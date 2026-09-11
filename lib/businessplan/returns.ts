// Business Plan — Returns (§7.1, pantalla 17): "decisión 8·09 — nunca
// captura assumptions manualmente" sigue aplicando (todo se deriva del
// mismo cash flow mensual de Project Cash Flow, pantalla 16). Estas
// mismas funciones las usa /returns (en vivo) y lib/actions/
// monthlyClose.ts (para congelar el resultado en un Snapshot al cerrar
// el periodo — ver lib/monthlyClose/buildSnapshotRows.ts) — ver
// docs/strategy §3.3 y §4.6.

function npvAtMonthlyRate(monthlyRate: number, cashFlows: number[]): number {
  return cashFlows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + monthlyRate, t), 0);
}

function bisect(f: (r: number) => number, low: number, high: number): number {
  let a = low;
  let b = high;
  let fa = f(a);
  for (let i = 0; i < 200; i++) {
    const mid = (a + b) / 2;
    const fMid = f(mid);
    if (Math.abs(fMid) < 1e-6) return mid;
    if ((fa < 0) === (fMid < 0)) {
      a = mid;
      fa = fMid;
    } else {
      b = mid;
    }
  }
  return (a + b) / 2;
}

/** IRR mensual — un flujo mensual real (egresos constantes, ingresos
 * concentrados en fechas de cobro puntuales) cruza cero VARIAS veces,
 * no una sola: no basta revisar los dos extremos del rango de búsqueda
 * y asumir que NPV(r) es monótona (eso es lo que hacía la primera
 * versión, y podía reportar una raíz espuria dominada por el signo del
 * último flujo al explotar cerca de r=-100%, o perder por completo una
 * raíz real y válida entre los extremos). Por eso se muestrea NPV(r) en
 * muchos puntos del rango y se biseca cada tramo donde cambia de signo.
 *
 * El problema clásico de "TIR múltiple" (Descartes: tantas raíces
 * posibles como cambios de signo tenga la propia serie de flujos, y un
 * flujo con cobros puntuales contra egresos constantes casi siempre
 * tiene más de uno) significa que puede haber más de una raíz
 * matemáticamente válida — probado con un caso real: un flujo neto en
 * ganancia (más ingresos que egresos) puede tener una raíz negativa
 * cerca del límite inferior del rango de búsqueda ADEMÁS de la raíz
 * positiva económicamente correcta, y "la más cercana a 0%" a veces
 * elige la negativa por pura coincidencia aritmética de qué tan lejos
 * cae cada una. La desambiguación correcta no es "la más cercana a
 * cero", es "la del signo que corresponde a si el proyecto ganó o
 * perdió dinero en total": con ganancia neta, se prefiere la raíz
 * positiva más chica; con pérdida neta, la no-positiva más chica en
 * magnitud. Sin ninguna raíz de ese signo (no debería pasar salvo
 * casos extremos), se cae de vuelta a la más cercana a cero de todas
 * las encontradas. Sin ningún cruce de signo, o sin tanto entradas
 * como salidas: null, no se inventa un número. */
function monthlyIrr(cashFlows: number[]): number | null {
  const hasPositive = cashFlows.some((cf) => cf > 0);
  const hasNegative = cashFlows.some((cf) => cf < 0);
  if (!hasPositive || !hasNegative) return null;

  const low = -0.99;
  const high = 10;
  const steps = 2000;
  const f = (r: number) => npvAtMonthlyRate(r, cashFlows);

  const roots: number[] = [];
  let prevR = low;
  let prevV = f(low);
  if (prevV === 0) roots.push(prevR);

  for (let i = 1; i <= steps; i++) {
    const r = low + ((high - low) * i) / steps;
    const v = f(r);
    if (v === 0) {
      roots.push(r);
    } else if ((prevV < 0) !== (v < 0)) {
      roots.push(bisect(f, prevR, r));
    }
    prevR = r;
    prevV = v;
  }

  if (roots.length === 0) return null;

  const netProfit = cashFlows.reduce((sum, cf) => sum + cf, 0);
  const preferred = netProfit >= 0 ? roots.filter((r) => r >= 0) : roots.filter((r) => r <= 0);
  const pool = preferred.length > 0 ? preferred : roots;

  pool.sort((a, b) => Math.abs(a) - Math.abs(b));
  return pool[0];
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
