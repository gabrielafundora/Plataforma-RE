import { describe, expect, it } from "vitest";
import { buildCashFlowPeriodRows, buildReturnMetricRows } from "./buildSnapshotRows";
import type { MonthlyLedger } from "@/lib/businessplan/monthlyLedger";

function makeLedger(overrides: Partial<MonthlyLedger> = {}): MonthlyLedger {
  const periods = 3;
  return {
    periods,
    startMonth: new Date(2026, 0, 1),
    currentPeriodIndex: 1,
    ingresos: [0, 5000000, 0],
    egresos: [1000000, 1000000, 1000000],
    cfBeforeFinancing: [-1000000, 4000000, -1000000],
    debtDrawsIn: [500000, 0, 0],
    debtInterestOut: [0, 10000, 10000],
    debtPrincipalOut: [0, 0, 0],
    equityIn: [500000, 0, 0],
    equityOut: [0, 0, 0],
    netLevered: [0, 3990000, -1010000],
    totals: {
      currentBudget: 3000000,
      contractedRevenue: 5000000,
      projectedRevenue: 6000000,
      loanAmount: 2000000,
      equityCommitment: 1000000,
    },
    ...overrides,
  };
}

describe("buildCashFlowPeriodRows", () => {
  it("emits one row per period, with isActual set from currentPeriodIndex", () => {
    const rows = buildCashFlowPeriodRows(makeLedger());
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.periodMonth)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(rows.map((r) => r.isActual)).toEqual([true, true, false]);
  });

  it("only includes non-zero categories per period", () => {
    const rows = buildCashFlowPeriodRows(makeLedger());
    const jan = rows[0];
    expect(jan.lines).toEqual(
      expect.arrayContaining([
        { category: "cost", amount: 1000000 },
        { category: "debt_draw", amount: 500000 },
        { category: "equity_contribution", amount: 500000 },
      ])
    );
    expect(jan.lines.find((l) => l.category === "revenue")).toBeUndefined();

    const feb = rows[1];
    expect(feb.lines).toEqual(
      expect.arrayContaining([
        { category: "revenue", amount: 5000000 },
        { category: "cost", amount: 1000000 },
        { category: "debt_interest", amount: 10000 },
      ])
    );
  });

  it("returns an empty array for a zero-period ledger", () => {
    expect(buildCashFlowPeriodRows(makeLedger({ periods: 0, ingresos: [], egresos: [], cfBeforeFinancing: [], debtDrawsIn: [], debtInterestOut: [], debtPrincipalOut: [], equityIn: [], equityOut: [], netLevered: [] }))).toEqual([]);
  });
});

describe("buildReturnMetricRows", () => {
  it("maps every calculated metric to its scope/key", () => {
    const rows = buildReturnMetricRows(makeLedger(), {
      unleveredIrr: 0.18,
      leveredIrr: 0.25,
      unleveredNpv: 1200000,
      unleveredMoic: 1.5,
      leveredMoic: 1.8,
      profitMargin: 0.22,
    });
    expect(rows).toEqual(
      expect.arrayContaining([
        { scope: "project", metricKey: "irr_unlevered", value: 0.18 },
        { scope: "equity", metricKey: "irr_levered", value: 0.25 },
        { scope: "project", metricKey: "npv", value: 1200000 },
        { scope: "project", metricKey: "moic", value: 1.5 },
        { scope: "equity", metricKey: "moic", value: 1.8 },
        { scope: "project", metricKey: "profit_margin", value: 0.22 },
        { scope: "project", metricKey: "total_development_cost", value: 3000000 },
        { scope: "project", metricKey: "equity_required", value: 1000000 },
      ])
    );
    expect(rows).toHaveLength(8);
  });

  it("omits null metrics instead of writing a fabricated value", () => {
    const rows = buildReturnMetricRows(makeLedger(), {
      unleveredIrr: 0.1,
      leveredIrr: null,
      unleveredNpv: 500000,
      unleveredMoic: 1.2,
      leveredMoic: null,
      profitMargin: null,
    });
    expect(rows.find((r) => r.metricKey === "irr_levered")).toBeUndefined();
    expect(rows.find((r) => r.metricKey === "moic" && r.scope === "equity")).toBeUndefined();
    expect(rows.find((r) => r.metricKey === "profit_margin")).toBeUndefined();
  });
});
