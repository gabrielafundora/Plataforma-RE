// Drizzle table definitions mirroring docs/schema/schema.sql.
//
// docs/schema/schema.sql is the source of truth for the actual database
// structure (it's what you run to create/migrate the DB). This file is
// a typed query layer on top of that — only the tables/views this
// vertical slice (Costs + Cash Flow Engine) actually touches are
// mapped here. Extend it domain by domain as later slices (Plan,
// Revenue, Capital, Business Plan, Platform Core) get built.
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
