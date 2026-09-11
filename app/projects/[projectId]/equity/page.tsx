import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { equityInvestors, equityInvestorRollup, equityContributions, projects } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { createEquityInvestor, recordEquityContribution } from "@/lib/actions/capital";

// Capital — lado de Equity (§6). Sin pantalla dedicada en la spec (las
// pantallas 14-15 son del lado de deuda) — este es el mínimo necesario
// para que el motor Equity First (lib/capital/equityFirst.ts, usado en
// /debt) tenga de dónde leer "equity disponible": compromisos de
// inversionistas menos lo ya aportado.
export const dynamic = "force-dynamic";

export default async function ProjectEquityPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));

  if (!project) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-6xl px-6 py-12 text-ink-soft">Proyecto no encontrado.</main>
      </>
    );
  }

  const investors = await db
    .select({
      id: equityInvestors.id,
      name: equityInvestors.name,
      counterpartyId: equityInvestors.counterpartyId,
      commitmentAmount: equityInvestorRollup.commitmentAmount,
      contributedAmount: equityInvestorRollup.contributedAmount,
      remainingCommitment: equityInvestorRollup.remainingCommitment,
    })
    .from(equityInvestors)
    .leftJoin(equityInvestorRollup, eq(equityInvestorRollup.equityInvestorId, equityInvestors.id))
    .where(eq(equityInvestors.projectId, projectId))
    .orderBy(equityInvestors.createdAt);

  const contributionsByInvestor = new Map<string, { periodMonth: string; amount: number }[]>();
  if (investors.length > 0) {
    const rows = await db
      .select({ equityInvestorId: equityContributions.equityInvestorId, periodMonth: equityContributions.periodMonth, amount: equityContributions.amount })
      .from(equityContributions)
      .orderBy(equityContributions.periodMonth);
    for (const r of rows) {
      if (!contributionsByInvestor.has(r.equityInvestorId)) contributionsByInvestor.set(r.equityInvestorId, []);
      contributionsByInvestor.get(r.equityInvestorId)!.push({ periodMonth: r.periodMonth, amount: Number(r.amount) });
    }
  }

  const totalCommitted = investors.reduce((s, i) => s + Number(i.commitmentAmount ?? 0), 0);
  const totalContributed = investors.reduce((s, i) => s + Number(i.contributedAmount ?? 0), 0);
  const totalAvailable = investors.reduce((s, i) => s + Number(i.remainingCommitment ?? i.commitmentAmount ?? 0), 0);

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="equity" />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <div className="text-sm text-ink-soft">Equity</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Comprometido" value={formatMoney(totalCommitted)} />
          <Stat label="Aportado" value={formatMoney(totalContributed)} />
          <Stat label="Disponible por llamar" value={formatMoney(totalAvailable)} />
        </div>

        <ul className="mt-6 grid gap-3">
          {investors.map((inv) => {
            const contributions = contributionsByInvestor.get(inv.id) ?? [];
            return (
              <li key={inv.id} className="rounded-xl border border-line bg-surface p-5 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-ink">
                      {inv.name} {!inv.counterpartyId && <span className="text-xs text-ink-faint">(sponsor propio)</span>}
                    </div>
                    <div className="mt-1 text-xs text-ink-faint">
                      Comprometido {formatMoney(inv.commitmentAmount)} · Aportado {formatMoney(inv.contributedAmount)} · Disponible{" "}
                      {formatMoney(inv.remainingCommitment ?? inv.commitmentAmount)}
                    </div>
                  </div>
                  <form action={recordEquityContribution} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="equityInvestorId" value={inv.id} />
                    <input
                      type="date"
                      name="periodMonth"
                      required
                      defaultValue={new Date().toISOString().slice(0, 10)}
                      className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-xs text-ink"
                    />
                    <input
                      type="number"
                      name="amount"
                      required
                      step="0.01"
                      placeholder="Monto"
                      className="w-32 rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-xs text-ink"
                    />
                    <button className="rounded-lg bg-blueprint px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90">
                      Registrar aportación
                    </button>
                  </form>
                </div>
                {contributions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-ink-faint">
                    {contributions.map((c, i) => (
                      <span key={i}>
                        {c.periodMonth}: {formatMoney(c.amount)}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
          {investors.length === 0 && (
            <li className="rounded-xl border border-dashed border-line-strong p-10 text-center text-sm text-ink-soft">
              Sin inversionistas todavía.
            </li>
          )}
        </ul>

        <h2 className="mt-10 text-sm font-medium text-ink-soft">+ Nuevo inversionista</h2>
        <form
          action={createEquityInvestor}
          className="mt-3 flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface p-5 shadow-sm"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <Field label="Nombre">
            <input name="name" required placeholder="Sponsor / Fondo XYZ" className="w-56 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
          </Field>
          <Field label="Compromiso">
            <input type="number" name="commitmentAmount" required step="0.01" className="w-40 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
          </Field>
          <label className="flex items-center gap-1.5 pb-2 text-xs font-medium text-ink-soft">
            <input type="checkbox" name="isSponsor" value="true" />
            Sponsor propio (sin contraparte externa)
          </label>
          <button className="rounded-lg bg-blueprint px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Crear inversionista
          </button>
        </form>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}
