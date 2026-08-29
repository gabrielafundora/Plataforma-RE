"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, ilike, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  portfolios,
  projects,
  phases,
  budgetLines,
  budgetChanges,
  contracts,
  changeOrders,
  accruals,
  invoices,
  approvalRequests,
} from "@/lib/db/schema";
import { getDevOrgId } from "@/lib/auth/devUser";

// "Falta todo el tema de poder crear un proyecto nuevo" — before this,
// the only way any Organization/Portfolio/Project/Phase row got created
// was `npm run db:seed`. This is the real in-app path.
//
// Scope cut (deliberate, see the plan): the project is created directly
// as `status: "active"` with `approved_at` set, same as seed.ts does
// today. The full Deal/Underwriting mode (`status: "deal"`, comparable
// `scenarios`) is designed in docs/schema/schema.sql but not wired up
// here — a project doesn't lose anything by skipping it now, since
// nothing yet reads the "deal" state or the scenarios table.

const createProjectSchema = z.object({
  name: z.string().min(1),
  portfolioName: z.string().min(1),
  strategy: z.enum(["development", "acquisition"]),
  currency: z.enum(["USD", "MXN"]),
  market: z.enum(["US", "MX"]),
  location: z.string().optional(),
});

export async function createProject(formData: FormData) {
  const parsed = createProjectSchema.parse({
    name: formData.get("name"),
    portfolioName: formData.get("portfolioName"),
    strategy: formData.get("strategy"),
    currency: formData.get("currency"),
    market: formData.get("market"),
    location: formData.get("location") || undefined,
  });
  const orgId = await getDevOrgId();

  const [existingPortfolio] = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.organizationId, orgId), ilike(portfolios.name, parsed.portfolioName)));

  const portfolio =
    existingPortfolio ??
    (await db.insert(portfolios).values({ organizationId: orgId, name: parsed.portfolioName }).returning())[0];

  const [project] = await db
    .insert(projects)
    .values({
      portfolioId: portfolio.id,
      name: parsed.name,
      status: "active",
      strategy: parsed.strategy,
      assetClass: "residential_for_sale",
      currency: parsed.currency,
      market: parsed.market,
      location: parsed.location,
      approvedAt: new Date(),
    })
    .returning();

  await db.insert(phases).values({
    projectId: project.id,
    name: "Fase única",
    assetClass: "residential_for_sale",
  });

  redirect(`/projects/${project.id}/budget`);
}

// Configuración de proyecto — "detalles del proyecto", los mismos
// campos que ya se capturan en createProject arriba, ahora editables
// después de creado. Edición de metadata simple, sin advertencia ni
// motivo: a diferencia del presupuesto, esto no mueve dinero
// comprometido, así que no carga el mismo peso que
// correctOriginalAmount/deleteProject.
const updateProjectDetailsSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1),
  strategy: z.enum(["development", "acquisition"]),
  currency: z.enum(["USD", "MXN"]),
  market: z.enum(["US", "MX"]),
  location: z.string().optional(),
});

export async function updateProjectDetails(formData: FormData) {
  const parsed = updateProjectDetailsSchema.parse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
    strategy: formData.get("strategy"),
    currency: formData.get("currency"),
    market: formData.get("market"),
    location: formData.get("location") || undefined,
  });

  await db
    .update(projects)
    .set({
      name: parsed.name,
      strategy: parsed.strategy,
      currency: parsed.currency,
      market: parsed.market,
      location: parsed.location,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, parsed.projectId));

  revalidatePath("/", "layout");
}

// "Debe haber una forma de borrar un proyecto." Irreversible sobre
// datos financieros reales, así que exige escribir el nombre exacto
// del proyecto (comparado contra el nombre real en la base, nunca
// contra un valor que venga del propio form) antes de tocar nada.
//
// No todo el árbol cascada solo en el schema (docs/schema/schema.sql):
// contracts.budget_line_id e invoices.contract_id NO tienen "on delete
// cascade" (Postgres bloquearía el borrado del proyecto con un error de
// FK), y approval_requests.entity_id es una FK polimórfica sin
// constraint real — hay que limpiarla a mano o quedan huérfanas. Por
// eso esto corre en una transacción: la primera de la app, justificada
// porque es la primera operación multi-tabla donde un fallo a medias
// dejaría basura financiera huérfana.
//
// cost_codes y counterparties son a nivel organización (se reusan
// entre proyectos) — nunca se tocan aquí.
const deleteProjectSchema = z.object({
  projectId: z.string().uuid(),
  confirmName: z.string().min(1),
});

