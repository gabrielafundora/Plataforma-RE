import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { updateProjectDetails, deleteProject } from "@/lib/actions/projects";

// Configuración de proyecto — "no me gusta que Eliminar viva en el
// Dashboard, debería estar en una sección de configuración, como
// habíamos hablado del Project Setup Wizard" (pantalla 3 del roadmap).
// Esto NO es el wizard completo con modo Deal/Underwriting/Scenarios —
// eso sigue diferido (ver lib/actions/projects.ts:createProject) — es
// el lugar donde vive la configuración de un proyecto ya creado:
// sus detalles y, al fondo, la Zona de peligro que antes estaba en el
// Dashboard.
export const dynamic = "force-dynamic";

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
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

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="settings" />
      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="text-sm text-ink-soft">Configuración</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>

        <h2 className="mt-10 text-sm font-medium text-ink-soft">Detalles del proyecto</h2>
        <form
          action={updateProjectDetails}
          className="mt-3 flex flex-col gap-4 rounded-xl border border-line bg-surface p-6 shadow-sm"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <Field label="Nombre del proyecto">
            <input
              name="name"
              required
              defaultValue={project.name}
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
            />
          </Field>

          <div className="grid grid-cols-3 gap-4">
            <Field label="Estrategia">
              <select
                name="strategy"
                required
                defaultValue={project.strategy}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
              >
                <option value="development">Development</option>
                <option value="acquisition">Acquisition</option>
              </select>
            </Field>
            <Field label="Moneda">
              <select
                name="currency"
                required
                defaultValue={project.currency}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
              >
                <option value="MXN">MXN</option>
                <option value="USD">USD</option>
              </select>
            </Field>
            <Field label="Mercado">
              <select
                name="market"
                required
                defaultValue={project.market}
                className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
              >
                <option value="MX">México</option>
                <option value="US">USA</option>
              </select>
            </Field>
          </div>

          <Field label="Ubicación (opcional)">
            <input
              name="location"
              defaultValue={project.location ?? ""}
              className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink"
            />
          </Field>

          <button className="mt-2 self-start rounded-lg bg-blueprint px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Guardar cambios
          </button>
        </form>

        <details className="mt-12 group">
          <summary className="cursor-pointer text-sm font-medium text-redline/70 hover:text-redline">
            Zona de peligro
          </summary>
          <div className="mt-3 rounded-xl border border-redline/40 bg-redline-soft p-4">
            <p className="text-sm font-medium text-redline">⚠ Eliminar este proyecto es irreversible.</p>
            <p className="mt-1 text-sm text-redline/90">
              Se borran todas sus partidas, contratos, change orders, facturas, pagos y cambios de
              presupuesto. No hay forma de recuperarlo después.
            </p>
            <form action={deleteProject} className="mt-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="projectId" value={projectId} />
              <label className="flex flex-col gap-1.5 text-xs font-medium text-redline">
                Escribe &quot;{project.name}&quot; para confirmar
                <input
                  name="confirmName"
                  required
                  placeholder={project.name}
                  className="w-64 rounded-lg border border-redline/40 bg-surface px-3 py-1.5 text-sm text-ink"
                />
              </label>
              <button className="rounded-lg bg-redline px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
                Eliminar proyecto
              </button>
            </form>
          </div>
        </details>
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
