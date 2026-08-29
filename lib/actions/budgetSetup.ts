"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { costCodes, budgetLines, phases } from "@/lib/db/schema";
import { getDevOrgId } from "@/lib/auth/devUser";
import { RESIDENTIAL_FOR_SALE_CATALOG, isLeaf } from "@/lib/costCodes/defaultCatalog";

// "A la hora de dar de alta un presupuesto, dar la opción de usar el
// catálogo de partidas por default o personalizarlas" — this file is
// both paths. Either way, only LEAF cost codes ever get a BudgetLine;
// a code with children (e.g. "02 Soft Costs") is a pure grouping row —
// its numbers on the Budget page are the sum of its sub-partidas, not
// a captured amount of its own.

async function getPhaseForProject(projectId: string) {
  const [phase] = await db.select().from(phases).where(eq(phases.projectId, projectId)).limit(1);
  if (!phase) throw new Error(`No phase found for project ${projectId} — was it seeded/approved?`);
  return phase;
}

const applyCatalogSchema = z.object({ projectId: z.string().uuid() });

export async function applyDefaultCatalog(formData: FormData) {
  const { projectId } = applyCatalogSchema.parse({ projectId: formData.get("projectId") });
  const phase = await getPhaseForProject(projectId);
  const orgId = await getDevOrgId();

  const existing = await db.select({ id: budgetLines.id }).from(budgetLines).where(eq(budgetLines.phaseId, phase.id));
  if (existing.length > 0) {
    throw new Error("Este proyecto ya tiene partidas — el catálogo por default solo aplica a un presupuesto vacío.");
  }

  const idByCode = new Map<string, string>();

  // Parents first (parentCode: null), then children — the catalog is
  // already ordered that way, so a single pass resolves every parent
  // reference against idByCode.
  for (const entry of RESIDENTIAL_FOR_SALE_CATALOG) {
    const parentId = entry.parentCode ? idByCode.get(entry.parentCode) ?? null : null;

    const [existingCode] = await db
      .select()
      .from(costCodes)
      .where(and(eq(costCodes.organizationId, orgId), eq(costCodes.code, entry.code)));

    const costCode =
      existingCode ??
      (
        await db
          .insert(costCodes)
          .values({ organizationId: orgId, code: entry.code, description: entry.description, parentCostCodeId: parentId })
          .returning()
      )[0];

    idByCode.set(entry.code, costCode.id);

    if (isLeaf(RESIDENTIAL_FOR_SALE_CATALOG, entry.code)) {
      await db.insert(budgetLines).values({ phaseId: phase.id, costCodeId: costCode.id, originalAmount: "0" });
    }
  }

  revalidatePath("/", "layout");
}

const addCostCodeSchema = z.object({
  projectId: z.string().uuid(),
  code: z.string().min(1),
  description: z.string().min(1),
  parentCode: z.string().optional(),
  originalAmount: z.coerce.number().min(0),
});

export async function addCostCode(formData: FormData) {
  const parsed = addCostCodeSchema.parse({
    projectId: formData.get("projectId"),
    code: formData.get("code"),
    description: formData.get("description"),
    parentCode: formData.get("parentCode") || undefined,
    originalAmount: formData.get("originalAmount"),
  });
  const phase = await getPhaseForProject(parsed.projectId);
  const orgId = await getDevOrgId();

  let parentId: string | null = null;
  if (parsed.parentCode) {
    const [parent] = await db
      .select()
      .from(costCodes)
      .where(and(eq(costCodes.organizationId, orgId), eq(costCodes.code, parsed.parentCode)));
    if (!parent) throw new Error(`Cost code padre "${parsed.parentCode}" no existe todavía.`);
    parentId = parent.id;
  }

  const [existingCode] = await db
    .select()
    .from(costCodes)
    .where(and(eq(costCodes.organizationId, orgId), eq(costCodes.code, parsed.code)));

  const costCode =
    existingCode ??
    (
      await db
        .insert(costCodes)
        .values({ organizationId: orgId, code: parsed.code, description: parsed.description, parentCostCodeId: parentId })
        .returning()
    )[0];

  await db.insert(budgetLines).values({
    phaseId: phase.id,
    costCodeId: costCode.id,
    originalAmount: String(parsed.originalAmount),
  });

  revalidatePath("/", "layout");
}

const setInitialBudgetSchema = z.object({
  budgetLineId: z.string().uuid(),
  originalAmount: z.coerce.number().min(0),
});

// Distinta de correctOriginalAmount de abajo: esto es capturar el
// presupuesto por PRIMERA vez, no corregir un error después del hecho.
// Aplicar el catálogo por default (o "personalizar") deja cada partida
// en $0 — llenar ese número no es una excepción ni necesita motivo ni
// warning, porque todavía no hay nada comprometido ni pagado contra
// esta partida. La página solo ofrece esta acción mientras
// Committed=0 y Actual=0; en cuanto hay actividad real, pasa a requerir
// el flujo con warning de correctOriginalAmount.
export async function setInitialBudget(formData: FormData) {
  const parsed = setInitialBudgetSchema.parse({
    budgetLineId: formData.get("budgetLineId"),
    originalAmount: formData.get("originalAmount"),
  });

  await db
    .update(budgetLines)
    .set({ originalAmount: String(parsed.originalAmount), updatedAt: new Date() })
    .where(eq(budgetLines.id, parsed.budgetLineId));

  revalidatePath("/", "layout");
}

const correctOriginalAmountSchema = z.object({
  budgetLineId: z.string().uuid(),
  originalAmount: z.coerce.number().min(0),
  reason: z.string().min(1),
});

// El presupuesto original NO se debe mover en el curso normal del
// proyecto — para eso están las Aditivas y Rebalanceos (ver
// lib/actions/budgetChanges.ts), que sí quedan en el historial y pasan
// por aprobación. Esta acción es sólo la excepción: corregir un error
// de captura del original (p.ej. se tecleó mal al dar de alta el
// presupuesto). Por eso exige un motivo — la advertencia de que esto
// no es el camino normal vive en la UI, justo antes de este botón.
export async function correctOriginalAmount(formData: FormData) {
  const parsed = correctOriginalAmountSchema.parse({
    budgetLineId: formData.get("budgetLineId"),
    originalAmount: formData.get("originalAmount"),
    reason: formData.get("reason"),
  });

  await db
    .update(budgetLines)
    .set({ originalAmount: String(parsed.originalAmount), updatedAt: new Date() })
    .where(eq(budgetLines.id, parsed.budgetLineId));

  revalidatePath("/", "layout");
}
