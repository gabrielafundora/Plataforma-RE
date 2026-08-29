"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { invoices, payments } from "@/lib/db/schema";

// Implements §7.2·A ("Registrar una factura y ver su impacto en el
// forecast") for this slice. Approval routing (ApprovalRequest) is
// deliberately deferred to a later slice — here an invoice moves
// straight from submitted -> approved so the cash-basis mechanic
// (decisión 8·03) can be exercised end to end.

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

  await db.insert(invoices).values({
    contractId: parsed.contractId,
    invoiceNumber: parsed.invoiceNumber,
    invoiceDate: parsed.invoiceDate,
    netAmount: String(parsed.netAmount),
    status: "approved",
    approvedAt: new Date(),
  });

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
