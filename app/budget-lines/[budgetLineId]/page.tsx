import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { budgetLines, costCodes, contracts, counterparties, contractRollup } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";

// Pantalla 7 — Budget Line Detail.
export const dynamic = "force-dynamic"; // live financial data — never prerendered at build time

export default async function BudgetLineDetailPage({
  params,
}: {
  params: Promise<{ budgetLineId: string }>;
}) {
  const { budgetLineId } = await params;

  const [line] = await db
    .select({ code: costCodes.code, description: costCodes.description, projectPhaseId: budgetLines.phaseId })
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
    <main className="mx-auto max-w-3xl p-8">
      <Link href="javascript:history.back()" className="text-sm text-blueprint">
        &larr; Volver al Budget
      </Link>
      <h1 className="mt-2 font-display text-2xl font-semibold text-ink">
        {line?.code} &middot; {line?.description}
      </h1>

      <h2 className="mt-6 font-mono text-xs uppercase tracking-wide text-ink-soft">Contratos</h2>
      <ul className="mt-2 divide-y divide-line rounded border border-line bg-white">
        {contractRows.map((c) => (
          <li key={c.id}>
            <Link href={`/contracts/${c.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-paper">
              <span>
                {c.counterpartyName} &middot; {c.scope}
              </span>
              <span className="font-mono text-xs text-ink-soft">
                {formatMoney(c.current)} · pagado {formatMoney(c.paid)}
              </span>
            </Link>
          </li>
        ))}
        {contractRows.length === 0 && (
          <li className="px-4 py-6 text-sm text-ink-soft">Sin contratos en esta partida todavía.</li>
        )}
      </ul>
    </main>
  );
}
