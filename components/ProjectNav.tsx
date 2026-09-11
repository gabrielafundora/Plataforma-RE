import Link from "next/link";

// Project-level sub-nav (Wireframe B's project nav: Overview/Plan/Costs/
// Revenue/Capital/Business Plan/...). Only tabs for screens that actually
// exist in this slice are shown — no dead links to unbuilt modules.
//
// Con 12 pestañas, en escritorio sigue siendo la fila horizontal de
// siempre — pero en celular eso nunca cabe bien, ni siquiera
// deslizable (ningún indicio visual de que hay más, y toma muchos
// swipes llegar a "Configuración"). Abajo del breakpoint sm se
// colapsa en un menú tipo hamburguesa (☰ + nombre de la pestaña
// activa), con las pestañas apiladas verticalmente al abrirlo — sin
// JS de cliente, con el truco de checkbox+label oculto (mismo
// espíritu del resto de la app: FormattedNumberInput sigue siendo el
// único componente que sí necesita "use client").
export function ProjectNav({
  projectId,
  active,
}: {
  projectId: string;
  active:
    | "overview"
    | "budget"
    | "forecast"
    | "contracts"
    | "invoices"
    | "inventory"
    | "collections"
    | "debt"
    | "equity"
    | "cashflow"
    | "returns"
    | "settings";
}) {
  const tabs = [
    { key: "overview", label: "Overview", href: `/projects/${projectId}` },
    { key: "budget", label: "Control Presupuestal", href: `/projects/${projectId}/budget` },
    { key: "forecast", label: "Forecast", href: `/projects/${projectId}/forecast` },
    { key: "contracts", label: "Contratos", href: `/projects/${projectId}/contracts` },
    { key: "invoices", label: "Facturas", href: `/projects/${projectId}/invoices` },
    { key: "inventory", label: "Inventario", href: `/projects/${projectId}/inventory` },
    { key: "collections", label: "Cobranza", href: `/projects/${projectId}/collections` },
    { key: "debt", label: "Deuda", href: `/projects/${projectId}/debt` },
    { key: "equity", label: "Equity", href: `/projects/${projectId}/equity` },
    { key: "cashflow", label: "Cash Flow", href: `/projects/${projectId}/cashflow` },
    { key: "returns", label: "Returns", href: `/projects/${projectId}/returns` },
    { key: "settings", label: "Configuración", href: `/projects/${projectId}/settings` },
  ] as const;

  const activeLabel = tabs.find((t) => t.key === active)?.label ?? "Menú";
  const toggleId = `projectnav-toggle-${projectId}`;

  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto max-w-6xl px-6">
        {/* key={active}: fuerza a React a montar un checkbox nuevo (sin
            marcar) cada vez que cambia de pestaña, para que el menú no
            se quede abierto después de navegar. */}
        <input key={active} type="checkbox" id={toggleId} className="peer hidden" />
        <label
          htmlFor={toggleId}
          className="flex cursor-pointer items-center justify-between py-3 text-sm font-medium text-ink sm:hidden"
        >
          <span>☰ {activeLabel}</span>
          <span className="text-ink-faint">▾</span>
        </label>

        <nav className="hidden flex-col peer-checked:flex sm:flex sm:flex-row sm:gap-1 sm:overflow-x-auto">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              className={`block border-l-2 px-3 py-2.5 text-sm font-medium transition-colors sm:inline-block sm:shrink-0 sm:whitespace-nowrap sm:border-b-2 sm:border-l-0 sm:py-3 ${
                active === tab.key
                  ? "border-blueprint bg-blueprint-soft/40 text-blueprint sm:bg-transparent"
                  : "border-transparent text-ink-soft hover:text-ink"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
