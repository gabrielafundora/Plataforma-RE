import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  projects,
  phases,
  budgetLines,
  budgetLineRollup,
  payments,
  invoices,
  contracts,
  collections,
  sales,
  units,
  debtFacilities,
  debtFacilityRollup,
  debtDraws,
  debtPayments,
  debtCovenants,
  equityInvestorRollup,
  counterparties,
} from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { StatusBadge } from "@/components/StatusBadge";
import { rollingForecast, type CurveMethod } from "@/lib/forecast/engine";
import { allocateEquityFirst } from "@/lib/capital/equityFirst";
import {
  saveDebtFacility,
  addCovenant,
  recordCovenantTest,
  requestDraw,
  submitDraw,
  approveDraw,
  fundDraw,
  recordDebtPayment,
} from "@/lib/actions/capital";

// Pantallas 14-15 — Debt Facility + Debt Draws (§6, §7.1). Un solo
// crédito por proyecto (decisión 8·07: único, solo Equity First). El
// panel "próximo mes" corre lib/capital/equityFirst.ts (§4.4) contra el
// mismo forecast de Costs que usa /forecast y las collections de
// /collections — es la primera pantalla que junta las tres piezas para
// responder la pregunta operativa del producto: "¿cuánto equity
// necesito aportar el próximo mes?".
export const dynamic = "force-dynamic";

const IMPLEMENTED_METHODS = new Set<CurveMethod>(["straight_line", "s_curve", "front_loaded", "back_loaded"]);

function monthsBetween(a: Date, b: Date): number {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

const MONTH_LABELS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export default async function ProjectDebtPage({ params }: { params: Promise<{ projectId: string }> }) {
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

  const [facilityRow] = await db
    .select({
      id: debtFacilities.id,
      loanAmount: debtFacilities.loanAmount,
      ltc: debtFacilities.ltc,
      ltv: debtFacilities.ltv,
      referenceRate: debtFacilities.referenceRate,
      spreadBps: debtFacilities.spreadBps,
      termMonths: debtFacilities.termMonths,
      amortizationMonths: debtFacilities.amortizationMonths,
      interestReserve: debtFacilities.interestReserve,
      commitmentFeePct: debtFacilities.commitmentFeePct,
      lenderName: counterparties.name,
      fundedAmount: debtFacilityRollup.fundedAmount,
      outstandingBalance: debtFacilityRollup.outstandingBalance,
      availableToDraw: debtFacilityRollup.availableToDraw,
    })
    .from(debtFacilities)
    .innerJoin(counterparties, eq(counterparties.id, debtFacilities.lenderId))
    .leftJoin(debtFacilityRollup, eq(debtFacilityRollup.debtFacilityId, debtFacilities.id))
    .where(eq(debtFacilities.projectId, projectId));

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="debt" />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="text-sm text-ink-soft">Deuda</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>

        {!facilityRow ? (
          <>
            <p className="mt-4 max-w-xl text-sm text-ink-soft">
              Este proyecto todavía no tiene un crédito de construcción registrado.
            </p>
            <FacilityForm projectId={projectId} />
          </>
        ) : (
          <FacilityDetail projectId={projectId} facility={facilityRow} />
        )}
      </main>
    </>
  );
}

