import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  contracts,
  counterparties,
  contractRollup,
  invoices,
  changeOrders,
  approvalRequests,
  budgetLines,
  costCodes,
  phases,
  projects,
} from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { createInvoice, markInvoicePaid } from "@/lib/actions/invoices";
import { createChangeOrder, decideChangeOrder } from "@/lib/actions/changeOrders";
import { AppHeader } from "@/components/AppHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Breadcrumb } from "@/components/Breadcrumb";

// Wireframe G — Detalle con tabs (aquí, solo el tab Financial + Invoices,
// que es lo que este slice necesita probar de punta a punta).
export const dynamic = "force-dynamic"; // live financial data — never prerendered at build time

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ contractId: string }>;
}) {
  const { contractId } = await params;

  const [contract] = await db
    .select({
      id: contracts.id,
      scope: contracts.scope,
      status: contracts.status,
      original: contracts.originalAmount,
      counterpartyName: counterparties.name,
      current: contractRollup.currentAmount,
      paid: contractRollup.paidAmount,
      pending: contractRollup.pendingInvoices,
      budgetLineId: budgetLines.id,
      budgetLineCode: costCodes.code,
      projectId: phases.projectId,
      projectName: projects.name,
    })
    .from(contracts)
    .innerJoin(counterparties, eq(counterparties.id, contracts.counterpartyId))
    .innerJoin(budgetLines, eq(budgetLines.id, contracts.budgetLineId))
    .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .innerJoin(projects, eq(projects.id, phases.projectId))
    .leftJoin(contractRollup, eq(contractRollup.contractId, contracts.id))
    .where(eq(contracts.id, contractId));

  const invoiceRows = await db.select().from(invoices).where(eq(invoices.contractId, contractId));

  const changeOrderRows = await db
    .select({
      id: changeOrders.id,
      description: changeOrders.description,
      costImpact: changeOrders.costImpact,
      scheduleImpactDays: changeOrders.scheduleImpactDays,
      status: changeOrders.status,
      requiredRole: approvalRequests.requiredRole,
    })
    .from(changeOrders)
    .leftJoin(
      approvalRequests,
      and(eq(approvalRequests.entityType, "change_order"), eq(approvalRequests.entityId, changeOrders.id))
    )
    .where(eq(changeOrders.contractId, contractId));

  if (!contract) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-3xl px-6 py-12 text-ink-soft">Contrato no encontrado.</main>
      </>
    );
  }

  return (
    <>
      <AppHeader
        crumb={
          <Breadcrumb
            items={[
              { label: "Mis Proyectos", href: "/" },
              { label: contract.projectName, href: `/projects/${contract.projectId}` },
              { label: "Control Presupuestal", href: `/projects/${contract.projectId}/budget` },
              { label: contract.budgetLineCode, href: `/budget-lines/${contract.budgetLineId}` },
            ]}
          />
        }
      />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-ink-soft">Contract</div>
            <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{contract.counterpartyName}</h1>
            <p className="mt-1 text-sm text-ink-soft">{contract.scope}</p>
          </div>
          <StatusBadge status={contract.status} />
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Original" value={formatMoney(contract.original)} />
          <Stat label="Current" value={formatMoney(contract.current)} />
          <Stat label="Paid" value={formatMoney(contract.paid)} highlight />
          <Stat label="Pending invoices" value={formatMoney(contract.pending)} />
        </div>

        <h2 className="mt-10 text-sm font-medium text-ink-soft">Change Orders</h2>
        <ul className="mt-3 grid gap-3">
          {changeOrderRows.map((co) => {
            const impact = Number(co.costImpact);
            return (
              <li
                key={co.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-5 shadow-sm"
              >
                <div>
                  <div className="font-medium text-ink">{co.description}</div>
                  <div className="mt-0.5 text-sm tabular-nums text-ink-faint">
                    <span className={impact > 0 ? "text-redline" : impact < 0 ? "text-success" : ""}>
                      {impact >= 0 ? "+" : ""}
                      {formatMoney(impact)}
                    </span>
                    {co.scheduleImpactDays !== 0 && <> · {co.scheduleImpactDays > 0 ? "+" : ""}{co.scheduleImpactDays}d schedule</>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {co.status === "submitted" && co.requiredRole && (
                    <span className="text-xs text-ink-faint">Requiere: {co.requiredRole.replace(/_/g, " ")}</span>
                  )}
                  <StatusBadge status={co.status} />
                  {co.status === "submitted" && (
                    <div className="flex items-center gap-2">
                      <form action={decideChangeOrder}>
                        <input type="hidden" name="changeOrderId" value={co.id} />
                        <input type="hidden" name="decision" value="approved" />
                        <button className="rounded-lg bg-blueprint px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90">
                          Aprobar
                        </button>
                      </form>
                      <form action={decideChangeOrder}>
                        <input type="hidden" name="changeOrderId" value={co.id} />
                        <input type="hidden" name="decision" value="rejected" />
                        <button className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-paper">
                          Rechazar
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {changeOrderRows.length === 0 && (
            <li className="rounded-xl border border-dashed border-line-strong p-10 text-center text-sm text-ink-soft">
              Sin change orders todavía.
            </li>
          )}
        </ul>

        <form
          action={createChangeOrder}
          className="mt-3 flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface p-5 shadow-sm"
        >
          <input type="hidden" name="contractId" value={contract.id} />
          <Field label="Descripción">
            <input name="description" required className="w-56 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
          </Field>
          <Field label="Cost impact">
            <input
              type="number"
              name="costImpact"
              required
              step="0.01"
              placeholder="ej. 150000 o -50000"
              className="w-44 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
            />
          </Field>
          <Field label="Schedule impact (días)">
            <input
              type="number"
              name="scheduleImpactDays"
              defaultValue={0}
              className="w-28 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
            />
          </Field>
          <button className="rounded-lg bg-blueprint px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Crear change order
          </button>
        </form>
        <p className="mt-2 max-w-lg text-xs text-ink-faint">
          Al aprobarse, el monto se suma al Current del contrato (arriba) y por lo tanto al Committed de
          la partida de Budget — sin paso manual. El aprobador requerido se calcula con las Approval
          Authorities de §4.7 (menos de $100k: Project Management · $100k–$500k: Development · más de
          $500k: Executive).
        </p>

        <h2 className="mt-10 text-sm font-medium text-ink-soft">Invoices &amp; Payments</h2>
        <ul className="mt-3 grid gap-3">
          {invoiceRows.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-5 shadow-sm"
            >
              <div>
                <div className="font-medium text-ink">{inv.invoiceNumber}</div>
                <div className="mt-0.5 text-sm tabular-nums text-ink-faint">
                  {inv.invoiceDate} · {formatMoney(inv.netAmount)}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={inv.status} />
                {inv.status === "approved" && (
                  <form action={markInvoicePaid} className="flex items-center gap-2">
                    <input type="hidden" name="invoiceId" value={inv.id} />
                    <input type="hidden" name="amount" value={inv.netAmount ?? ""} />
                    <input
                      type="date"
                      name="paidDate"
                      required
                      defaultValue={new Date().toISOString().slice(0, 10)}
                      className="rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
                    />
                    <button className="rounded-lg bg-blueprint px-3.5 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90">
                      Marcar Paid
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
          {invoiceRows.length === 0 && (
            <li className="rounded-xl border border-dashed border-line-strong p-10 text-center text-sm text-ink-soft">
              Sin facturas todavía.
            </li>
          )}
        </ul>

        <h2 className="mt-10 text-sm font-medium text-ink-soft">+ Nueva factura</h2>
        <form
          action={createInvoice}
          className="mt-3 flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface p-5 shadow-sm"
        >
          <input type="hidden" name="contractId" value={contract.id} />
          <Field label="Número">
            <input name="invoiceNumber" required className="w-32 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
          </Field>
          <Field label="Fecha">
            <input
              type="date"
              name="invoiceDate"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
            />
          </Field>
          <Field label="Monto (neto)">
            <input
              type="number"
              name="netAmount"
              required
              step="0.01"
              className="w-40 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
            />
          </Field>
          <button className="rounded-lg bg-blueprint px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Crear factura
          </button>
        </form>
        <p className="mt-2 max-w-lg text-xs text-ink-faint">
          En esta slice la factura se crea directo en estado "approved" — el enrutamiento por umbral de
          aprobación (Approval Authorities, §4.7) se construye en una siguiente slice.
        </p>
      </main>
    </>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${highlight ? "text-success" : "text-ink"}`}>
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
