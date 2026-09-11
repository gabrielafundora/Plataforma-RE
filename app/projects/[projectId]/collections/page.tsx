import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { collections, sales, units, phases, projects } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { StatusBadge } from "@/components/StatusBadge";
import { registerCollection, rescheduleCollection } from "@/lib/actions/revenue";

// Pantalla 13 — Sales / Collections Forecast (§7.1). "Sales != Cash
// Collections" (§1.1): esto muestra lo que se ha cobrado (Real) contra
// lo que falta por cobrar (Forecast) por unidad vendida, agrupado por
// mes — igual distinción visual que usa Forecast de Costs, pero aquí el
// calendario son fechas reales de Collections, no una curva generada.
// "Ajustar curva de absorción" = reprogramar (fecha/monto) un cobro
// pendiente — no hay fórmula de curva guardada.
export const dynamic = "force-dynamic";

const MONTH_LABELS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split("-").map(Number);
  return `${MONTH_LABELS[m - 1]} ${y}`;
}

export default async function ProjectCollectionsPage({ params }: { params: Promise<{ projectId: string }> }) {
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

  const rows = (
    await db
      .select({
        id: collections.id,
        dueDate: collections.dueDate,
        amount: collections.amount,
        paidDate: collections.paidDate,
        status: collections.status,
        unitCode: units.code,
      })
      .from(collections)
      .innerJoin(sales, eq(sales.id, collections.saleId))
      .innerJoin(units, eq(units.id, sales.unitId))
      .innerJoin(phases, eq(phases.id, units.phaseId))
      .where(eq(phases.projectId, projectId))
      .orderBy(collections.dueDate)
  ).map((r) => ({ ...r, amount: Number(r.amount) }));

  const today = new Date().toISOString().slice(0, 10);

  const totalContracted = rows.reduce((s, r) => s + r.amount, 0);
  const totalCollected = rows.filter((r) => r.status === "paid").reduce((s, r) => s + r.amount, 0);
  const totalPending = rows.filter((r) => r.status !== "paid").reduce((s, r) => s + r.amount, 0);

  const monthGroups = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.dueDate.slice(0, 7);
    if (!monthGroups.has(key)) monthGroups.set(key, []);
    monthGroups.get(key)!.push(r);
  }
  const sortedMonths = [...monthGroups.keys()].sort();

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="collections" />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="text-sm text-ink-soft">Cobranza</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Contratado" value={formatMoney(totalContracted)} />
          <Stat label="Cobrado" value={formatMoney(totalCollected)} tone="good" />
          <Stat label="Pendiente" value={formatMoney(totalPending)} />
        </div>

        {sortedMonths.length === 0 && (
          <p className="mt-8 text-sm text-ink-soft">
            Sin cobros programados todavía — registra una venta en{" "}
            <Link href={`/projects/${projectId}/inventory`} className="text-blueprint hover:underline">
              Inventario
            </Link>
            .
          </p>
        )}

        <div className="mt-6 space-y-6">
          {sortedMonths.map((month) => {
            const monthRows = monthGroups.get(month)!;
            const monthCollected = monthRows.filter((r) => r.status === "paid").reduce((s, r) => s + r.amount, 0);
            const monthPending = monthRows.filter((r) => r.status !== "paid").reduce((s, r) => s + r.amount, 0);

            return (
              <div key={month} className="overflow-hidden rounded-xl border border-line bg-surface shadow-sm">
                <div className="flex items-center justify-between border-b border-line bg-surface-2 px-4 py-2.5">
                  <span className="text-sm font-semibold capitalize text-ink">{monthLabel(month)}</span>
                  <span className="text-xs text-ink-faint">
                    Cobrado {formatMoney(monthCollected)} · Pendiente {formatMoney(monthPending)}
                  </span>
                </div>
                <div className="divide-y divide-line">
                  {monthRows.map((r) => {
                    const isOverdue = r.status === "pending" && r.dueDate < today;
                    return (
                      <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div>
                          <span className="font-medium text-ink">{r.unitCode}</span>{" "}
                          <span className="text-sm text-ink-soft">· vence {r.dueDate}</span>{" "}
                          <span className="text-sm tabular-nums text-ink-faint">· {formatMoney(r.amount)}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={isOverdue ? "overdue" : r.status} />
                          {r.status === "pending" && (
                            <>
                              <form action={registerCollection} className="flex flex-wrap items-center gap-1.5">
                                <input type="hidden" name="collectionId" value={r.id} />
                                <input type="hidden" name="amount" value={r.amount} />
                                <input
                                  type="date"
                                  name="paidDate"
                                  required
                                  defaultValue={today}
                                  className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink"
                                />
                                <button className="rounded-lg bg-blueprint px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90">
                                  Registrar cobro
                                </button>
                              </form>
                              <form action={rescheduleCollection} className="flex flex-wrap items-center gap-1.5">
                                <input type="hidden" name="collectionId" value={r.id} />
                                <input
                                  type="date"
                                  name="dueDate"
                                  required
                                  defaultValue={r.dueDate}
                                  className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink"
                                />
                                <input
                                  type="number"
                                  name="amount"
                                  required
                                  step="0.01"
                                  defaultValue={r.amount}
                                  className="w-24 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink"
                                />
                                <button className="rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-paper">
                                  Reprogramar
                                </button>
                              </form>
                            </>
                          )}
                          {r.status === "paid" && (
                            <span className="text-xs text-ink-faint">cobrado {r.paidDate}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone === "good" ? "text-success" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}
