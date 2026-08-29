import Link from "next/link";

// Project-level sub-nav (Wireframe B's project nav: Overview/Plan/Costs/
// Revenue/Capital/Business Plan/...). Only tabs for screens that actually
// exist in this slice are shown — no dead links to unbuilt modules.
export function ProjectNav({ projectId, active }: { projectId: string; active: "overview" | "budget" }) {
  const tabs = [
    { key: "overview", label: "Overview", href: `/projects/${projectId}` },
    { key: "budget", label: "Budget", href: `/projects/${projectId}/budget` },
  ] as const;

  return (
    <div className="border-b border-line bg-surface">
      <nav className="mx-auto flex max-w-4xl gap-1 px-6">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
              active === tab.key
                ? "border-blueprint text-blueprint"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
