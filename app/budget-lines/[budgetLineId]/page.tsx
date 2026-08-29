import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { budgetLines, costCodes, contracts, counterparties, contractRollup, phases } from "@/lib/db/schema";
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
    .select({
      code: costCodes.code,
      description: costCodes.description,
      projectId: phases.projectId,
    })
    .from(budgetLines)
    .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
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
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Link
          href={`/projects/${line?.projectId}/budget`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-blueprint hover:underline"
        >
          &larr; Volver a Control Presupuestal
        </Link>

        <div className="mt-4 text-sm text-ink-soft">Budget Line</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
          {line?.code} · {line?.description}
        </h1>

        <h2 className="mt-8 text-sm font-medium text-ink-soft">Contratos</h2>
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
                <div className="text-right text-sm">
                  <div className="font-medium tabular-nums text-ink">{formatMoney(c.current)}</div>
                  <div className="tabular-nums text-ink-faint">pagado {formatMoney(c.paid)}</div>
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
      </main>
    </>
  );
}
