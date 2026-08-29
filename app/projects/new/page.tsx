import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { portfolios } from "@/lib/db/schema";
import { getDevOrgId } from "@/lib/auth/devUser";
import { AppHeader } from "@/components/AppHeader";
import { createProject } from "@/lib/actions/projects";

// Pantalla 3 (recortada) — Project Setup. El modo Deal/Underwriting
// completo (estado "deal", Scenarios comparables) queda para una
// siguiente vuelta (ver el plan) — este formulario crea el proyecto
// directo como activo, igual que hace `npm run db:seed` hoy.
export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const orgId = await getDevOrgId();
  const portfolioOptions = await db.select({ name: portfolios.name }).from(portfolios).where(eq(portfolios.organizationId, orgId));

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="font-display text-2xl font-semibold text-ink">Nuevo Proyecto</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Por ahora el proyecto se crea directo como activo — el modo Deal/Underwriting con escenarios
          comparables (borrador antes de aprobar) es una siguiente vuelta.
        </p>

        <form
          action={createProject}
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

          <Field label="Ubicación (opcional)">
            <input
              name="location"
              placeholder="ej. Ciudad de México"
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
            />
          </Field>

          <button className="mt-2 rounded-lg bg-blueprint px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Crear proyecto
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
