import { Fragment } from "react";
import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { budgetLines, costCodes, phases, projects, budgetLineRollup, payments, invoices, contracts } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { rollingForecast, type CurveMethod } from "@/lib/forecast/engine";
import { updateCurveMethods } from "@/lib/actions/forecast";

// Pantalla 11 — Cost Forecast mensual (§4.2). El motor (lib/forecast/engine.ts)
// ya existía, probado, sin ninguna pantalla que lo usara — todo lo
// demás en la app muestra budget_line_rollup.forecast_to_complete_naive,
// que la propia vista documenta como "la línea recta simple". Esto es
// el número real ajustado por curva, con el desglose mes a mes por
// partida individual (horizontal, como un modelo financiero) — no solo
// el agregado del proyecto.
//
// "No me gusta que la selección del tipo de curva esté en la parte de
// alta de presupuesto" — el método de curva se elige aquí, por partida,
// no en /budget/setup (lib/actions/budgetSetup.ts ya no lo toca).
//
// Sin módulo de Schedule todavía, el horizonte lo define
// projects.forecast_months (Configuración) arrancando en
// projects.approved_at — un proyecto, una fase, un solo timeline,
// igual que el resto del MVP.
export const dynamic = "force-dynamic";

const IMPLEMENTED_METHODS = ["straight_line", "s_curve", "front_loaded", "back_loaded"] as const;
const CURVE_METHOD_LABELS: Record<(typeof IMPLEMENTED_METHODS)[number], string> = {
  straight_line: "Línea recta",
  s_curve: "S-Curve",
  front_loaded: "Front-loaded",
  back_loaded: "Back-loaded",
};
const IMPLEMENTED_METHODS_SET = new Set<CurveMethod>(IMPLEMENTED_METHODS);
const MONTH_LABELS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

interface LeafRow {
  budgetLineId: string;
  costCodeId: string;
  code: string;
  description: string;
  parentCostCodeId: string | null;
  current: number;
  forecastMethod: CurveMethod;
  schedule: number[];
}

interface Group {
  code: string;
  description: string;
  ownRow: LeafRow | null;
  children: LeafRow[];
}

