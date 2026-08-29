import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { budgetLines, costCodes, contracts, counterparties, contractRollup } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";

// Pantalla 7 — Budget Line Detail.
export const dynamic = "force-dynamic"; // live financial data — never prerendered at build time

export default async function BudgetLineDetailPage({
  params,
}: {
  params: Promise<{ budgetLineId: string }>;
}) {
  const { budgetLineId } = await params;

  const [line] = await db
    .select({ code: costCodes.code, description: costCodes.description })
    .from(budgetLines)
    .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
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

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="font-mono text-xs uppercase tracking-wide text-ink-faint">Budget Line</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
          {line?.code} · {line?.description}
        </h1>

        <h2 className="mt-8 font-mono text-xs uppercase tracking-wide text-ink-faint">Contratos</h2>
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-md border border-line-strong bg-surface shadow-sm">
          {contractRows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/contracts/${c.id}`}
                className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-paper"
              >
                <div>
                  <div className="font-medium text-ink">{c.counterpartyName}</div>
                  <div className="mt-0.5 text-xs text-ink-soft">{c.scope}</div>
                </div>
                <div className="text-right font-mono text-xs text-ink-soft">
                  <div>{formatMoney(c.current)}</div>
                  <div className="text-ink-faint">pagado {formatMoney(c.paid)}</div>
                </div>
              </Link>
            </li>
          ))}
          {contractRows.length === 0 && (
            <li className="px-5 py-10 text-center text-sm text-ink-soft">Sin contratos en esta partida todavía.</li>
          )}
        </ul>
      </main>
    </>
  );
}
