import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { budgetLines, phases, projects, budgetLineRollup, payments, invoices, contracts } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { rollingForecast, type CurveMethod } from "@/lib/forecast/engine";

// Pantalla 11 — Cost Forecast mensual (§4.2). El motor (lib/forecast/engine.ts)
// ya existía, probado, sin ninguna pantalla que lo usara — todo lo
// demás en la app muestra budget_line_rollup.forecast_to_complete_naive,
// que la propia vista documenta como "la línea recta simple". Esto es
// el número real ajustado por curva, agregado a nivel proyecto (el
// desglose mes-a-mes por partida individual queda para otra vuelta).
//
// Sin módulo de Schedule todavía, el horizonte lo define
// projects.forecast_months (Configuración) arrancando en
// projects.approved_at — un proyecto, una fase, un solo timeline,
// igual que el resto del MVP.
export const dynamic = "force-dynamic";

const IMPLEMENTED_METHODS = new Set<CurveMethod>(["straight_line", "s_curve", "front_loaded", "back_loaded"]);
const MONTH_LABELS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
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
      forecastMethod: budgetLines.forecastMethod,
      current: budgetLineRollup.currentAmount,
    })
    .from(budgetLines)
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .leftJoin(budgetLineRollup, eq(budgetLineRollup.budgetLineId, budgetLines.id))
    .where(eq(phases.projectId, projectId));

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

  for (const line of lineRows) {
    const totalAmount = Number(line.current ?? 0);
    grandCurrent += totalAmount;

    const method: CurveMethod = IMPLEMENTED_METHODS.has(line.forecastMethod as CurveMethod)
      ? (line.forecastMethod as CurveMethod)
      : "straight_line";

    const byPeriod = paymentsByLine.get(line.budgetLineId);
    const actuals: (number | null)[] = Array.from({ length: periods }, (_, i) =>
      i <= currentPeriodIndex ? byPeriod?.get(i) ?? 0 : null
    );

    const result = rollingForecast({ totalAmount, periods, method, actuals });
    grandActualToDate += result.actualCostToDate;
    grandForecastFinal += result.forecastFinalCost;
    for (const p of result.schedule) monthlyTotals[p.period] += p.amount;
  }

  const variance = grandCurrent - grandForecastFinal;

  let cumulative = 0;
  const monthRows = monthlyTotals.map((amount, i) => {
    cumulative += amount;
    const d = new Date(startMonth);
    d.setMonth(d.getMonth() + i);
    return {
      label: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`,
      amount,
      cumulative,
      isActual: i <= currentPeriodIndex,
    };
  });

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="forecast" />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="text-sm text-ink-soft">Forecast</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Current Budget" value={formatMoney(grandCurrent)} />
          <Stat label="Actual to date" value={formatMoney(grandActualToDate)} />
          <Stat label="Forecast Final Cost" value={formatMoney(grandForecastFinal)} />
          <Stat label="Variance" value={formatMoney(variance)} tone={variance < 0 ? "bad" : "good"} />
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs font-medium text-ink-soft">
              <tr>
                <th className="px-4 py-3 text-left">Mes</th>
                <th className="px-4 py-3 text-left"></th>
                <th className="px-4 py-3 text-right">Monto</th>
                <th className="px-4 py-3 text-right">Acumulado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {monthRows.map((m, i) => (
                <tr key={i} className={i === currentPeriodIndex ? "bg-blueprint-soft/40" : ""}>
                  <td className="px-4 py-2.5 capitalize text-ink">{m.label}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        m.isActual ? "bg-success-soft text-success" : "bg-surface-2 text-ink-faint"
                      }`}
                    >
                      {m.isActual ? "Real" : "Forecast"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{formatMoney(m.amount)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-faint">{formatMoney(m.cumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 max-w-xl text-xs text-ink-faint">
          Forecast por partida, ajustado por su método de curva (§4.2) — se define en Control Presupuestal
          → Dar de alta/Modificar presupuesto. Los meses "Real" usan lo efectivamente pagado (cash basis);
          el resto redistribuye lo que queda de presupuesto según la curva de cada partida. Es el total
          agregado del proyecto — el desglose mes a mes por partida individual queda para una siguiente
          vuelta.
        </p>
      </main>
    </>
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
