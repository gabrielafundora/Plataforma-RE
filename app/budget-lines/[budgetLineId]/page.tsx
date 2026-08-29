import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  budgetLines,
  costCodes,
  contracts,
  counterparties,
  contractRollup,
  phases,
  budgetLineRollup,
} from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { updateBudgetLineAmount } from "@/lib/actions/budgetSetup";
import { createContract } from "@/lib/actions/contracts";
import { getDevOrgId } from "@/lib/auth/devUser";

// Pantalla 7 — Budget Line Detail. El presupuesto de una partida se
// define aquí; los contratos que des de alta abajo son lo que empieza
// a "consumirlo" (Committed), y sus facturas pagadas lo que consume el
// Actual — el ciclo completo Budget → Contract → Invoice.
export const dynamic = "force-dynamic";

export default async function BudgetLineDetailPage({
  params,
}: {
  params: Promise<{ budgetLineId: string }>;
}) {
  const { budgetLineId } = await params;

  const [line] = await db
    .select({
      code: costCodes.code,
      description: costCodes.description,
      projectId: phases.projectId,
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
    .where(eq(budgetLines.id, budgetLineId));

  const contractRows = await db
    .select({
      id: contracts.id,
      scope: contracts.scope,
      status: contracts.status,
      counterpartyName: counterparties.name,
      current: contractRollup.currentAmount,
      paid: contractRollup.paidAmount,
      pending: contractRollup.pendingInvoices,
    })
    .from(contracts)
    .innerJoin(counterparties, eq(counterparties.id, contracts.counterpartyId))
    .leftJoin(contractRollup, eq(contractRollup.contractId, contracts.id))
    .where(eq(contracts.budgetLineId, budgetLineId));

  const orgId = await getDevOrgId();
  const counterpartyOptions = await db
    .select({ name: counterparties.name })
    .from(counterparties)
    .where(eq(counterparties.organizationId, orgId));

  if (!line) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-3xl px-6 py-12 text-ink-soft">Partida no encontrada.</main>
      </>
    );
  }

  const original = Number(line.original ?? 0);
  const current = Number(line.current ?? 0);
  const committed = Number(line.committed ?? 0);
  const actual = Number(line.actual ?? 0);
  const disponible = current - committed;

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Link
          href={`/projects/${line.projectId}/budget`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-blueprint hover:underline"
        >
          &larr; Volver a Control Presupuestal
        </Link>

        <div className="mt-4 text-sm text-ink-soft">Budget Line</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
          {line.code} · {line.description}
        </h1>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Original" value={formatMoney(original)} />
          <Stat label="Current" value={formatMoney(current)} />
          <Stat label="Committed" value={formatMoney(committed)} />
          <Stat label="Disponible" value={formatMoney(disponible)} tone={disponible < 0 ? "bad" : "good"} />
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-blueprint">Editar monto original</summary>
          <form action={updateBudgetLineAmount} className="mt-3 flex items-end gap-3 rounded-xl border border-line bg-surface p-4 shadow-sm">
            <input type="hidden" name="budgetLineId" value={budgetLineId} />
            <Field label="Nuevo monto original">
              <input
                type="number"
                name="originalAmount"
                required
                min={0}
                step="0.01"
                defaultValue={original}
                className="w-48 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
              />
            </Field>
            <button className="rounded-lg bg-blueprint px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
              Guardar
            </button>
          </form>
          <p className="mt-2 max-w-lg text-xs text-ink-faint">
            Edición directa — todavía no hay Baseline/Deal aprobado que proteja este número (§3.3); cuando
            exista, esto pasará por una solicitud de Budget Change en vez de editarse directo.
          </p>
        </details>

        <h2 className="mt-10 text-sm font-medium text-ink-soft">Contratos</h2>
        <ul className="mt-3 grid gap-3">
          {contractRows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/contracts/${c.id}`}
                className="flex items-center justify-between rounded-xl border border-line bg-surface p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <div>
                  <div className="font-medium text-ink">{c.counterpartyName}</div>
                  <div className="mt-0.5 text-sm text-ink-soft">{c.scope}</div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right text-sm">
                    <div className="font-medium tabular-nums text-ink">{formatMoney(c.current)}</div>
                    <div className="tabular-nums text-ink-faint">pagado {formatMoney(c.paid)}</div>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
              </Link>
            </li>
          ))}
          {contractRows.length === 0 && (
            <li className="rounded-xl border border-dashed border-line-strong p-10 text-center text-sm text-ink-soft">
              Sin contratos en esta partida todavía.
            </li>
          )}
        </ul>

        <h2 className="mt-10 text-sm font-medium text-ink-soft">+ Nuevo contrato</h2>
        <form
          action={createContract}
          className="mt-3 flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface p-5 shadow-sm"
        >
          <input type="hidden" name="budgetLineId" value={budgetLineId} />
          <Field label="Contraparte">
            <input
              name="counterpartyName"
              required
              list="counterparty-options"
              placeholder="ej. Constructora del Valle"
              className="w-56 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
            />
            <datalist id="counterparty-options">
              {counterpartyOptions.map((c) => (
                <option key={c.name} value={c.name} />
              ))}
            </datalist>
          </Field>
          <Field label="Alcance">
            <input name="scope" required placeholder="ej. Suministro de acero" className="w-56 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
          </Field>
          <Field label="Monto">
            <input type="number" name="originalAmount" required min={0} step="0.01" className="w-40 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
          </Field>
          <button className="rounded-lg bg-blueprint px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Crear contrato
          </button>
        </form>
        <p className="mt-2 max-w-lg text-xs text-ink-faint">
          Si "Contraparte" coincide con una ya existente se reutiliza; si no, se crea una nueva. El
          contrato queda "active" directo — el flujo de aprobación de contratos se construye en una
          siguiente slice, igual que ya pasa con invoices.
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-soft">
      {label}
      {children}
    </label>
  );
}
