// Drizzle table definitions mirroring docs/schema/schema.sql.
//
// docs/schema/schema.sql is the source of truth for the actual database
// structure (it's what you run to create/migrate the DB). This file is
// a typed query layer on top of that — only the tables/views the slices
// built so far (Costs + Cash Flow Engine, Revenue/For Sale, Capital,
// Plan/Schedule, Business Plan) actually touch are mapped here. Extend
// it domain by domain as later slices (Platform Core) get built.
import {
  pgTable,
  pgView,
  pgEnum,
  uuid,
  text,
  numeric,
  boolean,
  date,
  timestamp,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";

export const contractStatus = pgEnum("contract_status", [
  "draft",
  "active",
  "closed",
  "terminated",
]);

export const invoiceStatus = pgEnum("invoice_status", [
  "submitted",
  "reviewed",
  "approved",
  "scheduled",
  "paid",
  "rejected",
]);

export const forecastMethod = pgEnum("forecast_method", [
  "straight_line",
  "s_curve",
  "front_loaded",
  "back_loaded",
  "milestone",
  "contract_schedule",
  "linked_to_schedule",
  "manual",
]);

export const counterpartyType = pgEnum("counterparty_type", [
  "vendor",
  "lender",
  "investor",
  "broker",
  "buyer",
  "consultant",
]);

export const changeOrderStatus = pgEnum("change_order_status", [
  "submitted",
  "under_review",
  "approved",
  "rejected",
]);

export const projectRole = pgEnum("project_role", [
  "project_admin",
  "development",
  "project_management",
  "construction",
  "finance",
  "sales",
  "executive",
  "consultant",
  "contractor",
]);

export const approvalEntityType = pgEnum("approval_entity_type", [
  "change_order",
  "invoice",
  "budget_change",
  "debt_draw",
]);

export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected"]);

export const unitStatus = pgEnum("unit_status", ["available", "reserved", "sold"]);

export const collectionStatus = pgEnum("collection_status", ["pending", "paid", "overdue"]);

export const debtDrawStatus = pgEnum("debt_draw_status", ["requested", "submitted", "approved", "funded"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  orgIsAdmin: boolean("org_is_admin").notNull().default(false),
  memberType: text("member_type").notNull().default("internal"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const portfolios = pgTable("portfolios", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  portfolioId: uuid("portfolio_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("deal"),
  strategy: text("strategy").notNull(),
  assetClass: text("asset_class").notNull().default("residential_for_sale"),
  currency: text("currency").notNull(),
  market: text("market").notNull(),
  location: text("location"),
  spvEntityName: text("spv_entity_name"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  templateId: text("template_id").notNull().default("residential_development"),
  forecastMonths: integer("forecast_months").notNull().default(24),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const phases = pgTable("phases", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  name: text("name").notNull(),
  assetClass: text("asset_class").notNull(),
  sequenceOrder: integer("sequence_order").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Plan — schedule, tareas, milestones (§3, decisión 8·05: 1 sola fase) ---

export const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  phaseId: uuid("phase_id").notNull(),
  name: text("name").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  progressPct: numeric("progress_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  predecessorTaskId: uuid("predecessor_task_id"),
  lagDays: integer("lag_days").notNull().default(0),
  ownerUserId: uuid("owner_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const milestones = pgTable("milestones", {
  id: uuid("id").primaryKey().defaultRandom(),
  phaseId: uuid("phase_id").notNull(),
  taskId: uuid("task_id"),
  name: text("name").notNull(),
  targetDate: date("target_date").notNull(),
  isCritical: boolean("is_critical").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const costCodes = pgTable("cost_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  code: text("code").notNull(),
  description: text("description").notNull(),
  parentCostCodeId: uuid("parent_cost_code_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const budgetLines = pgTable("budget_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  phaseId: uuid("phase_id").notNull(),
  costCodeId: uuid("cost_code_id").notNull(),
  originalAmount: numeric("original_amount", { precision: 18, scale: 2 }).notNull(),
  forecastMethod: forecastMethod("forecast_method").notNull().default("straight_line"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const budgetChanges = pgTable("budget_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  budgetLineId: uuid("budget_line_id").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  requestedBy: uuid("requested_by").notNull(),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const counterparties = pgTable("counterparties", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  name: text("name").notNull(),
  type: counterpartyType("type").notNull(),
  taxId: text("tax_id"),
  contactInfo: jsonb("contact_info").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contracts = pgTable("contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  budgetLineId: uuid("budget_line_id").notNull(),
  counterpartyId: uuid("counterparty_id").notNull(),
  scope: text("scope").notNull(),
  originalAmount: numeric("original_amount", { precision: 18, scale: 2 }).notNull(),
  netAmount: numeric("net_amount", { precision: 18, scale: 2 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  retentionAmount: numeric("retention_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  status: contractStatus("status").notNull().default("draft"),
  signedDate: date("signed_date"),
  startDate: date("start_date"),
  completionDate: date("completion_date"),
  ownerUserId: uuid("owner_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const changeOrders = pgTable("change_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull(),
  description: text("description").notNull(),
  costImpact: numeric("cost_impact", { precision: 18, scale: 2 }).notNull().default("0"),
  scheduleImpactDays: integer("schedule_impact_days").notNull().default(0),
  status: changeOrderStatus("status").notNull().default("submitted"),
  requestedBy: uuid("requested_by").notNull(),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accruals = pgTable("accruals", {
  id: uuid("id").primaryKey().defaultRandom(),
  budgetLineId: uuid("budget_line_id").notNull(),
  contractId: uuid("contract_id"),
  periodMonth: date("period_month").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  description: text("description"),
  recognizedBy: uuid("recognized_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: date("invoice_date").notNull(),
  dueDate: date("due_date"),
  netAmount: numeric("net_amount", { precision: 18, scale: 2 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  retentionAmount: numeric("retention_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  status: invoiceStatus("status").notNull().default("submitted"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  paidDate: date("paid_date").notNull(),
  importedViaBatch: boolean("imported_via_batch").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const approvalRules = pgTable("approval_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: approvalEntityType("entity_type").notNull(),
  thresholdMin: numeric("threshold_min", { precision: 18, scale: 2 }).notNull().default("0"),
  thresholdMax: numeric("threshold_max", { precision: 18, scale: 2 }),
  requiredRole: projectRole("required_role").notNull(),
});

export const approvalRequests = pgTable("approval_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: approvalEntityType("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  requestedBy: uuid("requested_by").notNull(),
  requiredRole: projectRole("required_role").notNull(),
  status: approvalStatus("status").notNull().default("pending"),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Revenue — motor For Sale (§5, único en MVP) -----------------------

export const units = pgTable("units", {
  id: uuid("id").primaryKey().defaultRandom(),
  phaseId: uuid("phase_id").notNull(),
  code: text("code").notNull(),
  unitType: text("unit_type").notNull(),
  areaM2: numeric("area_m2", { precision: 10, scale: 2 }).notNull(),
  pricePerM2: numeric("price_per_m2", { precision: 14, scale: 2 }).notNull(),
  status: unitStatus("status").notNull().default("available"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// "Sales != Cash Collections" (§1.1) — price_total es lo contratado, no
// lo cobrado; ver collections para lo efectivamente cobrado. payment_plan
// se captura tal cual se acordó (ver lib/revenue/paymentPlan.ts para su
// forma) — de ahí se derivan las filas de `collections` al registrar la
// venta, una sola vez; el plan guardado aquí ya no vuelve a leerse para
// calcular nada (a diferencia del forecast_method de Costs, que sí se
// reevalúa cada vez).
export const sales = pgTable("sales", {
  id: uuid("id").primaryKey().defaultRandom(),
  unitId: uuid("unit_id").notNull(),
  saleDate: date("sale_date").notNull(),
  priceTotal: numeric("price_total", { precision: 18, scale: 2 }).notNull(),
  paymentPlan: jsonb("payment_plan").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const collections = pgTable("collections", {
  id: uuid("id").primaryKey().defaultRandom(),
  saleId: uuid("sale_id").notNull(),
  dueDate: date("due_date").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  paidDate: date("paid_date"),
  status: collectionStatus("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Capital — equity y deuda (§6, solo Equity First, decisión 8·07) ---

export const debtFacilities = pgTable("debt_facilities", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  lenderId: uuid("lender_id").notNull(),
  loanAmount: numeric("loan_amount", { precision: 18, scale: 2 }).notNull(),
  ltc: numeric("ltc", { precision: 9, scale: 6 }),
  ltv: numeric("ltv", { precision: 9, scale: 6 }),
  referenceRate: text("reference_rate"),
  spreadBps: integer("spread_bps"),
  termMonths: integer("term_months"),
  amortizationMonths: integer("amortization_months"),
  interestReserve: numeric("interest_reserve", { precision: 18, scale: 2 }).default("0"),
  commitmentFeePct: numeric("commitment_fee_pct", { precision: 9, scale: 6 }).default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// "Captura manual, sin alertas automáticas en MVP" (§5) — no hay motor
// que evalúe el covenant contra datos reales, es un registro de lo que
// alguien revisó a mano.
export const debtCovenants = pgTable("debt_covenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  debtFacilityId: uuid("debt_facility_id").notNull(),
  name: text("name").notNull(),
  threshold: text("threshold").notNull(),
  lastTestedStatus: text("last_tested_status"),
  lastTestedAt: date("last_tested_at"),
});

// requested_amount lo pre-calcula lib/capital/equityFirst.ts a partir
// del déficit de caja del mes (§4.4); la UI permite ajustarlo antes de
// enviar. Sin "rejected" en el enum — es un avance lineal
// requested→submitted→approved→funded, no una decisión binaria como
// Invoice.
export const debtDraws = pgTable("debt_draws", {
  id: uuid("id").primaryKey().defaultRandom(),
  debtFacilityId: uuid("debt_facility_id").notNull(),
  periodMonth: date("period_month").notNull(),
  requestedAmount: numeric("requested_amount", { precision: 18, scale: 2 }).notNull(),
  fundedAmount: numeric("funded_amount", { precision: 18, scale: 2 }),
  status: debtDrawStatus("status").notNull().default("requested"),
  fundedDate: date("funded_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const debtPayments = pgTable("debt_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  debtFacilityId: uuid("debt_facility_id").notNull(),
  periodMonth: date("period_month").notNull(),
  interestAmount: numeric("interest_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  principalAmount: numeric("principal_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const equityInvestors = pgTable("equity_investors", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  counterpartyId: uuid("counterparty_id"), // null = sponsor propio
  name: text("name").notNull(),
  commitmentAmount: numeric("commitment_amount", { precision: 18, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const equityContributions = pgTable("equity_contributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  equityInvestorId: uuid("equity_investor_id").notNull(),
  periodMonth: date("period_month").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Sin UI/acción todavía — no hay evento de negocio (exit, refinanciamiento)
// que las dispare en esta vuelta; se mapea porque ya existe en schema.sql.
export const distributions = pgTable("distributions", {
  id: uuid("id").primaryKey().defaultRandom(),
  equityInvestorId: uuid("equity_investor_id").notNull(),
  periodMonth: date("period_month").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Derived views (§4.1 — "calculado, nunca capturado") ---------------

export const contractRollup = pgView("contract_rollup", {
  contractId: uuid("contract_id"),
  originalAmount: numeric("original_amount", { precision: 18, scale: 2 }),
  currentAmount: numeric("current_amount", { precision: 18, scale: 2 }),
  paidAmount: numeric("paid_amount", { precision: 18, scale: 2 }),
  pendingInvoices: numeric("pending_invoices", { precision: 18, scale: 2 }),
}).existing();

export const budgetLineRollup = pgView("budget_line_rollup", {
  budgetLineId: uuid("budget_line_id"),
  originalAmount: numeric("original_amount", { precision: 18, scale: 2 }),
  currentAmount: numeric("current_amount", { precision: 18, scale: 2 }),
  committedAmount: numeric("committed_amount", { precision: 18, scale: 2 }),
  actualCost: numeric("actual_cost", { precision: 18, scale: 2 }),
  forecastToCompleteNaive: numeric("forecast_to_complete_naive", { precision: 18, scale: 2 }),
  forecastMethod: forecastMethod("forecast_method"),
}).existing();

export const saleCollectionRollup = pgView("sale_collection_rollup", {
  saleId: uuid("sale_id"),
  unitId: uuid("unit_id"),
  priceTotal: numeric("price_total", { precision: 18, scale: 2 }),
  collectedAmount: numeric("collected_amount", { precision: 18, scale: 2 }),
  pendingAmount: numeric("pending_amount", { precision: 18, scale: 2 }),
  overdueAmount: numeric("overdue_amount", { precision: 18, scale: 2 }),
}).existing();

export const debtFacilityRollup = pgView("debt_facility_rollup", {
  debtFacilityId: uuid("debt_facility_id"),
  loanAmount: numeric("loan_amount", { precision: 18, scale: 2 }),
  fundedAmount: numeric("funded_amount", { precision: 18, scale: 2 }),
  principalPaid: numeric("principal_paid", { precision: 18, scale: 2 }),
  outstandingBalance: numeric("outstanding_balance", { precision: 18, scale: 2 }),
  availableToDraw: numeric("available_to_draw", { precision: 18, scale: 2 }),
}).existing();

export const equityInvestorRollup = pgView("equity_investor_rollup", {
  equityInvestorId: uuid("equity_investor_id"),
  projectId: uuid("project_id"),
  commitmentAmount: numeric("commitment_amount", { precision: 18, scale: 2 }),
  contributedAmount: numeric("contributed_amount", { precision: 18, scale: 2 }),
  distributedAmount: numeric("distributed_amount", { precision: 18, scale: 2 }),
  remainingCommitment: numeric("remaining_commitment", { precision: 18, scale: 2 }),
}).existing();
