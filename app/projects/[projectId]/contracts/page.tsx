import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contracts, counterparties, contractRollup, budgetLines, costCodes, phases, projects } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { StatusBadge } from "@/components/StatusBadge";

// Pantalla 8 — Contracts (lista). Antes de esto, la única forma de ver
// un contrato era entrar primero a su partida en Control Presupuestal;
// esto junta todos los contratos del proyecto, sin importar en qué
// partida viven, en una sola vista.
export const dynamic = "force-dynamic";

export default async function ProjectContractsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));

  const rows = await db
    .select({
      id: contracts.id,
      scope: contracts.scope,
      status: contracts.status,
      counterpartyName: counterparties.name,
      costCode: costCodes.code,
      costCodeDescription: costCodes.description,
      current: contractRollup.currentAmount,
      paid: contractRollup.paidAmount,
      pending: contractRollup.pendingInvoices,
    })
    .from(contracts)
    .innerJoin(counterparties, eq(counterparties.id, contracts.counterpartyId))
    .innerJoin(budgetLines, eq(budgetLines.id, contracts.budgetLineId))
    .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .leftJoin(contractRollup, eq(contractRollup.contractId, contracts.id))
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
      <ProjectNav projectId={projectId} active="contracts" />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="text-sm text-ink-soft">Contratos</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>

        <ul className="mt-6 grid gap-3">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={`/contracts/${c.id}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <div>
                  <div className="font-medium text-ink">{c.counterpartyName}</div>
                  <div className="mt-0.5 text-sm text-ink-soft">{c.scope}</div>
                  <div className="mt-1 text-xs text-ink-faint">
                    {c.costCode} · {c.costCodeDescription}
                  </div>
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
          {rows.length === 0 && (
            <li className="rounded-xl border border-dashed border-line-strong p-10 text-center text-sm text-ink-soft">
              Sin contratos todavía — se dan de alta desde el detalle de cada partida en Control
              Presupuestal.
            </li>
          )}
        </ul>
      </main>
    </>
  );
}
