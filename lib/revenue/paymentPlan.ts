// Revenue engine — plan de pagos (§5, motor For Sale). El equivalente,
// del lado de Ingresos, a lib/forecast/engine.ts: la pieza de más riesgo
// de este slice (convertir un plan de pagos en fechas y montos reales de
// cobro) — se construye y se prueba antes que cualquier pantalla.
//
// "Sales != Cash Collections" (§1.1): registrar una venta captura lo
// contratado (payment_plan); expandPaymentPlan() es lo único que produce
// las filas de `collections` — una sola vez, al registrar la venta. El
// plan guardado en `sales.payment_plan` no se vuelve a leer para
// recalcular nada después (a diferencia del forecast_method de Costs,
// que sí se reevalúa cada vez que cambia algo).

export interface PaymentPlanInput {
  /** Fracción de price_total pagada como enganche en la fecha de venta, ej. 0.20. */
  downPaymentPct: number;
  /** Fracción de price_total pagada al momento de escrituración. */
  closingPct: number;
  /** Número de mensualidades iguales que cubren el resto (price_total - enganche - escrituración). */
  installmentsCount: number;
  /** Meses desde la fecha de venta hasta la escrituración. */
  closingOffsetMonths: number;
}

export interface PaymentPlanStored extends PaymentPlanInput {
  downPaymentAmount: number;
  installmentAmount: number;
  closingAmount: number;
  /** price_total - downPaymentAmount - closingAmount — lo que reparten las mensualidades. */
  remainderAmount: number;
}

export interface ScheduledCollection {
  /** "YYYY-MM-DD" */
  dueDate: string;
  amount: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildPaymentPlan(priceTotal: number, input: PaymentPlanInput): PaymentPlanStored {
  const { downPaymentPct, closingPct, installmentsCount, closingOffsetMonths } = input;

  if (!(priceTotal > 0)) throw new Error("priceTotal debe ser mayor a 0.");
  if (downPaymentPct < 0 || closingPct < 0) throw new Error("Los porcentajes no pueden ser negativos.");
  if (downPaymentPct + closingPct > 1) {
    throw new Error("Enganche + escrituración no puede exceder el 100% del precio.");
  }
  if (!Number.isInteger(installmentsCount) || installmentsCount < 1) {
    throw new Error("El número de mensualidades debe ser un entero mayor o igual a 1.");
  }
  if (!Number.isInteger(closingOffsetMonths) || closingOffsetMonths < 1) {
    throw new Error("Los meses hasta escrituración deben ser un entero mayor o igual a 1.");
  }

  const downPaymentAmount = round2(priceTotal * downPaymentPct);
  const closingAmount = round2(priceTotal * closingPct);
  const remainderAmount = round2(priceTotal - downPaymentAmount - closingAmount);
  const installmentAmount = round2(remainderAmount / installmentsCount);

  return { ...input, downPaymentAmount, installmentAmount, closingAmount, remainderAmount };
}

/** Suma `months` meses a una fecha "YYYY-MM-DD", recortando el día al
 * último día del mes destino si no existe (31 ene + 1 mes -> 28/29 feb). */
function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const firstOfTarget = new Date(Date.UTC(y, m - 1 + months, 1));
  const targetYear = firstOfTarget.getUTCFullYear();
  const targetMonth = firstOfTarget.getUTCMonth();
  const daysInTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(d, daysInTargetMonth);
  return new Date(Date.UTC(targetYear, targetMonth, day)).toISOString().slice(0, 10);
}

/** Expande un plan ya construido en las filas de `collections` a
 * insertar: enganche en la fecha de venta, mensualidades mes a mes desde
 * ahí, y el pago de escrituración en su mes correspondiente. La última
 * mensualidad absorbe el remanente de redondeo para que la suma cierre
 * exactamente contra price_total. */
export function expandPaymentPlan(saleDate: string, plan: PaymentPlanStored): ScheduledCollection[] {
  const rows: ScheduledCollection[] = [];

  if (plan.downPaymentAmount > 0) {
    rows.push({ dueDate: saleDate, amount: plan.downPaymentAmount });
  }

  if (plan.remainderAmount > 0) {
    const amounts = Array(plan.installmentsCount).fill(plan.installmentAmount);
    const distributed = round2(plan.installmentAmount * plan.installmentsCount);
    const drift = round2(plan.remainderAmount - distributed);
    amounts[amounts.length - 1] = round2(amounts[amounts.length - 1] + drift);

    amounts.forEach((amount, i) => {
      if (amount === 0) return;
      rows.push({ dueDate: addMonths(saleDate, i + 1), amount });
    });
  }

  if (plan.closingAmount > 0) {
    rows.push({ dueDate: addMonths(saleDate, plan.closingOffsetMonths), amount: plan.closingAmount });
  }

  return rows;
}
