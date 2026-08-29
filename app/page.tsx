import Link from "next/link";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { AppHeader } from "@/components/AppHeader";

// Every page here reads live financial data — none of them should be
// statically prerendered at build time (which would (a) require a
// reachable DATABASE_URL during the build itself, fragile on Vercel,
// and (b) bake in stale data). Render per request instead.
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  deal: "Deal",
  active: "Active",
  on_hold: "On Hold",
  closed: "Closed",
};

export default async function HomePage() {
  const rows = await db.select().from(projects);

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="font-display text-3xl font-semibold text-ink">Mis Proyectos</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-soft">
          Vertical slice 1 — Costs + Cash Flow Engine. Sin login todavía; corre{" "}
          <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-xs">npm run db:seed</code>{" "}
          si esta lista está vacía.
        </p>

        <ul className="mt-8 divide-y divide-line overflow-hidden rounded-md border border-line-strong bg-surface shadow-sm">
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}/budget`}
                className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-paper"
              >
                <div>
                  <div className="font-display text-base font-medium text-ink">{p.name}</div>
                  <div className="mt-0.5 font-mono text-xs text-ink-faint">
                    {p.assetClass.replace(/_/g, " ")} · {p.currency}
                  </div>
                </div>
                <span className="rounded-full border border-line-strong bg-surface-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wide text-ink-soft">
                  {STATUS_LABEL[p.status] ?? p.status}
                </span>
              </Link>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="px-5 py-10 text-center text-sm text-ink-soft">Sin proyectos todavía.</li>
          )}
        </ul>
      </main>
    </>
  );
}
