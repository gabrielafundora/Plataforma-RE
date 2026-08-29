"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { z } from "zod";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { budgetChanges, approvalRequests } from "@/lib/db/schema";
import { getDevUserId } from "@/lib/auth/devUser";
import { resolveRequiredRole } from "@/lib/actions/approvals";
import { groupTag, extractGroupId } from "@/lib/budgetChanges/groupTag";

// El presupuesto original (BudgetLine.original_amount) no se mueve una
// vez dado de alta — para llegar al "presupuesto actualizado" (Current,
// ver budget_line_rollup: original + budget_changes aprobados) el
// camino normal es uno de estos dos, ambos ruteados por Approval
// Authorities (§4.7, entity_type "budget_change") igual que un Change
// Order, y sin efecto en Current hasta que se aprueban:
//   - Aditiva: sube el total del proyecto en esta partida.
//   - Rebalanceo: mueve monto de una partida a otra sin tocar el total
//     (dos filas de budget_changes con signo opuesto, atadas por un tag
//     de grupo en "reason" ya que el schema no tiene una tabla puente —
//     se aprueban/rechazan siempre juntas, nunca una sin la otra).

const createSchema = z.object({
  type: z.enum(["aditiva", "rebalanceo"]),
  budgetLineId: z.string().uuid(),
  destinationBudgetLineId: z.string().uuid().optional(),
  amount: z.coerce.number().positive(),
  reason: z.string().min(1),
});

export async function createBudgetChange(formData: FormData) {
  const parsed = createSchema.parse({
    type: formData.get("type"),
    budgetLineId: formData.get("budgetLineId"),
    destinationBudgetLineId: formData.get("destinationBudgetLineId") || undefined,
    amount: formData.get("amount"),
    reason: formData.get("reason"),
  });
  const userId = await getDevUserId();
  const requiredRole = await resolveRequiredRole("budget_change", parsed.amount);

  if (parsed.type === "aditiva") {
    const [bc] = await db
      .insert(budgetChanges)
      .values({
        budgetLineId: parsed.budgetLineId,
        amount: String(parsed.amount),
        reason: parsed.reason,
        requestedBy: userId,
      })
      .returning();
    await db.insert(approvalRequests).values({
      entityType: "budget_change",
      entityId: bc.id,
      amount: String(parsed.amount),
      requestedBy: userId,
      requiredRole,
      status: "pending",
    });
  } else {
    if (!parsed.destinationBudgetLineId) {
      throw new Error("Un rebalanceo requiere una partida destino.");
    }
    if (parsed.destinationBudgetLineId === parsed.budgetLineId) {
      throw new Error("La partida destino debe ser distinta a la de origen.");
    }
    const taggedReason = `${parsed.reason} ${groupTag(randomUUID())}`;

    const [outgoing] = await db
      .insert(budgetChanges)
      .values({
        budgetLineId: parsed.budgetLineId,
        amount: String(-parsed.amount),
        reason: taggedReason,
        requestedBy: userId,
      })
      .returning();
    const [incoming] = await db
      .insert(budgetChanges)
      .values({
        budgetLineId: parsed.destinationBudgetLineId,
        amount: String(parsed.amount),
        reason: taggedReason,
        requestedBy: userId,
      })
      .returning();

    await db.insert(approvalRequests).values([
      {
        entityType: "budget_change",
        entityId: outgoing.id,
        amount: String(parsed.amount),
        requestedBy: userId,
        requiredRole,
        status: "pending",
      },
      {
        entityType: "budget_change",
        entityId: incoming.id,
        amount: String(parsed.amount),
        requestedBy: userId,
        requiredRole,
        status: "pending",
      },
    ]);
  }

  revalidatePath("/", "layout");
}

const decideSchema = z.object({
  budgetChangeId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
});

export async function decideBudgetChange(formData: FormData) {
  const parsed = decideSchema.parse({
    budgetChangeId: formData.get("budgetChangeId"),
    decision: formData.get("decision"),
  });
  const userId = await getDevUserId();
  const decidedAt = new Date();

  const [bc] = await db.select().from(budgetChanges).where(eq(budgetChanges.id, parsed.budgetChangeId));
  if (!bc) throw new Error("Cambio de presupuesto no encontrado.");

  const groupId = extractGroupId(bc.reason);
  let idsToUpdate = [bc.id];
  if (groupId) {
    const siblings = await db
      .select({ id: budgetChanges.id })
      .from(budgetChanges)
      .where(like(budgetChanges.reason, `%${groupTag(groupId)}%`));
    idsToUpdate = siblings.map((s) => s.id);
  }

  for (const id of idsToUpdate) {
    await db
      .update(budgetChanges)
      .set({
        approvedBy: parsed.decision === "approved" ? userId : null,
        approvedAt: parsed.decision === "approved" ? decidedAt : null,
      })
      .where(eq(budgetChanges.id, id));
    await db
      .update(approvalRequests)
      .set({ status: parsed.decision, decidedBy: userId, decidedAt })
      .where(and(eq(approvalRequests.entityType, "budget_change"), eq(approvalRequests.entityId, id)));
  }

  revalidatePath("/", "layout");
}
