import Link from "next/link";
import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projects, scenarios, scenarioAssumptions } from "@/lib/db/schema";
import { formatMoney } from "@/lib/format";
import { AppHeader } from "@/components/AppHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { evaluateScenario, assumptionsFromRows, type ScenarioAssumptions } from "@/lib/deal/scenarioModel";
import { createScenario, updateScenario, deleteScenario, approveDeal } from "@/lib/actions/deal";

// Pantalla 3, pasos 4-5 (§3.3, §7.1, decisión 8·01) — "Assumptions" +
// "Scenarios": el workspace de un Deal en status='deal'. Sin Team
// (paso 7 — pantalla 4, Project Team & Permisos, no construida) y sin
// paso Capital separado (leverage vive dentro de los supuestos de cada
// Scenario — un checkbox, no un paso de wizard aparte). Wireframe C —
// wizard + comparación de escenarios, aquí como tarjetas lado a lado en
// vez de una tabla ancha (más simple de hacer responsive sin JS).
export const dynamic = "force-dynamic";

export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { projectId } = await params;
  const { from } = await searchParams;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-6xl px-6 py-12 text-ink-soft">Proyecto no encontrado.</main>
      </>
    );
  }

  if (project.status !== "deal") {
    return (
      <>
        <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
        <main className="mx-auto max-w-2xl px-6 py-12">
          <p className="rounded-xl border border-line bg-surface p-6 text-sm text-ink-soft">
            Este proyecto ya fue aprobado (status: <StatusBadge status={project.status} />) — los
            Scenarios ya no son editables (§3.3).{" "}
            <Link href={`/projects/${projectId}`} className="text-blueprint hover:underline">
              Ir al Dashboard →
            </Link>
          </p>
        </main>
      </>
    );
  }

  const scenarioRows = await db.select().from(scenarios).where(eq(scenarios.projectId, projectId)).orderBy(asc(scenarios.createdAt));
  const assumptionRows = await db.select().from(scenarioAssumptions);

  const scenarioList = scenarioRows.map((s) => {
    const rows = assumptionRows.filter((r) => r.scenarioId === s.id);
    const assumptions = assumptionsFromRows(rows);
    const result = evaluateScenario(assumptions);
    return { scenario: s, assumptions, result };
  });

  const sourceForDuplicate = from ? scenarioList.find((s) => s.scenario.id === from) : undefined;
  const prefill: (ScenarioAssumptions & { name: string }) | undefined = sourceForDuplicate
    ? { ...sourceForDuplicate.assumptions, name: `${sourceForDuplicate.scenario.name} (copia)` }
    : undefined;

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-ink-soft">Deal / Underwriting</div>
            <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>
            <p className="mt-1 text-xs text-ink-soft capitalize">
              {project.strategy} · {project.currency} · {project.market}
              {project.location ? ` · ${project.location}` : ""}
            </p>
          </div>
          <StatusBadge status={project.status} />
        </div>

        <p className="mt-4 max-w-2xl text-sm text-ink-soft">
          Mueve los supuestos de cada Scenario y compara — nada de esto es definitivo hasta que
          apruebes uno. Al aprobar, ese Scenario se congela como Baseline y el proyecto pasa a activo;
          los demás quedan archivados (solo lectura, referencia histórica del UW).
        </p>

        {scenarioList.length === 0 ? (
          <p className="mt-8 text-sm text-ink-soft">Todavía no hay ningún Scenario — crea el primero abajo.</p>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {scenarioList.map(({ scenario, assumptions, result }) => (
              <ScenarioCard key={scenario.id} projectId={projectId} scenario={scenario} assumptions={assumptions} result={result} />
            ))}
          </div>
        )}

        <h2 className="mt-10 font-display text-lg font-semibold text-ink">
          {prefill ? `+ Duplicar "${sourceForDuplicate!.scenario.name}"` : "+ Nuevo Scenario"}
        </h2>
        {prefill && (
          <p className="mt-1 text-xs text-ink-faint">
            Copiando los supuestos de <strong className="text-ink">{sourceForDuplicate!.scenario.name}</strong> — ajusta lo que quieras
            cambiar. <Link href={`/projects/${projectId}/deal`} className="text-blueprint hover:underline">Empezar en blanco</Link>
          </p>
        )}
        <ScenarioForm key={prefill?.name ?? "blank"} action={createScenario} projectId={projectId} defaults={prefill} submitLabel="Crear Scenario" />
      </main>
    </>
  );
}

