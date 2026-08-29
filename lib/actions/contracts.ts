"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contracts, counterparties } from "@/lib/db/schema";
import { getDevOrgId } from "@/lib/auth/devUser";

// "No hay un botón para cargar un nuevo contrato" — this is that
// button's action. Counterparty is a free-text field with autocomplete
// (see the <datalist> on Budget Line Detail): typing an existing name
// reuses that Counterparty, anything else creates a new one — no
// separate "manage vendors" screen needed for this slice.

const createContractSchema = z.object({
  budgetLineId: z.string().uuid(),
  counterpartyName: z.string().min(1),
  scope: z.string().min(1),
  originalAmount: z.coerce.number().positive(),
});

export async function createContract(formData: FormData) {
  const parsed = createContractSchema.parse({
    budgetLineId: formData.get("budgetLineId"),
    counterpartyName: formData.get("counterpartyName"),
    scope: formData.get("scope"),
    originalAmount: formData.get("originalAmount"),
  });
  const orgId = await getDevOrgId();

  const [existing] = await db
    .select()
    .from(counterparties)
    .where(and(eq(counterparties.organizationId, orgId), ilike(counterparties.name, parsed.counterpartyName)));

  const counterparty =
    existing ??
    (
      await db
        .insert(counterparties)
        .values({ organizationId: orgId, name: parsed.counterpartyName, type: "vendor" })
        .returning()
    )[0];

  await db.insert(contracts).values({
    budgetLineId: parsed.budgetLineId,
    counterpartyId: counterparty.id,
    scope: parsed.scope,
    originalAmount: String(parsed.originalAmount),
    netAmount: String(parsed.originalAmount),
    status: "active",
    signedDate: new Date().toISOString().slice(0, 10),
  });

  revalidatePath("/", "layout");
}
