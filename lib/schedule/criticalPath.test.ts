import { describe, it, expect } from "vitest";
import { computeCriticalPath } from "./criticalPath";

describe("computeCriticalPath", () => {
  it("sin tareas, ruta vacía", () => {
    expect(computeCriticalPath([])).toEqual(new Set());
  });

  it("una sola tarea es su propia ruta crítica", () => {
    const result = computeCriticalPath([{ id: "a", endDate: "2026-01-10", predecessorTaskId: null }]);
    expect(result).toEqual(new Set(["a"]));
  });

  it("una cadena lineal A→B→C: las tres tareas son críticas", () => {
    const tasks = [
      { id: "a", endDate: "2026-01-10", predecessorTaskId: null },
      { id: "b", endDate: "2026-02-10", predecessorTaskId: "a" },
      { id: "c", endDate: "2026-03-10", predecessorTaskId: "b" },
    ];
    expect(computeCriticalPath(tasks)).toEqual(new Set(["a", "b", "c"]));
  });

  it("con dos ramas, solo la que termina más tarde es crítica", () => {
    const tasks = [
      { id: "start", endDate: "2026-01-01", predecessorTaskId: null },
      { id: "short-branch", endDate: "2026-01-15", predecessorTaskId: "start" },
      { id: "long-branch-1", endDate: "2026-02-01", predecessorTaskId: "start" },
      { id: "long-branch-2", endDate: "2026-03-01", predecessorTaskId: "long-branch-1" },
    ];
    const result = computeCriticalPath(tasks);
    expect(result).toEqual(new Set(["start", "long-branch-1", "long-branch-2"]));
    expect(result.has("short-branch")).toBe(false);
  });

  it("un ciclo accidental en los datos no cuelga el cálculo", () => {
    const tasks = [
      { id: "a", endDate: "2026-01-10", predecessorTaskId: "b" },
      { id: "b", endDate: "2026-01-05", predecessorTaskId: "a" },
    ];
    const result = computeCriticalPath(tasks);
    expect(result.size).toBeLessThanOrEqual(2);
  });
});
