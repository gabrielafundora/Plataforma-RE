// Deal/Underwriting ligero (§3.3, §7.1 pantalla 3, decisión 8·01) — el
// motor que responde "¿el número cierra?" con 4-6 supuestos de alto
// nivel, ANTES de que exista Budget/Inventory/Debt real. A propósito
// mucho más simple que el Cash Flow Engine real
// (lib/businessplan/monthlyLedger.ts): sin curvas configurables (todo
// straight-line sobre un único horizonte), deuda sin amortización
// (bullet — se liquida completa en el último mes), equity como el
// residual entre ingreso y costo+deuda. No es un forecast operativo,
// es una calculadora de underwriting rápida — la spec lo pide
// explícitamente reducido ("obligar a llenar el wizard completo... para
// solo ver si el número cierra genera fricción").
//
// Reusa calculateIRR/calculateNPV/calculateMOIC de returns.ts sin
// cambiar una línea: son funciones puras sobre number[], no les importa
// si el flujo viene de datos reales (ejecución) o de supuestos (UW) —
// el mismo motor de retornos sirve para ambas etapas.
import { calculateIRR, calculateNPV, calculateMOIC, DISCOUNT_RATE } from "@/lib/businessplan/returns";

export interface ScenarioAssumptions {
  pricePerM2: number;
  totalAreaM2: number;
  /** 0-1: costo total como fracción del ingreso total. */
  constructionCostPct: number;
  /** Meses del proyecto. El costo se reparte en línea recta sobre todo
   * el horizonte (construcción arranca en el mes 0); el ingreso arranca
   * a la mitad del horizonte y se reparte en línea recta sobre la
   * segunda mitad (preventa/cierre concentrados en la segunda mitad de
   * obra — heurística simple pero real de UW: sin este desfase, costo e
   * ingreso corriendo parejos desde el mes 0 nunca cruzan cero y el
   * IRR queda indefinido incluso en un deal rentable). */
  horizonMonths: number;
  leveraged: boolean;
  /** 0-1: loan-to-cost. Solo aplica si leveraged. */
  ltc?: number;
  /** Tasa anual, en basis points. Solo aplica si leveraged. */
  interestRateBps?: number;
}

export interface ScenarioResult {
  totalRevenue: number;
  totalCost: number;
  loanAmount: number;
  equityRequired: number;
  ingresos: number[];
  egresos: number[];
  debtDrawsIn: number[];
  debtInterestOut: number[];
  debtPrincipalOut: number[];
  equityIn: number[];
  /** Ingreso − costo, sin financiamiento. */
  unleveredCashFlow: number[];
  /** Lo que recibe/pone el equity: -aportación + ingreso neto de
   * servicio de deuda (el ingreso ya cubre el costo vía deuda+equity
   * cada mes, así que lo que sobra después de deuda es la
   * "distribución" implícita del equity — no hay tabla de
   * distributions en esta etapa, es puramente aritmético). */
  equityCashFlow: number[];
  unleveredIrr: number | null;
  leveredIrr: number | null;
  npv: number;
  moic: number | null;
  leveredMoic: number | null;
  profitMargin: number | null;
}

// scenario_assumptions es key/value genérico en la DB (§3.3 —
// "los supuestos de underwriting varían por asset class y evolucionan;
// no se fija una columna por supuesto"). Estas dos funciones son el
// único lugar que conoce el mapeo entre esas claves y
// ScenarioAssumptions — tanto la pantalla de comparación como
// lib/actions/deal.ts las usan, así que un cambio de clave se hace en
// un solo lugar.
const ASSUMPTION_KEYS = {
  pricePerM2: "price_per_m2",
  totalAreaM2: "total_area_m2",
  constructionCostPct: "construction_cost_pct",
  horizonMonths: "horizon_months",
  leveraged: "leveraged",
  ltc: "ltc",
  interestRateBps: "interest_rate_bps",
} as const;

export function assumptionsToRows(a: ScenarioAssumptions): { key: string; value: number }[] {
  const rows: { key: string; value: number }[] = [
    { key: ASSUMPTION_KEYS.pricePerM2, value: a.pricePerM2 },
    { key: ASSUMPTION_KEYS.totalAreaM2, value: a.totalAreaM2 },
    { key: ASSUMPTION_KEYS.constructionCostPct, value: a.constructionCostPct },
    { key: ASSUMPTION_KEYS.horizonMonths, value: a.horizonMonths },
    { key: ASSUMPTION_KEYS.leveraged, value: a.leveraged ? 1 : 0 },
  ];
  if (a.leveraged) {
    rows.push({ key: ASSUMPTION_KEYS.ltc, value: a.ltc ?? 0 });
    rows.push({ key: ASSUMPTION_KEYS.interestRateBps, value: a.interestRateBps ?? 0 });
  }
  return rows;
}

