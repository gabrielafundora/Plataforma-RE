// Cost Forecast engine — §4.2 of docs/strategy/00-analisis-arquitectura-y-mvp.md.
//
// "Actuals + Remaining Forecast = Forecast Final Cost": for periods
// already closed we use the real actual; for periods still ahead we
// redistribute whatever budget remains using the curve shape the
// BudgetLine is configured with. This is the single highest-risk piece
// of the whole product (§10 of the same doc) — it's deliberately built
// and tested before any screen.

export type CurveMethod = "straight_line" | "s_curve" | "front_loaded" | "back_loaded";

export interface ForecastPeriod {
  /** 0-indexed period number within the forecast window. */
  period: number;
  amount: number;
  isActual: boolean;
}

export interface RollingForecastInput {
  totalAmount: number;
  periods: number;
  method: CurveMethod;
  /** Actual amount for each period, or null if that period hasn't closed yet. Length must equal `periods`. */
  actuals: (number | null)[];
}

export interface RollingForecastResult {
  schedule: ForecastPeriod[];
  actualCostToDate: number;
  remainingForecast: number;
  forecastFinalCost: number;
}

/**
 * Relative weights (summing to 1) for how `periods` periods share a
 * total amount, before any actuals are known. This is the "curva
 * estimada inicial" from §4.2 — Straight-line / S-Curve / Front·Back
 * loaded. Milestone / Contract schedule / Linked to Schedule / Manual
 * come from real dates elsewhere in the app, not from a generic curve,
 * so they aren't modeled here.
 */
export function curveWeights(method: CurveMethod, periods: number): number[] {
  if (periods <= 0) return [];
  if (periods === 1) return [1];

  switch (method) {
    case "straight_line":
      return Array(periods).fill(1 / periods);

    case "s_curve": {
      // Smoothstep cumulative curve (3t^2 - 2t^3): slow start, fast
      // middle, slow finish — the classic construction S-curve shape.
      const cumulative = (t: number) => 3 * t * t - 2 * t * t * t;
      const weights: number[] = [];
      for (let i = 1; i <= periods; i++) {
        weights.push(cumulative(i / periods) - cumulative((i - 1) / periods));
      }
      return weights;
    }

    case "front_loaded": {
      // Linearly decreasing weight — heaviest at period 0.
      const raw = Array.from({ length: periods }, (_, i) => periods - i);
      const sum = raw.reduce((a, b) => a + b, 0);
      return raw.map((w) => w / sum);
    }

    case "back_loaded": {
      const raw = Array.from({ length: periods }, (_, i) => i + 1);
      const sum = raw.reduce((a, b) => a + b, 0);
      return raw.map((w) => w / sum);
    }
  }
}

/** Distributes `amount` across weights, rounded to cents, with the last
 * non-zero-weight slot absorbing rounding remainder so the sum is exact. */
function distribute(amount: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const rounded = weights.map((w) => Math.round(amount * w * 100) / 100);
  const roundedSum = rounded.reduce((a, b) => a + b, 0);
  const remainder = Math.round((amount - roundedSum) * 100) / 100;

  const lastIdx = weights.map((w, i) => (w > 0 ? i : -1)).filter((i) => i >= 0).pop();
  if (lastIdx !== undefined) rounded[lastIdx] += remainder;
  return rounded;
}

export function rollingForecast(input: RollingForecastInput): RollingForecastResult {
  const { totalAmount, periods, method, actuals } = input;
  if (actuals.length !== periods) {
    throw new Error(`actuals length (${actuals.length}) must equal periods (${periods})`);
  }

  const actualCostToDate = actuals.reduce((sum: number, a) => sum + (a ?? 0), 0);
  const remainingAmount = Math.max(0, totalAmount - actualCostToDate);

  const remainingIndexes = actuals
    .map((a, i) => (a === null ? i : -1))
    .filter((i) => i >= 0);

  const baseWeights = curveWeights(method, periods);
  const remainingWeightsRaw = remainingIndexes.map((i) => baseWeights[i]);
  const remainingWeightsSum = remainingWeightsRaw.reduce((a, b) => a + b, 0);
  const remainingWeightsNormalized =
    remainingWeightsSum > 0
      ? remainingWeightsRaw.map((w) => w / remainingWeightsSum)
      : remainingWeightsRaw.map(() => 1 / (remainingWeightsRaw.length || 1));

  const remainingAmounts = distribute(remainingAmount, remainingWeightsNormalized);

  const schedule: ForecastPeriod[] = actuals.map((a, i) => {
    if (a !== null) return { period: i, amount: a, isActual: true };
    const idxInRemaining = remainingIndexes.indexOf(i);
    return { period: i, amount: remainingAmounts[idxInRemaining], isActual: false };
  });

  const remainingForecast = schedule
    .filter((p) => !p.isActual)
    .reduce((sum, p) => sum + p.amount, 0);

  return {
    schedule,
    actualCostToDate,
    remainingForecast,
    forecastFinalCost: actualCostToDate + remainingForecast,
  };
}
