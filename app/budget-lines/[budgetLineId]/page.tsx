import Link from "next/link";
import { and, desc, eq, like, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  budgetLines,
  costCodes,
  contracts,
  counterparties,
  contractRollup,
  phases,
  budgetLineRollup,
  budgetChanges,
  approvalRequests,
} from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { correctOriginalAmount, setInitialBudget } from "@/lib/actions/budgetSetup";
import { createContract } from "@/lib/actions/contracts";
import { createBudgetChange, decideBudgetChange } from "@/lib/actions/budgetChanges";
import { extractGroupId, stripGroupTag } from "@/lib/budgetChanges/groupTag";
import { getDevOrgId } from "@/lib/auth/devUser";

// Pantalla 7 — Budget Line Detail. El presupuesto original se define una
// vez; a partir de ahí "Current" sólo se mueve vía Aditivas/Rebalanceos
// aprobados (budget_line_rollup: original + budget_changes aprobados).
// Los contratos que des de alta abajo son lo que empieza a "consumir"
// ese Current (Committed), y sus facturas pagadas lo que consume el
// Actual — el ciclo completo Budget → Contract → Invoice.
export const dynamic = "force-dynamic";

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
      original: budgetLineRollup.originalAmount,
      current: budgetLineRollup.currentAmount,
      committed: budgetLineRollup.committedAmount,
      actual: budgetLineRollup.actualCost,
      forecastRemaining: budgetLineRollup.forecastToCompleteNaive,
    })
    .from(budgetLines)
    .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .leftJoin(budgetLineRollup, eq(budgetLineRollup.budgetLineId, budgetLines.id))
    .where(eq(budgetLines.id, budgetLineId));

  if (!line) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-6xl px-6 py-12 text-ink-soft">Partida no encontrada.</main>
      </>
    );
  }

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

  const orgId = await getDevOrgId();
  const counterpartyOptions = await db
    .select({ name: counterparties.name })
    .from(counterparties)
    .where(eq(counterparties.organizationId, orgId));

  const changeRows = await db
    .select({
      id: budgetChanges.id,
      amount: budgetChanges.amount,
      reason: budgetChanges.reason,
      approvedAt: budgetChanges.approvedAt,
      requiredRole: approvalRequests.requiredRole,
      status: approvalRequests.status,
    })
    .from(budgetChanges)
    .leftJoin(
      approvalRequests,
      and(eq(approvalRequests.entityType, "budget_change"), eq(approvalRequests.entityId, budgetChanges.id))
    )
    .where(eq(budgetChanges.budgetLineId, budgetLineId))
    .orderBy(desc(budgetChanges.createdAt));

  // Para un rebalanceo (dos filas atadas por un tag de grupo, ver
  // lib/actions/budgetChanges.ts) buscamos la partida del otro lado del
  // movimiento nada más para mostrarla — no afecta el cálculo.
  const changeDisplayRows = await Promise.all(
    changeRows.map(async (c) => {
      const groupId = extractGroupId(c.reason);
      if (!groupId) return { ...c, reason: c.reason, counterpartCode: null as string | null };
      const [sibling] = await db
        .select({ code: costCodes.code })
        .from(budgetChanges)
        .innerJoin(budgetLines, eq(budgetLines.id, budgetChanges.budgetLineId))
        .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
        .where(and(like(budgetChanges.reason, `%[grp:${groupId}]%`), ne(budgetChanges.id, c.id)));
      return { ...c, reason: stripGroupTag(c.reason), counterpartCode: sibling?.code ?? null };
    })
  );

  const otherLines = await db
    .select({ id: budgetLines.id, code: costCodes.code, description: costCodes.description })
    .from(budgetLines)
    .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
    .innerJoin(phases, eq(phases.id, budgetLines.phaseId))
    .where(and(eq(phases.projectId, line.projectId), ne(budgetLines.id, budgetLineId)))
    .orderBy(costCodes.code);

  const original = Number(line.original ?? 0);
  const current = Number(line.current ?? 0);
  const committed = Number(line.committed ?? 0);
  const actual = Number(line.actual ?? 0);
  const disponible = current - committed;
  // Nada comprometido ni pagado todavía -> capturar/editar el original es
  // seguro, no una excepción. En cuanto hay Committed o Actual, cambiar
  // el original se vuelve riesgoso y pasa al flujo con warning de abajo.
  const hasActivity = committed > 0 || actual > 0;

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <Link
          href={`/projects/${line.projectId}/budget`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-blueprint hover:underline"
        >
          &larr; Volver a Control Presupuestal
        </Link>

        <div className="mt-4 text-sm text-ink-soft">Budget Line</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
          {line.code} · {line.description}
        </h1>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Original" value={formatMoney(original)} />
          <Stat label="Current" value={formatMoney(current)} />
          <Stat label="Committed" value={formatMoney(committed)} />
          <Stat label="Disponible" value={formatMoney(disponible)} tone={disponible < 0 ? "bad" : "good"} />
        </div>

        {!hasActivity ? (
          <div className="mt-4 rounded-xl border border-line bg-surface p-4 shadow-sm">
            {original === 0 && (
              <p className="text-sm font-medium text-ink">Esta partida no tiene presupuesto capturado todavía.</p>
            )}
            <form action={setInitialBudget} className="mt-2 flex flex-wrap items-end gap-3">
              <input type="hidden" name="budgetLineId" value={budgetLineId} />
              <Field label={original === 0 ? "Presupuesto de esta partida" : "Nuevo monto original"}>
                <input
                  type="number"
                  name="originalAmount"
                  required
                  min={0}
                  step="0.01"
                  defaultValue={original}
                  className="w-48 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
                />
              </Field>
              <button className="rounded-lg bg-blueprint px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
                Guardar
              </button>
            </form>
            <p className="mt-2 max-w-lg text-xs text-ink-faint">
              Todavía no hay nada comprometido ni pagado contra esta partida, así que puedes ajustar este
              número libremente. En cuanto haya un contrato o una factura, esto pasa a protegerse.
            </p>
          </div>
        ) : (
          <details className="mt-4 group">
            <summary className="cursor-pointer text-sm font-medium text-ink-faint hover:text-ink-soft">
              Revisar presupuesto original (excepción)
            </summary>
            <div className="mt-3 rounded-xl border border-warning/40 bg-warning-soft p-4">
              <p className="text-sm font-medium text-warning">
                ⚠ Esto no es el proceso normal para actualizar el presupuesto.
              </p>
              <p className="mt-1 text-sm text-warning/90">
                El presupuesto original no debe moverse una vez dado de alta — para eso están las Aditivas
                y Rebalanceos de abajo, que sí quedan en el historial y pasan por aprobación. Usa esto
                únicamente para corregir un error de captura (p.ej. te equivocaste de cifra al dar de alta
                esta partida).
              </p>
              <form action={correctOriginalAmount} className="mt-4 flex flex-wrap items-end gap-3">
                <input type="hidden" name="budgetLineId" value={budgetLineId} />
                <Field label="Nuevo monto original">
                  <input
                    type="number"
                    name="originalAmount"
                    required
                    min={0}
                    step="0.01"
                    defaultValue={original}
                    className="w-48 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
                  />
                </Field>
                <Field label="Motivo de la corrección">
                  <input
                    name="reason"
                    required
                    placeholder="ej. Error de captura al dar de alta"
                    className="w-64 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
                  />
                </Field>
                <button className="rounded-lg bg-warning px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
                  Corregir de todas formas
                </button>
              </form>
            </div>
          </details>
        )}

        <h2 className="mt-10 text-sm font-medium text-ink-soft">Cambios de presupuesto</h2>
        <ul className="mt-3 grid gap-3">
          {changeDisplayRows.map((c) => {
            const amount = Number(c.amount);
            return (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-5 shadow-sm"
              >
                <div>
                  <div className="font-medium text-ink">
                    {c.reason}
                    {c.counterpartCode && (
                      <span className="ml-2 text-xs font-normal text-ink-faint">
                        {amount >= 0 ? "← desde" : "→ hacia"} {c.counterpartCode}
                      </span>
                    )}
                  </div>
                  <div className={`mt-0.5 text-sm tabular-nums ${amount >= 0 ? "text-success" : "text-redline"}`}>
                    {amount >= 0 ? "+" : ""}
                    {formatMoney(amount)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {c.status === "pending" && c.requiredRole && (
                    <span className="text-xs text-ink-faint">Requiere: {c.requiredRole.replace(/_/g, " ")}</span>
                  )}
                  <StatusBadge status={c.status ?? "pending"} />
                  {c.status === "pending" && (
                    <div className="flex items-center gap-2">
                      <form action={decideBudgetChange}>
                        <input type="hidden" name="budgetChangeId" value={c.id} />
                        <input type="hidden" name="decision" value="approved" />
                        <button className="rounded-lg bg-blueprint px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90">
                          Aprobar
                        </button>
                      </form>
                      <form action={decideBudgetChange}>
                        <input type="hidden" name="budgetChangeId" value={c.id} />
                        <input type="hidden" name="decision" value="rejected" />
                        <button className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-paper">
                          Rechazar
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {changeDisplayRows.length === 0 && (
            <li className="rounded-xl border border-dashed border-line-strong p-10 text-center text-sm text-ink-soft">
              Sin cambios de presupuesto todavía.
            </li>
          )}
        </ul>

        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <form
            action={createBudgetChange}
            className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-sm"
          >
            <div className="text-sm font-medium text-ink">+ Aditiva</div>
            <input type="hidden" name="type" value="aditiva" />
            <input type="hidden" name="budgetLineId" value={budgetLineId} />
            <Field label="Monto adicional">
              <input type="number" name="amount" required min={0} step="0.01" className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
            </Field>
            <Field label="Motivo">
              <input name="reason" required placeholder="ej. Alza de precio de acero" className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
            </Field>
            <button className="mt-1 rounded-lg bg-blueprint px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
              Solicitar aditiva
            </button>
            <p className="text-xs text-ink-faint">Sube el presupuesto total del proyecto en esta partida.</p>
          </form>

          <form
            action={createBudgetChange}
            className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-sm"
          >
            <div className="text-sm font-medium text-ink">+ Rebalanceo</div>
            <input type="hidden" name="type" value="rebalanceo" />
            <input type="hidden" name="budgetLineId" value={budgetLineId} />
            <Field label="Mover hacia">
              <select name="destinationBudgetLineId" required className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink">
                <option value="">Selecciona una partida…</option>
                {otherLines.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.code} — {o.description}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Monto a mover">
              <input type="number" name="amount" required min={0} step="0.01" className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
            </Field>
            <Field label="Motivo">
              <input name="reason" required placeholder="ej. Ahorro en cimentación" className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
            </Field>
            <button className="mt-1 rounded-lg bg-blueprint px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
              Solicitar rebalanceo
            </button>
            <p className="text-xs text-ink-faint">No cambia el total del proyecto — sólo mueve monto entre partidas.</p>
          </form>
        </div>
        <p className="mt-2 max-w-xl text-xs text-ink-faint">
          Ambas pasan por Approval Authorities (§4.7) y sólo se reflejan en Current una vez aprobadas — un
          rebalanceo aprueba/rechaza sus dos lados juntos, nunca uno sin el otro.
        </p>

        <h2 className="mt-10 text-sm font-medium text-ink-soft">Contratos</h2>
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
          {contractRows.length === 0 && (
            <li className="rounded-xl border border-dashed border-line-strong p-10 text-center text-sm text-ink-soft">
              Sin contratos en esta partida todavía.
            </li>
          )}
        </ul>

        <h2 className="mt-10 text-sm font-medium text-ink-soft">+ Nuevo contrato</h2>
        <form
          action={createContract}
          className="mt-3 flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface p-5 shadow-sm"
        >
          <input type="hidden" name="budgetLineId" value={budgetLineId} />
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="text-xs text-ink-soft">{label}</div>
      <div
        className={`mt-1 text-lg font-semibold tabular-nums ${
          tone === "bad" ? "text-redline" : tone === "good" ? "text-success" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
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
