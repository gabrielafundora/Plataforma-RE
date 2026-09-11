"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, ilike, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { portfolios, projects, phases, scenarios, scenarioAssumptions, snapshots, cashFlowPeriods, cashFlowLines, returnMetrics } from "@/lib/db/schema";
import { getDevOrgId, getDevUserId } from "@/lib/auth/devUser";
import { evaluateScenario, assumptionsToRows, assumptionsFromRows } from "@/lib/deal/scenarioModel";
import { buildCashFlowPeriodRows, buildReturnMetricRows } from "@/lib/monthlyClose/buildSnapshotRows";

// Deal/Underwriting ligero (§3.3, §7.1 pantalla 3, decisión 8·01) —
// "wizard reducido... aquí y solo aquí se mueven supuestos y se
// comparan Scenarios antes de aprobar". Sin modo Team (decisión de
// scope: "sin team completo" — Project Team & Permisos, pantalla 4, es
// una pantalla aparte que esta app no construyó) y sin paso Asset
// separado (Residential For Sale es el único valor posible, decisión
// 8·04 — no hay nada que elegir).

async function requireDeal(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("Proyecto no encontrado.");
  if (project.status !== "deal") {
    throw new Error(`Este proyecto ya no está en etapa Deal (status=${project.status}) — los Scenarios ya no son editables.`);
  }
  return project;
}

const createDealSchema = z.object({
  name: z.string().min(1),
  portfolioName: z.string().min(1),
  strategy: z.enum(["development", "acquisition"]),
  currency: z.enum(["USD", "MXN"]),
  market: z.enum(["US", "MX"]),
  location: z.string().optional(),
  spvEntityName: z.string().optional(),
});

export async function createDeal(formData: FormData) {
  const parsed = createDealSchema.parse({
    name: formData.get("name"),
    portfolioName: formData.get("portfolioName"),
    strategy: formData.get("strategy"),
    currency: formData.get("currency"),
    market: formData.get("market"),
    location: formData.get("location") || undefined,
    spvEntityName: formData.get("spvEntityName") || undefined,
  });
  const orgId = await getDevOrgId();

  const [existingPortfolio] = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.organizationId, orgId), ilike(portfolios.name, parsed.portfolioName)));

  const portfolio =
    existingPortfolio ??
    (await db.insert(portfolios).values({ organizationId: orgId, name: parsed.portfolioName }).returning())[0];

  const [project] = await db
    .insert(projects)
    .values({
      portfolioId: portfolio.id,
      name: parsed.name,
      status: "deal",
      strategy: parsed.strategy,
      assetClass: "residential_for_sale",
      currency: parsed.currency,
      market: parsed.market,
      location: parsed.location,
      spvEntityName: parsed.spvEntityName,
      // approvedAt se queda null hasta aprobar — es literalmente lo que
      // distingue un Deal de un Project (ver requireDeal arriba).
    })
    .returning();

  await db.insert(phases).values({
    projectId: project.id,
    name: "Fase única",
    assetClass: "residential_for_sale",
  });

  redirect(`/projects/${project.id}/deal`);
}

const scenarioFormSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1),
  pricePerM2: z.coerce.number().positive(),
  totalAreaM2: z.coerce.number().positive(),
  constructionCostPercent: z.coerce.number().min(0).max(100),
  horizonMonths: z.coerce.number().int().positive(),
  leveraged: z.string().optional(),
  ltcPercent: z.coerce.number().min(0).max(100).optional(),
  interestRatePercent: z.coerce.number().min(0).optional(),
});

