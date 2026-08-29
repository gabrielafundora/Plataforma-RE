import Link from "next/link";

// Same title-block language as the strategy docs' artifacts — a slim
// wordmark + an eyebrow naming what this slice actually is, so nobody
// mistakes this for a finished product.
export function AppHeader({ crumb }: { crumb?: React.ReactNode }) {
  return (
    <header className="border-b border-line-strong bg-surface">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
        <div className="flex items-baseline gap-3">
          <Link href="/" className="font-display text-base font-semibold text-ink">
            Real Estate Development OS
          </Link>
          <span className="rounded-full border border-line-strong px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-ink-faint">
            Slice 01 · Costs
          </span>
        </div>
        {crumb && <div className="font-mono text-xs text-ink-soft">{crumb}</div>}
      </div>
    </header>
  );
}
