import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contracts, counterparties, contractRollup, invoices } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { createInvoice, markInvoicePaid } from "@/lib/actions/invoices";
import { AppHeader } from "@/components/AppHeader";

// Wireframe G — Detalle con tabs (aquí, solo el tab Financial + Invoices,
// que es lo que este slice necesita probar de punta a punta).
export const dynamic = "force-dynamic"; // live financial data — never prerendered at build time

const STATUS_STYLE: Record<string, string> = {
  paid: "border-blueprint/30 bg-blueprint-soft text-blueprint",
  approved: "border-line-strong bg-surface-2 text-ink-soft",
  submitted: "border-line-strong bg-surface-2 text-ink-soft",
};

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
    })
    .from(contracts)
    .innerJoin(counterparties, eq(counterparties.id, contracts.counterpartyId))
    .leftJoin(contractRollup, eq(contractRollup.contractId, contracts.id))
    .where(eq(contracts.id, contractId));

  const invoiceRows = await db.select().from(invoices).where(eq(invoices.contractId, contractId));

  if (!contract) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-3xl px-6 py-10 text-ink-soft">Contrato no encontrado.</main>
      </>
    );
  }

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-xs uppercase tracking-wide text-ink-faint">Contract</div>
            <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{contract.counterpartyName}</h1>
            <p className="mt-1 text-sm text-ink-soft">{contract.scope}</p>
          </div>
          <span className="whitespace-nowrap rounded-full border border-line-strong bg-surface-2 px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-ink-soft">
            {contract.status}
          </span>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Original" value={formatMoney(contract.original)} />
          <Stat label="Current" value={formatMoney(contract.current)} />
          <Stat label="Paid" value={formatMoney(contract.paid)} highlight />
          <Stat label="Pending invoices" value={formatMoney(contract.pending)} />
        </div>

        <h2 className="mt-10 font-mono text-xs uppercase tracking-wide text-ink-faint">Invoices &amp; Payments</h2>
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-md border border-line-strong bg-surface shadow-sm">
          {invoiceRows.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div>
                <div className="font-medium text-ink">{inv.invoiceNumber}</div>
                <div className="mt-0.5 font-mono text-xs text-ink-faint">
                  {inv.invoiceDate} · {formatMoney(inv.netAmount)}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide ${
                    STATUS_STYLE[inv.status] ?? "border-line-strong bg-surface-2 text-ink-soft"
                  }`}
                >
                  {inv.status}
                </span>
                {inv.status === "approved" && (
                  <form action={markInvoicePaid} className="flex items-center gap-2">
                    <input type="hidden" name="invoiceId" value={inv.id} />
                    <input type="hidden" name="amount" value={inv.netAmount ?? ""} />
                    <input
                      type="date"
                      name="paidDate"
                      required
                      defaultValue={new Date().toISOString().slice(0, 10)}
                      className="rounded border border-line-strong bg-surface px-2 py-1 text-xs text-ink"
                    />
                    <button className="rounded bg-blueprint px-3 py-1 font-mono text-xs font-medium text-white transition-opacity hover:opacity-90">
                      Marcar Paid
                    </button>
                  </form>
                )}
              </div>
            </li>
          ))}
          {invoiceRows.length === 0 && (
            <li className="px-5 py-10 text-center text-sm text-ink-soft">Sin facturas todavía.</li>
          )}
        </ul>

        <h2 className="mt-10 font-mono text-xs uppercase tracking-wide text-ink-faint">+ Nueva factura</h2>
        <form
          action={createInvoice}
          className="mt-3 flex flex-wrap items-end gap-4 rounded-md border border-line-strong bg-surface p-5 shadow-sm"
        >
          <input type="hidden" name="contractId" value={contract.id} />
          <Field label="Número">
            <input name="invoiceNumber" required className="w-32 rounded border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink" />
          </Field>
          <Field label="Fecha">
            <input
              type="date"
              name="invoiceDate"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="rounded border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
            />
          </Field>
          <Field label="Monto (neto)">
            <input
              type="number"
              name="netAmount"
              required
              step="0.01"
              className="w-40 rounded border border-line-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
            />
          </Field>
          <button className="rounded bg-blueprint px-4 py-1.5 font-mono text-sm font-medium text-white transition-opacity hover:opacity-90">
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
    <div className="rounded-md border border-line-strong bg-surface p-3.5 shadow-sm">
      <div className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`mt-1 font-mono text-sm font-semibold tabular-nums ${highlight ? "text-blueprint" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
      {label}
      {children}
    </label>
  );
}