export async function deleteProject(formData: FormData) {
  const parsed = deleteProjectSchema.parse({
    projectId: formData.get("projectId"),
    confirmName: formData.get("confirmName"),
  });

  const [project] = await db.select().from(projects).where(eq(projects.id, parsed.projectId));
  if (!project) throw new Error("Proyecto no encontrado.");
  if (parsed.confirmName.trim() !== project.name) {
    throw new Error(`El nombre no coincide — escribe exactamente "${project.name}" para confirmar.`);
  }

  await db.transaction(async (tx) => {
    const projectPhases = await tx.select({ id: phases.id }).from(phases).where(eq(phases.projectId, parsed.projectId));
    const phaseIds = projectPhases.map((p) => p.id);

    const projectBudgetLines = phaseIds.length
      ? await tx.select({ id: budgetLines.id }).from(budgetLines).where(inArray(budgetLines.phaseId, phaseIds))
      : [];
    const budgetLineIds = projectBudgetLines.map((b) => b.id);

    const projectContracts = budgetLineIds.length
      ? await tx.select({ id: contracts.id }).from(contracts).where(inArray(contracts.budgetLineId, budgetLineIds))
      : [];
    const contractIds = projectContracts.map((c) => c.id);

    const projectInvoices = contractIds.length
      ? await tx.select({ id: invoices.id }).from(invoices).where(inArray(invoices.contractId, contractIds))
      : [];
    const invoiceIds = projectInvoices.map((i) => i.id);

    const projectChangeOrders = contractIds.length
      ? await tx.select({ id: changeOrders.id }).from(changeOrders).where(inArray(changeOrders.contractId, contractIds))
      : [];
    const changeOrderIds = projectChangeOrders.map((c) => c.id);

    const projectBudgetChanges = budgetLineIds.length
      ? await tx.select({ id: budgetChanges.id }).from(budgetChanges).where(inArray(budgetChanges.budgetLineId, budgetLineIds))
      : [];
    const budgetChangeIds = projectBudgetChanges.map((b) => b.id);

    // Limpieza de la FK polimórfica antes de que sus entidades desaparezcan.
    if (invoiceIds.length) {
      await tx.delete(approvalRequests).where(and(eq(approvalRequests.entityType, "invoice"), inArray(approvalRequests.entityId, invoiceIds)));
    }
    if (changeOrderIds.length) {
      await tx.delete(approvalRequests).where(and(eq(approvalRequests.entityType, "change_order"), inArray(approvalRequests.entityId, changeOrderIds)));
    }
    if (budgetChangeIds.length) {
      await tx.delete(approvalRequests).where(and(eq(approvalRequests.entityType, "budget_change"), inArray(approvalRequests.entityId, budgetChangeIds)));
    }

    // accruals: sin uso todavía en la app, pero sin cascade en el schema — limpiar por si acaso.
    if (budgetLineIds.length) await tx.delete(accruals).where(inArray(accruals.budgetLineId, budgetLineIds));
    if (contractIds.length) await tx.delete(accruals).where(inArray(accruals.contractId, contractIds));

    if (contractIds.length) await tx.delete(invoices).where(inArray(invoices.contractId, contractIds)); // cascada -> payments
    if (budgetLineIds.length) await tx.delete(contracts).where(inArray(contracts.budgetLineId, budgetLineIds)); // cascada -> change_orders

    // Cascada automática desde aquí: phases -> budget_lines -> budget_changes.
    await tx.delete(projects).where(eq(projects.id, parsed.projectId));
  });

  revalidatePath("/", "layout");
  redirect("/");
}
