import { Fragment } from "react";
import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { budgetLines, costCodes, phases, projects } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { FormattedNumberField } from "@/components/FormattedNumberInput";
import { saveBudgetBaseline } from "@/lib/actions/budgetSetup";

// La única pantalla donde se captura o corrige el presupuesto base —
// "esto solo se debe poder hacer desde Control Presupuestal, no las
// páginas de partida individual". Una sola tabla, todas las partidas,
// un solo guardado. Primera vez (ninguna hoja con original > 0):
// "Dar de alta presupuesto", sin warning. Ya hay algo capturado:
// "Modificar presupuesto base" — mismo warning que existía antes en
// Budget Line Detail, ahora centralizado aquí.
export const dynamic = "force-dynamic";

interface Row {
  budgetLineId: string;
  costCodeId: string;
  code: string;
  description: string;
  parentCostCodeId: string | null;
  original: number;
}

interface Group {
  code: string;
  description: string;
  ownRow: Row | null;
  children: Row[];
}

export default async function BudgetSetupPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));

  const leafRows: Row[] = (
    await db
      .select({
        budgetLineId: budgetLines.id,
        costCodeId: costCodes.id,
        code: costCodes.code,
        description: costCodes.description,
        parentCostCodeId: costCodes.parentCostCodeId,
        original: budgetLines.originalAmount,
      })
      .from(budgetLines)
      .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
      .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
      .where(eq(phases.projectId, projectId))
      .orderBy(costCodes.code)
  ).map((r) => ({ ...r, original: Number(r.original ?? 0) }));

  const parentIds = [...new Set(leafRows.map((r) => r.parentCostCodeId).filter((id): id is string => !!id))];
  const parentCodes = parentIds.length > 0 ? await db.select().from(costCodes).where(inArray(costCodes.id, parentIds)) : [];

  const groups = new Map<string, Group>();
  for (const r of leafRows) {
    const topId = r.parentCostCodeId ?? r.costCodeId;
    if (!groups.has(topId)) {
      if (r.parentCostCodeId) {
        const parent = parentCodes.find((p) => p.id === r.parentCostCodeId)!;
        groups.set(topId, { code: parent.code, description: parent.description, ownRow: null, children: [] });
      } else {
        groups.set(topId, { code: r.code, description: r.description, ownRow: r, children: [] });
      }
    }
    if (r.parentCostCodeId) groups.get(topId)!.children.push(r);
  }

  const sortedGroups = [...groups.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  for (const g of sortedGroups) g.children.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  const isModify = leafRows.some((r) => r.original > 0);

  if (leafRows.length === 0) {
    return (
      <>
        <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
        <main className="mx-auto max-w-6xl px-6 py-12 text-ink-soft">
          Este proyecto todavía no tiene partidas — usa el catálogo estándar o personaliza las tuyas
          primero en{" "}
          <Link href={`/projects/${projectId}/budget`} className="text-blueprint hover:underline">
            Control Presupuestal
          </Link>
          .
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <Link
          href={`/projects/${projectId}/budget`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-blueprint hover:underline"
        >
          &larr; Volver a Control Presupuestal
        </Link>

        <div className="mt-4 text-sm text-ink-soft">{project?.name}</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
          {isModify ? "Modificar presupuesto base" : "Dar de alta presupuesto"}
        </h1>

        {isModify && (
          <div className="mt-4 rounded-xl border border-warning/40 bg-warning-soft p-4">
            <p className="text-sm font-medium text-warning">
              ⚠ Esto no es el proceso normal para actualizar el presupuesto.
            </p>
            <p className="mt-1 text-sm text-warning/90">
              El presupuesto base no debe moverse una vez dado de alta — para eso están las Aditivas y
              Rebalanceos de cada partida, que sí quedan en el historial y pasan por aprobación. Usa esto
              únicamente para corregir un error de captura general (p.ej. te equivocaste de cifras al dar
              de alta el presupuesto).
            </p>
          </div>
        )}

        <form action={saveBudgetBaseline} className="mt-6">
          <input type="hidden" name="projectId" value={projectId} />

          {isModify && (
            <div className="mb-4 max-w-md">
              <Field label="Motivo de la corrección">
                <input
                  name="reason"
                  required
                  placeholder="ej. Se corrigen montos capturados con error"
                  className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
                />
              </Field>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-line bg-surface-2 text-xs font-medium text-ink-soft">
                <tr>
                  <th className="px-4 py-3 text-left">Code</th>
                  <th className="px-4 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-right">Presupuesto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sortedGroups.map((g) => {
                  const isParent = g.children.length > 0;
                  return (
                    <Fragment key={g.code}>
                      <tr className={isParent ? "bg-surface-2/40" : ""}>
                        <td className="px-4 py-3">
                          <span className="text-xs font-semibold text-ink-soft">{g.code}</span>
                        </td>
                        <td className={`px-4 py-3 ${isParent ? "font-semibold text-ink" : "text-ink"}`}>{g.description}</td>
                        <td className="px-4 py-3 text-right">
                          {isParent ? (
                            <span className="text-xs text-ink-faint">suma de sub-partidas</span>
                          ) : (
                            <FormattedNumberField
                              name={`amount_${g.ownRow!.budgetLineId}`}
                              defaultValue={g.ownRow!.original}
                              className="w-40 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-right text-sm text-ink"
                            />
                          )}
                        </td>
                      </tr>
                      {g.children.map((c) => (
                        <tr key={c.budgetLineId}>
                          <td className="px-4 py-3 pl-9">
                            <span className="text-xs font-semibold text-ink-soft">{c.code}</span>
                          </td>
                          <td className="px-4 py-3 text-ink">{c.description}</td>
                          <td className="px-4 py-3 text-right">
                            <FormattedNumberField
                              name={`amount_${c.budgetLineId}`}
                              defaultValue={c.original}
                              className="w-40 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-right text-sm text-ink"
                            />
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button
            className={`mt-4 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 ${
              isModify ? "bg-warning" : "bg-blueprint"
            }`}
          >
            {isModify ? "Guardar cambios" : "Guardar presupuesto"}
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
