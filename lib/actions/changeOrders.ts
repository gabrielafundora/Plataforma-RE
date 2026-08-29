"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { changeOrders, approvalRequests } from "@/lib/db/schema";
import { getDevUserId } from "@/lib/auth/devUser";
import { resolveRequiredRole } from "@/lib/actions/approvals";

// Implements §7.2·B ("Aprobar un Change Order"). Approving here is what
// actually amends the contract — contract_rollup.current_amount sums
// cost_impact from approved change orders, which feeds Budget's
// Committed figure. No separate "apply to budget" step: the view does
// it the moment the status flips.

const createSchema = z.object({
  contractId: z.string().uuid(),
  description: z.string().min(1),
  costImpact: z.coerce.number(), // can be negative (a credit)
  scheduleImpactDays: z.coerce.number().int().default(0),
});

export async function createChangeOrder(formData: FormData) {
  const parsed = createSchema.parse({
    contractId: formData.get("contractId"),
    description: formData.get("description"),
    costImpact: formData.get("costImpact"),
    scheduleImpactDays: formData.get("scheduleImpactDays") || 0,
  });
  const userId = await getDevUserId();

  const [co] = await db
    .insert(changeOrders)
    .values({
      contractId: parsed.contractId,
      description: parsed.description,
      costImpact: String(parsed.costImpact),
      scheduleImpactDays: parsed.scheduleImpactDays,
      status: "submitted",
      requestedBy: userId,
    })
    .returning();

  const requiredRole = await resolveRequiredRole("change_order", parsed.costImpact);
  await db.insert(approvalRequests).values({
    entityType: "change_order",
    entityId: co.id,
    amount: String(Math.abs(parsed.costImpact)),
    requestedBy: userId,
    requiredRole,
    status: "pending",
  });

  revalidatePath("/", "layout");
}

const decideSchema = z.object({
  changeOrderId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
});

export async function decideChangeOrder(formData: FormData) {
  const parsed = decideSchema.parse({
    changeOrderId: formData.get("changeOrderId"),
    decision: formData.get("decision"),
  });
  const userId = await getDevUserId();
  const decidedAt = new Date();

  await db
    .update(changeOrders)
    .set({ status: parsed.decision, decidedBy: userId, decidedAt })
    .where(eq(changeOrders.id, parsed.changeOrderId));

  await db
    .update(approvalRequests)
    .set({ status: parsed.decision, decidedBy: userId, decidedAt })
    .where(
      and(eq(approvalRequests.entityType, "change_order"), eq(approvalRequests.entityId, parsed.changeOrderId))
    );

  revalidatePath("/", "layout");
}
