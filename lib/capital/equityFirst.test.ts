import { describe, it, expect } from "vitest";
import { allocateEquityFirst } from "./equityFirst";

describe("allocateEquityFirst — §4.4, Equity First hardcodeado (decisión 8·07)", () => {
  it("con equity disponible de sobra, todo el déficit lo cubre equity", () => {
    const result = allocateEquityFirst({ cashDeficit: 100_000, equityAvailable: 500_000 });
    expect(result.equityCallAmount).toBe(100_000);
    expect(result.debtDrawAmount).toBe(0);
  });

  it("con equity insuficiente, cubre lo que puede y el resto va a deuda", () => {
    const result = allocateEquityFirst({ cashDeficit: 500_000, equityAvailable: 200_000 });
    expect(result.equityCallAmount).toBe(200_000);
    expect(result.debtDrawAmount).toBe(300_000);
  });

  it("con equity agotado (0), todo el déficit va a deuda", () => {
    const result = allocateEquityFirst({ cashDeficit: 400_000, equityAvailable: 0 });
    expect(result.equityCallAmount).toBe(0);
    expect(result.debtDrawAmount).toBe(400_000);
  });

  it("equityCallAmount + debtDrawAmount siempre suma exactamente el déficit", () => {
    const result = allocateEquityFirst({ cashDeficit: 333_333.33, equityAvailable: 100_000 });
    expect(result.equityCallAmount + result.debtDrawAmount).toBeCloseTo(333_333.33, 2);
  });

  it("sin déficit (superávit de caja), no se pide ni equity ni deuda", () => {
    const result = allocateEquityFirst({ cashDeficit: -50_000, equityAvailable: 200_000 });
    expect(result.equityCallAmount).toBe(0);
    expect(result.debtDrawAmount).toBe(0);
  });

  it("equityAvailable negativo (dato inconsistente) se trata como 0, no resta del déficit", () => {
    const result = allocateEquityFirst({ cashDeficit: 100_000, equityAvailable: -20_000 });
    expect(result.equityCallAmount).toBe(0);
    expect(result.debtDrawAmount).toBe(100_000);
  });
});