/** Inverso de assumptionsToRows — con defaults seguros si alguna clave
 * llegara a faltar (nunca debería, pero evita un NaN silencioso). */
export function assumptionsFromRows(rows: { key: string; value: number | string }[]): ScenarioAssumptions {
  const byKey = new Map(rows.map((r) => [r.key, Number(r.value)]));
  const leveraged = (byKey.get(ASSUMPTION_KEYS.leveraged) ?? 0) === 1;
  return {
    pricePerM2: byKey.get(ASSUMPTION_KEYS.pricePerM2) ?? 0,
    totalAreaM2: byKey.get(ASSUMPTION_KEYS.totalAreaM2) ?? 0,
    constructionCostPct: byKey.get(ASSUMPTION_KEYS.constructionCostPct) ?? 0,
    horizonMonths: byKey.get(ASSUMPTION_KEYS.horizonMonths) ?? 1,
    leveraged,
    ltc: leveraged ? byKey.get(ASSUMPTION_KEYS.ltc) ?? 0 : undefined,
    interestRateBps: leveraged ? byKey.get(ASSUMPTION_KEYS.interestRateBps) ?? 0 : undefined,
  };
}

export function evaluateScenario(a: ScenarioAssumptions): ScenarioResult {
  const months = Math.max(1, Math.round(a.horizonMonths));
  const totalRevenue = a.totalAreaM2 * a.pricePerM2;
  const totalCost = totalRevenue * a.constructionCostPct;
  const monthlyCost = totalCost / months;

  // Ventas arrancan a la mitad del horizonte, repartidas en línea recta
  // sobre la segunda mitad — ver el comentario en ScenarioAssumptions.
  const salesStartMonth = Math.floor(months / 2);
  const salesMonths = months - salesStartMonth;
  const monthlyRevenue = totalRevenue / salesMonths;

  const egresos = Array(months).fill(monthlyCost) as number[];
  const ingresos = Array.from({ length: months }, (_, i) => (i >= salesStartMonth ? monthlyRevenue : 0));

  const ltc = a.leveraged ? Math.min(Math.max(a.ltc ?? 0, 0), 1) : 0;
  const loanAmount = totalCost * ltc;
  const equityRequired = totalCost - loanAmount;

  const debtDrawsIn = egresos.map((c) => c * ltc);
  const equityIn = egresos.map((c) => c * (1 - ltc));

  const monthlyRate = a.leveraged && a.interestRateBps ? a.interestRateBps / 10000 / 12 : 0;
  const debtInterestOut = Array(months).fill(0) as number[];
  const debtPrincipalOut = Array(months).fill(0) as number[];
  let outstanding = 0;
  for (let i = 0; i < months; i++) {
    debtInterestOut[i] = outstanding * monthlyRate;
    outstanding += debtDrawsIn[i];
  }
  if (a.leveraged) {
    debtPrincipalOut[months - 1] = outstanding; // bullet al final del horizonte
  }

  const unleveredCashFlow = ingresos.map((r, i) => r - egresos[i]);
  const equityCashFlow = ingresos.map(
    (r, i) => r - equityIn[i] - debtInterestOut[i] - debtPrincipalOut[i]
  );

  const profitMargin = totalRevenue > 0 ? (totalRevenue - totalCost) / totalRevenue : null;

  return {
    totalRevenue,
    totalCost,
    loanAmount,
    equityRequired,
    ingresos,
    egresos,
    debtDrawsIn,
    debtInterestOut,
    debtPrincipalOut,
    equityIn,
    unleveredCashFlow,
    equityCashFlow,
    unleveredIrr: calculateIRR(unleveredCashFlow),
    leveredIrr: a.leveraged ? calculateIRR(equityCashFlow) : null,
    npv: calculateNPV(DISCOUNT_RATE, unleveredCashFlow),
    moic: calculateMOIC(unleveredCashFlow),
    leveredMoic: a.leveraged ? calculateMOIC(equityCashFlow) : null,
    profitMargin,
  };
}
