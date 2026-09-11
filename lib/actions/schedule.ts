"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tasks, milestones, phases } from "@/lib/db/schema";

// Plan — schedule, tareas, milestones (§3, §7.1 pantalla 5). Mismas
// convenciones que el resto: "use server", zod .parse() por acción,
// revalidatePath al final. Sin capa de aprobaciones (no aplica a un
// cronograma). "linkedBudgetLineIds" de la spec (vincular tarea a
// Budget Line, y que su cambio de fecha recalcule forecastMethod) NO
// está en esta vuelta — ver plan/README de la sesión: requiere una
// tabla puente que no existe todavía y un motor de curva nuevo
// (milestone/contract_schedule/linked_to_schedule), corte explícito.

async function getPhaseForProject(projectId: string) {
  const [phase] = await db.select().from(phases).where(eq(phases.projectId, projectId)).limit(1);
  if (!phase) throw new Error(`No phase found for project ${projectId} — was it seeded/approved?`);
  return phase;
}

const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  predecessorTaskId: z.string().uuid().optional(),
  lagDays: z.coerce.number().int().optional(),
  ownerUserId: z.string().uuid().optional(),
});

export async function createTask(formData: FormData) {
  const parsed = createTaskSchema.parse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    predecessorTaskId: formData.get("predecessorTaskId") || undefined,
    lagDays: formData.get("lagDays") || undefined,
    ownerUserId: formData.get("ownerUserId") || undefined,
  });
  const phase = await getPhaseForProject(parsed.projectId);

  await db.insert(tasks).values({
    phaseId: phase.id,
    name: parsed.name,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    predecessorTaskId: parsed.predecessorTaskId ?? null,
    lagDays: parsed.lagDays ?? 0,
    ownerUserId: parsed.ownerUserId ?? null,
  });

  revalidatePath("/", "layout");
}

// Actualización rápida de una sola tarea, en línea en la fila del
// Gantt — el caso más común día a día (mismo criterio que
// updateUnitPrice en Inventario).
const updateTaskProgressSchema = z.object({
  taskId: z.string().uuid(),
  progressPct: z.coerce.number().min(0).max(100),
});

export async function updateTaskProgress(formData: FormData) {
  const parsed = updateTaskProgressSchema.parse({
    taskId: formData.get("taskId"),
    progressPct: formData.get("progressPct"),
  });
  await db
    .update(tasks)
    .set({ progressPct: String(parsed.progressPct), updatedAt: new Date() })
    .where(eq(tasks.id, parsed.taskId));
  revalidatePath("/", "layout");
}

// Edición completa (nombre/fechas/predecesor/owner) — la acción
// "Crear/editar tarea" de la spec, aparte de la actualización rápida
// de progreso de arriba.
const updateTaskSchema = z.object({
  taskId: z.string().uuid(),
  name: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  predecessorTaskId: z.string().uuid().optional(),
  lagDays: z.coerce.number().int().optional(),
  ownerUserId: z.string().uuid().optional(),
});

export async function updateTask(formData: FormData) {
  const parsed = updateTaskSchema.parse({
    taskId: formData.get("taskId"),
    name: formData.get("name"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    predecessorTaskId: formData.get("predecessorTaskId") || undefined,
    lagDays: formData.get("lagDays") || undefined,
    ownerUserId: formData.get("ownerUserId") || undefined,
  });
  await db
    .update(tasks)
    .set({
      name: parsed.name,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      predecessorTaskId: parsed.predecessorTaskId ?? null,
      lagDays: parsed.lagDays ?? 0,
      ownerUserId: parsed.ownerUserId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, parsed.taskId));
  revalidatePath("/", "layout");
}

const createMilestoneSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1),
  targetDate: z.string().min(1),
  taskId: z.string().uuid().optional(),
  isCritical: z.string().optional(),
});

export async function createMilestone(formData: FormData) {
  const parsed = createMilestoneSchema.parse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
    targetDate: formData.get("targetDate"),
    taskId: formData.get("taskId") || undefined,
    isCritical: formData.get("isCritical") || undefined,
  });
  const phase = await getPhaseForProject(parsed.projectId);

  await db.insert(milestones).values({
    phaseId: phase.id,
    taskId: parsed.taskId ?? null,
    name: parsed.name,
    targetDate: parsed.targetDate,
    isCritical: !!parsed.isCritical,
  });

  revalidatePath("/", "layout");
}
