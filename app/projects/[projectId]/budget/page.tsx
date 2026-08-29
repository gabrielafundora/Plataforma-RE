import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { budgetLines, costCodes, phases, projects, budgetLineRollup } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";

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

  return (
    <main className="mx-auto max-w-4xl p-8">
      <Link href="/" className="text-sm text-blueprint">
        &larr; Mis Proyectos
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">
        {project?.name ?? "Proyecto"} &middot; Budget
      </h1>

      <div className="mt-6 overflow-x-auto rounded border border-line bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-paper font-mono text-xs uppercase text-ink-soft">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-right">Original</th>
              <th className="px-3 py-2 text-right">Current</th>
              <th className="px-3 py-2 text-right">Committed</th>
              <th className="px-3 py-2 text-right">Actual</th>
              <th className="px-3 py-2 text-right">Forecast Final</th>
              <th className="px-3 py-2 text-right">Variance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const current = Number(r.current ?? 0);
              const forecastFinal = Number(r.actual ?? 0) + Number(r.forecast ?? 0);
              const variance = current - forecastFinal;
              return (
                <tr key={r.budgetLineId} className="border-t border-line hover:bg-paper">
                  <td className="px-3 py-2">
                    <Link href={`/budget-lines/${r.budgetLineId}`} className="text-blueprint">
                      {r.code}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.description}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatMoney(r.original)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatMoney(r.current)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatMoney(r.committed)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatMoney(r.actual)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatMoney(forecastFinal)}</td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${
                      variance < 0 ? "text-redline" : "text-ink"
                    }`}
                  >
                    {formatMoney(variance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink-soft">
        Actual = suma de invoices en estado Paid (cash basis, decisión 8·03). Forecast Final = Actual + remanente en línea recta.
      </p>
    </main>
  );
}