function parseScenarioForm(formData: FormData) {
  const parsed = scenarioFormSchema.parse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
    pricePerM2: formData.get("pricePerM2"),
    totalAreaM2: formData.get("totalAreaM2"),
    constructionCostPercent: formData.get("constructionCostPercent"),
    horizonMonths: formData.get("horizonMonths"),
    leveraged: formData.get("leveraged") || undefined,
    ltcPercent: formData.get("ltcPercent") || undefined,
    interestRatePercent: formData.get("interestRatePercent") || undefined,
  });
  const leveraged = !!parsed.leveraged;
  return {
    projectId: parsed.projectId,
    name: parsed.name,
    assumptions: {
      pricePerM2: parsed.pricePerM2,
      totalAreaM2: parsed.totalAreaM2,
      constructionCostPct: parsed.constructionCostPercent / 100,
      horizonMonths: parsed.horizonMonths,
      leveraged,
      ltc: leveraged ? (parsed.ltcPercent ?? 0) / 100 : undefined,
      interestRateBps: leveraged ? (parsed.interestRatePercent ?? 0) * 100 : undefined,
    },
  };
}

export async function createScenario(formData: FormData) {
  const { projectId, name, assumptions } = parseScenarioForm(formData);
  await requireDeal(projectId);
  const userId = await getDevUserId();

  const [scenario] = await db
    .insert(scenarios)
    .values({ projectId, name, status: "draft", createdBy: userId })
    .returning();

  const rows = assumptionsToRows(assumptions);
  await db.insert(scenarioAssumptions).values(rows.map((r) => ({ scenarioId: scenario.id, key: r.key, value: String(r.value) })));

  revalidatePath("/", "layout");
}

const updateScenarioSchema = scenarioFormSchema.extend({ scenarioId: z.string().uuid() });

export async function updateScenario(formData: FormData) {
  const parsedBase = parseScenarioForm(formData);
  const { scenarioId } = updateScenarioSchema.parse({
    ...Object.fromEntries(formData.entries()),
    scenarioId: formData.get("scenarioId"),
  });
  await requireDeal(parsedBase.projectId);

  await db.update(scenarios).set({ name: parsedBase.name, updatedAt: new Date() }).where(eq(scenarios.id, scenarioId));

  // Full replace de los supuestos — mismo criterio que updateTask: es
  // un set chico y fijo de claves, más simple y menos propenso a error
  // que un diff parcial.
  await db.delete(scenarioAssumptions).where(eq(scenarioAssumptions.scenarioId, scenarioId));
  const rows = assumptionsToRows(parsedBase.assumptions);
  await db.insert(scenarioAssumptions).values(rows.map((r) => ({ scenarioId, key: r.key, value: String(r.value) })));

  revalidatePath("/", "layout");
}

const deleteScenarioSchema = z.object({ scenarioId: z.string().uuid(), projectId: z.string().uuid() });

export async function deleteScenario(formData: FormData) {
  const parsed = deleteScenarioSchema.parse({
    scenarioId: formData.get("scenarioId"),
    projectId: formData.get("projectId"),
  });
  await requireDeal(parsed.projectId);
  await db.delete(scenarios).where(eq(scenarios.id, parsed.scenarioId)); // cascada -> scenario_assumptions
  revalidatePath("/", "layout");
}

const approveDealSchema = z.object({ projectId: z.string().uuid(), scenarioId: z.string().uuid() });

/** "Aprobar Deal → Project" (§3.3): congela el Scenario elegido como
 * Baseline — el primer Snapshot del proyecto — y promueve el proyecto a
 * `active`. A partir de aquí el Scenario elegido deja de ser editable
 * (§3.3: "no hay edición de escenarios en ejecución") y todo el resto
 * de la app (Budget, Schedule, Revenue, Capital) arranca desde cero:
 * esta vuelta no auto-genera BudgetLines/Units/DebtFacility desde los
 * supuestos del Scenario — eso se captura después con las pantallas que
 * ya existen (Budget Setup, Inventario, Debt Facility). Lo que sí se
 * congela es el pronóstico de retorno con el que se tomó la decisión de
 * aprobar, para que Returns/Snapshots por fin tengan una Baseline real
 * contra la cual comparar. */
