"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { and, eq, ilike } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { portfolios, projects, phases } from "@/lib/db/schema";
import { getDevOrgId } from "@/lib/auth/devUser";

// "Falta todo el tema de poder crear un proyecto nuevo" — before this,
// the only way any Organization/Portfolio/Project/Phase row got created
// was `npm run db:seed`. This is the real in-app path.
//
// Scope cut (deliberate, see the plan): the project is created directly
// as `status: "active"` with `approved_at` set, same as seed.ts does
// today. The full Deal/Underwriting mode (`status: "deal"`, comparable
// `scenarios`) is designed in docs/schema/schema.sql but not wired up
// here — a project doesn't lose anything by skipping it now, since
// nothing yet reads the "deal" state or the scenarios table.

const createProjectSchema = z.object({
  name: z.string().min(1),
  portfolioName: z.string().min(1),
  strategy: z.enum(["development", "acquisition"]),
  currency: z.enum(["USD", "MXN"]),
  market: z.enum(["US", "MX"]),
  location: z.string().optional(),
});

export async function createProject(formData: FormData) {
  const parsed = createProjectSchema.parse({
    name: formData.get("name"),
    portfolioName: formData.get("portfolioName"),
    strategy: formData.get("strategy"),
    currency: formData.get("currency"),
    market: formData.get("market"),
    location: formData.get("location") || undefined,
  });
  const orgId = await getDevOrgId();

  const [existingPortfolio] = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.organizationId, orgId), ilike(portfolios.name, parsed.portfolioName)));

  const portfolio =
    existingPortfolio ??
    (await db.insert(portfolios).values({ organizationId: orgId, name: parsed.portfolioName }).returning())[0];

  const [project] = await db
    .insert(projects)
    .values({
      portfolioId: portfolio.id,
      name: parsed.name,
      status: "active",
      strategy: parsed.strategy,
      assetClass: "residential_for_sale",
      currency: parsed.currency,
      market: parsed.market,
      location: parsed.location,
      approvedAt: new Date(),
    })
    .returning();

  await db.insert(phases).values({
    projectId: project.id,
    name: "Fase única",
    assetClass: "residential_for_sale",
  });

  redirect(`/projects/${project.id}/budget`);
}
