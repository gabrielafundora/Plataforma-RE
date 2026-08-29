// Pure string helpers shared between lib/actions/budgetChanges.ts (a
// "use server" file, which can only export async actions) and the pages
// that read budget_changes rows. A rebalanceo's two legs are tagged with
// the same "[grp:<uuid>]" suffix in their `reason` text so they can be
// found and decided together — see lib/actions/budgetChanges.ts.
const GROUP_TAG_RE = /\[grp:([0-9a-f-]+)\]/;

export function groupTag(id: string): string {
  return `[grp:${id}]`;
}

export function stripGroupTag(reason: string): string {
  return reason.replace(GROUP_TAG_RE, "").trim();
}

export function extractGroupId(reason: string): string | null {
  return reason.match(GROUP_TAG_RE)?.[1] ?? null;
}
