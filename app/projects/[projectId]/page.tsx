import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  budgetLines,
  phases,
  projects,
  budgetLineRollup,
  units,
  sales,
  collections,
  debtFacilities,
  debtFacilityRollup,
  equityInvestorRollup,
  tasks,
  milestones,
} from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { StatusBadge } from "@/components/StatusBadge";
import { computeCriticalPath } from "@/lib/schedule/criticalPath";

// Pantalla 2 — Project Dashboard (Wireframe B). Responde en segundos
// "¿cómo va el proyecto?" — para cada módulo que esta app ya construyó
// (Costs, Schedule, Revenue, Capital).
export const dynamic = "force-dynamic";

export default async function ProjectDashboardPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));

  const rows = await db
    .select({
      current: budgetLineRollup.currentAmount,
      committed: budgetLineRollup.committedAmount,
      actual: budgetLineRollup.actualCost,
      forecast: budgetLineRollup.forecastToCompleteNaive,
    })
    .from(budgetLines)
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .leftJoin(budgetLineRollup, eq(budgetLineRollup.budgetLineId, budgetLines.id))
    .where(eq(phases.projectId, projectId));

  const current = rows.reduce((s, r) => s + Number(r.current ?? 0), 0);
  const committed = rows.reduce((s, r) => s + Number(r.committed ?? 0), 0);
  const actual = rows.reduce((s, r) => s + Number(r.actual ?? 0), 0);
  const forecastFinal = rows.reduce((s, r) => s + Number(r.actual ?? 0) + Number(r.forecast ?? 0), 0);
  const variance = current - forecastFinal;
  const pctCommitted = current > 0 ? Math.round((committed / current) * 100) : 0;
  const pctPaid = current > 0 ? Math.round((actual / current) * 100) : 0;

  // Revenue — % sold, Contracted, Collections (§7.1, pantalla 2).
  const unitRows = await db
    .select({ status: units.status })
    .from(units)
    .innerJoin(phases, eq(phases.id, units.phaseId))
    .where(eq(phases.projectId, projectId));
  const totalUnits = unitRows.length;
  const soldUnits = unitRows.filter((u) => u.status === "sold").length;
  const pctSold = totalUnits > 0 ? Math.round((soldUnits / totalUnits) * 100) : 0;

  const salesRows = await db
    .select({ priceTotal: sales.priceTotal })
    .from(sales)
    .innerJoin(units, eq(units.id, sales.unitId))
    .innerJoin(phases, eq(phases.id, units.phaseId))
    .where(eq(phases.projectId, projectId));
  const contracted = salesRows.reduce((s, r) => s + Number(r.priceTotal), 0);

  const collectionRows = await db
    .select({ amount: collections.amount, status: collections.status })
    .from(collections)
    .innerJoin(sales, eq(sales.id, collections.saleId))
    .innerJoin(units, eq(units.id, sales.unitId))
    .innerJoin(phases, eq(phases.id, units.phaseId))
    .where(eq(phases.projectId, projectId));
  const collected = collectionRows.filter((c) => c.status === "paid").reduce((s, c) => s + Number(c.amount), 0);

  // Capital — Equity invested, Debt drawn, Debt available, Remaining
  // equity need (§7.1, pantalla 2).
  const [facility] = await db.select().from(debtFacilities).where(eq(debtFacilities.projectId, projectId));
  const [facilityRollupRow] = facility
    ? await db.select().from(debtFacilityRollup).where(eq(debtFacilityRollup.debtFacilityId, facility.id))
    : [undefined];
  const debtDrawn = Number(facilityRollupRow?.fundedAmount ?? 0);
  const debtAvailable = Number(facilityRollupRow?.availableToDraw ?? facility?.loanAmount ?? 0);

  const investorRollupRows = await db
    .select()
    .from(equityInvestorRollup)
    .where(eq(equityInvestorRollup.projectId, projectId));
  const equityInvested = investorRollupRows.reduce((s, r) => s + Number(r.contributedAmount ?? 0), 0);
  const remainingEquityNeed = investorRollupRows.reduce(
    (s, r) => s + Number(r.remainingCommitment ?? r.commitmentAmount ?? 0),
    0
  );

  // Schedule — % complete, completion date, critical path, milestones
  // (§7.1, pantalla 2) — mismo cálculo que /schedule.
  const taskRows = await db
    .select({
      id: tasks.id,
      endDate: tasks.endDate,
      predecessorTaskId: tasks.predecessorTaskId,
      progressPct: tasks.progressPct,
    })
    .from(tasks)
    .innerJoin(phases, eq(phases.id, tasks.phaseId))
    .where(eq(phases.projectId, projectId));
  const totalTasks = taskRows.length;
  const pctComplete =
    totalTasks > 0
      ? Math.round(taskRows.reduce((s, t) => s + Number(t.progressPct), 0) / totalTasks)
      : 0;
  const completionDate = taskRows.reduce<string | null>(
    (latest, t) => (latest === null || t.endDate > latest ? t.endDate : latest),
    null
  );
  const criticalPath = computeCriticalPath(
    taskRows.map((t) => ({ id: t.id, endDate: t.endDate, predecessorTaskId: t.predecessorTaskId }))
  );

  const milestoneRows = await db
    .select({ targetDate: milestones.targetDate })
    .from(milestones)
    .innerJoin(phases, eq(phases.id, milestones.phaseId))
    .where(eq(phases.projectId, projectId));
  const todayStr = new Date().toISOString().slice(0, 10);
  const totalMilestones = milestoneRows.length;
  const overdueMilestones = milestoneRows.filter((m) => m.targetDate < todayStr).length;

  if (!project) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-6xl px-6 py-12 text-ink-soft">Proyecto no encontrado.</main>
      </>
    );
  }

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="overview" />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-ink-soft capitalize">
              {project.assetClass.replace(/_/g, " ")} · {project.currency}
            </div>
            <h1 className="mt-1 font-display text-3xl font-semibold text-ink">{project.name}</h1>
          </div>
          <StatusBadge status={project.status} />
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <ModulePanel
            title="Control Presupuestal"
            live
            href={`/projects/${projectId}/budget`}
            rows={[
              ["Current Budget", formatMoney(current)],
              ["Committed", `${formatMoney(committed)} · ${pctCommitted}%`],
              ["Paid", `${formatMoney(actual)} · ${pctPaid}%`],
              ["Forecast Final Cost", formatMoney(forecastFinal)],
            ]}
            footer={
              <span className={variance < 0 ? "font-medium text-redline" : "text-success"}>
                Variance {formatMoney(variance)}
              </span>
            }
          />
          <ModulePanel
            title="Schedule"
            live
            href={`/projects/${projectId}/schedule`}
            rows={[
              ["% complete", `${pctComplete}%`],
              ["Completion date", completionDate ?? "—"],
              ["Ruta crítica", `${criticalPath.size} tarea${criticalPath.size === 1 ? "" : "s"}`],
              [
                "Milestones",
                `${totalMilestones}${overdueMilestones > 0 ? ` · ${overdueMilestones} vencido${overdueMilestones === 1 ? "" : "s"}` : ""}`,
              ],
            ]}
          />
          <ModulePanel
            title="Revenue"
            live
            href={`/projects/${projectId}/inventory`}
            rows={[
              ["% sold", `${pctSold}% (${soldUnits}/${totalUnits})`],
              ["Contracted", formatMoney(contracted)],
              ["Collections", formatMoney(collected)],
            ]}
          />
          <ModulePanel
            title="Capital"
            live
            href={`/projects/${projectId}/debt`}
            rows={[
              ["Equity invested", formatMoney(equityInvested)],
              ["Debt drawn", formatMoney(debtDrawn)],
              ["Debt available", formatMoney(debtAvailable)],
              ["Remaining equity need", formatMoney(remainingEquityNeed)],
            ]}
          />
        </div>
      </main>
    </>
  );
}

function ModulePanel({
  title,
  rows,
  live,
  href,
  footer,
}: {
  title: string;
  rows: [string, string][];
  live?: boolean;
  href?: string;
  footer?: React.ReactNode;
}) {
  const content = (
    <div
      className={`rounded-xl border p-5 shadow-sm transition-shadow ${
        live ? "border-line bg-surface hover:shadow-md" : "border-dashed border-line-strong bg-surface-2/60"
      }`}
    >
      <div className="flex items-center justify-between">
        <h2 className={`font-medium ${live ? "text-ink" : "text-ink-soft"}`}>{title}</h2>
        {!live && (
          <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-ink-faint">
            Próxima slice
          </span>
        )}
      </div>
      {live ? (
        <>
          <dl className="mt-3 space-y-2 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between">
                <dt className="text-ink-soft">{label}</dt>
                <dd className="font-medium tabular-nums text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          {footer && <div className="mt-3 border-t border-line pt-3 text-sm">{footer}</div>}
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-faint">
          Se construye cuando lleguemos al módulo de {title} — por ahora esta slice solo cubre Costs.
        </p>
      )}
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}
