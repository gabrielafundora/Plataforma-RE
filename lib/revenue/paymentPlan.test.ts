import { describe, it, expect } from "vitest";
import { buildPaymentPlan, expandPaymentPlan } from "./paymentPlan";

describe("buildPaymentPlan", () => {
  it("splits price_total into enganche, mensualidades y escrituración", () => {
    const plan = buildPaymentPlan(4_290_000, {
      downPaymentPct: 0.2,
      closingPct: 0.1,
      installmentsCount: 6,
      closingOffsetMonths: 10,
    });
    expect(plan.downPaymentAmount).toBe(858_000);
    expect(plan.closingAmount).toBe(429_000);
    expect(plan.remainderAmount).toBe(4_290_000 - 858_000 - 429_000);
    expect(plan.installmentAmount).toBe(plan.remainderAmount / 6);
  });

  it("rejects enganche + escrituración por encima del 100%", () => {
    expect(() =>
      buildPaymentPlan(1_000_000, {
        downPaymentPct: 0.7,
        closingPct: 0.4,
        installmentsCount: 3,
        closingOffsetMonths: 6,
      })
    ).toThrow();
  });

  it("rechaza montos y conteos inválidos", () => {
    expect(() => buildPaymentPlan(0, { downPaymentPct: 0.2, closingPct: 0.1, installmentsCount: 3, closingOffsetMonths: 6 })).toThrow();
    expect(() =>
      buildPaymentPlan(1_000_000, { downPaymentPct: 0.2, closingPct: 0.1, installmentsCount: 0, closingOffsetMonths: 6 })
    ).toThrow();
    expect(() =>
      buildPaymentPlan(1_000_000, { downPaymentPct: 0.2, closingPct: 0.1, installmentsCount: 3, closingOffsetMonths: 0 })
    ).toThrow();
  });
});

describe("expandPaymentPlan — la suma siempre cierra exacto contra price_total", () => {
  it("un caso típico: enganche + 6 mensualidades + escrituración", () => {
    const priceTotal = 4_290_000;
    const plan = buildPaymentPlan(priceTotal, {
      downPaymentPct: 0.2,
      closingPct: 0.1,
      installmentsCount: 6,
      closingOffsetMonths: 10,
    });
    const rows = expandPaymentPlan("2026-01-15", plan);

    expect(rows).toHaveLength(1 + 6 + 1); // enganche + mensualidades + escrituración
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    expect(sum).toBeCloseTo(priceTotal, 2);

    expect(rows[0]).toEqual({ dueDate: "2026-01-15", amount: plan.downPaymentAmount });
    expect(rows[1].dueDate).toBe("2026-02-15");
    expect(rows[6].dueDate).toBe("2026-07-15"); // última mensualidad, mes 6
    expect(rows[rows.length - 1].dueDate).toBe("2026-11-15"); // escrituración, +10 meses
  });

  it("un caso con remanente que no divide exacto absorbe el redondeo en la última mensualidad", () => {
    const priceTotal = 1_000_000;
    const plan = buildPaymentPlan(priceTotal, {
      downPaymentPct: 0.2,
      closingPct: 0.1,
      installmentsCount: 7, // 700,000 / 7 = 100,000 exacto — usar un caso que no divida
      closingOffsetMonths: 8,
    });
    // fuerza un remanente no divisible exactamente entre 3 mensualidades
    const oddPlan = buildPaymentPlan(priceTotal, {
      downPaymentPct: 0.2,
      closingPct: 0.1,
      installmentsCount: 3,
      closingOffsetMonths: 8,
    });
    const rows = expandPaymentPlan("2026-01-31", oddPlan);
    const sum = rows.reduce((s, r) => s + r.amount, 0);
    expect(sum).toBeCloseTo(priceTotal, 2);
    void plan;
  });

  it("recorta el día de vencimiento al último día del mes cuando el mes destino es más corto", () => {
    const plan = buildPaymentPlan(300_000, {
      downPaymentPct: 0,
      closingPct: 0,
      installmentsCount: 1,
      closingOffsetMonths: 1,
    });
    // venta el 31 de enero + 1 mes de plazo de mensualidad -> no existe 31 de
    // febrero, debe recortar al último día real del mes.
    const rows = expandPaymentPlan("2026-01-31", plan);
    expect(rows[0].dueDate).toBe("2026-02-28");
  });

  it("omite filas de monto cero (ej. sin enganche o sin escrituración)", () => {
    const plan = buildPaymentPlan(500_000, {
      downPaymentPct: 0,
      closingPct: 0,
      installmentsCount: 4,
      closingOffsetMonths: 5,
    });
    const rows = expandPaymentPlan("2026-03-01", plan);
    expect(rows).toHaveLength(4); // solo las mensualidades, sin enganche ni escrituración
  });
});
