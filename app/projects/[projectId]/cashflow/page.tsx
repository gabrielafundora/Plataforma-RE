import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { computeMonthlyLedger } from "@/lib/businessplan/monthlyLedger";

// Pantalla 16 — Project Cash Flow (§4.3, §7.1). "La lectura directa del
// Cash Flow Engine — no es una pantalla con lógica propia": todo el
// cálculo vive en lib/businessplan/monthlyLedger.ts; esto solo lo
// renderiza. Sin acciones de captura (spec: "Ninguna — solo lectura"),
// solo el toggle Unlevered/Levered vía query param (sin JS de cliente).
export const dynamic = "force-dynamic";

const MONTH_LABELS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export default async function ProjectCashFlowPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { projectId } = await params;
  const { view } = await searchParams;
  const levered = view !== "unlevered";

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

  const monthHeaders = Array.from({ length: ledger.periods }, (_, i) => {
    const d = new Date(ledger.startMonth);
    d.setMonth(d.getMonth() + i);
    return { label: `${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`, isActual: i <= ledger.currentPeriodIndex };
  });

  const accumulated: number[] = [];
  let running = 0;
  const series = levered ? ledger.netLevered : ledger.cfBeforeFinancing;
  for (const v of series) {
    running += v;
    accumulated.push(running);
  }

  const rows: { label: string; values: number[]; bold?: boolean; tone?: "muted" }[] = [
    { label: "Ingresos", values: ledger.ingresos },
    { label: "Egresos", values: ledger.egresos.map((v) => -v) },
    { label: "Cash flow antes de financiamiento", values: ledger.cfBeforeFinancing, bold: true },
    { label: "Debt draws", values: ledger.debtDrawsIn, tone: "muted" },
    { label: "Debt interest", values: ledger.debtInterestOut.map((v) => -v), tone: "muted" },
    { label: "Debt principal", values: ledger.debtPrincipalOut.map((v) => -v), tone: "muted" },
    { label: "Equity contributions", values: ledger.equityIn, tone: "muted" },
    { label: "Equity distributions", values: ledger.equityOut.map((v) => -v), tone: "muted" },
    { label: `Cash flow neto (${levered ? "Levered" : "Unlevered"})`, values: series, bold: true },
    { label: "Acumulado", values: accumulated, bold: true },
  ];

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="cashflow" />
      <main className="mx-auto max-w-[1400px] px-6 py-12">
        <div className="text-sm text-ink-soft">Project Cash Flow</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>

        <div className="mt-4 flex items-center gap-2 text-sm">
          <Link
            href={`/projects/${projectId}/cashflow?view=levered`}
            className={`rounded-lg px-3 py-1.5 font-medium ${levered ? "bg-blueprint text-white" : "border border-line-strong text-ink-soft"}`}
          >
            Levered
          </Link>
          <Link
            href={`/projects/${projectId}/cashflow?view=unlevered`}
            className={`rounded-lg px-3 py-1.5 font-medium ${!levered ? "bg-blueprint text-white" : "border border-line-strong text-ink-soft"}`}
          >
            Unlevered
          </Link>
        </div>

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
          Lectura directa del Cash Flow Engine (§4.3) — no se captura nada aquí, todo se deriva de Costs,
          Revenue y Capital. Los meses en verde ya pasaron (cash basis); el resto es forecast. → Ver{" "}
          <Link href={`/projects/${projectId}/returns`} className="text-blueprint hover:underline">
            Returns
          </Link>{" "}
          para las métricas derivadas (IRR, MOIC, NPV).
        </p>
      </main>
    </>
  );
}
