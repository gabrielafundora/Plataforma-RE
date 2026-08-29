import Link from "next/link";

// A small geometric logomark (in the spirit of a site icon + wordmark
// lockup) plus a colored "what is this" pill — sans-serif throughout,
// no monospace eyebrow text.
export function AppHeader({ crumb }: { crumb?: React.ReactNode }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2.5">
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
              <rect width="26" height="26" rx="7" fill="#1E3A5F" />
              <path d="M7 18V11L13 7L19 11V18H15V14H11V18H7Z" fill="white" />
            </svg>
            <span className="font-display text-lg font-semibold text-ink">Real Estate Development OS</span>
          </Link>
          <span className="rounded-full bg-blueprint-soft px-2.5 py-1 text-xs font-medium text-blueprint">
            Slice 1 · Costs
          </span>
        </div>
        {crumb && <div className="text-sm text-ink-soft">{crumb}</div>}
      </div>
    </header>
  );
}
