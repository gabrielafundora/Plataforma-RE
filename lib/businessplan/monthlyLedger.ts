// El Cash Flow Engine (§4.3): "no es una pantalla, es la función de
// cálculo que corre cada vez que cambia cualquier input de Plan, Costs,
// Revenue o Capital. Las pantallas (Project Cash Flow, Returns) son
// lecturas de su resultado." Esta es esa función — /cashflow y /returns
// solo la leen, ninguna tiene su propia lógica de cálculo.
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  projects,
  phases,
  budgetLines,
  budgetLineRollup,
  payments,
  invoices,
  contracts,
  collections,
  sales,
  units,
  debtFacilities,
  debtDraws,
  debtPayments,
  equityInvestors,
  equityContributions,
  distributions,
} from "@/lib/db/schema";
import { rollingForecast, type CurveMethod } from "@/lib/forecast/engine";

const IMPLEMENTED_METHODS = new Set<CurveMethod>(["straight_line", "s_curve", "front_loaded", "back_loaded"]);

export function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export interface MonthlyLedger {
  periods: number;
  startMonth: Date;
  currentPeriodIndex: number;
  /** Ingresos (collections) por mes. */
  ingresos: number[];
  /** Egresos (cost forecast) por mes. */
  egresos: number[];
  /** Ingresos − Egresos, antes de financiamiento. */
  cfBeforeFinancing: number[];
  debtDrawsIn: number[];
  debtInterestOut: number[];
  debtPrincipalOut: number[];
  equityIn: number[];
  equityOut: number[];
  /** cfBeforeFinancing + deuda neta + equity neto, por mes. */
  netLevered: number[];
  /** Totales agregados para Sources & Uses / Profit Margin (screen 17). */
  totals: {
    currentBudget: number;
    /** Suma de sales.price_total de lo ya vendido — para Sources & Uses. */
    contractedRevenue: number;
    /** Vendido a precio real + no vendido a precio de lista — base de Profit Margin. */
    projectedRevenue: number;
    loanAmount: number;
    equityCommitment: number;
  };
}

