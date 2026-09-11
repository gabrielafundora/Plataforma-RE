// Business Plan — Returns (§7.1, pantalla 17), recortado a lo que se
// puede calcular en vivo sin Monthly Close: "decisión 8·09 — nunca
// captura assumptions manualmente" sigue aplicando (todo se deriva del
// mismo cash flow mensual de Project Cash Flow, pantalla 16), pero la
// comparación Baseline/Actual/Current Forecast por Snapshot queda fuera
// de esta vuelta porque Snapshot lo genera Monthly Close (pantalla 18,
// no construida todavía) — ver docs/strategy §3.3.

function npvAtMonthlyRate(monthlyRate: number, cashFlows: number[]): number {
  return cashFlows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + monthlyRate, t), 0);
}

/** IRR mensual vía bisección — robusto para el patrón típico de un
 * desarrollo (aportaciones/egresos primero, luego ingresos/retornos),
 * que cruza cero una sola vez. Si no hay cruce de signo detectable en
 * el rango de búsqueda, o el flujo no tiene tanto entradas como
 * salidas, regresa null en vez de inventar un número. */
function monthlyIrr(cashFlows: number[]): number | null {
  const hasPositive = cashFlows.some((cf) => cf > 0);
  const hasNegative = cashFlows.some((cf) => cf < 0);
  if (!hasPositive || !hasNegative) return null;

  let low = -0.99;
  let high = 10;
  let npvLow = npvAtMonthlyRate(low, cashFlows);
  let npvHigh = npvAtMonthlyRate(high, cashFlows);
  if (npvLow === 0) return low;
  if (npvHigh === 0) return high;
  if ((npvLow < 0) === (npvHigh < 0)) return null; // sin cruce de signo en el rango

  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const npvMid = npvAtMonthlyRate(mid, cashFlows);
    if (Math.abs(npvMid) < 1e-6) return mid;
    if ((npvLow < 0) === (npvMid < 0)) {
      low = mid;
      npvLow = npvMid;
    } else {
      high = mid;
      npvHigh = npvMid;
    }
  }
  return (low + high) / 2;
}

/** IRR anualizada de una serie de flujos mensuales (cashFlows[0] es t=0). */
export function calculateIRR(monthlyCashFlows: number[]): number | null {
  const r = monthlyIrr(monthlyCashFlows);
  if (r === null) return null;
  return Math.pow(1 + r, 12) - 1;
}

/** NPV de una serie de flujos mensuales, descontada a una tasa anual. */
export function calculateNPV(annualDiscountRate: number, monthlyCashFlows: number[]): number {
  const monthlyRate = Math.pow(1 + annualDiscountRate, 1 / 12) - 1;
  return npvAtMonthlyRate(monthlyRate, monthlyCashFlows);
}

/** Multiple on Invested Capital: total recibido / total invertido. null si no hubo inversión. */
export function calculateMOIC(cashFlows: number[]): number | null {
  const invested = cashFlows.filter((cf) => cf < 0).reduce((sum, cf) => sum - cf, 0);
  const returned = cashFlows.filter((cf) => cf > 0).reduce((sum, cf) => sum + cf, 0);
  if (invested === 0) return null;
  return returned / invested;
}
