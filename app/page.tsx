import Link from "next/link";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";
import { AppHeader } from "@/components/AppHeader";
import { StatusBadge } from "@/components/StatusBadge";

// Every page here reads live financial data — none of them should be
// statically prerendered at build time (which would (a) require a
// reachable DATABASE_URL during the build itself, fragile on Vercel,
// and (b) bake in stale data). Render per request instead.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const rows = await db.select().from(projects);

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <h1 className="font-display text-3xl font-semibold text-ink">Mis Proyectos</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-soft">
          Vertical slice 1 — Costs + Cash Flow Engine. Sin login todavía; corre{" "}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">npm run db:seed</code> si esta
          lista está vacía.
        </p>

        <ul className="mt-8 grid gap-3 sm:grid-cols-2">
          {rows.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="flex items-center justify-between rounded-xl border border-line bg-surface p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <div>
                  <div className="font-display text-lg font-medium text-ink">{p.name}</div>
                  <div className="mt-1 text-sm capitalize text-ink-soft">
                    {p.assetClass.replace(/_/g, " ")} · {p.currency}
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </Link>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="rounded-xl border border-dashed border-line-strong p-10 text-center text-sm text-ink-soft sm:col-span-2">
              Sin proyectos todavía.
            </li>
          )}
        </ul>
      </main>
    </>
  );
}
