import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { budgetLines, phases, projects, budgetLineRollup } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { StatusBadge } from "@/components/StatusBadge";
import { deleteProject } from "@/lib/actions/projects";

// Pantalla 2 — Project Dashboard (Wireframe B). Responde en segundos
// "¿cómo va el proyecto?" — pero solo para lo que esta slice realmente
// construyó (Costs). Los demás módulos se muestran, sin inventar datos,
// como "todavía no construido" en vez de omitirlos silenciosamente.
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
          <ModulePanel title="Schedule" rows={[]} />
          <ModulePanel title="Revenue" rows={[]} />
          <ModulePanel title="Capital" rows={[]} />
        </div>

        <details className="mt-12 group">
          <summary className="cursor-pointer text-sm font-medium text-redline/70 hover:text-redline">
            Zona de peligro
          </summary>
          <div className="mt-3 rounded-xl border border-redline/40 bg-redline-soft p-4">
            <p className="text-sm font-medium text-redline">⚠ Eliminar este proyecto es irreversible.</p>
            <p className="mt-1 text-sm text-redline/90">
              Se borran todas sus partidas, contratos, change orders, facturas, pagos y cambios de
              presupuesto. No hay forma de recuperarlo después.
            </p>
            <form action={deleteProject} className="mt-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="projectId" value={projectId} />
              <label className="flex flex-col gap-1.5 text-xs font-medium text-redline">
                Escribe &quot;{project.name}&quot; para confirmar
                <input
                  name="confirmName"
                  required
                  placeholder={project.name}
                  className="w-64 rounded-lg border border-redline/40 bg-surface px-3 py-1.5 text-sm text-ink"
                />
              </label>
              <button className="rounded-lg bg-redline px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
                Eliminar proyecto
              </button>
            </form>
          </div>
        </details>
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