export async function computeMonthlyLedger(projectId: string): Promise<MonthlyLedger> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));

  const startMonth = new Date(project.approvedAt ?? project.createdAt);
  startMonth.setDate(1);
  startMonth.setHours(0, 0, 0, 0);

  const currentPeriodIndex = monthsBetween(startMonth, new Date());
  const periods = project.forecastMonths;

  const monthIndexOf = (dateStr: string) => monthsBetween(startMonth, new Date(dateStr));

  // --- Egresos: mismo cálculo que /forecast ---
  const lineRows = await db
    .select({
      budgetLineId: budgetLines.id,
      forecastMethod: budgetLines.forecastMethod,
      current: budgetLineRollup.currentAmount,
    })
    .from(budgetLines)
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .leftJoin(budgetLineRollup, eq(budgetLineRollup.budgetLineId, budgetLines.id))
    .where(eq(phases.projectId, projectId));

  const costPaymentRows = await db
    .select({ budgetLineId: budgetLines.id, amount: payments.amount, paidDate: payments.paidDate })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(contracts, eq(contracts.id, invoices.contractId))
    .innerJoin(budgetLines, eq(budgetLines.id, contracts.budgetLineId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .where(eq(phases.projectId, projectId));

  const paymentsByLine = new Map<string, Map<number, number>>();
  for (const p of costPaymentRows) {
    const idx = monthIndexOf(p.paidDate);
    if (idx < 0 || idx >= periods) continue;
    if (!paymentsByLine.has(p.budgetLineId)) paymentsByLine.set(p.budgetLineId, new Map());
    const byPeriod = paymentsByLine.get(p.budgetLineId)!;
    byPeriod.set(idx, (byPeriod.get(idx) ?? 0) + Number(p.amount));
  }

  const egresos = Array(periods).fill(0) as number[];
  let currentBudget = 0;
  for (const line of lineRows) {
    const totalAmount = Number(line.current ?? 0);
    currentBudget += totalAmount;
    const method: CurveMethod = IMPLEMENTED_METHODS.has(line.forecastMethod as CurveMethod)
      ? (line.forecastMethod as CurveMethod)
      : "straight_line";
    const byPeriod = paymentsByLine.get(line.budgetLineId);
    const actuals: (number | null)[] = Array.from({ length: periods }, (_, i) =>
      i <= currentPeriodIndex ? byPeriod?.get(i) ?? 0 : null
    );
    const result = rollingForecast({ totalAmount, periods, method, actuals });
    for (const p of result.schedule) egresos[p.period] += p.amount;
  }

  // --- Ingresos: collections con vencimiento en cada mes ---
  const collectionRows = await db
    .select({ amount: collections.amount, dueDate: collections.dueDate })
    .from(collections)
    .innerJoin(sales, eq(sales.id, collections.saleId))
    .innerJoin(units, eq(units.id, sales.unitId))
    .innerJoin(phases, eq(phases.id, units.phaseId))
    .where(eq(phases.projectId, projectId));

  const ingresos = Array(periods).fill(0) as number[];
  for (const c of collectionRows) {
    const idx = monthIndexOf(c.dueDate);
    if (idx >= 0 && idx < periods) ingresos[idx] += Number(c.amount);
  }

  // "Contractado" (para Sources & Uses) vs. "proyectado a venta completa"
  // (para Profit Margin) son cosas distintas: con solo 1 de 7 unidades
  // vendidas, usar el ingreso ya contratado como base de un margen da un
  // número absurdo (el margen no es "cuánto gano de lo vendido hasta
  // ahora", es "cuánto voy a ganar si vendo todo el inventario"). Las
  // unidades no vendidas se proyectan a su precio de lista.
  const allUnitRows = await db
    .select({ id: units.id, areaM2: units.areaM2, pricePerM2: units.pricePerM2 })
    .from(units)
    .innerJoin(phases, eq(phases.id, units.phaseId))
    .where(eq(phases.projectId, projectId));

  const soldPriceByUnit = new Map<string, number>();
  const saleRows = await db
    .select({ unitId: sales.unitId, priceTotal: sales.priceTotal })
    .from(sales)
    .innerJoin(units, eq(units.id, sales.unitId))
    .innerJoin(phases, eq(phases.id, units.phaseId))
    .where(eq(phases.projectId, projectId));
  for (const s of saleRows) soldPriceByUnit.set(s.unitId, Number(s.priceTotal));

  const contractedRevenue = saleRows.reduce((sum, s) => sum + Number(s.priceTotal), 0);
  const projectedRevenue = allUnitRows.reduce(
    (sum, u) => sum + (soldPriceByUnit.get(u.id) ?? Number(u.areaM2) * Number(u.pricePerM2)),
    0
  );

  // --- Deuda: draws (fondeado o, si aún no, lo solicitado) + pagos ---
  const [facility] = await db.select().from(debtFacilities).where(eq(debtFacilities.projectId, projectId));

  const debtDrawsIn = Array(periods).fill(0) as number[];
  const debtInterestOut = Array(periods).fill(0) as number[];
  const debtPrincipalOut = Array(periods).fill(0) as number[];

  if (facility) {
    const draws = await db.select().from(debtDraws).where(eq(debtDraws.debtFacilityId, facility.id));
    for (const d of draws) {
      const idx = monthIndexOf(d.periodMonth);
      if (idx < 0 || idx >= periods) continue;
      debtDrawsIn[idx] += Number(d.fundedAmount ?? d.requestedAmount);
    }

    const debtPaymentRows = await db.select().from(debtPayments).where(eq(debtPayments.debtFacilityId, facility.id));
    for (const p of debtPaymentRows) {
      const idx = monthIndexOf(p.periodMonth);
      if (idx < 0 || idx >= periods) continue;
      debtInterestOut[idx] += Number(p.interestAmount);
      debtPrincipalOut[idx] += Number(p.principalAmount);
    }
  }

  // --- Equity: contributions/distributions ---
  const investorRows = await db.select().from(equityInvestors).where(eq(equityInvestors.projectId, projectId));
  const equityCommitment = investorRows.reduce((sum, i) => sum + Number(i.commitmentAmount), 0);

  const equityIn = Array(periods).fill(0) as number[];
  const equityOut = Array(periods).fill(0) as number[];
  if (investorRows.length > 0) {
    const investorIds = new Set(investorRows.map((i) => i.id));
    const contributionRows = await db.select().from(equityContributions);
    for (const c of contributionRows) {
      if (!investorIds.has(c.equityInvestorId)) continue;
      const idx = monthIndexOf(c.periodMonth);
      if (idx >= 0 && idx < periods) equityIn[idx] += Number(c.amount);
    }
    const distributionRows = await db.select().from(distributions);
    for (const d of distributionRows) {
      if (!investorIds.has(d.equityInvestorId)) continue;
      const idx = monthIndexOf(d.periodMonth);
      if (idx >= 0 && idx < periods) equityOut[idx] += Number(d.amount);
    }
  }

  const cfBeforeFinancing = egresos.map((e, i) => ingresos[i] - e);
  const netLevered = cfBeforeFinancing.map(
    (cf, i) => cf + debtDrawsIn[i] - debtInterestOut[i] - debtPrincipalOut[i] + equityIn[i] - equityOut[i]
  );

  return {
    periods,
    startMonth,
    currentPeriodIndex,
    ingresos,
    egresos,
    cfBeforeFinancing,
    debtDrawsIn,
    debtInterestOut,
    debtPrincipalOut,
    equityIn,
    equityOut,
    netLevered,
    totals: {
      currentBudget,
      contractedRevenue,
      projectedRevenue,
      loanAmount: facility ? Number(facility.loanAmount) : 0,
      equityCommitment,
    },
  };
}
