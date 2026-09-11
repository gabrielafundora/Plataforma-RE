import Link from "next/link";
import { eq, and, ne, inArray, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  projects,
  phases,
  budgetLines,
  budgetLineRollup,
  invoices,
  contracts,
  changeOrders,
  tasks,
  milestones,
  units,
  collections,
  sales,
  debtFacilities,
  debtFacilityRollup,
  equityInvestorRollup,
  snapshots,
  returnMetrics,
} from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { computeCriticalPath } from "@/lib/schedule/criticalPath";
import { computeMonthlyLedger } from "@/lib/businessplan/monthlyLedger";
import { calculateIRR, calculateNPV, calculateMOIC } from "@/lib/businessplan/returns";
import { getCurrentClosePeriod, closePeriod } from "@/lib/actions/monthlyClose";

// Pantalla 18 — Monthly Close (§4.6, §7.2·C): wizard guiado de una sola
// sesión, no 9 pantallas sueltas. Los pasos 1-8 no capturan nada
// propio — cada uno es una revisión que enlaza al módulo real (donde ya
// se captura); solo el paso 9 escribe: congela el cash flow/returns de
// ese momento en un Snapshot inmutable (lib/actions/monthlyClose.ts).
export const dynamic = "force-dynamic";

const DISCOUNT_RATE = 0.15;

const STEP_TITLES = [
  "Marcar invoices como Paid",
  "Revisar budget y change orders",
  "Actualizar forecast remanente",
  "Actualizar schedule y milestones",
  "Actualizar ventas y cobranza",
  "Recalcular deuda, interés y equity",
  "Recalcular cash flow y retornos",
  "Revisar variance drivers",
  "Cerrar periodo",
];

