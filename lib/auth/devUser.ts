import { db } from "@/lib/db/client";
import { users, organizations } from "@/lib/db/schema";

// No real auth in this slice (see README.md). Every action that needs
// a "current user" (requestedBy, decidedBy, etc.) uses whoever `npm
// run db:seed` created. Replace this with the real session lookup
// once auth ships.
let cachedUserId: string | null = null;
let cachedOrgId: string | null = null;

export async function getDevUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!user) throw new Error("No users found — run `npm run db:seed` first.");
  cachedUserId = user.id;
  return cachedUserId;
}

export async function getDevOrgId(): Promise<string> {
  if (cachedOrgId) return cachedOrgId;
  const [org] = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (!org) throw new Error("No organizations found — run `npm run db:seed` first.");
  cachedOrgId = org.id;
  return cachedOrgId;
}
