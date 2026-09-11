import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { computeMonthlyLedger } from "@/lib/businessplan/monthlyLedger";
import { calculateIRR, calculateNPV, calculateMOIC } from "@/lib/businessplan/returns";

// Pantalla 17 — Returns / Business Plan (§7.1), recortada a lo que se
// puede derivar en vivo. La spec completa compara Baseline vs. Actual
// vs. Current Forecast por Snapshot — los Snapshots los genera Monthly
// Close (pantalla 18, no construida todavía), así que esta vuelta solo
// muestra el Current Forecast, sin columnas de comparación. Yield on
// Cost / Development Spread quedan fuera: necesitan un pro forma de
// operación estabilizada que este MVP no modela.
export const dynamic = "force-dynamic";

const DISCOUNT_RATE = 0.15; // tasa de descuento anual fija — no hay selector en la spec (pantalla 17: solo "seleccionar Snapshot" y "export").

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

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="returns" />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="text-sm text-ink-soft">Returns</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>
        <p className="mt-1 text-xs text-ink-faint">
          Current Forecast — sin comparación Baseline/Actual todavía (requiere Monthly Close, no
          construido en esta vuelta).
        </p>

        <h2 className="mt-8 font-display text-lg font-semibold text-ink">Retornos</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <ReturnStat label="IRR Unlevered" value={formatPercent(unleveredIrr)} />
          <ReturnStat label="IRR Levered (equity)" value={formatPercent(leveredIrr)} />
          <ReturnStat label={`NPV Unlevered @ ${(DISCOUNT_RATE * 100).toFixed(0)}%`} value={formatMoney(unleveredNpv)} />
          <ReturnStat label="MOIC Proyecto" value={formatMultiple(unleveredMoic)} />
          <ReturnStat label="MOIC Equity" value={formatMultiple(leveredMoic)} />
          <ReturnStat
            label={`Profit Margin (sobre ${formatMoney(projectedRevenue)} proyectado)`}
            value={profitMargin !== null ? `${(profitMargin * 100).toFixed(1)}%` : "N/A"}
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
          Fuera de esta vuelta (disclosed, no silencioso): comparación Baseline/Actual/Current Forecast
          por Snapshot (§3.3, requiere Monthly Close) · Yield on Cost · Development Spread (necesitan un
          pro forma de operación estabilizada no modelado en el MVP).
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

function ReturnStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}
