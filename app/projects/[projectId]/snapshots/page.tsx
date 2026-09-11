import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects, snapshots, returnMetrics, users } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";

// Historial de Snapshots (§3.3, §7.1 pantalla 17/18) — cada fila la
// generó un Monthly Close (mensual) o, la primera, aprobar el Deal
// (Baseline — lib/actions/deal.ts:approveDeal). Ambas son inmutables,
// no se editan aquí. La Baseline no tiene period_month (§3.3: "null
// para 'baseline'"), así que se etiqueta distinto y el orden es por
// fecha de creación, no por mes.
export const dynamic = "force-dynamic";

export default async function SnapshotsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-6xl px-6 py-12 text-ink-soft">Proyecto no encontrado.</main>
      </>
    );
  }

  const rows = await db
    .select({
      id: snapshots.id,
      type: snapshots.type,
      periodMonth: snapshots.periodMonth,
      createdAt: snapshots.createdAt,
      createdByName: users.fullName,
    })
    .from(snapshots)
    .innerJoin(users, eq(users.id, snapshots.createdBy))
    .where(eq(snapshots.projectId, projectId))
    .orderBy(desc(snapshots.createdAt));

  const metricsBySnapshot = new Map<string, { metricKey: string; scope: string; value: string }[]>();
  if (rows.length > 0) {
    const allMetrics = await db.select().from(returnMetrics);
    for (const m of allMetrics) {
      if (!rows.some((r) => r.id === m.snapshotId)) continue;
      if (!metricsBySnapshot.has(m.snapshotId)) metricsBySnapshot.set(m.snapshotId, []);
      metricsBySnapshot.get(m.snapshotId)!.push(m);
    }
  }

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="snapshots" />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-ink-soft">Snapshots</div>
            <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>
          </div>
          <Link
            href={`/projects/${projectId}/monthly-close`}
            className="rounded-lg bg-blueprint px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Cerrar periodo
          </Link>
        </div>

        {rows.length === 0 ? (
          <p className="mt-8 text-sm text-ink-soft">
            Todavía no se ha cerrado ningún periodo.{" "}
            <Link href={`/projects/${projectId}/monthly-close`} className="text-blueprint hover:underline">
              Iniciar el Monthly Close →
            </Link>
          </p>
        ) : (
          <div className="mt-8 overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs font-medium text-ink-soft">
                <tr>
                  <th className="px-4 py-2.5 text-left">Periodo</th>
                  <th className="px-4 py-2.5 text-left">Cerrado</th>
                  <th className="px-4 py-2.5 text-right">IRR Unlevered</th>
                  <th className="px-4 py-2.5 text-right">MOIC</th>
                  <th className="px-4 py-2.5 text-right">NPV @ 15%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const metrics = metricsBySnapshot.get(r.id) ?? [];
                  const irr = metrics.find((m) => m.metricKey === "irr_unlevered" && m.scope === "project");
                  const moic = metrics.find((m) => m.metricKey === "moic" && m.scope === "project");
                  const npv = metrics.find((m) => m.metricKey === "npv");
                  return (
                    <tr key={r.id} className="border-t border-line hover:bg-surface-2/40">
                      <td className="px-4 py-2.5">
                        <Link href={`/projects/${projectId}/snapshots/${r.id}`} className="font-medium text-blueprint hover:underline">
                          {r.type === "baseline" ? (
                            "Baseline"
                          ) : (
                            <span className="capitalize">
                              {new Date(r.periodMonth + "T00:00:00").toLocaleDateString("es-MX", { month: "long", year: "numeric" })}
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-ink-soft">
                        {new Date(r.createdAt).toLocaleDateString("es-MX")} · {r.createdByName}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink">
                        {irr ? `${(Number(irr.value) * 100).toFixed(1)}%` : "N/A"}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink">{moic ? `${Number(moic.value).toFixed(2)}x` : "N/A"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink">{npv ? formatMoney(Number(npv.value)) : "N/A"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
