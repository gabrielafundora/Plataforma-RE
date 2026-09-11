"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  debtFacilities,
  debtCovenants,
  debtDraws,
  debtPayments,
  equityInvestors,
  equityContributions,
  counterparties,
} from "@/lib/db/schema";
import { getDevOrgId } from "@/lib/auth/devUser";

// Capital — equity y deuda (§6, solo Equity First). Mismas convenciones
// que contracts.ts/invoices.ts: "use server", zod .parse() por acción,
// find-or-create para contrapartes (lender/investor), revalidatePath al
// final, sin capa de aprobaciones todavía para estas entidades (mismo
// criterio que contracts.ts del lado de Costs).

const debtFacilitySchema = z.object({
  projectId: z.string().uuid(),
  lenderName: z.string().min(1),
  loanAmount: z.coerce.number().positive(),
  ltcPercent: z.coerce.number().min(0).max(100).optional(),
  ltvPercent: z.coerce.number().min(0).max(100).optional(),
  referenceRate: z.string().optional(),
  spreadBps: z.coerce.number().int().optional(),
  termMonths: z.coerce.number().int().positive().optional(),
  amortizationMonths: z.coerce.number().int().positive().optional(),
  interestReserve: z.coerce.number().min(0).optional(),
  commitmentFeePercent: z.coerce.number().min(0).max(100).optional(),
});

// "Editar términos (solo antes de la primera disposición)" — un solo
// facility por proyecto (decisión 8·07: único). Da de alta si no existe,
// actualiza si existe y todavía no tiene draws (el caller ya validó eso
// antes de mostrar el form; aquí solo se re-valida el guard).
export async function saveDebtFacility(formData: FormData) {
  const parsed = debtFacilitySchema.parse({
    projectId: formData.get("projectId"),
    lenderName: formData.get("lenderName"),
    loanAmount: formData.get("loanAmount"),
    ltcPercent: formData.get("ltcPercent") || undefined,
    ltvPercent: formData.get("ltvPercent") || undefined,
    referenceRate: formData.get("referenceRate") || undefined,
    spreadBps: formData.get("spreadBps") || undefined,
    termMonths: formData.get("termMonths") || undefined,
    amortizationMonths: formData.get("amortizationMonths") || undefined,
    interestReserve: formData.get("interestReserve") || undefined,
    commitmentFeePercent: formData.get("commitmentFeePercent") || undefined,
  });
  const orgId = await getDevOrgId();

  const [existingLender] = await db
    .select()
    .from(counterparties)
    .where(and(eq(counterparties.organizationId, orgId), ilike(counterparties.name, parsed.lenderName)));
  const lender =
    existingLender ??
    (
      await db
        .insert(counterparties)
        .values({ organizationId: orgId, name: parsed.lenderName, type: "lender" })
        .returning()
    )[0];

  const values = {
    lenderId: lender.id,
    loanAmount: String(parsed.loanAmount),
    ltc: parsed.ltcPercent !== undefined ? String(parsed.ltcPercent / 100) : null,
    ltv: parsed.ltvPercent !== undefined ? String(parsed.ltvPercent / 100) : null,
    referenceRate: parsed.referenceRate ?? null,
    spreadBps: parsed.spreadBps ?? null,
    termMonths: parsed.termMonths ?? null,
    amortizationMonths: parsed.amortizationMonths ?? null,
    interestReserve: parsed.interestReserve !== undefined ? String(parsed.interestReserve) : "0",
    commitmentFeePct: parsed.commitmentFeePercent !== undefined ? String(parsed.commitmentFeePercent / 100) : "0",
  };

  const [existing] = await db.select().from(debtFacilities).where(eq(debtFacilities.projectId, parsed.projectId));
  const [anyDraw] = existing
    ? await db.select({ id: debtDraws.id }).from(debtDraws).where(eq(debtDraws.debtFacilityId, existing.id)).limit(1)
    : [undefined];

  if (existing) {
    if (anyDraw) {
      throw new Error("Ya tiene disposiciones registradas — los términos del crédito ya no se pueden editar.");
    }
    await db.update(debtFacilities).set({ ...values, updatedAt: new Date() }).where(eq(debtFacilities.id, existing.id));
  } else {
    await db.insert(debtFacilities).values({ projectId: parsed.projectId, ...values });
  }

  revalidatePath("/", "layout");
}

const addCovenantSchema = z.object({
  debtFacilityId: z.string().uuid(),
  name: z.string().min(1),
  threshold: z.string().min(1),
});

export async function addCovenant(formData: FormData) {
  const parsed = addCovenantSchema.parse({
    debtFacilityId: formData.get("debtFacilityId"),
    name: formData.get("name"),
    threshold: formData.get("threshold"),
  });
  await db.insert(debtCovenants).values(parsed);
  revalidatePath("/", "layout");
}

const recordCovenantTestSchema = z.object({
  covenantId: z.string().uuid(),
  status: z.string().min(1),
  testedAt: z.string().min(1),
});

export async function recordCovenantTest(formData: FormData) {
  const parsed = recordCovenantTestSchema.parse({
    covenantId: formData.get("covenantId"),
    status: formData.get("status"),
    testedAt: formData.get("testedAt"),
  });
  await db
    .update(debtCovenants)
    .set({ lastTestedStatus: parsed.status, lastTestedAt: parsed.testedAt })
    .where(eq(debtCovenants.id, parsed.covenantId));
  revalidatePath("/", "layout");
}

