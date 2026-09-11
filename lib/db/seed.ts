// Seeds one dev org/user/portfolio/project/phase using the real default
// cost code catalog (with sub-partidas under Soft Costs/Hard Costs) —
// the same catalog "Usar catálogo estándar" applies from the UI — plus
// one contract, so there's something to click into right away.
//
// Run with: npm run db:seed
import { eq } from "drizzle-orm";
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
  units,
  sales,
  collections,
  debtFacilities,
  debtDraws,
  equityInvestors,
  equityContributions,
  tasks,
  milestones,
} from "./schema";
import { RESIDENTIAL_FOR_SALE_CATALOG, isLeaf } from "../costCodes/defaultCatalog";
import { buildPaymentPlan, expandPaymentPlan } from "../revenue/paymentPlan";

// Leaf amounts chosen so Soft Costs sums to 50M and Hard Costs to 300M —
// the same totals the original single-line demo used — just spread
// realistically across sub-partidas instead of one lump sum each.
const LEAF_AMOUNTS: Record<string, string> = {
  "01.01": "90000000",
  "01.02": "6000000",
  "01.03": "4000000",
  "02.01": "15000000",
  "02.02": "10000000",
  "02.03": "15000000",
  "02.04": "10000000",
  "03.01": "40000000",
  "03.02": "120000000",
  "03.03": "70000000",
  "03.04": "50000000",
  "03.05": "20000000",
  "04.01": "8000000",
  "04.02": "7000000",
  "05.01": "8000000",
  "05.02": "5000000",
  "05.03": "7000000",
  "06.01": "10000000",
  "06.02": "5000000",
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

  // Revenue — motor For Sale (§5). Un puñado de unidades disponibles más
  // una ya vendida, con su plan de pagos parcialmente cobrado, para que
  // Inventario y Cobranza tengan algo real que mostrar desde el primer
  // día (Real = ya cobrado, Forecast = pendiente, incluyendo algo ya
  // vencido si "hoy" cae después de esas fechas).
  const unitSeeds = [
    { code: "A101", unitType: "2BR", areaM2: "78.00", pricePerM2: "55000" },
    { code: "A102", unitType: "2BR", areaM2: "78.00", pricePerM2: "55000" },
    { code: "A103", unitType: "2BR", areaM2: "78.00", pricePerM2: "55000" },
    { code: "A104", unitType: "2BR", areaM2: "78.00", pricePerM2: "55000" },
    { code: "A105", unitType: "2BR", areaM2: "78.00", pricePerM2: "55000" },
    { code: "B101", unitType: "3BR", areaM2: "95.00", pricePerM2: "58000" },
    { code: "B102", unitType: "3BR", areaM2: "95.00", pricePerM2: "58000" },
  ];

  const unitIdByCode = new Map<string, string>();
  for (const u of unitSeeds) {
    const [row] = await db.insert(units).values({ phaseId: phase.id, ...u }).returning();
    unitIdByCode.set(u.code, row.id);
  }

  const soldUnitId = unitIdByCode.get("A105")!;
  const priceTotal = 78 * 55000;
  const saleDate = "2026-01-15";
  const paymentPlan = buildPaymentPlan(priceTotal, {
    downPaymentPct: 0.2,
    closingPct: 0.1,
    installmentsCount: 6,
    closingOffsetMonths: 10,
  });
  const schedule = expandPaymentPlan(saleDate, paymentPlan);

  const [sale] = await db
    .insert(sales)
    .values({ unitId: soldUnitId, saleDate, priceTotal: String(priceTotal), paymentPlan })
    .returning();

  const paidThroughDate = "2026-03-15"; // enganche + Feb + Mar ya cobrados; el resto queda pendiente/vencido
  await db.insert(collections).values(
    schedule.map((row) => ({
      saleId: sale.id,
      dueDate: row.dueDate,
      amount: String(row.amount),
      status: row.dueDate <= paidThroughDate ? ("paid" as const) : ("pending" as const),
      paidDate: row.dueDate <= paidThroughDate ? row.dueDate : null,
    }))
  );

  await db.update(units).set({ status: "sold" }).where(eq(units.id, soldUnitId));

  // Capital — equity y deuda (§6, solo Equity First). Un sponsor propio
  // ya aportó parte de su compromiso, y un crédito de construcción con
  // un draw ya fondeado — para que /debt y /equity tengan de dónde
  // calcular el panel de "próximo mes" desde el primer día.
  const [lender] = await db
    .insert(counterparties)
    .values({ organizationId: org.id, name: "Banco del Norte", type: "lender" })
    .returning();

  const [facility] = await db
    .insert(debtFacilities)
    .values({
      projectId: project.id,
      lenderId: lender.id,
      loanAmount: "200000000",
      ltc: "0.65",
      ltv: "0.55",
      referenceRate: "TIIE",
      spreadBps: 350,
      termMonths: 36,
      amortizationMonths: 24,
      interestReserve: "5000000",
      commitmentFeePct: "0.01",
    })
    .returning();

  await db.insert(debtDraws).values({
    debtFacilityId: facility.id,
    periodMonth: "2026-02-01",
    requestedAmount: "30000000",
    fundedAmount: "30000000",
    status: "funded",
    fundedDate: "2026-02-10",
  });

  const [sponsor] = await db
    .insert(equityInvestors)
    .values({
      projectId: project.id,
      counterpartyId: null,
      name: "Sponsor Developer XYZ",
      commitmentAmount: "80000000",
    })
    .returning();

  await db.insert(equityContributions).values({
    equityInvestorId: sponsor.id,
    periodMonth: "2026-01-15",
    amount: "20000000",
  });

  // Plan — schedule, tareas, milestones (§3, §7.1 pantalla 5). Una
  // cadena principal (permisos → cimentación → estructura → acabados)
  // más una rama corta (instalaciones) que no es la ruta crítica —
  // para que /schedule tenga tanto una ruta crítica real como una
  // tarea "atrasada" (estructura al 60%, con fecha fin ya en el
  // pasado) y un milestone vencido desde el primer día.
  const [t1] = await db
    .insert(tasks)
    .values({
      phaseId: phase.id,
      name: "Permisos y licencias",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      progressPct: "100",
      ownerUserId: user.id,
    })
    .returning();

  const [t2] = await db
    .insert(tasks)
    .values({
      phaseId: phase.id,
      name: "Cimentación",
      startDate: "2026-02-01",
      endDate: "2026-03-15",
      progressPct: "100",
      predecessorTaskId: t1.id,
      ownerUserId: user.id,
    })
    .returning();

  const [t3] = await db
    .insert(tasks)
    .values({
      phaseId: phase.id,
      name: "Estructura",
      startDate: "2026-03-16",
      endDate: "2026-07-31",
      progressPct: "60",
      predecessorTaskId: t2.id,
      ownerUserId: user.id,
    })
    .returning();

  const [t4] = await db.insert(tasks).values({
    phaseId: phase.id,
    name: "Acabados",
    startDate: "2026-08-01",
    endDate: "2026-11-30",
    progressPct: "0",
    predecessorTaskId: t3.id,
  }).returning();

  await db.insert(tasks).values({
    phaseId: phase.id,
    name: "Instalaciones eléctricas",
    startDate: "2026-03-16",
    endDate: "2026-05-31",
    progressPct: "40",
    predecessorTaskId: t2.id,
  });

  await db.insert(milestones).values([
    { phaseId: phase.id, taskId: t2.id, name: "Inicio de obra", targetDate: "2026-02-01", isCritical: true },
    { phaseId: phase.id, taskId: t3.id, name: "Entrega estructura", targetDate: "2026-07-31", isCritical: true },
    { phaseId: phase.id, taskId: t4.id, name: "Entrega final", targetDate: "2026-11-30", isCritical: true },
  ]);

  console.log("Seeded:", {
    organizationId: org.id,
    userId: user.id,
    projectId: project.id,
    phaseId: phase.id,
    contractId: contract.id,
    saleId: sale.id,
  });
  console.log(`\nOpen: http://localhost:3000/projects/${project.id}/budget`);
  console.log(`      http://localhost:3000/projects/${project.id}/schedule`);
  console.log(`      http://localhost:3000/projects/${project.id}/inventory`);
  console.log(`      http://localhost:3000/projects/${project.id}/collections`);
  console.log(`      http://localhost:3000/projects/${project.id}/debt`);
  console.log(`      http://localhost:3000/projects/${project.id}/equity`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
