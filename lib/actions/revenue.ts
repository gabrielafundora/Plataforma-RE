"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { units, sales, collections, phases } from "@/lib/db/schema";
import { buildPaymentPlan, expandPaymentPlan } from "@/lib/revenue/paymentPlan";

// Revenue — motor For Sale (§5, único en MVP). Mismas convenciones que
// lib/actions/budgetSetup.ts / contracts.ts: "use server", un schema
// zod por acción, .parse() (que truene si algo no cuadra), sin capa de
// aprobaciones todavía (igual que contracts.ts del lado de Costs — se
// construye en una siguiente slice si hace falta).

async function getPhaseForProject(projectId: string) {
  const [phase] = await db.select().from(phases).where(eq(phases.projectId, projectId)).limit(1);
  if (!phase) throw new Error(`No phase found for project ${projectId} — was it seeded/approved?`);
  return phase;
}

const createUnitSchema = z.object({
  projectId: z.string().uuid(),
  code: z.string().min(1),
  unitType: z.string().min(1),
  areaM2: z.coerce.number().positive(),
  pricePerM2: z.coerce.number().positive(),
});

export async function createUnit(formData: FormData) {
  const parsed = createUnitSchema.parse({
    projectId: formData.get("projectId"),
    code: formData.get("code"),
    unitType: formData.get("unitType"),
    areaM2: formData.get("areaM2"),
    pricePerM2: formData.get("pricePerM2"),
  });
  const phase = await getPhaseForProject(parsed.projectId);

  await db.insert(units).values({
    phaseId: phase.id,
    code: parsed.code,
    unitType: parsed.unitType,
    areaM2: String(parsed.areaM2),
    pricePerM2: String(parsed.pricePerM2),
  });

  revalidatePath("/", "layout");
}

const updateUnitPriceSchema = z.object({
  unitId: z.string().uuid(),
  pricePerM2: z.coerce.number().positive(),
});

export async function updateUnitPrice(formData: FormData) {
  const parsed = updateUnitPriceSchema.parse({
    unitId: formData.get("unitId"),
    pricePerM2: formData.get("pricePerM2"),
  });

  const [unit] = await db.select().from(units).where(eq(units.id, parsed.unitId));
  if (!unit) throw new Error("Unidad no encontrada.");
  if (unit.status !== "available") {
    throw new Error('Solo se puede ajustar el precio de una unidad "available" — ya está reservada o vendida.');
  }

  await db
    .update(units)
    .set({ pricePerM2: String(parsed.pricePerM2), updatedAt: new Date() })
    .where(eq(units.id, parsed.unitId));

  revalidatePath("/", "layout");
}

// "Registrar venta" (pantalla 12) — vive en su propia sub-ruta
// (/inventory/[unitId]/sell), no en la fila de la tabla ni en un modal,
// porque son 5 campos del plan de pagos además del monto — demasiado
// para una fila (mismo criterio que budget/setup es su propia sub-ruta).
// downPaymentPercent/closingPercent llegan del formulario como 0-100
// (más natural de teclear que una fracción) y se convierten a 0-1 justo
// antes de llamar a buildPaymentPlan, que sí trabaja en fracción.
const registerSaleSchema = z.object({
  projectId: z.string().uuid(),
  unitId: z.string().uuid(),
  saleDate: z.string().min(1),
  downPaymentPercent: z.coerce.number().min(0).max(100),
  closingPercent: z.coerce.number().min(0).max(100),
  installmentsCount: z.coerce.number().int().min(1),
  closingOffsetMonths: z.coerce.number().int().min(1),
  priceTotalOverride: z.coerce.number().positive().optional(),
});

export async function registerSale(formData: FormData) {
  const parsed = registerSaleSchema.parse({
    projectId: formData.get("projectId"),
    unitId: formData.get("unitId"),
    saleDate: formData.get("saleDate"),
    downPaymentPercent: formData.get("downPaymentPercent"),
    closingPercent: formData.get("closingPercent"),
    installmentsCount: formData.get("installmentsCount"),
    closingOffsetMonths: formData.get("closingOffsetMonths"),
    priceTotalOverride: formData.get("priceTotalOverride") || undefined,
  });

  const [unit] = await db.select().from(units).where(eq(units.id, parsed.unitId));
  if (!unit) throw new Error("Unidad no encontrada.");
  if (unit.status !== "available") throw new Error('Esta unidad ya no está "available".');

  const priceTotal = parsed.priceTotalOverride ?? Number(unit.areaM2) * Number(unit.pricePerM2);
  const plan = buildPaymentPlan(priceTotal, {
    downPaymentPct: parsed.downPaymentPercent / 100,
    closingPct: parsed.closingPercent / 100,
    installmentsCount: parsed.installmentsCount,
    closingOffsetMonths: parsed.closingOffsetMonths,
  });
  const schedule = expandPaymentPlan(parsed.saleDate, plan);

  const [sale] = await db
    .insert(sales)
    .values({
      unitId: parsed.unitId,
      saleDate: parsed.saleDate,
      priceTotal: String(priceTotal),
      paymentPlan: plan,
    })
    .returning();

  await db.insert(collections).values(
    schedule.map((row) => ({
      saleId: sale.id,
      dueDate: row.dueDate,
      amount: String(row.amount),
    }))
  );

  await db.update(units).set({ status: "sold", updatedAt: new Date() }).where(eq(units.id, parsed.unitId));

  revalidatePath("/", "layout");
  redirect(`/projects/${parsed.projectId}/inventory`);
}

const registerCollectionSchema = z.object({
  collectionId: z.string().uuid(),
  paidDate: z.string().min(1),
  amount: z.coerce.number().positive(),
});

export async function registerCollection(formData: FormData) {
  const parsed = registerCollectionSchema.parse({
    collectionId: formData.get("collectionId"),
    paidDate: formData.get("paidDate"),
    amount: formData.get("amount"),
  });

  // El cobro no tiene un ledger de pagos parciales como Invoice->Payment
  // del lado de Costs — se sobreescribe el monto pendiente con lo
  // efectivamente cobrado en un solo paso. Simplificación consciente
  // para esta primera vuelta (ver plan — cortes de alcance).
  await db
    .update(collections)
    .set({ amount: String(parsed.amount), paidDate: parsed.paidDate, status: "paid", updatedAt: new Date() })
    .where(eq(collections.id, parsed.collectionId));

  revalidatePath("/", "layout");
}

// "Ajustar curva de absorción" (pantalla 13) — no hay una fórmula de
// curva guardada; la "curva" es, literalmente, la fecha/monto de cada
// Collection pendiente. Reprogramar una es ajustarla.
const rescheduleCollectionSchema = z.object({
  collectionId: z.string().uuid(),
  dueDate: z.string().min(1),
  amount: z.coerce.number().positive(),
});

export async function rescheduleCollection(formData: FormData) {
  const parsed = rescheduleCollectionSchema.parse({
    collectionId: formData.get("collectionId"),
    dueDate: formData.get("dueDate"),
    amount: formData.get("amount"),
  });

  const [collection] = await db.select().from(collections).where(eq(collections.id, parsed.collectionId));
  if (!collection) throw new Error("Collection no encontrada.");
  if (collection.status !== "pending") throw new Error("Solo se puede reprogramar un cobro pendiente.");

  await db
    .update(collections)
    .set({ dueDate: parsed.dueDate, amount: String(parsed.amount), updatedAt: new Date() })
    .where(eq(collections.id, parsed.collectionId));

  revalidatePath("/", "layout");
}