const requestDrawSchema = z.object({
  debtFacilityId: z.string().uuid(),
  periodMonth: z.string().min(1),
  requestedAmount: z.coerce.number().positive(),
});

// "Solicitar draw (pre-llenado por el motor Equity First)" — el
// pre-llenado pasa en la página (lib/capital/equityFirst.ts contra el
// forecast/cobranza del mes); aquí solo se captura lo que el usuario
// confirmó o ajustó.
export async function requestDraw(formData: FormData) {
  const parsed = requestDrawSchema.parse({
    debtFacilityId: formData.get("debtFacilityId"),
    periodMonth: formData.get("periodMonth"),
    requestedAmount: formData.get("requestedAmount"),
  });
  await db.insert(debtDraws).values({
    debtFacilityId: parsed.debtFacilityId,
    periodMonth: parsed.periodMonth,
    requestedAmount: String(parsed.requestedAmount),
  });
  revalidatePath("/", "layout");
}

// Sin "rejected" en debt_draw_status — es un avance lineal, no una
// decisión binaria como Invoice. Tres acciones chicas en vez de una
// genérica "advance" para que cada botón en la UI sea un <form> con su
// propio hidden hasta el estado exacto, mismo patrón que
// decideInvoice/markInvoicePaid.
async function advanceDraw(drawId: string, status: "submitted" | "approved") {
  await db.update(debtDraws).set({ status, updatedAt: new Date() }).where(eq(debtDraws.id, drawId));
  revalidatePath("/", "layout");
}

export async function submitDraw(formData: FormData) {
  const drawId = z.string().uuid().parse(formData.get("drawId"));
  await advanceDraw(drawId, "submitted");
}

export async function approveDraw(formData: FormData) {
  const drawId = z.string().uuid().parse(formData.get("drawId"));
  await advanceDraw(drawId, "approved");
}

const fundDrawSchema = z.object({
  drawId: z.string().uuid(),
  fundedAmount: z.coerce.number().positive(),
  fundedDate: z.string().min(1),
});

export async function fundDraw(formData: FormData) {
  const parsed = fundDrawSchema.parse({
    drawId: formData.get("drawId"),
    fundedAmount: formData.get("fundedAmount"),
    fundedDate: formData.get("fundedDate"),
  });
  await db
    .update(debtDraws)
    .set({ status: "funded", fundedAmount: String(parsed.fundedAmount), fundedDate: parsed.fundedDate, updatedAt: new Date() })
    .where(eq(debtDraws.id, parsed.drawId));
  revalidatePath("/", "layout");
}

const recordDebtPaymentSchema = z.object({
  debtFacilityId: z.string().uuid(),
  periodMonth: z.string().min(1),
  interestAmount: z.coerce.number().min(0),
  principalAmount: z.coerce.number().min(0),
});

export async function recordDebtPayment(formData: FormData) {
  const parsed = recordDebtPaymentSchema.parse({
    debtFacilityId: formData.get("debtFacilityId"),
    periodMonth: formData.get("periodMonth"),
    interestAmount: formData.get("interestAmount"),
    principalAmount: formData.get("principalAmount"),
  });
  await db.insert(debtPayments).values({
    debtFacilityId: parsed.debtFacilityId,
    periodMonth: parsed.periodMonth,
    interestAmount: String(parsed.interestAmount),
    principalAmount: String(parsed.principalAmount),
  });
  revalidatePath("/", "layout");
}

const createEquityInvestorSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1),
  isSponsor: z.string().optional(),
  commitmentAmount: z.coerce.number().positive(),
});

// "counterparty_id null = sponsor propio" — si no es el sponsor,
// reutiliza el mismo find-or-create de contracts.ts/addCostCode, con
// type "investor" (ya existe en counterparty_type).
export async function createEquityInvestor(formData: FormData) {
  const parsed = createEquityInvestorSchema.parse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
    isSponsor: formData.get("isSponsor") || undefined,
    commitmentAmount: formData.get("commitmentAmount"),
  });

  let counterpartyId: string | null = null;
  if (!parsed.isSponsor) {
    const orgId = await getDevOrgId();
    const [existing] = await db
      .select()
      .from(counterparties)
      .where(and(eq(counterparties.organizationId, orgId), ilike(counterparties.name, parsed.name)));
    const investor =
      existing ??
      (
        await db
          .insert(counterparties)
          .values({ organizationId: orgId, name: parsed.name, type: "investor" })
          .returning()
      )[0];
    counterpartyId = investor.id;
  }

  await db.insert(equityInvestors).values({
    projectId: parsed.projectId,
    counterpartyId,
    name: parsed.name,
    commitmentAmount: String(parsed.commitmentAmount),
  });

  revalidatePath("/", "layout");
}

const recordEquityContributionSchema = z.object({
  equityInvestorId: z.string().uuid(),
  periodMonth: z.string().min(1),
  amount: z.coerce.number().positive(),
});

export async function recordEquityContribution(formData: FormData) {
  const parsed = recordEquityContributionSchema.parse({
    equityInvestorId: formData.get("equityInvestorId"),
    periodMonth: formData.get("periodMonth"),
    amount: formData.get("amount"),
  });
  await db.insert(equityContributions).values({ ...parsed, amount: String(parsed.amount) });
  revalidatePath("/", "layout");
}
