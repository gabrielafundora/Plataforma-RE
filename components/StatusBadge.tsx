// Colorful, semantic status pills — like Escuela de Escritores' category/
// level tags — instead of one gray mono pill for every status. Color
// carries real meaning here: green = done/good, amber = pending/deal
// stage, blue = active/informational, red = needs attention.
const STYLES: Record<string, string> = {
  deal: "bg-warning-soft text-warning",
  active: "bg-success-soft text-success",
  on_hold: "bg-surface-2 text-ink-soft",
  closed: "bg-surface-2 text-ink-faint",

  draft: "bg-surface-2 text-ink-soft",
  submitted: "bg-warning-soft text-warning",
  under_review: "bg-warning-soft text-warning",
  reviewed: "bg-warning-soft text-warning",
  approved: "bg-blueprint-soft text-blueprint",
  scheduled: "bg-blueprint-soft text-blueprint",
  paid: "bg-success-soft text-success",
  rejected: "bg-redline-soft text-redline",
  terminated: "bg-redline-soft text-redline",
};

const LABELS: Record<string, string> = {
  on_hold: "On Hold",
  under_review: "Under Review",
};

export function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? "bg-surface-2 text-ink-soft";
  const label = LABELS[status] ?? status.replace(/_/g, " ");
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium capitalize ${style}`}>
      {label}
    </span>
  );
}