async function FacilityDetail({
  projectId,
  facility,
}: {
  projectId: string;
  facility: {
    id: string;
    loanAmount: string;
    ltc: string | null;
    ltv: string | null;
    referenceRate: string | null;
    spreadBps: number | null;
    termMonths: number | null;
    amortizationMonths: number | null;
    interestReserve: string | null;
    commitmentFeePct: string | null;
    lenderName: string;
    fundedAmount: string | null;
    outstandingBalance: string | null;
    availableToDraw: string | null;
  };
}) {
  const draws = await db
    .select()
    .from(debtDraws)
    .where(eq(debtDraws.debtFacilityId, facility.id))
    .orderBy(debtDraws.periodMonth);

  const hasDraws = draws.length > 0;

  const paymentRows = await db
    .select()
    .from(debtPayments)
    .where(eq(debtPayments.debtFacilityId, facility.id))
    .orderBy(debtPayments.periodMonth);

  const covenants = await db.select().from(debtCovenants).where(eq(debtCovenants.debtFacilityId, facility.id));

  const suggestion = await computeNextMonthSuggestion(projectId);

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Monto del crédito" value={formatMoney(facility.loanAmount)} />
        <Stat label="Dispuesto" value={formatMoney(facility.fundedAmount ?? 0)} />
        <Stat label="Saldo" value={formatMoney(facility.outstandingBalance ?? 0)} />
        <Stat label="Disponible" value={formatMoney(facility.availableToDraw ?? facility.loanAmount)} />
      </div>

      <div className="mt-6 rounded-xl border border-line bg-surface p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-ink">Términos</h2>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Term label="Lender" value={facility.lenderName} />
          <Term label="LTC" value={facility.ltc ? `${(Number(facility.ltc) * 100).toFixed(1)}%` : "—"} />
          <Term label="LTV" value={facility.ltv ? `${(Number(facility.ltv) * 100).toFixed(1)}%` : "—"} />
          <Term label="Tasa" value={facility.referenceRate ?? "—"} />
          <Term label="Spread" value={facility.spreadBps ? `${facility.spreadBps} bps` : "—"} />
          <Term label="Plazo" value={facility.termMonths ? `${facility.termMonths} meses` : "—"} />
          <Term label="Amortización" value={facility.amortizationMonths ? `${facility.amortizationMonths} meses` : "—"} />
          <Term label="Reserva de interés" value={formatMoney(facility.interestReserve ?? 0)} />
          <Term
            label="Commitment fee"
            value={facility.commitmentFeePct ? `${(Number(facility.commitmentFeePct) * 100).toFixed(2)}%` : "—"}
          />
        </dl>
        {hasDraws ? (
          <p className="mt-3 text-xs text-ink-faint">
            Ya tiene disposiciones registradas — los términos no se pueden editar (§7.1, pantalla 14).
          </p>
        ) : (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs font-medium text-blueprint">Editar términos</summary>
            <FacilityForm projectId={projectId} existing={facility} />
          </details>
        )}
      </div>

      <div className="mt-6 rounded-xl border border-warning/40 bg-warning-soft p-5">
        <h2 className="font-display text-lg font-semibold text-ink">
          Próximo mes — {suggestion.monthLabel}
        </h2>
        <p className="mt-1 text-sm text-warning/90">
          Motor Equity First (§4.4): egresos {formatMoney(suggestion.costsNextMonth)} − ingresos{" "}
          {formatMoney(suggestion.revenueNextMonth)} = déficit {formatMoney(suggestion.cashDeficit)}. Equity
          disponible: {formatMoney(suggestion.equityAvailable)}.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:w-96">
          <Stat label="Equity a llamar" value={formatMoney(suggestion.equityCallAmount)} />
          <Stat label="Deuda a disponer" value={formatMoney(suggestion.debtDrawAmount)} />
        </div>

        <form action={requestDraw} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="debtFacilityId" value={facility.id} />
          <Field label="Mes">
            <input
              type="date"
              name="periodMonth"
              required
              defaultValue={suggestion.periodMonth}
              className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
            />
          </Field>
          <Field label="Monto a solicitar">
            <input
              type="number"
              name="requestedAmount"
              required
              step="0.01"
              defaultValue={suggestion.debtDrawAmount > 0 ? suggestion.debtDrawAmount : undefined}
              className="w-40 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
            />
          </Field>
          <button className="rounded-lg bg-blueprint px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Solicitar draw
          </button>
        </form>
      </div>

      <h2 className="mt-8 font-display text-lg font-semibold text-ink">Disposiciones</h2>
      <ul className="mt-3 grid gap-2">
        {draws.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm">
            <div>
              <span className="font-medium text-ink">{d.periodMonth}</span>{" "}
              <span className="text-sm text-ink-soft">· solicitado {formatMoney(d.requestedAmount)}</span>
              {d.fundedAmount && <span className="text-sm text-ink-faint"> · fondeado {formatMoney(d.fundedAmount)}</span>}
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={d.status} />
              {d.status === "requested" && (
                <form action={submitDraw}>
                  <input type="hidden" name="drawId" value={d.id} />
                  <button className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-paper">
                    Enviar
                  </button>
                </form>
              )}
              {d.status === "submitted" && (
                <form action={approveDraw}>
                  <input type="hidden" name="drawId" value={d.id} />
                  <button className="rounded-lg bg-blueprint px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90">
                    Aprobar
                  </button>
                </form>
              )}
              {d.status === "approved" && (
                <form action={fundDraw} className="flex items-center gap-2">
                  <input type="hidden" name="drawId" value={d.id} />
                  <input type="hidden" name="fundedAmount" value={d.requestedAmount} />
                  <input
                    type="date"
                    name="fundedDate"
                    required
                    defaultValue={new Date().toISOString().slice(0, 10)}
                    className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink"
                  />
                  <button className="rounded-lg bg-blueprint px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90">
                    Marcar Funded
                  </button>
                </form>
              )}
            </div>
          </li>
        ))}
        {draws.length === 0 && (
          <li className="rounded-xl border border-dashed border-line-strong p-8 text-center text-sm text-ink-soft">
            Sin disposiciones todavía.
          </li>
        )}
      </ul>

      <h2 className="mt-8 font-display text-lg font-semibold text-ink">Pagos de deuda</h2>
      <ul className="mt-3 grid gap-2">
        {paymentRows.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4 text-sm shadow-sm">
            <span className="font-medium text-ink">{p.periodMonth}</span>
            <span className="text-ink-faint">interés {formatMoney(p.interestAmount)}</span>
            <span className="text-ink-faint">capital {formatMoney(p.principalAmount)}</span>
          </li>
        ))}
      </ul>
      <form action={recordDebtPayment} className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm">
        <input type="hidden" name="debtFacilityId" value={facility.id} />
        <Field label="Mes">
          <input type="date" name="periodMonth" required defaultValue={new Date().toISOString().slice(0, 10)} className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
        </Field>
        <Field label="Interés">
          <input type="number" name="interestAmount" step="0.01" defaultValue={0} className="w-32 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
        </Field>
        <Field label="Capital">
          <input type="number" name="principalAmount" step="0.01" defaultValue={0} className="w-32 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
        </Field>
        <button className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-paper">
          Registrar pago
        </button>
      </form>
      <p className="mt-2 max-w-lg text-xs text-ink-faint">
        El interés se captura a mano — no hay feed de tasa vigente en el MVP para derivarlo (mismo criterio
        que los covenants).
      </p>

      <h2 className="mt-8 font-display text-lg font-semibold text-ink">Covenants</h2>
      <ul className="mt-3 grid gap-2">
        {covenants.map((c) => (
          <li key={c.id} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-medium text-ink">{c.name}</span>{" "}
                <span className="text-ink-faint">· umbral {c.threshold}</span>
                {c.lastTestedStatus && (
                  <span className="text-ink-faint"> · última prueba: {c.lastTestedStatus} ({c.lastTestedAt})</span>
                )}
              </div>
              <form action={recordCovenantTest} className="flex items-center gap-2">
                <input type="hidden" name="covenantId" value={c.id} />
                <select name="status" required className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink">
                  <option value="cumple">Cumple</option>
                  <option value="no cumple">No cumple</option>
                </select>
                <input type="date" name="testedAt" required defaultValue={new Date().toISOString().slice(0, 10)} className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink" />
                <button className="rounded-lg border border-line-strong px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-paper">
                  Registrar prueba
                </button>
              </form>
            </div>
          </li>
        ))}
        {covenants.length === 0 && <li className="text-sm text-ink-soft">Sin covenants registrados.</li>}
      </ul>
      <form action={addCovenant} className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm">
        <input type="hidden" name="debtFacilityId" value={facility.id} />
        <Field label="Covenant">
          <input name="name" required placeholder="Minimum equity" className="w-48 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
        </Field>
        <Field label="Umbral">
          <input name="threshold" required placeholder="DSCR >= 1.25x" className="w-48 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
        </Field>
        <button className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-paper">
          Agregar covenant
        </button>
      </form>
    </>
  );
}