export async function approveDeal(formData: FormData) {
  const { projectId, scenarioId } = approveDealSchema.parse({
    projectId: formData.get("projectId"),
    scenarioId: formData.get("scenarioId"),
  });

  await requireDeal(projectId);
  const userId = await getDevUserId();

  const assumptionRows = await db.select().from(scenarioAssumptions).where(eq(scenarioAssumptions.scenarioId, scenarioId));
  if (assumptionRows.length === 0) throw new Error("Scenario sin supuestos — no se puede aprobar.");
  const assumptions = assumptionsFromRows(assumptionRows);
  const result = evaluateScenario(assumptions);

  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  await db.transaction(async (tx) => {
    await tx
      .update(scenarios)
      .set({ status: "chosen", updatedAt: now })
      .where(eq(scenarios.id, scenarioId));
    await tx
      .update(scenarios)
      .set({ status: "archived", updatedAt: now })
      .where(and(eq(scenarios.projectId, projectId), ne(scenarios.id, scenarioId)));

    await tx.update(projects).set({ status: "active", approvedAt: now, updatedAt: now }).where(eq(projects.id, projectId));

    const [snap] = await tx
      .insert(snapshots)
      .values({ projectId, type: "baseline", sourceScenarioId: scenarioId, periodMonth: null, createdBy: userId })
      .returning();

    // El mismo par buildCashFlowPeriodRows/buildReturnMetricRows que usa
    // Monthly Close — le basta con la forma de un MonthlyLedger, no le
    // importa si esos números vienen de datos reales o, como aquí, del
    // motor de UW. currentPeriodIndex=-1: nada es "actual" todavía, el
    // proyecto se acaba de aprobar.
    const periodRows = buildCashFlowPeriodRows({
      periods: result.ingresos.length,
      startMonth,
      currentPeriodIndex: -1,
      ingresos: result.ingresos,
      egresos: result.egresos,
      cfBeforeFinancing: result.unleveredCashFlow,
      debtDrawsIn: result.debtDrawsIn,
      debtInterestOut: result.debtInterestOut,
      debtPrincipalOut: result.debtPrincipalOut,
      equityIn: result.equityIn,
      equityOut: Array(result.ingresos.length).fill(0),
      netLevered: result.equityCashFlow,
      totals: {
        currentBudget: result.totalCost,
        contractedRevenue: 0,
        projectedRevenue: result.totalRevenue,
        loanAmount: result.loanAmount,
        equityCommitment: result.equityRequired,
      },
    });

    const insertedPeriods = await tx
      .insert(cashFlowPeriods)
      .values(periodRows.map((p) => ({ snapshotId: snap.id, periodMonth: p.periodMonth, isActual: p.isActual })))
      .returning();
    const lineValues = insertedPeriods.flatMap((cfp, i) =>
      periodRows[i].lines.map((l) => ({ cashFlowPeriodId: cfp.id, category: l.category, amount: String(l.amount) }))
    );
    if (lineValues.length > 0) await tx.insert(cashFlowLines).values(lineValues);

    const metricRows = buildReturnMetricRows(
      {
        periods: result.ingresos.length,
        startMonth,
        currentPeriodIndex: -1,
        ingresos: result.ingresos,
        egresos: result.egresos,
        cfBeforeFinancing: result.unleveredCashFlow,
        debtDrawsIn: result.debtDrawsIn,
        debtInterestOut: result.debtInterestOut,
        debtPrincipalOut: result.debtPrincipalOut,
        equityIn: result.equityIn,
        equityOut: Array(result.ingresos.length).fill(0),
        netLevered: result.equityCashFlow,
        totals: {
          currentBudget: result.totalCost,
          contractedRevenue: 0,
          projectedRevenue: result.totalRevenue,
          loanAmount: result.loanAmount,
          equityCommitment: result.equityRequired,
        },
      },
      {
        unleveredIrr: result.unleveredIrr,
        leveredIrr: result.leveredIrr,
        unleveredNpv: result.npv,
        unleveredMoic: result.moic,
        leveredMoic: result.leveredMoic,
        profitMargin: result.profitMargin,
      }
    );
    if (metricRows.length > 0) {
      await tx.insert(returnMetrics).values(metricRows.map((m) => ({ snapshotId: snap.id, scope: m.scope, metricKey: m.metricKey, value: String(m.value) })));
    }
  });

  revalidatePath("/", "layout");
  redirect(`/projects/${projectId}`);
}
