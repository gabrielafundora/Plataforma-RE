import Link from "next/link";
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects, snapshots, returnMetrics } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { computeMonthlyLedger } from "@/lib/businessplan/monthlyLedger";
import { calculateIRR, calculateNPV, calculateMOIC, DISCOUNT_RATE } from "@/lib/businessplan/returns";

// Pantalla 17 — Returns / Business Plan (§7.1), recortada a lo que se
// puede derivar en vivo. La spec completa compara Baseline vs. Actual
// vs. Current Forecast por Snapshot — esta pantalla muestra el Current
// Forecast en vivo, con la Baseline (congelada al aprobar el Deal —
// lib/actions/deal.ts:approveDeal, §3.3) como referencia chica debajo
// de cada métrica cuando existe. Un proyecto que arrancó directo
// (seed.ts, antes de que existiera el modo Deal) no tiene Baseline —
// esas métricas simplemente no muestran la referencia, no se inventa
// una. Yield on Cost / Development Spread quedan fuera: necesitan un
// pro forma de operación estabilizada que este MVP no modela.
export const dynamic = "force-dynamic";

export default async function ProjectReturnsPage({ params }: { params: Promise<{ projectId: string }> }) {
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

  const ledger = await computeMonthlyLedger(projectId);

  const unleveredSeries = ledger.cfBeforeFinancing;
  const equitySeries = ledger.equityIn.map((v, i) => -v + ledger.equityOut[i]);

  const unleveredIrr = calculateIRR(unleveredSeries);
  const leveredIrr = calculateIRR(equitySeries);
  const unleveredNpv = calculateNPV(DISCOUNT_RATE, unleveredSeries);
  const unleveredMoic = calculateMOIC(unleveredSeries);
  const leveredMoic = calculateMOIC(equitySeries);

  const { currentBudget, contractedRevenue, projectedRevenue, loanAmount, equityCommitment } = ledger.totals;
  const totalSources = loanAmount + equityCommitment;
  // Base del margen: ingreso proyectado a venta completa del inventario
  // (vendido a precio real + disponible a precio de lista), no solo lo
  // ya contratado — con pocas unidades vendidas, usar solo lo contratado
  // da un margen negativo absurdo que no refleja la economía real del
  // proyecto completo.
  const profitMargin = projectedRevenue > 0 ? (projectedRevenue - currentBudget) / projectedRevenue : null;

  const [baseline] = await db
    .select({ id: snapshots.id })
    .from(snapshots)
    .where(and(eq(snapshots.projectId, projectId), eq(snapshots.type, "baseline")));
  const baselineMetrics = baseline
    ? await db.select().from(returnMetrics).where(eq(returnMetrics.snapshotId, baseline.id))
    : [];
  const baselineValue = (scope: string, metricKey: string) => {
    const m = baselineMetrics.find((r) => r.scope === scope && r.metricKey === metricKey);
    return m ? Number(m.value) : null;
  };

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="returns" />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="text-sm text-ink-soft">Returns</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>
        <p className="mt-1 text-xs text-ink-faint">
          Current Forecast, en vivo. Para lo ya cerrado mes a mes, ver{" "}
          <Link href={`/projects/${projectId}/snapshots`} className="text-blueprint hover:underline">
            Snapshots
          </Link>
          .
        </p>

        <h2 className="mt-8 font-display text-lg font-semibold text-ink">Retornos</h2>
        {baseline && (
          <p className="mt-1 text-xs text-ink-faint">
            "Baseline" = lo proyectado con el Scenario elegido al aprobar el Deal — inmutable.{" "}
            <Link href={`/projects/${projectId}/snapshots/${baseline.id}`} className="text-blueprint hover:underline">
              Ver Baseline completa →
            </Link>
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <ReturnStat label="IRR Unlevered" value={formatPercent(unleveredIrr)} baseline={baseline ? formatPercent(baselineValue("project", "irr_unlevered")) : undefined} />
          <ReturnStat label="IRR Levered (equity)" value={formatPercent(leveredIrr)} baseline={baseline ? formatPercent(baselineValue("equity", "irr_levered")) : undefined} />
          <ReturnStat
            label={`NPV Unlevered @ ${(DISCOUNT_RATE * 100).toFixed(0)}%`}
            value={formatMoney(unleveredNpv)}
            baseline={baseline ? formatMoneyOrNA(baselineValue("project", "npv")) : undefined}
          />
          <ReturnStat label="MOIC Proyecto" value={formatMultiple(unleveredMoic)} baseline={baseline ? formatMultiple(baselineValue("project", "moic")) : undefined} />
          <ReturnStat label="MOIC Equity" value={formatMultiple(leveredMoic)} baseline={baseline ? formatMultiple(baselineValue("equity", "moic")) : undefined} />
          <ReturnStat
            label={`Profit Margin (sobre ${formatMoney(projectedRevenue)} proyectado)`}
            value={profitMargin !== null ? `${(profitMargin * 100).toFixed(1)}%` : "N/A"}
            baseline={baseline ? formatPercent(baselineValue("project", "profit_margin")) : undefined}
          />
        </div>
        {leveredIrr === null && (
          <p className="mt-3 max-w-lg text-xs text-ink-faint">
            IRR/MOIC de equity salen "N/A" hasta que haya una distribución registrada — todavía no hay
            evento de salida/refinanciamiento en este proyecto.
          </p>
        )}

        <h2 className="mt-8 font-display text-lg font-semibold text-ink">Sources &amp; Uses</h2>
        <div className="mt-3 overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs font-medium text-ink-soft">
              <tr>
                <th className="px-4 py-2.5 text-left">Uses</th>
                <th className="px-4 py-2.5 text-right">Monto</th>
                <th className="border-l border-line px-4 py-2.5 text-left">Sources</th>
                <th className="px-4 py-2.5 text-right">Monto</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <td className="px-4 py-2.5 text-ink">Presupuesto (current)</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink">{formatMoney(currentBudget)}</td>
                <td className="border-l border-line px-4 py-2.5 text-ink">Deuda (loan amount)</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink">{formatMoney(loanAmount)}</td>
              </tr>
              <tr className="border-t border-line">
                <td className="px-4 py-2.5"></td>
                <td className="px-4 py-2.5"></td>
                <td className="border-l border-line px-4 py-2.5 text-ink">Equity (comprometido)</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink">{formatMoney(equityCommitment)}</td>
              </tr>
              <tr className="border-t border-line-strong bg-surface-2/40 font-semibold">
                <td className="px-4 py-2.5 text-ink">Total Uses</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink">{formatMoney(currentBudget)}</td>
                <td className="border-l border-line px-4 py-2.5 text-ink">Total Sources</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-ink">{formatMoney(totalSources)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          Gap (Uses − Sources): {formatMoney(currentBudget - totalSources)}
          {currentBudget - totalSources > 0
            ? " — el financiamiento comprometido no cubre el presupuesto actual."
            : " — el financiamiento comprometido cubre el presupuesto actual."}
        </p>

        <p className="mt-8 max-w-2xl text-xs text-ink-faint">
          Fuera de esta vuelta (disclosed, no silencioso): Yield on Cost · Development Spread
          (necesitan un pro forma de operación estabilizada no modelado en el MVP)
          {!baseline && " · Baseline (este proyecto arrancó antes de que existiera el modo Deal/UW, o nunca pasó por él)"}.
        </p>
      </main>
    </>
  );
}

function formatPercent(value: number | null): string {
  if (value === null) return "N/A";
  return `${(value * 100).toFixed(1)}%`;
}

function formatMultiple(value: number | null): string {
  if (value === null) return "N/A";
  return `${value.toFixed(2)}x`;
}

function formatMoneyOrNA(value: number | null): string {
  return value === null ? "N/A" : formatMoney(value);
}

function ReturnStat({ label, value, baseline }: { label: string; value: string; baseline?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</div>
      {baseline !== undefined && <div className="mt-0.5 text-xs tabular-nums text-ink-faint">Baseline: {baseline}</div>}
    </div>
  );
}
