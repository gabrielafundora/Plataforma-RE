import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { portfolios } from "@/lib/db/schema";
import { getDevOrgId } from "@/lib/auth/devUser";
import { AppHeader } from "@/components/AppHeader";
import { createDeal } from "@/lib/actions/deal";

// Pantalla 3, pasos 1-2 (§3.3, decisión 8·01) — "Project" + "Strategy".
// El paso "Asset" no es un paso real: Residential For Sale es el único
// valor posible (decisión 8·04), así que se fija solo. Esto crea el
// proyecto en status='deal' — no en 'active' como antes — y manda al
// workspace de Scenarios (/deal) para el resto del wizard (Assumptions +
// Scenarios), en vez de directo a Budget.
export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const orgId = await getDevOrgId();
  const portfolioOptions = await db.select({ name: portfolios.name }).from(portfolios).where(eq(portfolios.organizationId, orgId));

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="font-display text-2xl font-semibold text-ink">Nuevo Deal</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Arranca en modo Deal/Underwriting — mueve supuestos y compara Scenarios antes de aprobar. Solo
          se vuelve un Project activo (con Budget, Schedule, etc.) cuando apruebas uno.
        </p>

        <form
          action={createDeal}
          className="mt-6 flex flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-sm"
        >
          <Field label="Nombre del proyecto">
            <input
              name="name"
              required
              placeholder="ej. Proyecto Polanco"
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
            />
          </Field>

          <Field label="Portfolio">
            <input
              name="portfolioName"
              required
              list="portfolio-options"
              placeholder="ej. México"
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
            />
            <datalist id="portfolio-options">
              {portfolioOptions.map((p) => (
                <option key={p.name} value={p.name} />
              ))}
            </datalist>
          </Field>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Estrategia">
              <select name="strategy" required className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink">
                <option value="development">Development</option>
                <option value="acquisition">Acquisition</option>
              </select>
            </Field>
            <Field label="Moneda">
              <select name="currency" required className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink">
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </select>
            </Field>
            <Field label="Mercado">
              <select name="market" required className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink">
                <option value="MX">México</option>
                <option value="US">USA</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Ubicación (opcional)">
              <input
                name="location"
                placeholder="ej. Ciudad de México"
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
              />
            </Field>
            <Field label="SPV / entidad tenedora (opcional)">
              <input
                name="spvEntityName"
                placeholder="ej. Polanco Desarrollos SPV S.A. de C.V."
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
              />
            </Field>
          </div>

          <button className="mt-2 rounded-lg bg-blueprint px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Crear Deal →
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
