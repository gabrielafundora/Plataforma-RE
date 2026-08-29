import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  invoices,
  contracts,
  counterparties,
  budgetLines,
  costCodes,
  phases,
  projects,
  approvalRequests,
} from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { StatusBadge } from "@/components/StatusBadge";
import { createInvoice, decideInvoice, markInvoicePaid } from "@/lib/actions/invoices";

// Igual tratamiento que ya tiene "Contratos" (pantalla 8): antes de
// esto, una factura solo se veía/creaba entrando primero al contrato
// específico. Esto junta todas las facturas del proyecto en una sola
// vista, reusando las mismas acciones que ya usa Contract Detail
// (createInvoice/decideInvoice/markInvoicePaid) — sin lógica nueva.
export const dynamic = "force-dynamic";

export default async function ProjectInvoicesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));

  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      netAmount: invoices.netAmount,
      status: invoices.status,
      requiredRole: approvalRequests.requiredRole,
      counterpartyName: counterparties.name,
      costCode: costCodes.code,
      costCodeDescription: costCodes.description,
    })
    .from(invoices)
    .innerJoin(contracts, eq(contracts.id, invoices.contractId))
    .innerJoin(counterparties, eq(counterparties.id, contracts.counterpartyId))
    .innerJoin(budgetLines, eq(budgetLines.id, contracts.budgetLineId))
    .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .leftJoin(approvalRequests, and(eq(approvalRequests.entityType, "invoice"), eq(approvalRequests.entityId, invoices.id)))
    .where(eq(phases.projectId, projectId))
    .orderBy(costCodes.code);

  const contractOptions = await db
    .select({
      id: contracts.id,
      counterpartyName: counterparties.name,
      scope: contracts.scope,
      costCode: costCodes.code,
    })
    .from(contracts)
    .innerJoin(counterparties, eq(counterparties.id, contracts.counterpartyId))
    .innerJoin(budgetLines, eq(budgetLines.id, contracts.budgetLineId))
    .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .where(eq(phases.projectId, projectId))
    .orderBy(costCodes.code);

  if (!project) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-6xl px-6 py-12 text-ink-soft">Proyecto no encontrado.</main>
      </>
    );
  }

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="invoices" />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="text-sm text-ink-soft">Facturas</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>

        <ul className="mt-6 grid gap-3">
          {rows.map((inv) => (
            <li
              key={inv.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-5 shadow-sm"
            >
              <div>
                <div className="font-medium text-ink">{inv.invoiceNumber}</div>
                <div className="mt-0.5 text-sm text-ink-soft">{inv.counterpartyName}</div>
                <div className="mt-1 text-xs text-ink-faint">
                  {inv.costCode} · {inv.costCodeDescription} · {inv.invoiceDate} · {formatMoney(inv.netAmount)}
                </div>
              </div>
              <div className="flex items-center gap-3">
                {inv.status === "submitted" && inv.requiredRole && (
                  <span className="text-xs text-ink-faint">Requiere: {inv.requiredRole.replace(/_/g, " ")}</span>
                )}
                <StatusBadge status={inv.status} />
                {inv.status === "submitted" && (
                  <div className="flex items-center gap-2">
                    <form action={decideInvoice}>
                      <input type="hidden" name="invoiceId" value={inv.id} />
                      <input type="hidden" name="decision" value="approved" />
                      <button className="rounded-lg bg-blueprint px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90">
                        Aprobar
                      </button>
                    </form>
                    <form action={decideInvoice}>
                      <input type="hidden" name="invoiceId" value={inv.id} />
                      <input type="hidden" name="decision" value="rejected" />
                      <button className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-paper">
                        Rechazar
                      </button>
                    </form>
                  </div>
                )}
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
          {rows.length === 0 && (
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
          <Field label="Contrato">
            <select
              name="contractId"
              required
              className="w-64 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
            >
              <option value="">Selecciona un contrato…</option>
              {contractOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.counterpartyName} — {c.scope} ({c.costCode})
                </option>
              ))}
            </select>
          </Field>
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
          La factura entra como "submitted" y pasa por Approval Authorities (§4.7: cualquier monto
          requiere Finance) — "Marcar Paid" solo aparece una vez aprobada.
        </p>
      </main>
    </>
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