function FacilityForm({
  projectId,
  existing,
}: {
  projectId: string;
  existing?: {
    lenderName: string;
    loanAmount: string;
    ltc: string | null;
    ltv: string | null;
    referenceRate: string | null;
    spreadBps: number | null;
    termMonths: number | null;
    amortizationMonths: number | null;
    interestReserve: string | null;
    commitmentFeePct: string | null;
  };
}) {
  return (
    <form action={saveDebtFacility} className="mt-4 grid gap-4 rounded-xl border border-line bg-surface p-5 shadow-sm sm:grid-cols-2">
      <input type="hidden" name="projectId" value={projectId} />
      <Field label="Lender">
        <input name="lenderName" required defaultValue={existing?.lenderName} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
      </Field>
      <Field label="Monto del crédito">
        <input type="number" name="loanAmount" required step="0.01" defaultValue={existing?.loanAmount} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
      </Field>
      <Field label="LTC %">
        <input type="number" name="ltcPercent" step="0.1" defaultValue={existing?.ltc ? Number(existing.ltc) * 100 : undefined} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
      </Field>
      <Field label="LTV %">
        <input type="number" name="ltvPercent" step="0.1" defaultValue={existing?.ltv ? Number(existing.ltv) * 100 : undefined} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
      </Field>
      <Field label="Tasa de referencia">
        <input name="referenceRate" placeholder="TIIE / SOFR" defaultValue={existing?.referenceRate ?? undefined} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
      </Field>
      <Field label="Spread (bps)">
        <input type="number" name="spreadBps" step="1" defaultValue={existing?.spreadBps ?? undefined} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
      </Field>
      <Field label="Plazo (meses)">
        <input type="number" name="termMonths" step="1" defaultValue={existing?.termMonths ?? undefined} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
      </Field>
      <Field label="Amortización (meses)">
        <input type="number" name="amortizationMonths" step="1" defaultValue={existing?.amortizationMonths ?? undefined} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
      </Field>
      <Field label="Reserva de interés">
        <input type="number" name="interestReserve" step="0.01" defaultValue={existing?.interestReserve ?? undefined} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
      </Field>
      <Field label="Commitment fee %">
        <input type="number" name="commitmentFeePercent" step="0.01" defaultValue={existing?.commitmentFeePct ? Number(existing.commitmentFeePct) * 100 : undefined} className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
      </Field>
      <button className="col-span-2 mt-2 w-fit rounded-lg bg-blueprint px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90">
        {existing ? "Guardar cambios" : "Dar de alta crédito"}
      </button>
    </form>
  );
}

