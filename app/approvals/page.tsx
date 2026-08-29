import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  approvalRequests,
  changeOrders,
  invoices,
  budgetChanges,
  contracts,
  counterparties,
  budgetLines,
  costCodes,
  phases,
  projects,
} from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { decideChangeOrder } from "@/lib/actions/changeOrders";
import { decideInvoice } from "@/lib/actions/invoices";
import { decideBudgetChange } from "@/lib/actions/budgetChanges";
import { extractGroupId, stripGroupTag } from "@/lib/budgetChanges/groupTag";

// Pantalla 19 — My Approvals. Antes de esto, aprobar algo requería
// encontrar por casualidad la pantalla de detalle correcta (el contrato,
// la partida). Esto junta las tres colas (Change Orders, Invoices,
// Budget Changes) en un solo lugar — reutiliza las mismas tres
// server actions que ya existían, no hay lógica de aprobación nueva.
export const dynamic = "force-dynamic";

interface ApprovalRow {
  id: string;
  entityType: "change_order" | "invoice" | "budget_change";
  amount: number;
  requiredRole: string;
  createdAt: Date;
  title: string;
  subtitle: string;
  projectName: string;
  href: string;
}

export default async function ApprovalsPage() {
  const changeOrderRows = await db
    .select({
      id: changeOrders.id,
      amount: approvalRequests.amount,
      requiredRole: approvalRequests.requiredRole,
      createdAt: approvalRequests.createdAt,
      description: changeOrders.description,
      counterpartyName: counterparties.name,
      contractId: contracts.id,
      projectName: projects.name,
    })
    .from(approvalRequests)
    .innerJoin(changeOrders, eq(changeOrders.id, approvalRequests.entityId))
    .innerJoin(contracts, eq(contracts.id, changeOrders.contractId))
    .innerJoin(counterparties, eq(counterparties.id, contracts.counterpartyId))
    .innerJoin(budgetLines, eq(budgetLines.id, contracts.budgetLineId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .innerJoin(projects, eq(projects.id, phases.projectId))
    .where(and(eq(approvalRequests.entityType, "change_order"), eq(approvalRequests.status, "pending")));

  const invoiceRows = await db
    .select({
      id: invoices.id,
      amount: approvalRequests.amount,
      requiredRole: approvalRequests.requiredRole,
      createdAt: approvalRequests.createdAt,
      invoiceNumber: invoices.invoiceNumber,
      counterpartyName: counterparties.name,
      contractId: contracts.id,
      projectName: projects.name,
    })
    .from(approvalRequests)
    .innerJoin(invoices, eq(invoices.id, approvalRequests.entityId))
    .innerJoin(contracts, eq(contracts.id, invoices.contractId))
    .innerJoin(counterparties, eq(counterparties.id, contracts.counterpartyId))
    .innerJoin(budgetLines, eq(budgetLines.id, contracts.budgetLineId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .innerJoin(projects, eq(projects.id, phases.projectId))
    .where(and(eq(approvalRequests.entityType, "invoice"), eq(approvalRequests.status, "pending")));

  const budgetChangeRows = await db
    .select({
      id: budgetChanges.id,
      amount: approvalRequests.amount,
      requiredRole: approvalRequests.requiredRole,
      createdAt: approvalRequests.createdAt,
      reason: budgetChanges.reason,
      rawAmount: budgetChanges.amount,
      costCode: costCodes.code,
      costCodeDescription: costCodes.description,
      budgetLineId: budgetLines.id,
      projectName: projects.name,
    })
    .from(approvalRequests)
    .innerJoin(budgetChanges, eq(budgetChanges.id, approvalRequests.entityId))
    .innerJoin(budgetLines, eq(budgetLines.id, budgetChanges.budgetLineId))
    .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .innerJoin(projects, eq(projects.id, phases.projectId))
    .where(and(eq(approvalRequests.entityType, "budget_change"), eq(approvalRequests.status, "pending")));

  const rows: ApprovalRow[] = [
    ...changeOrderRows.map((r) => ({
      id: r.id,
      entityType: "change_order" as const,
      amount: Number(r.amount),
      requiredRole: r.requiredRole,
      createdAt: r.createdAt,
      title: `Change Order — ${r.counterpartyName}`,
      subtitle: r.description,
      projectName: r.projectName,
      href: `/contracts/${r.contractId}`,
    })),
    ...invoiceRows.map((r) => ({
      id: r.id,
      entityType: "invoice" as const,
      amount: Number(r.amount),
      requiredRole: r.requiredRole,
      createdAt: r.createdAt,
      title: `Factura ${r.invoiceNumber} — ${r.counterpartyName}`,
      subtitle: "",
      projectName: r.projectName,
      href: `/contracts/${r.contractId}`,
    })),
    ...budgetChangeRows.map((r) => {
      const isRebalanceo = extractGroupId(r.reason) !== null;
      const rawAmount = Number(r.rawAmount);
      return {
        id: r.id,
        entityType: "budget_change" as const,
        amount: rawAmount,
        requiredRole: r.requiredRole,
        createdAt: r.createdAt,
        title: isRebalanceo
          ? `Rebalanceo (${rawAmount >= 0 ? "entra a" : "sale de"} ${r.costCode})`
          : `Aditiva — ${r.costCode}`,
        subtitle: `${stripGroupTag(r.reason)} · ${r.costCodeDescription}`,
        projectName: r.projectName,
        href: `/budget-lines/${r.budgetLineId}`,
      };
    }),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <h1 className="font-display text-2xl font-semibold text-ink">Aprobaciones pendientes</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-soft">
          Change Orders, facturas y cambios de presupuesto que están esperando la aprobación de alguien
          con el rol requerido (§4.7).
        </p>

        <ul className="mt-6 grid gap-3">
          {rows.map((row) => (
            <li
              key={`${row.entityType}-${row.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-5 shadow-sm"
            >
              <div>
                <div className="text-xs text-ink-faint">{row.projectName}</div>
                <Link href={row.href} className="font-medium text-ink hover:text-blueprint hover:underline">
                  {row.title}
                </Link>
                {row.subtitle && <div className="mt-0.5 text-sm text-ink-soft">{row.subtitle}</div>}
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right text-sm">
                  <div className={`font-medium tabular-nums ${row.amount < 0 ? "text-redline" : "text-ink"}`}>
                    {formatMoney(row.amount)}
                  </div>
                  <div className="text-xs text-ink-faint">Requiere: {row.requiredRole.replace(/_/g, " ")}</div>
                </div>
                <DecideForm row={row} />
              </div>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="rounded-xl border border-dashed border-line-strong p-10 text-center text-sm text-ink-soft">
              No hay nada pendiente de aprobación ahorita.
            </li>
          )}
        </ul>
      </main>
    </>
  );
}

function DecideForm({ row }: { row: ApprovalRow }) {
  const config = {
    change_order: { action: decideChangeOrder, field: "changeOrderId" },
    invoice: { action: decideInvoice, field: "invoiceId" },
    budget_change: { action: decideBudgetChange, field: "budgetChangeId" },
  }[row.entityType];

  return (
    <div className="flex items-center gap-2">
      <form action={config.action}>
        <input type="hidden" name={config.field} value={row.id} />
        <input type="hidden" name="decision" value="approved" />
        <button className="rounded-lg bg-blueprint px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90">
          Aprobar
        </button>
      </form>
      <form action={config.action}>
        <input type="hidden" name={config.field} value={row.id} />
        <input type="hidden" name="decision" value="rejected" />
        <button className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-paper">
          Rechazar
        </button>
      </form>
    </div>
  );
}
