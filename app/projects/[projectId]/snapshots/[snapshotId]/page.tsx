import Link from "next/link";
import { eq, and, ne, lt, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects, snapshots, cashFlowPeriods, cashFlowLines, returnMetrics, users } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";

// Detalle de un Snapshot cerrado — la lectura congelada del Cash Flow
// Engine en el momento del cierre (§3.3, §4.6), no una consulta en vivo
// (a diferencia de /cashflow, que sí lee el estado actual). Reusa el
// mismo patrón visual de tabla que /cashflow para que el salto entre
// "lo de hoy" y "lo que se cerró" se sienta como la misma pantalla.
export const dynamic = "force-dynamic";

const MONTH_LABELS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const METRIC_LABELS: Record<string, string> = {
  irr_unlevered: "IRR Unlevered",
  irr_levered: "IRR Levered (equity)",
  moic: "MOIC",
  npv: "NPV @ 15%",
  profit_margin: "Profit Margin",
  total_development_cost: "Total Development Cost",
  equity_required: "Equity Required",
};

function formatMetric(key: string, value: number): string {
  if (key === "irr_unlevered" || key === "irr_levered" || key === "profit_margin") return `${(value * 100).toFixed(1)}%`;
  if (key === "moic") return `${value.toFixed(2)}x`;
  return formatMoney(value);
}