// Motor Equity First contra "el próximo mes" — reusa exactamente el
// mismo cálculo de forecast por partida que /forecast (rollingForecast +
// actuals vía payments) para el lado de egresos, y la misma noción de
// "collections con vencimiento en el mes" que /collections para el lado
// de ingresos, para que los tres módulos cuenten la misma historia.
async function computeNextMonthSuggestion(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));

  const startMonth = new Date(project.approvedAt ?? project.createdAt);
  startMonth.setDate(1);
  startMonth.setHours(0, 0, 0, 0);

  const currentPeriodIndex = monthsBetween(startMonth, new Date());
  const targetIndex = currentPeriodIndex + 1;
  // Mismo horizonte que /forecast (project.forecastMonths) — no solo
  // hasta el mes objetivo: con un horizonte corto, rollingForecast
  // reparte todo el presupuesto restante entre muy pocos periodos y
  // sobreestima brutalmente el mes objetivo (straight_line con 2
  // periodos = 50% del total por mes).
  const periods = Math.max(project.forecastMonths, targetIndex + 1);

  const targetMonthDate = new Date(startMonth);
  targetMonthDate.setMonth(targetMonthDate.getMonth() + targetIndex);
  const monthLabel = `${MONTH_LABELS[targetMonthDate.getMonth()]} ${targetMonthDate.getFullYear()}`;
  const periodMonth = targetMonthDate.toISOString().slice(0, 10);

  // --- Costs: mismo cálculo que /forecast, recortado a un solo mes ---
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

  const paymentRows = await db
    .select({ budgetLineId: budgetLines.id, amount: payments.amount, paidDate: payments.paidDate })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(contracts, eq(contracts.id, invoices.contractId))
    .innerJoin(budgetLines, eq(budgetLines.id, contracts.budgetLineId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .where(eq(phases.projectId, projectId));

  const paymentsByLine = new Map<string, Map<number, number>>();
  for (const p of paymentRows) {
    const idx = monthsBetween(startMonth, new Date(p.paidDate));
    if (idx < 0 || idx >= periods) continue;
    if (!paymentsByLine.has(p.budgetLineId)) paymentsByLine.set(p.budgetLineId, new Map());
    const byPeriod = paymentsByLine.get(p.budgetLineId)!;
    byPeriod.set(idx, (byPeriod.get(idx) ?? 0) + Number(p.amount));
  }

  let costsNextMonth = 0;
  for (const line of lineRows) {
    const totalAmount = Number(line.current ?? 0);
    const method: CurveMethod = IMPLEMENTED_METHODS.has(line.forecastMethod as CurveMethod)
      ? (line.forecastMethod as CurveMethod)
      : "straight_line";
    const byPeriod = paymentsByLine.get(line.budgetLineId);
    const actuals: (number | null)[] = Array.from({ length: periods }, (_, i) =>
      i <= currentPeriodIndex ? byPeriod?.get(i) ?? 0 : null
    );
    const result = rollingForecast({ totalAmount, periods, method, actuals });
    costsNextMonth += result.schedule[targetIndex]?.amount ?? 0;
  }

  // --- Revenue: collections con vencimiento dentro del mes objetivo ---
  const nextMonthStart = periodMonth;
  const nextMonthEndDate = new Date(targetMonthDate);
  nextMonthEndDate.setMonth(nextMonthEndDate.getMonth() + 1);
  const nextMonthEnd = nextMonthEndDate.toISOString().slice(0, 10);

  const collectionRows = await db
    .select({ amount: collections.amount, dueDate: collections.dueDate })
    .from(collections)
    .innerJoin(sales, eq(sales.id, collections.saleId))
    .innerJoin(units, eq(units.id, sales.unitId))
    .innerJoin(phases, eq(phases.id, units.phaseId))
    .where(eq(phases.projectId, projectId));

  const revenueNextMonth = collectionRows
    .filter((c) => c.dueDate >= nextMonthStart && c.dueDate < nextMonthEnd)
    .reduce((s, c) => s + Number(c.amount), 0);

  // --- Equity disponible ---
  const investorRows = await db
    .select({ remainingCommitment: equityInvestorRollup.remainingCommitment, commitmentAmount: equityInvestorRollup.commitmentAmount })
    .from(equityInvestorRollup)
    .where(eq(equityInvestorRollup.projectId, projectId));
  const equityAvailable = investorRows.reduce((s, r) => s + Number(r.remainingCommitment ?? r.commitmentAmount ?? 0), 0);

  const cashDeficit = costsNextMonth - revenueNextMonth;
  const { equityCallAmount, debtDrawAmount } = allocateEquityFirst({ cashDeficit, equityAvailable });

  return { monthLabel, periodMonth, costsNextMonth, revenueNextMonth, cashDeficit, equityAvailable, equityCallAmount, debtDrawAmount };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-soft">
      {label}
      {children}
    </label>
  );
}

function Term({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}
