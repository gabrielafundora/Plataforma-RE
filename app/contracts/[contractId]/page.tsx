import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contracts, counterparties, contractRollup, invoices } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { createInvoice, markInvoicePaid } from "@/lib/actions/invoices";

// Wireframe G — Detalle con tabs (aquí, solo el tab Financial + Invoices,
// que es lo que este slice necesita probar de punta a punta).
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

  if (!contract) return <main className="p-8">Contrato no encontrado.</main>;

  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href="javascript:history.back()" className="text-sm text-blueprint">
        &larr; Volver
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">
        {contract.counterpartyName}
      </h1>
      <p className="text-sm text-ink-soft">
        {contract.scope} &middot;{" "}
        <span className="rounded-full border border-line px-2 py-0.5 font-mono text-xs uppercase">
          {contract.status}
        </span>
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Original" value={formatMoney(contract.original)} />
        <Stat label="Current" value={formatMoney(contract.current)} />
        <Stat label="Paid" value={formatMoney(contract.paid)} />
        <Stat label="Pending invoices" value={formatMoney(contract.pending)} />
      </div>

      <h2 className="mt-8 font-mono text-xs uppercase tracking-wide text-ink-soft">
        Invoices &amp; Payments
      </h2>
      <ul className="mt-2 divide-y divide-line rounded border border-line bg-white">
        {invoiceRows.map((inv) => (
          <li key={inv.id} className="flex items-center justify-between px-4 py-3">
            <span>
              {inv.invoiceNumber} &middot; {inv.invoiceDate} &middot; {formatMoney(inv.netAmount)}
            </span>
            <span className="flex items-center gap-3">
              <span className="rounded-full border border-line px-2 py-0.5 font-mono text-xs uppercase">
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
                    className="rounded border border-line px-2 py-1 text-xs"
                  />
                  <button className="rounded bg-blueprint px-2 py-1 text-xs font-semibold text-white">
                    Marcar Paid
                  </button>
                </form>
              )}
            </span>
          </li>
        ))}
        {invoiceRows.length === 0 && (
          <li className="px-4 py-6 text-sm text-ink-soft">Sin facturas todavía.</li>
        )}
      </ul>

      <h2 className="mt-8 font-mono text-xs uppercase tracking-wide text-ink-soft">
        + Nueva factura
      </h2>
      <form action={createInvoice} className="mt-2 flex flex-wrap items-end gap-3 rounded border border-line bg-white p-4">
        <input type="hidden" name="contractId" value={contract.id} />
        <Field label="Número">
          <input name="invoiceNumber" required className="w-32 rounded border border-line px-2 py-1 text-sm" />
        </Field>
        <Field label="Fecha">
          <input
            type="date"
            name="invoiceDate"
            required
            defaultValue={new Date().toISOString().slice(0, 10)}
            className="rounded border border-line px-2 py-1 text-sm"
          />
        </Field>
        <Field label="Monto (neto)">
          <input
            type="number"
            name="netAmount"
            required
            step="0.01"
            className="w-40 rounded border border-line px-2 py-1 text-sm"
          />
        </Field>
        <button className="rounded bg-blueprint px-3 py-1.5 text-sm font-semibold text-white">
          Crear factura
        </button>
      </form>
      <p className="mt-2 text-xs text-ink-soft">
        En esta slice la factura se crea directo en estado "approved" — el enrutamiento por umbral
        de aprobación (Approval Authorities, §4.7) se construye en una siguiente slice.
      </p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-white p-3">
      <div className="font-mono text-[10px] uppercase tracking-wide text-ink-soft">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-ink-soft">
      {label}
      {children}
    </label>
  );
}
