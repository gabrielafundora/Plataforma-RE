import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { units, phases, projects } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { StatusBadge } from "@/components/StatusBadge";
import { FormattedNumberField } from "@/components/FormattedNumberInput";
import { createUnit, updateUnitPrice } from "@/lib/actions/revenue";

// Pantalla 12 — Residential Inventory (§7.1). Lista plana, no jerárquica
// como Budget — las unidades no tienen padre/hijo. "Registrar venta"
// manda a /inventory/[unitId]/sell (sub-ruta dedicada, no modal — son 5
// campos del plan de pagos, mismo criterio que budget/setup).
export const dynamic = "force-dynamic";

// Sugiere el siguiente código disponible a partir de uno existente
// ("A101" -> "A102", saltándose los que ya existen) — solo una
// sugerencia editable, nunca se fuerza: si no hay sufijo numérico que
// incrementar, el campo simplemente queda vacío para que se teclee a mano.
function suggestNextCode(sourceCode: string, existingCodes: Set<string>): string {
  const match = sourceCode.match(/^(.*?)(\d+)$/);
  if (!match) return "";
  const [, prefix, digits] = match;
  let n = parseInt(digits, 10);
  let candidate: string;
  do {
    n += 1;
    candidate = `${prefix}${String(n).padStart(digits.length, "0")}`;
  } while (existingCodes.has(candidate));
  return candidate;
}

export default async function ProjectInventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ duplicate?: string }>;
}) {
  const { projectId } = await params;
  const { duplicate } = await searchParams;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));

  if (!project) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-6xl px-6 py-12 text-ink-soft">Proyecto no encontrado.</main>
      </>
    );
  }

  const rows = (
    await db
      .select({
        id: units.id,
        code: units.code,
        unitType: units.unitType,
        areaM2: units.areaM2,
        pricePerM2: units.pricePerM2,
        status: units.status,
      })
      .from(units)
      .innerJoin(phases, eq(phases.id, units.phaseId))
      .where(eq(phases.projectId, projectId))
      .orderBy(units.code)
  ).map((u) => ({ ...u, areaM2: Number(u.areaM2), pricePerM2: Number(u.pricePerM2) }));

  const soldCount = rows.filter((u) => u.status === "sold").length;

  const sourceUnit = duplicate ? rows.find((u) => u.id === duplicate) : undefined;
  const suggestedCode = sourceUnit ? suggestNextCode(sourceUnit.code, new Set(rows.map((r) => r.code))) : "";

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="inventory" />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="text-sm text-ink-soft">Inventario</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>
        {rows.length > 0 && (
          <p className="mt-1 text-sm text-ink-faint">
            {soldCount} de {rows.length} unidades vendidas
          </p>
        )}

        <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs font-medium text-ink-soft">
              <tr>
                <th className="px-4 py-3 text-left">Unidad</th>
                <th className="px-4 py-3 text-left">Tipo</th>
                <th className="px-4 py-3 text-right">m²</th>
                <th className="px-4 py-3 text-right">Precio/m²</th>
                <th className="px-4 py-3 text-right">Precio total</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-medium text-ink">{u.code}</td>
                  <td className="px-4 py-3 text-ink-soft">{u.unitType}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">{u.areaM2.toLocaleString("es-MX")}</td>
                  <td className="px-4 py-3 text-right">
                    {u.status === "available" ? (
                      <form action={updateUnitPrice} className="flex items-center justify-end gap-2">
                        <input type="hidden" name="unitId" value={u.id} />
                        <FormattedNumberField
                          name="pricePerM2"
                          defaultValue={u.pricePerM2}
                          className="w-28 rounded-lg border border-line-strong bg-surface px-2 py-1 text-right text-sm text-ink"
                        />
                        <button className="rounded-lg border border-line-strong px-2 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-paper">
                          Guardar
                        </button>
                      </form>
                    ) : (
                      <span className="tabular-nums text-ink">{formatMoney(u.pricePerM2)}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink">
                    {formatMoney(u.areaM2 * u.pricePerM2)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={u.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      {u.status === "available" && (
                        <Link
                          href={`/projects/${projectId}/inventory/${u.id}/sell`}
                          className="text-xs font-medium text-blueprint hover:underline"
                        >
                          Registrar venta
                        </Link>
                      )}
                      <Link
                        href={`/projects/${projectId}/inventory?duplicate=${u.id}#nueva-unidad`}
                        className="text-xs font-medium text-ink-soft hover:underline"
                      >
                        Duplicar
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-ink-soft">
                    Sin unidades todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h2 id="nueva-unidad" className="mt-10 text-sm font-medium text-ink-soft">
          + Nueva unidad
        </h2>
        {sourceUnit && (
          <p className="mt-1 text-xs text-ink-faint">
            Copiando tipo/m²/precio de <strong className="text-ink">{sourceUnit.code}</strong> — solo
            falta confirmar el código.{" "}
            <Link href={`/projects/${projectId}/inventory`} className="text-blueprint hover:underline">
              Cancelar
            </Link>
          </p>
        )}
        <form
          key={sourceUnit?.id ?? "blank"}
          action={createUnit}
          className="mt-3 flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface p-5 shadow-sm"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <Field label="Unidad">
            <input
              name="code"
              required
              placeholder="A101"
              defaultValue={suggestedCode}
              autoFocus={!!sourceUnit}
              className="w-28 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
            />
          </Field>
          <Field label="Tipo">
            <input
              name="unitType"
              required
              placeholder="2BR"
              defaultValue={sourceUnit?.unitType}
              className="w-24 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
            />
          </Field>
          <Field label="m²">
            <input
              type="number"
              name="areaM2"
              required
              step="0.01"
              defaultValue={sourceUnit?.areaM2}
              className="w-24 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
            />
          </Field>
          <Field label="Precio/m²">
            <input
              type="number"
              name="pricePerM2"
              required
              step="0.01"
              defaultValue={sourceUnit?.pricePerM2}
              className="w-32 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
            />
          </Field>
          <button className="rounded-lg bg-blueprint px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Crear unidad
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
