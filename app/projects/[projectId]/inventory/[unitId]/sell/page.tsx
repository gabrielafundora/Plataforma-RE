import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { units } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { registerSale } from "@/lib/actions/revenue";

// "Registrar venta" (pantalla 12) — sub-ruta dedicada en vez de un modal
// o una fila de tabla: el plan de pagos son 5 campos, demasiado para un
// renglón (mismo criterio que /budget/setup es su propia página).
export const dynamic = "force-dynamic";

export default async function SellUnitPage({
  params,
}: {
  params: Promise<{ projectId: string; unitId: string }>;
}) {
  const { projectId, unitId } = await params;

  const [unit] = await db.select().from(units).where(eq(units.id, unitId));

  if (!unit) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-xl px-6 py-12 text-ink-soft">Unidad no encontrada.</main>
      </>
    );
  }

  const listPrice = Number(unit.areaM2) * Number(unit.pricePerM2);

  if (unit.status !== "available") {
    return (
      <>
        <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
        <main className="mx-auto max-w-xl px-6 py-12">
          <Link
            href={`/projects/${projectId}/inventory`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blueprint hover:underline"
          >
            &larr; Volver a Inventario
          </Link>
          <p className="mt-6 text-sm text-ink-soft">
            La unidad <strong className="text-ink">{unit.code}</strong> ya no está disponible (status:{" "}
            {unit.status}).
          </p>
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <main className="mx-auto max-w-xl px-6 py-12">
        <Link
          href={`/projects/${projectId}/inventory`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-blueprint hover:underline"
        >
          &larr; Volver a Inventario
        </Link>

        <div className="mt-4 text-sm text-ink-soft">Registrar venta</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
          {unit.code} · {unit.unitType}
        </h1>
        <p className="mt-1 text-sm text-ink-faint">
          {Number(unit.areaM2).toLocaleString("es-MX")} m² · lista: {formatMoney(listPrice)}
        </p>

        <form action={registerSale} className="mt-6 grid gap-4 rounded-xl border border-line bg-surface p-6 shadow-sm">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="unitId" value={unitId} />

          <Field label="Fecha de venta">
            <input
              type="date"
              name="saleDate"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
            />
          </Field>

          <Field label="Precio total (opcional — vacío usa el precio de lista)">
            <input
              type="number"
              name="priceTotalOverride"
              step="0.01"
              placeholder={String(listPrice)}
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="% enganche">
              <input
                type="number"
                name="downPaymentPercent"
                required
                min={0}
                max={100}
                step="0.1"
                defaultValue={20}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
              />
            </Field>
            <Field label="% escrituración">
              <input
                type="number"
                name="closingPercent"
                required
                min={0}
                max={100}
                step="0.1"
                defaultValue={10}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Mensualidades">
              <input
                type="number"
                name="installmentsCount"
                required
                min={1}
                step={1}
                defaultValue={6}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
              />
            </Field>
            <Field label="Meses hasta escrituración">
              <input
                type="number"
                name="closingOffsetMonths"
                required
                min={1}
                step={1}
                defaultValue={12}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink"
              />
            </Field>
          </div>

          <button className="mt-2 rounded-lg bg-blueprint px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Registrar venta
          </button>
        </form>

        <p className="mt-3 max-w-md text-xs text-ink-faint">
          El resto (100% − enganche − escrituración) se reparte en partes iguales entre las
          mensualidades, empezando un mes después de la fecha de venta. Esto genera el calendario de
          cobranza de la unidad — visible y editable después en Cobranza.
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
