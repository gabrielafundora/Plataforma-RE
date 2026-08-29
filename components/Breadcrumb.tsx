import Link from "next/link";

// A full trail (Mis Proyectos › Proyecto › Control Presupuestal › ...)
// instead of a single "back" link, so any ancestor is one click away —
// not just the immediate parent.
export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-ink-faint">/</span>}
          {item.href ? (
            <Link href={item.href} className="hover:text-blueprint">
              {item.label}
            </Link>
          ) : (
            <span className="text-ink">{item.label}</span>
          )}
        </span>
      ))}
    </span>
  );
}
