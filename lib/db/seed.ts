// Seeds one dev org/user/portfolio/project/phase using the real default
// cost code catalog (with sub-partidas under Soft Costs/Hard Costs) —
// the same catalog "Usar catálogo estándar" applies from the UI — plus
// one contract, so there's something to click into right away.
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
import { RESIDENTIAL_FOR_SALE_CATALOG, isLeaf } from "../costCodes/defaultCatalog";

// Leaf amounts chosen so Soft Costs sums to 50M and Hard Costs to 300M —
// the same totals the original single-line demo used — just spread
// realistically across sub-partidas instead of one lump sum each.
const LEAF_AMOUNTS: Record<string, string> = {
  "01": "100000000",
  "02.01": "15000000",
  "02.02": "10000000",
  "02.03": "15000000",
  "02.04": "10000000",
  "03.01": "40000000",
  "03.02": "120000000",
  "03.03": "70000000",
  "03.04": "50000000",
  "03.05": "20000000",
  "04": "15000000",
  "05": "20000000",
  "06": "15000000",
};

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

  const idByCode = new Map<string, string>();
  const budgetLineIdByCode = new Map<string, string>();

  for (const entry of RESIDENTIAL_FOR_SALE_CATALOG) {
    const parentId = entry.parentCode ? idByCode.get(entry.parentCode) ?? null : null;

    const [cc] = await db
      .insert(costCodes)
      .values({
        organizationId: org.id,
        code: entry.code,
        description: entry.description,
        parentCostCodeId: parentId,
      })
      .returning();
    idByCode.set(entry.code, cc.id);

    if (isLeaf(RESIDENTIAL_FOR_SALE_CATALOG, entry.code)) {
      const method = entry.code.startsWith("03") ? ("s_curve" as const) : ("straight_line" as const);
      const [bl] = await db
        .insert(budgetLines)
        .values({
          phaseId: phase.id,
          costCodeId: cc.id,
          originalAmount: LEAF_AMOUNTS[entry.code] ?? "0",
          forecastMethod: method,
        })
        .returning();
      budgetLineIdByCode.set(entry.code, bl.id);
    }
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
      budgetLineId: budgetLineIdByCode.get("03.02")!, // Estructura
      counterpartyId: contractor.id,
      scope: "Obra gris — Estructura",
      originalAmount: "95000000",
      netAmount: "95000000",
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
