// Capital — funding waterfall Equity First (§4.4, único soportado en el
// MVP — decisión 8·07). El diagrama de secuencia de §4.4 es literal:
// cada mes, si hay déficit de caja (egresos > ingresos), primero se le
// pide a equity hasta agotar lo comprometido y aún no aportado; lo que
// falta después de eso se dispone de deuda. Es la pieza que responde la
// pregunta operativa del producto: "¿cuánto equity necesito aportar el
// próximo mes?" — por eso se construye y se prueba antes que cualquier
// pantalla, mismo criterio que lib/forecast/engine.ts y
// lib/revenue/paymentPlan.ts.

export interface EquityFirstInput {
  /** Egresos del mes (cost forecast) menos ingresos del mes (collections). Puede ser negativo (superávit). */
  cashDeficit: number;
  /** Compromisos de equity todavía no aportados (suma de equity_investor_rollup.remaining_commitment). */
  equityAvailable: number;
}

export interface EquityFirstResult {
  equityCallAmount: number;
  debtDrawAmount: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function allocateEquityFirst(input: EquityFirstInput): EquityFirstResult {
  const deficit = Math.max(0, round2(input.cashDeficit));
  const equityAvailable = Math.max(0, round2(input.equityAvailable));

  const equityCallAmount = Math.min(deficit, equityAvailable);
  const debtDrawAmount = round2(deficit - equityCallAmount);

  return { equityCallAmount: round2(equityCallAmount), debtDrawAmount };
}
