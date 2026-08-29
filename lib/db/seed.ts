// Seeds one dev org/user/portfolio/project/phase/cost-codes/budget-lines/
// counterparty/contract — the same example numbers used throughout
// docs/strategy (Land $100M, Soft Costs $50M+5, Hard Costs $300M+10).
//
// Run with: npm run db:seed
import { db } from "./client";
import {
  organizations,
  users,
  portfolios,
  projects,
  phases,
  costCodes,
  budgetLines,
  counterparties,
  contracts,
} from "./schema";

async function main() {
  console.log("Seeding dev data…");

  const [org] = await db
    .insert(organizations)
    .values({ name: "Developer XYZ" })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      organizationId: org.id,
      email: "ana@xyz.dev",
      fullName: "Ana Martínez",
      orgIsAdmin: true,
    })
    .returning();

  const [portfolio] = await db
    .insert(portfolios)
    .values({ organizationId: org.id, name: "México" })
    .returning();

  const [project] = await db
    .insert(projects)
    .values({
      portfolioId: portfolio.id,
      name: "Proyecto Polanco",
      status: "active",
      strategy: "development",
      assetClass: "residential_for_sale",
      currency: "MXN",
      market: "MX",
      location: "Ciudad de México",
      approvedAt: new Date(),
    })
    .returning();

  const [phase] = await db
    .insert(phases)
    .values({
      projectId: project.id,
      name: "Fase única",
      assetClass: "residential_for_sale",
    })
    .returning();

  const costCodeSeed = [
    { code: "01", description: "Land", original: "100000000", method: "manual" as const },
    { code: "02", description: "Soft Costs", original: "50000000", method: "milestone" as const },
    { code: "03", description: "Hard Costs", original: "300000000", method: "s_curve" as const },
  ];

  const budgetLineByCode: Record<string, string> = {};

  for (const row of costCodeSeed) {
    const [cc] = await db
      .insert(costCodes)
      .values({ organizationId: org.id, code: row.code, description: row.description })
      .returning();

    const [bl] = await db
      .insert(budgetLines)
      .values({
        phaseId: phase.id,
        costCodeId: cc.id,
        originalAmount: row.original,
        forecastMethod: row.method,
      })
      .returning();

    budgetLineByCode[row.code] = bl.id;
  }

  const [contractor] = await db
    .insert(counterparties)
    .values({
      organizationId: org.id,
      name: "Constructora del Valle",
      type: "vendor",
    })
    .returning();

  const [contract] = await db
    .insert(contracts)
    .values({
      budgetLineId: budgetLineByCode["03"],
      counterpartyId: contractor.id,
      scope: "Obra gris — Hard Costs",
      originalAmount: "240000000",
      netAmount: "240000000",
      status: "active",
      signedDate: "2026-01-15",
    })
    .returning();

  console.log("Seeded:", {
    organizationId: org.id,
    userId: user.id,
    projectId: project.id,
    phaseId: phase.id,
    contractId: contract.id,
  });
  console.log(`\nOpen: http://localhost:3000/projects/${project.id}/budget`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
