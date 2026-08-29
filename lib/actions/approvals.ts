import { db } from "@/lib/db/client";
import { approvalRules } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

// Approval Authorities (§4.7 / docs/schema seed data) — reads the
// hardcoded rules from the DB instead of duplicating the thresholds in
// application code, so the two never drift apart.
export async function resolveRequiredRole(
  entityType: "change_order" | "invoice" | "budget_change" | "debt_draw",
  amount: number
) {
  const rules = await db.select().from(approvalRules).where(eq(approvalRules.entityType, entityType));
  const abs = Math.abs(amount);
  const match = rules.find((r) => {
    const min = Number(r.thresholdMin);
    const max = r.thresholdMax === null ? null : Number(r.thresholdMax);
    return abs >= min && (max === null || abs < max);
  });
  return match?.requiredRole ?? rules[rules.length - 1]?.requiredRole ?? "project_admin";
}
