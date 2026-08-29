"use server";

import { redirect } from "next/navigation";
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

// "Esto solo se debe poder hacer desde la página de Control
// Presupuestal y no las de las partidas individuales" — saveBudgetBaseline
// is the one place the whole project's presupuesto base gets captured
// or corrected, from the bulk table at
// /projects/[projectId]/budget/setup. Field names are dynamic
// (`amount_<budgetLineId>`, one per leaf) so they're read directly off
// formData instead of a static zod object.
//
// "reason" is only present (and required by the form) once at least
// one leaf already has a non-zero original — that's the "esto ya no es
// dar de alta, es modificar" case the UI warns about. There's no
// audit_log table wired into Drizzle yet, so — same disclosed
// limitation as the rest of this slice — the reason isn't persisted
// anywhere; it's a confirmation step, not an audit trail.
const amountFieldSchema = z.coerce.number().min(0);

export async function saveBudgetBaseline(formData: FormData) {
  const projectId = z.string().uuid().parse(formData.get("projectId"));
  const phase = await getPhaseForProject(projectId);

  const leafLines = await db
    .select({ id: budgetLines.id })
    .from(budgetLines)
    .where(eq(budgetLines.phaseId, phase.id));
  const validIds = new Set(leafLines.map((l) => l.id));

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("amount_")) continue;
    const budgetLineId = key.slice("amount_".length);
    if (!validIds.has(budgetLineId)) continue;

    const amount = amountFieldSchema.parse(value);
    await db
      .update(budgetLines)
      .set({ originalAmount: String(amount), updatedAt: new Date() })
      .where(eq(budgetLines.id, budgetLineId));
  }

  revalidatePath("/", "layout");
  redirect(`/projects/${projectId}/budget`);
}
