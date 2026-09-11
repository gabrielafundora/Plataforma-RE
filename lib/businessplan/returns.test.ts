import { describe, it, expect } from "vitest";
import { calculateIRR, calculateNPV, calculateMOIC } from "./returns";

describe("calculateIRR", () => {
  it("una inversión que regresa 1.2x en 12 meses da ~20% anual", () => {
    const cashFlows = [-1000, ...Array(11).fill(0), 1200];
    expect(calculateIRR(cashFlows)).toBeCloseTo(0.2, 4);
  });

  it("sin salidas de caja (todo positivo) no se puede calcular", () => {
    expect(calculateIRR([100, 100, 100])).toBeNull();
  });

  it("sin entradas de caja (todo negativo) no se puede calcular", () => {
    expect(calculateIRR([-100, -100, -100])).toBeNull();
  });
});

describe("calculateNPV", () => {
  it("a tasa de descuento 0%, el NPV es la suma simple de los flujos", () => {
    const cashFlows = [-1000, 200, 300, 900];
    expect(calculateNPV(0, cashFlows)).toBeCloseTo(400, 6);
  });

  it("a mayor tasa de descuento, el NPV de flujos futuros positivos baja", () => {
    const cashFlows = [-1000, ...Array(11).fill(0), 1200];
    const npvLowRate = calculateNPV(0.05, cashFlows);
    const npvHighRate = calculateNPV(0.3, cashFlows);
    expect(npvHighRate).toBeLessThan(npvLowRate);
  });
});

describe("calculateMOIC", () => {
  it("1000 invertido, 1200 devuelto -> 1.2x", () => {
    const cashFlows = [-1000, ...Array(11).fill(0), 1200];
    expect(calculateMOIC(cashFlows)).toBeCloseTo(1.2, 6);
  });

  it("sin inversión (todo cero) no se puede calcular", () => {
    expect(calculateMOIC([0, 0, 0])).toBeNull();
  });

  it("varias aportaciones y distribuciones se suman correctamente", () => {
    const cashFlows = [-500, -500, 0, 600, 600];
    expect(calculateMOIC(cashFlows)).toBeCloseTo(1.2, 6);
  });
});
