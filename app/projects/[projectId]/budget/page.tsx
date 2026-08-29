import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { budgetLines, costCodes, phases, projects, budgetLineRollup } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { Breadcrumb } from "@/components/Breadcrumb";

// Wireframe F — Tabla jerárquica financiera (docs/strategy wireframes, patrón F).
// The five numbers here are never captured directly — they come from
// budget_line_rollup (see docs/schema/README.md, decisión #1).
export const dynamic = "force-dynamic"; // live financial data — never prerendered at build time

export default async function BudgetPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));

  const rows = await db
    .select({
      budgetLineId: budgetLines.id,
      code: costCodes.code,
      description: costCodes.description,
      original: budgetLineRollup.originalAmount,
      current: budgetLineRollup.currentAmount,
      committed: budgetLineRollup.committedAmount,
      actual: budgetLineRollup.actualCost,
      forecast: budgetLineRollup.forecastToCompleteNaive,
    })
    .from(budgetLines)
    .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .leftJoin(budgetLineRollup, eq(budgetLineRollup.budgetLineId, budgetLines.id))
    .where(eq(phases.projectId, projectId))
    .orderBy(costCodes.code);

  const totalCurrent = rows.reduce((s, r) => s + Number(r.current ?? 0), 0);
  const totalForecast = rows.reduce((s, r) => s + Number(r.actual ?? 0) + Number(r.forecast ?? 0), 0);

  return (
    <>
      <AppHeader
        crumb={
          <Breadcrumb
            items={[
              { label: "Mis Proyectos", href: "/" },
              { label: project?.name ?? "Proyecto", href: `/projects/${projectId}` },
            ]}
          />
        }
      />
      <ProjectNav projectId={projectId} active="budget" />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-sm text-ink-soft">Control Presupuestal</div>
            <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project?.name ?? "Proyecto"}</h1>
          </div>
          <div className="text-right">
            <div className="text-xs text-ink-soft">Forecast Final</div>
            <div className="text-xl font-semibold tabular-nums text-ink">{formatMoney(totalForecast)}</div>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs font-medium text-ink-soft">
              <tr>
                <th className="px-4 py-3 text-left">Code</th>
                <th className="px-4 py-3 text-left">Description</th>
                <th className="px-4 py-3 text-right">Original</th>
                <th className="px-4 py-3 text-right">Current</th>
                <th className="px-4 py-3 text-right">Committed</th>
                <th className="px-4 py-3 text-right">Actual</th>
                <th className="px-4 py-3 text-right">Forecast Final</th>
                <th className="px-4 py-3 text-right">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => {
                const current = Number(r.current ?? 0);
                const forecastFinal = Number(r.actual ?? 0) + Number(r.forecast ?? 0);
                const variance = current - forecastFinal;
                return (
                  <tr key={r.budgetLineId} className="transition-colors hover:bg-paper">
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/budget-lines/${r.budgetLineId}`}
                        className="inline-block rounded-full bg-blueprint-soft px-2.5 py-1 text-xs font-semibold text-blueprint hover:opacity-80"
                      >
                        {r.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5 text-ink">{r.description}</td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-ink-soft">{formatMoney(r.original)}</td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-ink">{formatMoney(r.current)}</td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-ink-soft">{formatMoney(r.committed)}</td>
                    <td className="px-4 py-3.5 text-right tabular-nums text-ink">{formatMoney(r.actual)}</td>
                    <td className="px-4 py-3.5 text-right font-medium tabular-nums text-ink">
                      {formatMoney(forecastFinal)}
                    </td>
                    <td
                      className={`px-4 py-3.5 text-right tabular-nums ${
                        variance < 0 ? "font-medium text-redline" : "text-ink-faint"
                      }`}
                    >
                      {formatMoney(variance)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-strong bg-surface-2 font-medium text-ink">
                <td className="px-4 py-3" colSpan={3}>
                  Total
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(totalCurrent)}</td>
                <td colSpan={2}></td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(totalForecast)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-3 max-w-xl text-xs text-ink-faint">
          Actual = suma de invoices en estado Paid (cash basis, decisión 8·03). Forecast Final = Actual + remanente en línea recta.
        </p>
      </main>
    </>
  );
}