export default async function MonthlyClosePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { projectId } = await params;
  const { step: stepParam } = await searchParams;
  const step = Math.min(Math.max(parseInt(stepParam ?? "1", 10) || 1, 1), 9);

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-6xl px-6 py-12 text-ink-soft">Proyecto no encontrado.</main>
      </>
    );
  }

  const { periodMonth, alreadyClosed, existingSnapshotId } = await getCurrentClosePeriod(projectId);
  const periodLabel = new Date(periodMonth + "T00:00:00").toLocaleDateString("es-MX", {
    month: "long",
    year: "numeric",
  });

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="monthlyClose" />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-ink-soft">
              Monthly Close — <span className="capitalize">{periodLabel}</span>
            </div>
            <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>
          </div>
          <Link href={`/projects/${projectId}/snapshots`} className="text-sm text-blueprint hover:underline">
            Ver historial →
          </Link>
        </div>

        {/* Barra de progreso — 9 pasos, patrón Wireframe L. */}
        <div className="mt-6 flex items-center gap-1">
          {STEP_TITLES.map((title, i) => {
            const n = i + 1;
            return (
              <Link
                key={n}
                href={`/projects/${projectId}/monthly-close?step=${n}`}
                title={title}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  n === step ? "bg-blueprint" : n < step ? "bg-blueprint/40" : "bg-surface-2"
                }`}
              />
            );
          })}
        </div>
        <div className="mt-2 text-xs text-ink-faint">
          Paso {step} de 9 — {STEP_TITLES[step - 1]}
        </div>

        <div className="mt-6 rounded-xl border border-line bg-surface p-6 shadow-sm">
          {step === 1 && <Step1 projectId={projectId} />}
          {step === 2 && <Step2 projectId={projectId} />}
          {step === 3 && <Step3 projectId={projectId} />}
          {step === 4 && <Step4 projectId={projectId} />}
          {step === 5 && <Step5 projectId={projectId} />}
          {step === 6 && <Step6 projectId={projectId} />}
          {step === 7 && <Step7 projectId={projectId} />}
          {step === 8 && <Step8 projectId={projectId} periodMonth={periodMonth} />}
          {step === 9 && (
            <Step9
              projectId={projectId}
              periodLabel={periodLabel}
              alreadyClosed={alreadyClosed}
              existingSnapshotId={existingSnapshotId}
            />
          )}
        </div>

        <div className="mt-4 flex items-center justify-between text-sm">
          {step > 1 ? (
            <Link href={`/projects/${projectId}/monthly-close?step=${step - 1}`} className="text-ink-soft hover:text-ink">
              ← Anterior
            </Link>
          ) : (
            <span />
          )}
          {step < 9 && (
            <Link
              href={`/projects/${projectId}/monthly-close?step=${step + 1}`}
              className="rounded-lg bg-blueprint px-4 py-2 font-medium text-white transition-opacity hover:opacity-90"
            >
              Guardar y continuar →
            </Link>
          )}
        </div>
      </main>
    </>
  );
}

function StepHeading({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h2 className="font-display text-lg font-semibold text-ink">
      {n}. {children}
    </h2>
  );
}

async function Step1({ projectId }: { projectId: string }) {
  const rows = await db
    .select({ id: invoices.id })
    .from(invoices)
    .innerJoin(contracts, eq(contracts.id, invoices.contractId))
    .innerJoin(budgetLines, eq(budgetLines.id, contracts.budgetLineId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .where(and(eq(phases.projectId, projectId), inArray(invoices.status, ["approved", "scheduled"])));

  return (
    <>
      <StepHeading n={1}>Marcar invoices como Paid</StepHeading>
      <p className="mt-2 text-sm text-ink-soft">
        Los costos se reconocen como Actual en cash basis — solo cuando su invoice pasa a{" "}
        <strong>Paid</strong> (captura nativa o import batch), no antes aunque ya esté devengado
        (Accrued). Marca aquí lo que ya se pagó este mes antes de seguir.
      </p>
      <div className="mt-4 rounded-lg bg-surface-2/60 p-4 text-sm">
        <span className="font-semibold text-ink">{rows.length}</span>{" "}
        <span className="text-ink-soft">invoice{rows.length === 1 ? "" : "s"} aprobada(s)/programada(s) lista(s) para marcar como pagada.</span>
      </div>
      <Link href={`/projects/${projectId}/invoices`} className="mt-4 inline-block text-sm text-blueprint hover:underline">
        Ir a Facturas →
      </Link>
    </>
  );
}

async function Step2({ projectId }: { projectId: string }) {
  const pendingCOs = await db
    .select({ id: changeOrders.id })
    .from(changeOrders)
    .innerJoin(contracts, eq(contracts.id, changeOrders.contractId))
    .innerJoin(budgetLines, eq(budgetLines.id, contracts.budgetLineId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .where(and(eq(phases.projectId, projectId), eq(changeOrders.status, "submitted")));

  return (
    <>
      <StepHeading n={2}>Revisar budget y change orders</StepHeading>
      <p className="mt-2 text-sm text-ink-soft">
        Confirma que el Current Budget refleja todos los Change Orders aprobados este mes, y decide
        los que sigan pendientes.
      </p>
      <div className="mt-4 rounded-lg bg-surface-2/60 p-4 text-sm">
        <span className="font-semibold text-ink">{pendingCOs.length}</span>{" "}
        <span className="text-ink-soft">change order{pendingCOs.length === 1 ? "" : "s"} pendiente(s) de decisión.</span>
      </div>
      <div className="mt-4 flex gap-4 text-sm">
        <Link href={`/projects/${projectId}/budget`} className="text-blueprint hover:underline">Ir a Budget →</Link>
        <Link href={`/projects/${projectId}/contracts`} className="text-blueprint hover:underline">Ir a Contratos →</Link>
      </div>
    </>
  );
}

async function Step3({ projectId }: { projectId: string }) {
  const rows = await db
    .select({ current: budgetLineRollup.currentAmount, forecast: budgetLineRollup.forecastToCompleteNaive, actual: budgetLineRollup.actualCost })
    .from(budgetLines)
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .leftJoin(budgetLineRollup, eq(budgetLineRollup.budgetLineId, budgetLines.id))
    .where(eq(phases.projectId, projectId));
  const current = rows.reduce((s, r) => s + Number(r.current ?? 0), 0);
  const forecastFinal = rows.reduce((s, r) => s + Number(r.actual ?? 0) + Number(r.forecast ?? 0), 0);

  return (
    <>
      <StepHeading n={3}>Actualizar forecast remanente</StepHeading>
      <p className="mt-2 text-sm text-ink-soft">
        Revisa el método de curva de cada partida (straight-line / S-curve / front/back-loaded) contra
        el avance real del mes.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-surface-2/60 p-4">
          <div className="text-ink-soft">Current Budget</div>
          <div className="mt-1 font-semibold tabular-nums text-ink">{formatMoney(current)}</div>
        </div>
        <div className="rounded-lg bg-surface-2/60 p-4">
          <div className="text-ink-soft">Forecast Final Cost</div>
          <div className="mt-1 font-semibold tabular-nums text-ink">{formatMoney(forecastFinal)}</div>
        </div>
      </div>
      <Link href={`/projects/${projectId}/forecast`} className="mt-4 inline-block text-sm text-blueprint hover:underline">
        Ir a Forecast →
      </Link>
    </>
  );
}

async function Step4({ projectId }: { projectId: string }) {
  const taskRows = await db
    .select({ id: tasks.id, endDate: tasks.endDate, predecessorTaskId: tasks.predecessorTaskId, progressPct: tasks.progressPct })
    .from(tasks)
    .innerJoin(phases, eq(phases.id, tasks.phaseId))
    .where(eq(phases.projectId, projectId));
  const pctComplete =
    taskRows.length > 0 ? Math.round(taskRows.reduce((s, t) => s + Number(t.progressPct), 0) / taskRows.length) : 0;
  const criticalPath = computeCriticalPath(taskRows.map((t) => ({ id: t.id, endDate: t.endDate, predecessorTaskId: t.predecessorTaskId })));

  const milestoneRows = await db
    .select({ targetDate: milestones.targetDate })
    .from(milestones)
    .innerJoin(phases, eq(phases.id, milestones.phaseId))
    .where(eq(phases.projectId, projectId));
  const today = new Date().toISOString().slice(0, 10);
  const overdueMilestones = milestoneRows.filter((m) => m.targetDate < today).length;

  return (
    <>
      <StepHeading n={4}>Actualizar schedule y milestones</StepHeading>
      <p className="mt-2 text-sm text-ink-soft">Actualiza el % de avance real de cada tarea y confirma milestones cumplidos.</p>
      <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
        <div className="rounded-lg bg-surface-2/60 p-4">
          <div className="text-ink-soft">% complete</div>
          <div className="mt-1 font-semibold tabular-nums text-ink">{pctComplete}%</div>
        </div>
        <div className="rounded-lg bg-surface-2/60 p-4">
          <div className="text-ink-soft">Ruta crítica</div>
          <div className="mt-1 font-semibold tabular-nums text-ink">{criticalPath.size} tareas</div>
        </div>
        <div className="rounded-lg bg-surface-2/60 p-4">
          <div className="text-ink-soft">Milestones vencidos</div>
          <div className={`mt-1 font-semibold tabular-nums ${overdueMilestones > 0 ? "text-redline" : "text-ink"}`}>{overdueMilestones}</div>
        </div>
      </div>
      <Link href={`/projects/${projectId}/schedule`} className="mt-4 inline-block text-sm text-blueprint hover:underline">
        Ir a Schedule →
      </Link>
    </>
  );
}

async function Step5({ projectId }: { projectId: string }) {
  const unitRows = await db
    .select({ status: units.status })
    .from(units)
    .innerJoin(phases, eq(phases.id, units.phaseId))
    .where(eq(phases.projectId, projectId));
  const soldUnits = unitRows.filter((u) => u.status === "sold").length;

  const collectionRows = await db
    .select({ status: collections.status, dueDate: collections.dueDate })
    .from(collections)
    .innerJoin(sales, eq(sales.id, collections.saleId))
    .innerJoin(units, eq(units.id, sales.unitId))
    .innerJoin(phases, eq(phases.id, units.phaseId))
    .where(eq(phases.projectId, projectId));
  const today = new Date().toISOString().slice(0, 10);
  const overdueCollections = collectionRows.filter((c) => c.status === "pending" && c.dueDate < today).length;

  return (
    <>
      <StepHeading n={5}>Actualizar ventas y cobranza</StepHeading>
      <p className="mt-2 text-sm text-ink-soft">Registra ventas nuevas, cobros recibidos y reprograma lo que se haya movido.</p>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-surface-2/60 p-4">
          <div className="text-ink-soft">Unidades vendidas</div>
          <div className="mt-1 font-semibold tabular-nums text-ink">{soldUnits}/{unitRows.length}</div>
        </div>
        <div className="rounded-lg bg-surface-2/60 p-4">
          <div className="text-ink-soft">Cobros vencidos</div>
          <div className={`mt-1 font-semibold tabular-nums ${overdueCollections > 0 ? "text-redline" : "text-ink"}`}>{overdueCollections}</div>
        </div>
      </div>
      <div className="mt-4 flex gap-4 text-sm">
        <Link href={`/projects/${projectId}/inventory`} className="text-blueprint hover:underline">Ir a Inventario →</Link>
        <Link href={`/projects/${projectId}/collections`} className="text-blueprint hover:underline">Ir a Cobranza →</Link>
      </div>
    </>
  );
}

async function Step6({ projectId }: { projectId: string }) {
  const [facility] = await db.select().from(debtFacilities).where(eq(debtFacilities.projectId, projectId));
  const [rollup] = facility
    ? await db.select().from(debtFacilityRollup).where(eq(debtFacilityRollup.debtFacilityId, facility.id))
    : [undefined];
  const investorRows = await db.select().from(equityInvestorRollup).where(eq(equityInvestorRollup.projectId, projectId));
  const equityInvested = investorRows.reduce((s, r) => s + Number(r.contributedAmount ?? 0), 0);

  return (
    <>
      <StepHeading n={6}>Recalcular deuda, interés y equity</StepHeading>
      <p className="mt-2 text-sm text-ink-soft">Registra draws fondeados, pagos de intereses/principal, y aportaciones de equity del mes.</p>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-surface-2/60 p-4">
          <div className="text-ink-soft">Deuda fondeada</div>
          <div className="mt-1 font-semibold tabular-nums text-ink">{formatMoney(Number(rollup?.fundedAmount ?? 0))}</div>
        </div>
        <div className="rounded-lg bg-surface-2/60 p-4">
          <div className="text-ink-soft">Equity aportado</div>
          <div className="mt-1 font-semibold tabular-nums text-ink">{formatMoney(equityInvested)}</div>
        </div>
      </div>
      <div className="mt-4 flex gap-4 text-sm">
        <Link href={`/projects/${projectId}/debt`} className="text-blueprint hover:underline">Ir a Deuda →</Link>
        <Link href={`/projects/${projectId}/equity`} className="text-blueprint hover:underline">Ir a Equity →</Link>
      </div>
    </>
  );
}

async function Step7({ projectId }: { projectId: string }) {
  const ledger = await computeMonthlyLedger(projectId);
  const unleveredIrr = calculateIRR(ledger.cfBeforeFinancing);
  const equitySeries = ledger.equityIn.map((v, i) => -v + ledger.equityOut[i]);
  const leveredIrr = calculateIRR(equitySeries);
  const npv = calculateNPV(DISCOUNT_RATE, ledger.cfBeforeFinancing);
  const moic = calculateMOIC(ledger.cfBeforeFinancing);

  const fmtPct = (v: number | null) => (v === null ? "N/A" : `${(v * 100).toFixed(1)}%`);

  return (
    <>
      <StepHeading n={7}>Recalcular cash flow y retornos</StepHeading>
      <p className="mt-2 text-sm text-ink-soft">
        Con lo anterior ya actualizado, este es el resultado en vivo del Cash Flow Engine — lo que se
        va a congelar en el Snapshot al cerrar el periodo.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div className="rounded-lg bg-surface-2/60 p-4">
          <div className="text-ink-soft">IRR Unlevered</div>
          <div className="mt-1 font-semibold tabular-nums text-ink">{fmtPct(unleveredIrr)}</div>
        </div>
        <div className="rounded-lg bg-surface-2/60 p-4">
          <div className="text-ink-soft">IRR Levered</div>
          <div className="mt-1 font-semibold tabular-nums text-ink">{fmtPct(leveredIrr)}</div>
        </div>
        <div className="rounded-lg bg-surface-2/60 p-4">
          <div className="text-ink-soft">NPV @ 15%</div>
          <div className="mt-1 font-semibold tabular-nums text-ink">{formatMoney(npv)}</div>
        </div>
        <div className="rounded-lg bg-surface-2/60 p-4">
          <div className="text-ink-soft">MOIC</div>
          <div className="mt-1 font-semibold tabular-nums text-ink">{moic === null ? "N/A" : `${moic.toFixed(2)}x`}</div>
        </div>
      </div>
      <div className="mt-4 flex gap-4 text-sm">
        <Link href={`/projects/${projectId}/cashflow`} className="text-blueprint hover:underline">Ir a Cash Flow →</Link>
        <Link href={`/projects/${projectId}/returns`} className="text-blueprint hover:underline">Ir a Returns →</Link>
      </div>
    </>
  );
}

async function Step8({ projectId, periodMonth }: { projectId: string; periodMonth: string }) {
  const rows = await db
    .select({ current: budgetLineRollup.currentAmount, forecast: budgetLineRollup.forecastToCompleteNaive, actual: budgetLineRollup.actualCost })
    .from(budgetLines)
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .leftJoin(budgetLineRollup, eq(budgetLineRollup.budgetLineId, budgetLines.id))
    .where(eq(phases.projectId, projectId));
  const current = rows.reduce((s, r) => s + Number(r.current ?? 0), 0);
  const forecastFinal = rows.reduce((s, r) => s + Number(r.actual ?? 0) + Number(r.forecast ?? 0), 0);
  const variance = current - forecastFinal;

  // Comparación contra el snapshot cerrado más reciente (si existe) —
  // no hay Baseline de UW en esta app (§3.3 requiere un flujo de Deal
  // que no se construyó), así que "variance driver" aquí es un delta
  // simple mes contra mes, no la atribución por causa completa
  // (-40 bps por retraso, -70 por costo, ...) que la spec deja para
  // Fase 2 incluso con Baseline real.
  const [prevSnapshot] = await db
    .select({ id: snapshots.id, periodMonth: snapshots.periodMonth })
    .from(snapshots)
    .where(and(eq(snapshots.projectId, projectId), eq(snapshots.type, "monthly_close"), ne(snapshots.periodMonth, periodMonth)))
    .orderBy(desc(snapshots.periodMonth))
    .limit(1);

  let prevIrr: number | null = null;
  let prevNpv: number | null = null;
  if (prevSnapshot) {
    const metrics = await db.select().from(returnMetrics).where(eq(returnMetrics.snapshotId, prevSnapshot.id));
    prevIrr = metrics.find((m) => m.metricKey === "irr_unlevered" && m.scope === "project")?.value
      ? Number(metrics.find((m) => m.metricKey === "irr_unlevered" && m.scope === "project")!.value)
      : null;
    prevNpv = metrics.find((m) => m.metricKey === "npv")?.value ? Number(metrics.find((m) => m.metricKey === "npv")!.value) : null;
  }

  const currentIrr = calculateIRR((await computeMonthlyLedger(projectId)).cfBeforeFinancing);

  return (
    <>
      <StepHeading n={8}>Revisar variance drivers</StepHeading>
      <p className="mt-2 text-sm text-ink-soft">
        Variance total de costo (Current Budget − Forecast Final). Atribución por causa (retraso,
        costo, ventas, tasa) queda fuera de esta vuelta — necesita un Baseline de Underwriting que
        esta app no construyó todavía.
      </p>
      <div className="mt-4 rounded-lg bg-surface-2/60 p-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-ink-soft">Variance de costo</span>
          <span className={`font-semibold tabular-nums ${variance < 0 ? "text-redline" : "text-success"}`}>{formatMoney(variance)}</span>
        </div>
      </div>
      {prevSnapshot ? (
        <div className="mt-3 rounded-lg bg-surface-2/60 p-4 text-sm">
          <div className="text-ink-soft">
            vs. snapshot anterior ({new Date(prevSnapshot.periodMonth + "T00:00:00").toLocaleDateString("es-MX", { month: "long", year: "numeric" })})
          </div>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-ink-soft">IRR Unlevered</span>
            <span className="font-semibold tabular-nums text-ink">
              {prevIrr !== null ? `${(prevIrr * 100).toFixed(1)}%` : "N/A"} → {currentIrr !== null ? `${(currentIrr * 100).toFixed(1)}%` : "N/A"}
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-ink-faint">Este sería el primer periodo cerrado — sin snapshot previo para comparar.</p>
      )}
    </>
  );
}

function Step9({
  projectId,
  periodLabel,
  alreadyClosed,
  existingSnapshotId,
}: {
  projectId: string;
  periodLabel: string;
  alreadyClosed: boolean;
  existingSnapshotId: string | null;
}) {
  return (
    <>
      <StepHeading n={9}>Cerrar periodo</StepHeading>
      <p className="mt-2 text-sm text-ink-soft">
        Periodo a cerrar: <span className="capitalize">{periodLabel}</span>.
      </p>
      <p className="mt-2 text-sm text-ink-soft">
        Esto congela el cash flow y los retornos calculados en este momento en un Snapshot{" "}
        <strong>inmutable</strong> — no se puede editar ni volver a cerrar el mismo mes después.
      </p>
      {alreadyClosed ? (
        <div className="mt-4 rounded-lg bg-success-soft p-4 text-sm text-success">
          Este periodo ya está cerrado.{" "}
          {existingSnapshotId && (
            <Link href={`/projects/${projectId}/snapshots/${existingSnapshotId}`} className="underline">
              Ver el snapshot →
            </Link>
          )}
        </div>
      ) : (
        <form action={closePeriod} className="mt-4">
          <input type="hidden" name="projectId" value={projectId} />
          <button className="rounded-lg bg-blueprint px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Cerrar periodo →
          </button>
        </form>
      )}
    </>
  );
}
