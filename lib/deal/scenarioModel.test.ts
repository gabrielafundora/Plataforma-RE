import { describe, expect, it } from "vitest";
import { evaluateScenario, assumptionsToRows, assumptionsFromRows } from "./scenarioModel";

const BASE = {
  pricePerM2: 55000,
  totalAreaM2: 1000,
  constructionCostPct: 0.6,
  horizonMonths: 12,
  leveraged: false,
};

describe("evaluateScenario — unleveraged", () => {
  it("computes revenue/cost totals; cost spreads over the full horizon, revenue over the back half", () => {
    const r = evaluateScenario(BASE);
    expect(r.totalRevenue).toBe(55_000_000);
    expect(r.totalCost).toBe(33_000_000);
    expect(r.egresos).toHaveLength(12);
    expect(r.egresos.every((v) => v === 33_000_000 / 12)).toBe(true);
    expect(r.ingresos.slice(0, 6).every((v) => v === 0)).toBe(true);
    expect(r.ingresos.slice(6).every((v) => v === 55_000_000 / 6)).toBe(true);
    expect(r.ingresos.reduce((s, v) => s + v, 0)).toBeCloseTo(55_000_000);
  });

  it("requires 100% equity and has no debt", () => {
    const r = evaluateScenario(BASE);
    expect(r.loanAmount).toBe(0);
    expect(r.equityRequired).toBe(r.totalCost);
    expect(r.debtDrawsIn.every((v) => v === 0)).toBe(true);
    expect(r.debtInterestOut.every((v) => v === 0)).toBe(true);
  });

  it("equity cash flow equals unlevered cash flow when there's no debt", () => {
    const r = evaluateScenario(BASE);
    expect(r.equityCashFlow).toEqual(r.unleveredCashFlow);
    expect(r.leveredIrr).toBeNull();
  });

  it("computes a positive profit margin and a positive unlevered IRR for a profitable scenario", () => {
    const r = evaluateScenario(BASE);
    expect(r.profitMargin).toBeCloseTo((55_000_000 - 33_000_000) / 55_000_000);
    expect(r.unleveredIrr).not.toBeNull();
    expect(r.unleveredIrr!).toBeGreaterThan(0);
  });

  it("returns a null profit margin instead of dividing by zero when there's no revenue", () => {
    const r = evaluateScenario({ ...BASE, totalAreaM2: 0 });
    expect(r.totalRevenue).toBe(0);
    expect(r.profitMargin).toBeNull();
  });
});

describe("evaluateScenario — leveraged", () => {
  const LEV = { ...BASE, leveraged: true, ltc: 0.6, interestRateBps: 1200 };

  it("sizes the loan and equity from LTC", () => {
    const r = evaluateScenario(LEV);
    expect(r.loanAmount).toBeCloseTo(33_000_000 * 0.6);
    expect(r.equityRequired).toBeCloseTo(33_000_000 * 0.4);
  });

  it("draws debt proportionally to the cost curve and repays the full balance as a bullet in the last month", () => {
    const r = evaluateScenario(LEV);
    const totalDraws = r.debtDrawsIn.reduce((s, v) => s + v, 0);
    expect(totalDraws).toBeCloseTo(r.loanAmount);
    expect(r.debtPrincipalOut.slice(0, -1).every((v) => v === 0)).toBe(true);
    expect(r.debtPrincipalOut[r.debtPrincipalOut.length - 1]).toBeCloseTo(r.loanAmount);
  });

  it("accrues interest monthly on the outstanding balance, compounding as draws happen", () => {
    const r = evaluateScenario(LEV);
    // Mes 0: nada fondeado todavía -> sin interés. Mes 1: interés sobre lo fondeado en mes 0.
    expect(r.debtInterestOut[0]).toBe(0);
    const monthlyRate = 0.12 / 12;
    expect(r.debtInterestOut[1]).toBeCloseTo(r.debtDrawsIn[0] * monthlyRate);
  });

  it("computes a levered IRR distinct from the unlevered one", () => {
    const r = evaluateScenario(LEV);
    expect(r.leveredIrr).not.toBeNull();
    expect(r.leveredIrr).not.toBeCloseTo(r.unleveredIrr ?? NaN, 6);
  });

  it("computes a levered MOIC only when leveraged", () => {
    expect(evaluateScenario(BASE).leveredMoic).toBeNull();
    expect(evaluateScenario(LEV).leveredMoic).not.toBeNull();
  });
});

describe("assumptionsToRows / assumptionsFromRows", () => {
  it("round-trips an unleveraged scenario without writing ltc/interest rows", () => {
    const rows = assumptionsToRows(BASE);
    expect(rows.find((r) => r.key === "ltc")).toBeUndefined();
    expect(rows.find((r) => r.key === "interest_rate_bps")).toBeUndefined();
    expect(assumptionsFromRows(rows)).toEqual(BASE);
  });

  it("round-trips a leveraged scenario including ltc/interest", () => {
    const leveraged = { ...BASE, leveraged: true, ltc: 0.6, interestRateBps: 1200 };
    const rows = assumptionsToRows(leveraged);
    expect(assumptionsFromRows(rows)).toEqual(leveraged);
  });

  it("defaults to unleveraged with safe fallbacks when a key is missing", () => {
    expect(assumptionsFromRows([])).toEqual({
      pricePerM2: 0,
      totalAreaM2: 0,
      constructionCostPct: 0,
      horizonMonths: 1,
      leveraged: false,
      ltc: undefined,
      interestRateBps: undefined,
    });
  });
});
