import Link from "next/link";

// A small geometric logomark (in the spirit of a site icon + wordmark
// lockup) plus a colored "what is this" pill — sans-serif throughout,
// no monospace eyebrow text.
export function AppHeader({ crumb }: { crumb?: React.ReactNode }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true" className="shrink-0">
              <rect width="26" height="26" rx="7" fill="#1E3A5F" />
              <path d="M7 18V11L13 7L19 11V18H15V14H11V18H7Z" fill="white" />
            </svg>
            <span className="truncate font-display text-lg font-semibold text-ink">Real Estate Development OS</span>
          </Link>
          <span className="hidden shrink-0 rounded-full bg-blueprint-soft px-2.5 py-1 text-xs font-medium text-blueprint sm:inline-block">
            Slice 1 · Costs
          </span>
        </div>
        <div className="flex items-center gap-5 text-sm text-ink-soft">
          <Link href="/approvals" className="hover:text-blueprint">
            Aprobaciones
          </Link>
          {crumb}
        </div>
      </div>
    </header>
  );
}