export default async function SnapshotDetailPage({
  params,
}: {
  params: Promise<{ projectId: string; snapshotId: string }>;
}) {
  const { projectId, snapshotId } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  const [snapshot] = await db
    .select({
      id: snapshots.id,
      type: snapshots.type,
      periodMonth: snapshots.periodMonth,
      createdAt: snapshots.createdAt,
      createdByName: users.fullName,
    })
    .from(snapshots)
    .innerJoin(users, eq(users.id, snapshots.createdBy))
    .where(eq(snapshots.id, snapshotId));

  if (!project || !snapshot) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-6xl px-6 py-12 text-ink-soft">Snapshot no encontrado.</main>
      </>
    );
  }

  const periodRows = await db
    .select()
    .from(cashFlowPeriods)
    .where(eq(cashFlowPeriods.snapshotId, snapshotId))
    .orderBy(cashFlowPeriods.periodMonth);

  const lineRows = periodRows.length > 0 ? await db.select().from(cashFlowLines) : [];
  const linesByPeriod = new Map<string, { category: string; amount: string }[]>();
  for (const l of lineRows) {
    if (!periodRows.some((p) => p.id === l.cashFlowPeriodId)) continue;
    if (!linesByPeriod.has(l.cashFlowPeriodId)) linesByPeriod.set(l.cashFlowPeriodId, []);
    linesByPeriod.get(l.cashFlowPeriodId)!.push(l);
  }

  const amountFor = (periodId: string, category: string) =>
    Number(linesByPeriod.get(periodId)?.find((l) => l.category === category)?.amount ?? 0);

  const monthHeaders = periodRows.map((p) => {
    const d = new Date(p.periodMonth + "T00:00:00");
    return { label: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`, isActual: p.isActual };
  });

  const ingresos = periodRows.map((p) => amountFor(p.id, "revenue"));
  const egresos = periodRows.map((p) => amountFor(p.id, "cost"));
  const debtDraws = periodRows.map((p) => amountFor(p.id, "debt_draw"));
  const debtInterest = periodRows.map((p) => amountFor(p.id, "debt_interest"));
  const debtPrincipal = periodRows.map((p) => amountFor(p.id, "debt_principal"));
  const equityIn = periodRows.map((p) => amountFor(p.id, "equity_contribution"));
  const equityOut = periodRows.map((p) => amountFor(p.id, "equity_distribution"));
  const netLevered = periodRows.map(
    (_, i) => ingresos[i] - egresos[i] + debtDraws[i] - debtInterest[i] - debtPrincipal[i] + equityIn[i] - equityOut[i]
  );
  const accumulated: number[] = [];
  let running = 0;
  for (const v of netLevered) {
    running += v;
    accumulated.push(running);
  }

  const rows: { label: string; values: number[]; bold?: boolean; tone?: "muted" }[] = [
    { label: "Ingresos", values: ingresos },
    { label: "Egresos", values: egresos.map((v) => -v) },
    { label: "Debt draws", values: debtDraws, tone: "muted" },
    { label: "Debt interest", values: debtInterest.map((v) => -v), tone: "muted" },
    { label: "Debt principal", values: debtPrincipal.map((v) => -v), tone: "muted" },
    { label: "Equity contributions", values: equityIn, tone: "muted" },
    { label: "Equity distributions", values: equityOut.map((v) => -v), tone: "muted" },
    { label: "Cash flow neto (Levered)", values: netLevered, bold: true },
    { label: "Acumulado", values: accumulated, bold: true },
  ];

  const metrics = await db.select().from(returnMetrics).where(eq(returnMetrics.snapshotId, snapshotId));

  // "Anterior" es el snapshot más reciente creado ANTES que este,
  // cualquiera sea su tipo — la cadena real es Baseline → Close 1 →
  // Close 2 → ..., así que el primer Monthly Close se compara contra la
  // Baseline, no contra "nada".
  const [prevSnapshot] = await db
    .select({ id: snapshots.id, type: snapshots.type, periodMonth: snapshots.periodMonth })
    .from(snapshots)
    .where(and(eq(snapshots.projectId, projectId), ne(snapshots.id, snapshotId), lt(snapshots.createdAt, snapshot.createdAt)))
    .orderBy(desc(snapshots.createdAt))
    .limit(1);
  const prevMetrics = prevSnapshot
    ? await db.select().from(returnMetrics).where(eq(returnMetrics.snapshotId, prevSnapshot.id))
    : [];

  const periodLabel =
    snapshot.type === "baseline"
      ? "Baseline"
      : new Date(snapshot.periodMonth + "T00:00:00").toLocaleDateString("es-MX", { month: "long", year: "numeric" });

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="snapshots" />
      <main className="mx-auto max-w-[1400px] px-6 py-12">
        <Link href={`/projects/${projectId}/snapshots`} className="text-sm text-blueprint hover:underline">
          ← Snapshots
        </Link>
        <div className="mt-2 text-sm text-ink-soft">
          Snapshot — <span className="capitalize">{periodLabel}</span>
        </div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>
        <p className="mt-1 text-xs text-ink-faint">
          Cerrado el {new Date(snapshot.createdAt).toLocaleDateString("es-MX")} por {snapshot.createdByName} — inmutable.
        </p>

        <h2 className="mt-8 font-display text-lg font-semibold text-ink">Retornos</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          {metrics.map((m) => {
            const prev = prevMetrics.find((p) => p.metricKey === m.metricKey && p.scope === m.scope);
            return (
              <div key={`${m.scope}-${m.metricKey}`} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
                <div className="text-xs text-ink-soft">{METRIC_LABELS[m.metricKey] ?? m.metricKey}</div>
                <div className="mt-1 font-semibold tabular-nums text-ink">{formatMetric(m.metricKey, Number(m.value))}</div>
                {prev && (
                  <div className="mt-1 text-xs text-ink-faint">vs. anterior: {formatMetric(m.metricKey, Number(prev.value))}</div>
                )}
              </div>
            );
          })}
        </div>

        <h2 className="mt-8 font-display text-lg font-semibold text-ink">Cash Flow congelado</h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs font-medium text-ink-soft">
              <tr>
                <th className="sticky left-0 z-10 min-w-[220px] bg-surface-2 px-4 py-3 text-left">Concepto</th>
                {monthHeaders.map((m, i) => (
                  <th key={i} className={`min-w-[110px] whitespace-nowrap px-3 py-3 text-right capitalize ${m.isActual ? "bg-success-soft/30" : ""}`}>
                    {m.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.label} className={row.bold ? "bg-surface-2/40" : ""}>
                  <td className={`sticky left-0 z-10 px-4 py-2.5 ${row.bold ? "bg-surface-2/40 font-semibold text-ink" : row.tone === "muted" ? "bg-surface text-ink-faint" : "bg-surface text-ink"}`}>
                    {row.label}
                  </td>
                  {row.values.map((v, i) => (
                    <td
                      key={i}
                      className={`px-3 py-2.5 text-right tabular-nums ${row.bold ? "font-semibold text-ink" : row.tone === "muted" ? "text-ink-faint" : "text-ink"} ${monthHeaders[i].isActual ? "bg-success-soft/30" : ""}`}
                    >
                      {formatMoney(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 max-w-2xl text-xs text-ink-faint">
          Congelado al momento del cierre — no cambia aunque los datos vivos del proyecto sigan
          moviéndose. Los meses en verde ya habían pasado (cash basis) cuando se cerró este periodo.
        </p>
      </main>
    </>
  );
}
