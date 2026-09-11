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

  // Regresión: un flujo mensual real (egresos constantes, ingresos
  // grandes en un par de meses puntuales) tiene varios cambios de
  // signo — NPV(r) no es monótona. Revisar solo los dos extremos del
  // rango de búsqueda (como hacía la versión anterior) veía negativo
  // en ambos y reportaba "sin raíz", cuando en realidad SÍ existe una
  // raíz real y positiva más cerca de r=0 — el total de este flujo
  // suma positivo (más ingresos que egresos) y la TIR debe reflejarlo.
  it("un flujo con varios cambios de signo (egresos constantes, cobros puntuales) encuentra la raíz real, no una espuria", () => {
    const cashFlows = [
      0, -1_000_000, -1_200_000, -1_400_000, -1_600_000, -1_800_000,
      8_000_000, -1_500_000, -1_600_000, 9_000_000, -1_000_000, -800_000,
    ];
    expect(cashFlows.reduce((a, b) => a + b, 0)).toBeGreaterThan(0); // más ingresos que egresos en total
    const irr = calculateIRR(cashFlows);
    expect(irr).not.toBeNull();
    expect(irr!).toBeGreaterThan(0); // no debe salir negativa cuando el total es positivo
  });

  // Regresión: este caso concreto tiene DOS raíces matemáticamente
  // válidas (el clásico problema de "TIR múltiple" para flujos no
  // convencionales) — una negativa, cerca del límite inferior del
  // rango de búsqueda, y una positiva más lejos de cero. "La más
  // cercana a 0%" elegía la negativa aquí solo porque cae más cerca de
  // cero en magnitud, aunque el proyecto gana dinero en total (egreso
  // constante de 2M en 12 meses, un solo cobro de 5M a mitad de
  // camino). El criterio correcto es el signo de la ganancia neta.
  it("con dos raíces válidas, elige la del signo correcto según si el proyecto ganó o perdió dinero", () => {
    const remainder = 2_000_000 / 11;
    const cashFlows = Array.from({ length: 12 }, (_, i) =>
      i === 0 ? 0 : i === 6 ? 5_000_000 - remainder : -remainder
    );
    expect(cashFlows.reduce((a, b) => a + b, 0)).toBeCloseTo(3_000_000, 0); // ganancia neta
    const irr = calculateIRR(cashFlows);
    expect(irr).not.toBeNull();
    expect(irr!).toBeGreaterThan(0);
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
