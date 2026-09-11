"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
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

// "Falta todo el tema de poder crear un proyecto nuevo" — antes de esto
// la única forma de crear cualquier fila Organization/Portfolio/
// Project/Phase era `npm run db:seed`. La creación real ahora vive en
// lib/actions/deal.ts (createDeal) — todo proyecto nuevo arranca en
// modo Deal/Underwriting (§3.3, decisión 8·01) y se promueve a
// `status: "active"` recién al aprobarse (approveDeal). Este archivo
// sigue siendo el lugar para las acciones de un proyecto YA aprobado:
// editar sus detalles y borrarlo.

// Configuración de proyecto — "detalles del proyecto", los mismos
// campos que ya se capturan en createDeal (lib/actions/deal.ts), ahora
// editables después de creado. Edición de metadata simple, sin advertencia ni
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
  forecastMonths: z.coerce.number().int().positive(),
});

export async function updateProjectDetails(formData: FormData) {
  const parsed = updateProjectDetailsSchema.parse({
    projectId: formData.get("projectId"),
    name: formData.get("name"),
    strategy: formData.get("strategy"),
    currency: formData.get("currency"),
    market: formData.get("market"),
    location: formData.get("location") || undefined,
    forecastMonths: formData.get("forecastMonths"),
  });

  await db
    .update(projects)
    .set({
      name: parsed.name,
      strategy: parsed.strategy,
      currency: parsed.currency,
      market: parsed.market,
      location: parsed.location,
      forecastMonths: parsed.forecastMonths,
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
