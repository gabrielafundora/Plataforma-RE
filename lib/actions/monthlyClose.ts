"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { snapshots, cashFlowPeriods, cashFlowLines, returnMetrics } from "@/lib/db/schema";
import { getDevUserId } from "@/lib/auth/devUser";
import { computeMonthlyLedger } from "@/lib/businessplan/monthlyLedger";
import { calculateIRR, calculateNPV, calculateMOIC, DISCOUNT_RATE } from "@/lib/businessplan/returns";
import { buildCashFlowPeriodRows, buildReturnMetricRows } from "@/lib/monthlyClose/buildSnapshotRows";

// Monthly Close (§4.6, §7.1 pantalla 18) — el ritual mensual. Los pasos
// 1-8 del wizard no capturan nada propio: cada uno es una revisión que
// enlaza a la pantalla del módulo correspondiente (Invoices, Budget,
// Forecast, Schedule, Inventory/Collections, Debt/Equity, Cash
// Flow/Returns), que ya son capturas en vivo. Solo el paso 9 escribe
// algo — congela el MonthlyLedger/returns de ese momento en un
// Snapshot inmutable.

/** El "mes en curso" a cerrar es siempre el mes calendario actual — sin
 * cola de meses atrasados por cerrar: esta app no versiona datos por
 * periodo (invoices/collections/draws son siempre "hoy"), así que
 * cerrar un mes pasado no reconstruiría de verdad ese pasado, solo
 * confundiría el historial con una fecha que no corresponde a cuándo se
 * congeló el dato. */
export async function getCurrentClosePeriod(
  projectId: string
): Promise<{ periodMonth: string; alreadyClosed: boolean; existingSnapshotId: string | null }> {
  const today = new Date();
  const periodMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);

  const [existing] = await db
    .select({ id: snapshots.id })
    .from(snapshots)
    .where(
      and(
        eq(snapshots.projectId, projectId),
        eq(snapshots.type, "monthly_close"),
        eq(snapshots.periodMonth, periodMonth)
      )
    );

  return { periodMonth, alreadyClosed: !!existing, existingSnapshotId: existing?.id ?? null };
}

const closePeriodSchema = z.object({ projectId: z.string().uuid() });

export async function closePeriod(formData: FormData) {
  const { projectId } = closePeriodSchema.parse({ projectId: formData.get("projectId") });

  const { periodMonth, alreadyClosed } = await getCurrentClosePeriod(projectId);
  if (alreadyClosed) {
    // No debería pasar con el guard de la pantalla (el botón no se
    // muestra si ya está cerrado) — defensivo por si dos pestañas
    // cierran el mismo mes a la vez.
    throw new Error(`El periodo ${periodMonth} ya fue cerrado — ver Snapshots.`);
  }

  const userId = await getDevUserId();
  const ledger = await computeMonthlyLedger(projectId);

  const unleveredSeries = ledger.cfBeforeFinancing;
  const equitySeries = ledger.equityIn.map((v, i) => -v + ledger.equityOut[i]);
  const profitMargin =
    ledger.totals.projectedRevenue > 0
      ? (ledger.totals.projectedRevenue - ledger.totals.currentBudget) / ledger.totals.projectedRevenue
      : null;

  const periodRows = buildCashFlowPeriodRows(ledger);
  const metricRows = buildReturnMetricRows(ledger, {
    unleveredIrr: calculateIRR(unleveredSeries),
    leveredIrr: calculateIRR(equitySeries),
    unleveredNpv: calculateNPV(DISCOUNT_RATE, unleveredSeries),
    unleveredMoic: calculateMOIC(unleveredSeries),
    leveredMoic: calculateMOIC(equitySeries),
    profitMargin,
  });

  // Snapshot inmutable — una sola transacción para que "cerrado" nunca
  // quede a medias (un snapshot con solo algunos meses/metrics sería
  // peor que no cerrarlo).
  const snapshotId = await db.transaction(async (tx) => {
    const [snap] = await tx
      .insert(snapshots)
      .values({ projectId, type: "monthly_close", periodMonth, createdBy: userId })
      .returning();

    const insertedPeriods = await tx
      .insert(cashFlowPeriods)
      .values(periodRows.map((p) => ({ snapshotId: snap.id, periodMonth: p.periodMonth, isActual: p.isActual })))
      .returning();

    // Postgres conserva el orden de un INSERT ... RETURNING multi-fila
    // igual al orden de los VALUES — por eso se puede emparejar por
    // índice con periodRows sin volver a consultar.
    const lineValues = insertedPeriods.flatMap((cfp, i) =>
      periodRows[i].lines.map((l) => ({
        cashFlowPeriodId: cfp.id,
        category: l.category,
        amount: String(l.amount),
      }))
    );
    if (lineValues.length > 0) {
      await tx.insert(cashFlowLines).values(lineValues);
    }

    if (metricRows.length > 0) {
      await tx.insert(returnMetrics).values(
        metricRows.map((m) => ({
          snapshotId: snap.id,
          scope: m.scope,
          metricKey: m.metricKey,
          value: String(m.value),
        }))
      );
    }

    return snap.id;
  });

  revalidatePath("/", "layout");
  redirect(`/projects/${projectId}/snapshots/${snapshotId}`);
}
