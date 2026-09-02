"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { budgetLines, phases } from "@/lib/db/schema";

// "No me gusta que la selección del tipo de curva esté en la parte de
// alta de presupuesto — me gustaría que esté en la página de Forecast."
// Solo el método de curva, sin tocar el monto — por eso vive separado
// de saveBudgetBaseline (lib/actions/budgetSetup.ts). Solo se ofrecen
// los 4 métodos que el motor implementa (lib/forecast/engine.ts); los
// otros 4 del enum dependen de un módulo de Schedule que no existe.
const methodFieldSchema = z.enum(["straight_line", "s_curve", "front_loaded", "back_loaded"]);

export async function updateCurveMethods(formData: FormData) {
  const projectId = z.string().uuid().parse(formData.get("projectId"));

  const leafLines = await db
    .select({ id: budgetLines.id })
    .from(budgetLines)
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .where(eq(phases.projectId, projectId));
  const validIds = new Set(leafLines.map((l) => l.id));

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("method_")) continue;
    const budgetLineId = key.slice("method_".length);
    if (!validIds.has(budgetLineId)) continue;

    const method = methodFieldSchema.parse(value);
    await db
      .update(budgetLines)
      .set({ forecastMethod: method, updatedAt: new Date() })
      .where(eq(budgetLines.id, budgetLineId));
  }

  // Sin redirect: la página de Forecast donde ya estás se refresca con
  // los nuevos métodos, en vez de mandarte a Control Presupuestal.
  revalidatePath("/", "layout");
}