export default async function ProjectForecastPage({ params }: { params: Promise<{ projectId: string }> }) {
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

  const lineRows = await db
    .select({
      budgetLineId: budgetLines.id,
      costCodeId: costCodes.id,
      code: costCodes.code,
      description: costCodes.description,
      parentCostCodeId: costCodes.parentCostCodeId,
      forecastMethod: budgetLines.forecastMethod,
      current: budgetLineRollup.currentAmount,
    })
    .from(budgetLines)
    .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .leftJoin(budgetLineRollup, eq(budgetLineRollup.budgetLineId, budgetLines.id))
    .where(eq(phases.projectId, projectId))
    .orderBy(costCodes.code);

  if (lineRows.length === 0) {
    return (
      <>
        <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
        <ProjectNav projectId={projectId} active="forecast" />
        <main className="mx-auto max-w-4xl px-6 py-12 text-ink-soft">
          Este proyecto todavía no tiene presupuesto — dalo de alta primero en{" "}
          <Link href={`/projects/${projectId}/budget`} className="text-blueprint hover:underline">
            Control Presupuestal
          </Link>
          .
        </main>
      </>
    );
  }

  const paymentRows = await db
    .select({ budgetLineId: budgetLines.id, amount: payments.amount, paidDate: payments.paidDate })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(contracts, eq(contracts.id, invoices.contractId))
    .innerJoin(budgetLines, eq(budgetLines.id, contracts.budgetLineId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .where(eq(phases.projectId, projectId));

  const periods = project.forecastMonths;
  const startMonth = new Date(project.approvedAt ?? project.createdAt);
  startMonth.setDate(1);
  startMonth.setHours(0, 0, 0, 0);

  const currentPeriodIndex = monthsBetween(startMonth, new Date());

  const paymentsByLine = new Map<string, Map<number, number>>();
  for (const p of paymentRows) {
    const idx = monthsBetween(startMonth, new Date(p.paidDate));
    if (idx < 0 || idx >= periods) continue; // pago fuera del horizonte configurado
    if (!paymentsByLine.has(p.budgetLineId)) paymentsByLine.set(p.budgetLineId, new Map());
    const byPeriod = paymentsByLine.get(p.budgetLineId)!;
    byPeriod.set(idx, (byPeriod.get(idx) ?? 0) + Number(p.amount));
  }

  const monthlyTotals = Array(periods).fill(0) as number[];
  let grandCurrent = 0;
  let grandActualToDate = 0;
  let grandForecastFinal = 0;

  const leafRows: LeafRow[] = lineRows.map((line) => {
    const totalAmount = Number(line.current ?? 0);
    grandCurrent += totalAmount;

    const method: CurveMethod = IMPLEMENTED_METHODS_SET.has(line.forecastMethod as CurveMethod)
      ? (line.forecastMethod as CurveMethod)
      : "straight_line";

    const byPeriod = paymentsByLine.get(line.budgetLineId);
    const actuals: (number | null)[] = Array.from({ length: periods }, (_, i) =>
      i <= currentPeriodIndex ? byPeriod?.get(i) ?? 0 : null
    );

    const result = rollingForecast({ totalAmount, periods, method, actuals });
    grandActualToDate += result.actualCostToDate;
    grandForecastFinal += result.forecastFinalCost;

    const schedule = Array(periods).fill(0) as number[];
    for (const p of result.schedule) {
      schedule[p.period] = p.amount;
      monthlyTotals[p.period] += p.amount;
    }

    return {
      budgetLineId: line.budgetLineId,
      costCodeId: line.costCodeId,
      code: line.code,
      description: line.description,
      parentCostCodeId: line.parentCostCodeId,
      current: totalAmount,
      forecastMethod: method,
      schedule,
    };
  });

  const variance = grandCurrent - grandForecastFinal;

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

  const monthHeaders = Array.from({ length: periods }, (_, i) => {
    const d = new Date(startMonth);
    d.setMonth(d.getMonth() + i);
    return { label: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`, isActual: i <= currentPeriodIndex };
  });

  const monthColClass = (isActual: boolean) => (isActual ? "bg-success-soft/30" : "");

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="forecast" />
      <main className="mx-auto max-w-[1400px] px-6 py-12">
        <div className="text-sm text-ink-soft">Forecast</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Current Budget" value={formatMoney(grandCurrent)} />
          <Stat label="Actual to date" value={formatMoney(grandActualToDate)} />
          <Stat label="Forecast Final Cost" value={formatMoney(grandForecastFinal)} />
          <Stat label="Variance" value={formatMoney(variance)} tone={variance < 0 ? "bad" : "good"} />
        </div>

        <div className="mt-3 flex items-center gap-3 text-xs text-ink-faint">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-success-soft/60" /> Real
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm border border-line" /> Forecast
          </span>
        </div>

        <form action={updateCurveMethods}>
          <input type="hidden" name="projectId" value={projectId} />

          <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs font-medium text-ink-soft">
                <tr>
                  <th className="sticky left-0 z-10 min-w-[220px] bg-surface-2 px-4 py-3 text-left">Partida</th>
                  <th className="min-w-[170px] px-4 py-3 text-left">Método de curva</th>
                  {monthHeaders.map((m, i) => (
                    <th
                      key={i}
                      className={`min-w-[110px] whitespace-nowrap px-3 py-3 text-right capitalize ${monthColClass(m.isActual)}`}
                    >
                      {m.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sortedGroups.map((g) => {
                  const isParent = g.children.length > 0;
                  const rowsForSubtotal = isParent ? g.children : g.ownRow ? [g.ownRow] : [];
                  const subtotal = Array.from({ length: periods }, (_, i) =>
                    rowsForSubtotal.reduce((sum, r) => sum + r.schedule[i], 0)
                  );

                  return (
                    <Fragment key={g.code}>
                      <tr className={isParent ? "bg-surface-2/40" : ""}>
                        <td className={`sticky left-0 z-10 px-4 py-3 ${isParent ? "bg-surface-2/40" : "bg-surface"}`}>
                          <span className="text-xs font-semibold text-ink-soft">{g.code}</span>{" "}
                          <span className={isParent ? "font-semibold text-ink" : "text-ink"}>{g.description}</span>
                        </td>
                        <td className="px-4 py-3">
                          {!isParent && g.ownRow && (
                            <CurveSelect budgetLineId={g.ownRow.budgetLineId} value={g.ownRow.forecastMethod} />
                          )}
                        </td>
                        {subtotal.map((amount, i) => (
                          <td
                            key={i}
                            className={`px-3 py-3 text-right tabular-nums ${isParent ? "font-semibold text-ink" : "text-ink"} ${monthColClass(monthHeaders[i].isActual)}`}
                          >
                            {formatMoney(amount)}
                          </td>
                        ))}
                      </tr>
                      {g.children.map((c) => (
                        <tr key={c.budgetLineId}>
                          <td className="sticky left-0 z-10 bg-surface px-4 py-3 pl-9">
                            <span className="text-xs font-semibold text-ink-soft">{c.code}</span>{" "}
                            <span className="text-ink">{c.description}</span>
                          </td>
                          <td className="px-4 py-3">
                            <CurveSelect budgetLineId={c.budgetLineId} value={c.forecastMethod} />
                          </td>
                          {c.schedule.map((amount, i) => (
                            <td
                              key={i}
                              className={`px-3 py-3 text-right tabular-nums text-ink ${monthColClass(monthHeaders[i].isActual)}`}
                            >
                              {formatMoney(amount)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-line-strong bg-surface-2">
                <tr>
                  <td className="sticky left-0 z-10 bg-surface-2 px-4 py-3 font-semibold text-ink">Total</td>
                  <td className="px-4 py-3"></td>
                  {monthlyTotals.map((amount, i) => (
                    <td
                      key={i}
                      className={`px-3 py-3 text-right font-semibold tabular-nums text-ink ${monthColClass(monthHeaders[i].isActual)}`}
                    >
                      {formatMoney(amount)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>

          <button className="mt-4 rounded-lg bg-blueprint px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Guardar métodos de curva
          </button>
        </form>

        <p className="mt-3 max-w-2xl text-xs text-ink-faint">
          Cada partida se proyecta con su propio método de curva (§4.2) — cámbialo arriba y guarda para
          recalcular. Los meses en verde ("Real") usan lo efectivamente pagado (cash basis); el resto
          redistribuye lo que queda de presupuesto según la curva elegida.
        </p>
      </main>
    </>
  );
}

function CurveSelect({ budgetLineId, value }: { budgetLineId: string; value: CurveMethod }) {
  return (
    <select
      name={`method_${budgetLineId}`}
      defaultValue={value}
      className="w-40 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
    >
      {IMPLEMENTED_METHODS.map((m) => (
        <option key={m} value={m}>
          {CURVE_METHOD_LABELS[m]}
        </option>
      ))}
    </select>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="text-xs text-ink-soft">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === "bad" ? "text-redline" : tone === "good" ? "text-success" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