function ScenarioCard({
  projectId,
  scenario,
  assumptions,
  result,
}: {
  projectId: string;
  scenario: { id: string; name: string };
  assumptions: ScenarioAssumptions;
  result: ReturnType<typeof evaluateScenario>;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-line bg-surface p-5 shadow-sm">
      <h3 className="font-display text-lg font-semibold text-ink">{scenario.name}</h3>

      <dl className="mt-3 space-y-1.5 text-sm">
        <Row label="IRR Unlevered" value={fmtPct(result.unleveredIrr)} />
        {assumptions.leveraged && <Row label="IRR Levered" value={fmtPct(result.leveredIrr)} />}
        <Row label={`NPV @ ${(0.15 * 100).toFixed(0)}%`} value={formatMoney(result.npv)} />
        <Row label="MOIC" value={fmtX(result.moic)} />
        <Row label="Profit Margin" value={fmtPct(result.profitMargin)} />
        <Row label="Equity Required" value={formatMoney(result.equityRequired)} />
        <Row label="Total Revenue" value={formatMoney(result.totalRevenue)} />
        <Row label="Total Cost" value={formatMoney(result.totalCost)} />
      </dl>

      <p className="mt-3 text-xs text-ink-faint">
        ${assumptions.pricePerM2.toLocaleString("es-MX")}/m² · {assumptions.totalAreaM2.toLocaleString("es-MX")} m² ·{" "}
        {(assumptions.constructionCostPct * 100).toFixed(0)}% costo · {assumptions.horizonMonths} meses
        {assumptions.leveraged ? ` · LTC ${((assumptions.ltc ?? 0) * 100).toFixed(0)}% @ ${((assumptions.interestRateBps ?? 0) / 100).toFixed(1)}%` : " · sin apalancar"}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
        <details className="w-full">
          <summary className="cursor-pointer font-medium text-blueprint">Editar supuestos</summary>
          <ScenarioForm action={updateScenario} projectId={projectId} scenarioId={scenario.id} defaults={{ ...assumptions, name: scenario.name }} submitLabel="Guardar" compact />
        </details>
        <Link href={`/projects/${projectId}/deal?from=${scenario.id}`} className="text-blueprint hover:underline">
          Duplicar
        </Link>
        <form action={deleteScenario}>
          <input type="hidden" name="scenarioId" value={scenario.id} />
          <input type="hidden" name="projectId" value={projectId} />
          <button className="text-redline hover:underline">Eliminar</button>
        </form>
      </div>

      <form action={approveDeal} className="mt-4 border-t border-line pt-4">
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="scenarioId" value={scenario.id} />
        <button className="w-full rounded-lg bg-blueprint px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
          Aprobar Deal con este Scenario →
        </button>
      </form>
    </div>
  );
}

function ScenarioForm({
  action,
  projectId,
  scenarioId,
  defaults,
  submitLabel,
  compact,
}: {
  action: (formData: FormData) => void | Promise<void>;
  projectId: string;
  scenarioId?: string;
  defaults?: ScenarioAssumptions & { name: string };
  submitLabel: string;
  compact?: boolean;
}) {
  return (
    <form
      action={action}
      className={`flex flex-wrap items-end gap-3 rounded-lg border border-line-strong bg-paper p-3 ${compact ? "mt-2" : "mt-4"}`}
    >
      <input type="hidden" name="projectId" value={projectId} />
      {scenarioId && <input type="hidden" name="scenarioId" value={scenarioId} />}

      <FormField label="Nombre">
        <input name="name" required defaultValue={defaults?.name} placeholder="Base" className="w-32 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink" />
      </FormField>
      <FormField label="Precio/m²">
        <input type="number" step="0.01" name="pricePerM2" required defaultValue={defaults?.pricePerM2} className="w-24 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink" />
      </FormField>
      <FormField label="Área total m²">
        <input type="number" step="0.01" name="totalAreaM2" required defaultValue={defaults?.totalAreaM2} className="w-24 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink" />
      </FormField>
      <FormField label="Costo (% de ingreso)">
        <input type="number" step="0.1" name="constructionCostPercent" required defaultValue={defaults ? defaults.constructionCostPct * 100 : undefined} className="w-20 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink" />
      </FormField>
      <FormField label="Horizonte (meses)">
        <input type="number" name="horizonMonths" required defaultValue={defaults?.horizonMonths} className="w-20 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink" />
      </FormField>
      <FormField label="Apalancado">
        <input type="checkbox" name="leveraged" defaultChecked={defaults?.leveraged} className="h-4 w-4" />
      </FormField>
      <FormField label="LTC %">
        <input type="number" step="1" name="ltcPercent" defaultValue={defaults?.ltc !== undefined ? defaults.ltc * 100 : undefined} placeholder="60" className="w-16 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink" />
      </FormField>
      <FormField label="Tasa anual %">
        <input type="number" step="0.1" name="interestRatePercent" defaultValue={defaults?.interestRateBps !== undefined ? defaults.interestRateBps / 100 : undefined} placeholder="12" className="w-16 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink" />
      </FormField>

      <button className="rounded-lg bg-blueprint px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90">
        {submitLabel}
      </button>
    </form>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-medium text-ink-soft">
      {label}
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="font-medium tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function fmtPct(v: number | null): string {
  return v === null ? "N/A" : `${(v * 100).toFixed(1)}%`;
}

function fmtX(v: number | null): string {
  return v === null ? "N/A" : `${v.toFixed(2)}x`;
}
