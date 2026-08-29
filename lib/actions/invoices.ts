"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { invoices, payments, approvalRequests } from "@/lib/db/schema";
import { getDevUserId } from "@/lib/auth/devUser";
import { resolveRequiredRole } from "@/lib/actions/approvals";

// Implements §7.2·A ("Registrar una factura y ver su impacto en el
// forecast") plus §4.7 Approval Authorities — invoices now route
// through the same pending -> approved/rejected pattern as Change
// Orders (lib/actions/changeOrders.ts) and Budget Changes
// (lib/actions/budgetChanges.ts), instead of skipping straight to
// "approved". markInvoicePaid still only makes sense once approved —
// gated in the UI, not here, same as before.

const createInvoiceSchema = z.object({
  contractId: z.string().uuid(),
  invoiceNumber: z.string().min(1),
  invoiceDate: z.string().min(1),
  netAmount: z.coerce.number().positive(),
});

export async function createInvoice(formData: FormData) {
  const parsed = createInvoiceSchema.parse({
    contractId: formData.get("contractId"),
    invoiceNumber: formData.get("invoiceNumber"),
    invoiceDate: formData.get("invoiceDate"),
    netAmount: formData.get("netAmount"),
  });
  const userId = await getDevUserId();

  const [invoice] = await db
    .insert(invoices)
    .values({
      contractId: parsed.contractId,
      invoiceNumber: parsed.invoiceNumber,
      invoiceDate: parsed.invoiceDate,
      netAmount: String(parsed.netAmount),
      status: "submitted",
    })
    .returning();

  const requiredRole = await resolveRequiredRole("invoice", parsed.netAmount);
  await db.insert(approvalRequests).values({
    entityType: "invoice",
    entityId: invoice.id,
    amount: String(parsed.netAmount),
    requestedBy: userId,
    requiredRole,
    status: "pending",
  });

  revalidatePath("/", "layout");
}

const decideSchema = z.object({
  invoiceId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
});

export async function decideInvoice(formData: FormData) {
  const parsed = decideSchema.parse({
    invoiceId: formData.get("invoiceId"),
    decision: formData.get("decision"),
  });
  const userId = await getDevUserId();
  const decidedAt = new Date();

  await db
    .update(invoices)
    .set({ status: parsed.decision, approvedBy: userId, approvedAt: decidedAt })
    .where(eq(invoices.id, parsed.invoiceId));

  await db
    .update(approvalRequests)
    .set({ status: parsed.decision, decidedBy: userId, decidedAt })
    .where(and(eq(approvalRequests.entityType, "invoice"), eq(approvalRequests.entityId, parsed.invoiceId)));

  revalidatePath("/", "layout");
}

const markPaidSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.coerce.number().positive(),
  paidDate: z.string().min(1),
});

export async function markInvoicePaid(formData: FormData) {
  const parsed = markPaidSchema.parse({
    invoiceId: formData.get("invoiceId"),
    amount: formData.get("amount"),
    paidDate: formData.get("paidDate"),
  });

  await db.insert(payments).values({
    invoiceId: parsed.invoiceId,
    amount: String(parsed.amount),
    paidDate: parsed.paidDate,
  });

  // Cash basis (decisión 8·03): this status flip is the exact moment
  // budget_line_rollup.actual_cost picks the amount up.
  await db.update(invoices).set({ status: "paid" }).where(eq(invoices.id, parsed.invoiceId));

  revalidatePath("/", "layout");
}
