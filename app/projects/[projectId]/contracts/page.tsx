import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { contracts, counterparties, contractRollup, budgetLines, costCodes, phases, projects } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { StatusBadge } from "@/components/StatusBadge";
import { createContract } from "@/lib/actions/contracts";
import { getDevOrgId } from "@/lib/auth/devUser";

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

  const budgetLineOptions = await db
    .select({ id: budgetLines.id, code: costCodes.code, description: costCodes.description })
    .from(budgetLines)
    .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .where(eq(phases.projectId, projectId))
    .orderBy(costCodes.code);

  const orgId = await getDevOrgId();
  const counterpartyOptions = await db
    .select({ name: counterparties.name })
    .from(counterparties)
    .where(eq(counterparties.organizationId, orgId));

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
              Sin contratos todavía.
            </li>
          )}
        </ul>

        <h2 className="mt-10 text-sm font-medium text-ink-soft">+ Nuevo contrato</h2>
        <form
          action={createContract}
          className="mt-3 flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface p-5 shadow-sm"
        >
          <Field label="Partida">
            <select
              name="budgetLineId"
              required
              className="w-56 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
            >
              <option value="">Selecciona una partida…</option>
              {budgetLineOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.description}
                </option>
              ))}
            </select>
          </Field>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-soft">
      {label}
      {children}
    </label>
  );
}
