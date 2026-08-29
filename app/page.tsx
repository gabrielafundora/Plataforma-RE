import Link from "next/link";
import { db } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";

// Every page here reads live financial data — none of them should be
// statically prerendered at build time (which would (a) require a
// reachable DATABASE_URL during the build itself, fragile on Vercel,
// and (b) bake in stale data). Render per request instead.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const rows = await db.select().from(projects);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="font-display text-2xl font-semibold text-ink">Mis Proyectos</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Slice 1: Costs + Cash Flow Engine. Corre <code>npm run db:seed</code> si esta lista está vacía.
      </p>
      <ul className="mt-6 divide-y divide-line rounded border border-line bg-white">
        {rows.map((p) => (
          <li key={p.id}>
            <Link
              href={`/projects/${p.id}/budget`}
              className="flex items-center justify-between px-4 py-3 hover:bg-paper"
            >
              <span>{p.name}</span>
              <span className="font-mono text-xs uppercase text-ink-soft">{p.status}</span>
            </Link>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="px-4 py-6 text-sm text-ink-soft">Sin proyectos todavía.</li>
        )}
      </ul>
    </main>
  );
}
