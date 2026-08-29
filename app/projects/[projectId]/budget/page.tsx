import { Fragment } from "react";
import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { budgetLines, costCodes, phases, projects, budgetLineRollup } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { applyDefaultCatalog, addCostCode } from "@/lib/actions/budgetSetup";

// Wireframe F — Tabla jerárquica financiera. Presupuesto se define por
// partida; contratos consumen ese presupuesto (Committed); facturas
// pagadas consumen Actual. Sub-partidas dentro de Soft Costs/Hard Costs
// son un segundo nivel real (cost_codes.parent_cost_code_id), no una
// lista plana — un código con hijos es una fila de agrupación cuyo
// total es la suma de sus sub-partidas, no un monto capturado aparte.
export const dynamic = "force-dynamic";

interface Row {
  budgetLineId: string;
  costCodeId: string;
  code: string;
  description: string;
  parentCostCodeId: string | null;
  original: number;
  current: number;
  committed: number;
  actual: number;
  forecastRemaining: number;
}

interface Group {
  code: string;
  description: string;
  ownRow: Row | null;
  children: Row[];
}

export default async function BudgetPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));

  const leafRows: Row[] = (
    await db
      .select({
        budgetLineId: budgetLines.id,
        costCodeId: costCodes.id,
        code: costCodes.code,
        description: costCodes.description,
        parentCostCodeId: costCodes.parentCostCodeId,
        original: budgetLineRollup.originalAmount,
        current: budgetLineRollup.currentAmount,
        committed: budgetLineRollup.committedAmount,
        actual: budgetLineRollup.actualCost,
        forecastRemaining: budgetLineRollup.forecastToCompleteNaive,
      })
      .from(budgetLines)
      .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
      .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
      .leftJoin(budgetLineRollup, eq(budgetLineRollup.budgetLineId, budgetLines.id))
      .where(eq(phases.projectId, projectId))
      .orderBy(costCodes.code)
  ).map((r) => ({
    ...r,
    original: Number(r.original ?? 0),
    current: Number(r.current ?? 0),
    committed: Number(r.committed ?? 0),
    actual: Number(r.actual ?? 0),
    forecastRemaining: Number(r.forecastRemaining ?? 0),
  }));

  const parentIds = [...new Set(leafRows.map((r) => r.parentCostCodeId).filter((id): id is string => !!id))];
  const parentCodes = parentIds.length > 0 ? await db.select().from(costCodes).where(inArray(costCodes.id, parentIds)) : [];

  const groups = new Map<string, Group>();
  for (const r of leafRows) {
    const topId = r.parentCostCodeId ?? r.costCodeId;
    if (!groups.has(topId)) {
      if (r.parentCostCodeId) {
        const parent = parentCodes.find((p) => p.id === r.parentCostCodeId)!;
        groups.set(topId, { code: parent.code, description: parent.description, ownRow: null, children: [] });
      } else {
        groups.set(topId, { code: r.code, description: r.description, ownRow: r, children: [] });
      }
    }
    if (r.parentCostCodeId) groups.get(topId)!.children.push(r);
  }

  const sortedGroups = [...groups.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  for (const g of sortedGroups) g.children.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const sum = (g: Group, field: keyof Row & ("original" | "current" | "committed" | "actual" | "forecastRemaining")) =>
    (g.ownRow?.[field] ?? 0) + g.children.reduce((s, c) => s + (c[field] as number), 0);

  const grand = {
    current: sortedGroups.reduce((s, g) => s + sum(g, "current"), 0),
    forecastFinal: sortedGroups.reduce((s, g) => s + sum(g, "actual") + sum(g, "forecastRemaining"), 0),
  };

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="budget" />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-sm text-ink-soft">Control Presupuestal</div>
            <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project?.name ?? "Proyecto"}</h1>
          </div>
          {sortedGroups.length > 0 && (
            <div className="text-right">
              <div className="text-xs text-ink-soft">Forecast Final</div>
              <div className="text-xl font-semibold tabular-nums text-ink">{formatMoney(grand.forecastFinal)}</div>
            </div>
          )}
        </div>

        {sortedGroups.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-line-strong bg-surface-2/60 p-8 text-center">
            <p className="text-sm text-ink-soft">Este proyecto no tiene presupuesto todavía.</p>
            <form action={applyDefaultCatalog} className="mt-4 inline-block">
              <input type="hidden" name="projectId" value={projectId} />
              <button className="rounded-lg bg-blueprint px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
                Usar catálogo estándar (Residential for Sale)
              </button>
            </form>
            <p className="mt-3 text-xs text-ink-faint">o personaliza tus propias partidas con el formulario de abajo.</p>
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs font-medium text-ink-soft">
                <tr>
                  <th className="px-4 py-3 text-left">Code</th>
                  <th className="px-4 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-right">Original</th>
                  <th className="px-4 py-3 text-right">Current</th>
                  <th className="px-4 py-3 text-right">Committed</th>
                  <th className="px-4 py-3 text-right">Disponible</th>
                  <th className="px-4 py-3 text-right">Actual</th>
                  <th className="px-4 py-3 text-right">Forecast Final</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sortedGroups.map((g) => {
                  const isParent = g.children.length > 0;
                  const current = sum(g, "current");
                  const committed = sum(g, "committed");
                  const forecastFinal = sum(g, "actual") + sum(g, "forecastRemaining");
                  return (
                    <Fragment key={g.code}>
                      <BudgetRow
                        code={g.code}
                        description={g.description}
                        bold={isParent}
                        original={sum(g, "original")}
                        current={current}
                        committed={committed}
                        actual={sum(g, "actual")}
                        forecastFinal={forecastFinal}
                        href={!isParent && g.ownRow ? `/budget-lines/${g.ownRow.budgetLineId}` : undefined}
                      />
                      {g.children.map((c) => (
                        <BudgetRow
                          key={c.budgetLineId}
                          code={c.code}
                          description={c.description}
                          indent
                          original={c.original}
                          current={c.current}
                          committed={c.committed}
                          actual={c.actual}
                          forecastFinal={c.actual + c.forecastRemaining}
                          href={`/budget-lines/${c.budgetLineId}`}
                        />
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line-strong bg-surface-2 font-medium text-ink">
                  <td className="px-4 py-3" colSpan={3}>
                    Total
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(grand.current)}</td>
                  <td colSpan={2}></td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(grand.forecastFinal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <p className="mt-3 max-w-xl text-xs text-ink-faint">
          Disponible = Current &minus; Committed (lo que aún no se contrata). Actual = suma de invoices en
          estado Paid (cash basis, decisión 8·03). Forecast Final = Actual + remanente en línea recta.
        </p>

        <h2 className="mt-10 text-sm font-medium text-ink-soft">+ Agregar partida</h2>
        <form
          action={addCostCode}
          className="mt-3 flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface p-5 shadow-sm"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <Field label="Code">
            <input name="code" required placeholder="ej. 03.06" className="w-28 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
          </Field>
          <Field label="Descripción">
            <input name="description" required className="w-56 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
          </Field>
          <Field label="Partida padre (opcional)">
            <select name="parentCode" className="w-56 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink">
              <option value="">(ninguna — partida de primer nivel)</option>
              {sortedGroups.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.code} — {g.description}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Monto original">
            <input type="number" name="originalAmount" required min={0} step="0.01" className="w-40 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
          </Field>
          <button className="rounded-lg bg-blueprint px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Agregar partida
          </button>
        </form>
      </main>
    </>
  );
}

function BudgetRow({
  code,
  description,
  original,
  current,
  committed,
  actual,
  forecastFinal,
  href,
  bold,
  indent,
}: {
  code: string;
  description: string;
  original: number;
  current: number;
  committed: number;
  actual: number;
  forecastFinal: number;
  href?: string;
  bold?: boolean;
  indent?: boolean;
}) {
  const disponible = current - committed;
  const variance = current - forecastFinal;
  return (
    <tr className={`transition-colors hover:bg-paper ${bold ? "bg-surface-2/40" : ""}`}>
      <td className={`px-4 py-3.5 ${indent ? "pl-9" : ""}`}>
        {href ? (
          <Link href={href} className="inline-block rounded-full bg-blueprint-soft px-2.5 py-1 text-xs font-semibold text-blueprint hover:opacity-80">
            {code}
          </Link>
        ) : (
          <span className="text-xs font-semibold text-ink-soft">{code}</span>
        )}
      </td>
      <td className={`px-4 py-3.5 ${bold ? "font-semibold text-ink" : "text-ink"}`}>{description}</td>
      <td className="px-4 py-3.5 text-right tabular-nums text-ink-soft">{formatMoney(original)}</td>
      <td className={`px-4 py-3.5 text-right tabular-nums ${bold ? "font-semibold" : ""} text-ink`}>{formatMoney(current)}</td>
      <td className="px-4 py-3.5 text-right tabular-nums text-ink-soft">{formatMoney(committed)}</td>
      <td className={`px-4 py-3.5 text-right tabular-nums ${disponible < 0 ? "font-medium text-redline" : "text-success"}`}>
        {formatMoney(disponible)}
      </td>
      <td className="px-4 py-3.5 text-right tabular-nums text-ink">{formatMoney(actual)}</td>
      <td className={`px-4 py-3.5 text-right tabular-nums ${bold ? "font-semibold" : "font-medium"} text-ink`}>{formatMoney(forecastFinal)}</td>
      <td className={`px-4 py-3.5 text-right tabular-nums ${variance < 0 ? "font-medium text-redline" : "text-ink-faint"}`}>
        {formatMoney(variance)}
      </td>
    </tr>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-soft">
      {label}
      {children}
    </label>
  );
}
