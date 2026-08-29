import { describe, it, expect } from "vitest";
import { curveWeights, rollingForecast } from "./engine";

describe("curveWeights", () => {
  it("straight_line splits evenly and sums to 1", () => {
    const w = curveWeights("straight_line", 4);
    expect(w).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  it("s_curve is bell-shaped (slow-fast-slow) and sums to ~1", () => {
    const w = curveWeights("s_curve", 6);
    const sum = w.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    // middle periods carry more weight than the first/last (construction ramp-up/down)
    expect(w[2]).toBeGreaterThan(w[0]);
    expect(w[3]).toBeGreaterThan(w[5]);
  });

  it("front_loaded weights decrease monotonically", () => {
    const w = curveWeights("front_loaded", 4);
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeLessThanOrEqual(w[i - 1]);
  });

  it("back_loaded weights increase monotonically", () => {
    const w = curveWeights("back_loaded", 4);
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeGreaterThanOrEqual(w[i - 1]);
  });
});

describe("rollingForecast — Actuals + Remaining Forecast = Forecast Final Cost (§4.2)", () => {
  it("with no actuals yet, forecast final cost equals the original total budget", () => {
    const result = rollingForecast({
      totalAmount: 300_000_000,
      periods: 12,
      method: "s_curve",
      actuals: Array(12).fill(null),
    });
    expect(result.actualCostToDate).toBe(0);
    expect(result.forecastFinalCost).toBeCloseTo(300_000_000, 2);
    const sum = result.schedule.reduce((s, p) => s + p.amount, 0);
    expect(sum).toBeCloseTo(300_000_000, 2);
  });

  it("closed periods use the real actual, not the curve estimate", () => {
    const result = rollingForecast({
      totalAmount: 300_000_000,
      periods: 6,
      method: "straight_line",
      actuals: [60_000_000, 40_000_000, null, null, null, null], // spent more/less than the flat 50M/period plan
    });
    expect(result.schedule[0]).toMatchObject({ amount: 60_000_000, isActual: true });
    expect(result.schedule[1]).toMatchObject({ amount: 40_000_000, isActual: true });
    expect(result.schedule[2].isActual).toBe(false);
    expect(result.actualCostToDate).toBe(100_000_000);
    // Remaining 200M redistributed evenly over the 4 remaining periods.
    expect(result.schedule[2].amount).toBeCloseTo(50_000_000, 2);
    expect(result.forecastFinalCost).toBeCloseTo(300_000_000, 2);
  });

  it("an overrun (actuals already exceed budget) leaves zero remaining forecast, not negative", () => {
    const result = rollingForecast({
      totalAmount: 100,
      periods: 4,
      method: "straight_line",
      actuals: [40, 80, null, null], // 120 already spent on a 100 budget
    });
    expect(result.actualCostToDate).toBe(120);
    expect(result.remainingForecast).toBe(0);
    expect(result.forecastFinalCost).toBe(120); // final cost is allowed to exceed the original budget
    expect(result.schedule[2].amount).toBe(0);
    expect(result.schedule[3].amount).toBe(0);
  });

  it("rounds to the cent and the schedule still sums exactly to the total", () => {
    const result = rollingForecast({
      totalAmount: 100,
      periods: 3,
      method: "straight_line",
      actuals: [null, null, null],
    });
    const sum = result.schedule.reduce((s, p) => s + p.amount, 0);
    expect(sum).toBe(100);
  });
});
