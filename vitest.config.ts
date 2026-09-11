import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Espeja el "@/*" -> "./*" de tsconfig.json — necesario en cuanto un
    // motor puro importa algo (no solo tipos) de otro módulo lib/ vía el
    // alias, como lib/deal/scenarioModel.ts reusando calculateIRR/NPV/MOIC
    // de lib/businessplan/returns.ts. Antes de esto ningún motor probado
    // había hecho un import de valores (no-type) cruzado vía "@/", así
    // que el hueco nunca se notó.
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
  },
});
