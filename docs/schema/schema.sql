-- =====================================================================
-- Real Estate Development OS — MVP schema (PostgreSQL 14+)
-- =====================================================================
-- Deriva directamente de docs/strategy/00-analisis-arquitectura-y-mvp.md
-- (secciones 3 y 5) y docs/strategy/01-especificacion-pantallas-mvp.md.
-- Cada tabla/decisión no obvia cita la sección o decisión que la origina.
--
-- Convenciones:
--   - snake_case, tablas en plural, PK = uuid (gen_random_uuid()).
--   - Dinero: numeric(18,2). Tasas/porcentajes: numeric(9,6).
--   - created_at/updated_at en toda tabla mutable.
--   - Los "5 números" de una BudgetLine (Original/Current/Committed/
--     Actual/Forecast) NUNCA son columnas capturables: se derivan con
--     las vistas al final del archivo (sección 9). Ver §4.1 del doc base.
--   - Scenario (hipotético, editable) y Snapshot (histórico, inmutable)
--     son entidades separadas a propósito — ver §3.3 y decisión 8·(scenario).
-- =====================================================================

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- 1. ENUMS
-- ---------------------------------------------------------------------

create type project_status as enum ('deal', 'active', 'on_hold', 'closed');
-- 'deal' = Draft/Deal del modo Deal/UW (decisión 8·01).

create type project_strategy as enum ('development', 'acquisition');

create type asset_class as enum ('residential_for_sale');
-- Único valor poblado en MVP (decisión 8·04). El tipo queda abierto para
-- agregar 'multifamily' | 'office' | 'retail' | 'industrial' | 'hotel' |
-- 'land' en fases posteriores sin romper filas existentes
-- (ALTER TYPE ... ADD VALUE).

create type currency_code as enum ('USD', 'MXN');   -- decisión 8·02
create type market_code   as enum ('US', 'MX');     -- decisión 8·02

create type project_role as enum (
  'project_admin', 'development', 'project_management', 'construction',
  'finance', 'sales', 'executive', 'consultant', 'contractor'
);
-- Roles FIJOS (decisión 8·06): es un enum, no una tabla configurable a
-- propósito. Migrar a tabla `project_roles` + `role_permissions`
-- editable es el camino natural si se habilita un editor de roles en
-- una fase posterior — hoy sería sobre-ingeniería.

create type member_type as enum ('internal', 'external');

create type forecast_method as enum (
  'straight_line', 's_curve', 'front_loaded', 'back_loaded',
  'milestone', 'contract_schedule', 'linked_to_schedule', 'manual'
);

create type contract_status as enum ('draft', 'active', 'closed', 'terminated');

create type change_order_status as enum ('submitted', 'under_review', 'approved', 'rejected');

create type invoice_status as enum ('submitted', 'reviewed', 'approved', 'scheduled', 'paid', 'rejected');
-- El Actual de costo se reconoce SOLO en 'paid' (cash basis, decisión 8·03).

create type unit_status as enum ('available', 'reserved', 'sold');

create type collection_status as enum ('pending', 'paid', 'overdue');

create type debt_draw_status as enum ('requested', 'submitted', 'approved', 'funded');

create type scenario_status as enum ('draft', 'chosen', 'archived');
-- 'chosen' = el escenario que se aprobó y se congeló como Baseline.
-- Un Scenario solo se crea/edita mientras Project.status = 'deal' — ver §3.3.

create type snapshot_type as enum ('baseline', 'monthly_close');

create type cash_flow_category as enum (
  'revenue', 'cost', 'debt_draw', 'debt_interest', 'debt_principal',
  'equity_contribution', 'equity_distribution'
);

create type return_metric_key as enum (
  'irr_unlevered', 'irr_levered', 'moic', 'npv', 'yield_on_cost',
  'development_spread', 'profit_margin', 'total_development_cost',
  'equity_required', 'peak_equity'
);

create type return_scope as enum ('project', 'equity', 'asset');

create type approval_entity_type as enum ('change_order', 'invoice', 'budget_change', 'debt_draw');

create type approval_status as enum ('pending', 'approved', 'rejected');

create type counterparty_type as enum ('vendor', 'lender', 'investor', 'broker', 'buyer', 'consultant');

create type notification_type as enum (
  'contract_expiring', 'approval_pending', 'draw_due',
  'budget_exceeded', 'schedule_delayed', 'equity_required'
);

create type module_key as enum ('overview', 'plan', 'costs', 'revenue', 'capital', 'business_plan', 'reports', 'team');
create type action_key as enum ('view', 'edit', 'approve', 'admin');

create type document_owner_type as enum (
  'contract', 'change_order', 'debt_facility', 'task', 'invoice', 'project'
);

create type audit_owner_type as enum (
  'budget_line', 'contract', 'change_order', 'invoice', 'debt_facility',
  'scenario_assumption', 'project'
);
-- Cubre la decisión 8·10 (versionar linaje de assumptions desde el día 1)
-- sin necesitar una tabla de auditoría distinta por entidad.

-- ---------------------------------------------------------------------
-- 2. ORGANIZACIÓN, ACCESO Y ESTRUCTURA DE PROYECTO
-- ---------------------------------------------------------------------

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table users (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  email           text not null unique,
  full_name       text not null,
  org_is_admin    boolean not null default false, -- Organization Role simplificado (admin/member)
  member_type     member_type not null default 'internal',
  created_at      timestamptz not null default now()
);
create index on users(organization_id);

create table portfolios (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name            text not null,
  created_at      timestamptz not null default now()
);
create index on portfolios(organization_id);

create table projects (
  id              uuid primary key default gen_random_uuid(),
  portfolio_id    uuid not null references portfolios(id),
  name            text not null,
  status          project_status not null default 'deal',
  strategy        project_strategy not null,
  asset_class     asset_class not null default 'residential_for_sale',
  currency        currency_code not null,   -- decisión 8·02
  market          market_code not null,     -- decisión 8·02
  location        text,
  spv_entity_name text,                     -- "SPV / ownership entity"
  approved_at     timestamptz,              -- momento de promoción Deal -> Project
  template_id     text not null default 'residential_development', -- decisión 8·11: único, hardcodeado
  forecast_months integer not null default 24, -- horizonte del Cost Forecast (§4.2) — sin módulo de Schedule, es la única señal de "cuánto dura el proyecto"; approved_at es el mes de arranque
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on projects(portfolio_id);
create index on projects(status);
comment on column projects.template_id is
  'MVP: valor fijo (decisión 8·11). No hay tabla de templates configurable.';

create table phases (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects(id) on delete cascade,
  name            text not null,
  asset_class     asset_class not null,
  sequence_order  int not null default 1,
  created_at      timestamptz not null default now()
);
create index on phases(project_id);
comment on table phases is
  'Existe desde el día 1 para no re-arquitecturar (§5), pero el MVP no '
  'expone UI para más de una fase por proyecto (decisión 8·05): '
  'aplicación crea exactamente 1 phase al aprobar el Deal.';

create table project_members (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  user_id     uuid not null references users(id),
  role        project_role not null,
  created_at  timestamptz not null default now(),
  unique (project_id, user_id)
);
create index on project_members(project_id);
create index on project_members(user_id);

-- Permisos 3D (Module Access / Action Permission / Data Scope) — §4.7.
-- Tabla SEMILLA, no editable desde la UI en V1 (decisión 8·06): existe
-- para que el motor de permisos lea de datos, no de código hardcodeado,
-- y para no migrar nada cuando se habilite un editor en el futuro.
create table role_permissions (
  role    project_role not null,
  module  module_key   not null,
  action  action_key   not null,
  primary key (role, module, action)
);

-- Data Scope granular: tabla preparada, sin filas en V1 (§4.7 / §5).
create table project_member_scopes (
  id                 uuid primary key default gen_random_uuid(),
  project_member_id  uuid not null references project_members(id) on delete cascade,
  scope_type         text not null,  -- 'phase' | 'vendor' | 'cost_code_range'
  scope_value        text not null,
  created_at         timestamptz not null default now()
);

create table counterparties (
  id           uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name         text not null,
  type         counterparty_type not null,
  tax_id       text,
  contact_info jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index on counterparties(organization_id, type);

-- ---------------------------------------------------------------------
-- 3. PLAN — schedule, tareas, milestones
-- ---------------------------------------------------------------------

create table tasks (
  id                  uuid primary key default gen_random_uuid(),
  phase_id            uuid not null references phases(id) on delete cascade,
  name                text not null,
  start_date          date not null,
  end_date            date not null,
  progress_pct        numeric(5,2) not null default 0 check (progress_pct between 0 and 100),
  predecessor_task_id uuid references tasks(id),
  lag_days            int not null default 0,
  owner_user_id       uuid references users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on tasks(phase_id);

create table milestones (
  id          uuid primary key default gen_random_uuid(),
  phase_id    uuid not null references phases(id) on delete cascade,
  task_id     uuid references tasks(id),
  name        text not null,
  target_date date not null,
  is_critical boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on milestones(phase_id);

-- ---------------------------------------------------------------------
-- 4. COSTS — budget, contratos, change orders, accruals, invoices, pagos
-- ---------------------------------------------------------------------

create table cost_codes (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  code              text not null,          -- ej. "03", "03.04"
  description       text not null,
  parent_cost_code_id uuid references cost_codes(id),
  created_at        timestamptz not null default now(),
  unique (organization_id, code)
);

create table budget_lines (
  id                uuid primary key default gen_random_uuid(),
  phase_id          uuid not null references phases(id) on delete cascade,
  cost_code_id      uuid not null references cost_codes(id),
  original_amount   numeric(18,2) not null,
  forecast_method   forecast_method not null default 'straight_line',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on budget_lines(phase_id);
create index on budget_lines(cost_code_id);
comment on table budget_lines is
  'current/committed/paid/forecast/variance NO son columnas — se '
  'derivan en la vista budget_line_rollup (sección 9). §4.1.';

-- Reasignaciones de presupuesto no atadas a un contrato específico
-- (transferencias entre partidas, re-baseline). Los cambios que sí
-- vienen de un Change Order se reflejan vía Contract.current_amount,
-- no aquí.
create table budget_changes (
  id              uuid primary key default gen_random_uuid(),
  budget_line_id  uuid not null references budget_lines(id) on delete cascade,
  amount          numeric(18,2) not null,   -- puede ser negativo
  reason          text not null,
  requested_by    uuid not null references users(id),
  approved_by     uuid references users(id),
  approved_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index on budget_changes(budget_line_id);

create table task_budget_lines (          -- Task <-> BudgetLine (N:N, §3.1/6.2)
  task_id         uuid not null references tasks(id) on delete cascade,
  budget_line_id  uuid not null references budget_lines(id) on delete cascade,
  primary key (task_id, budget_line_id)
);

create table contracts (
  id                uuid primary key default gen_random_uuid(),
  budget_line_id    uuid not null references budget_lines(id),
  counterparty_id   uuid not null references counterparties(id),
  scope             text not null,
  original_amount   numeric(18,2) not null,
  net_amount        numeric(18,2) not null,          -- decisión 8·02 (mercado US+MX)
  tax_amount        numeric(18,2) not null default 0, -- captura manual, sin motor fiscal automático
  retention_amount  numeric(18,2) not null default 0,
  status            contract_status not null default 'draft',
  signed_date       date,
  start_date        date,
  completion_date   date,
  owner_user_id     uuid references users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on contracts(budget_line_id);
create index on contracts(counterparty_id);
comment on column contracts.tax_amount is
  'Campo genérico, capturado a mano. No hay motor de IVA mexicano ni '
  'de sales tax por estado en EUA en el MVP (decisión 8·02).';

create table change_orders (
  id                    uuid primary key default gen_random_uuid(),
  contract_id           uuid not null references contracts(id) on delete cascade,
  description           text not null,
  cost_impact           numeric(18,2) not null default 0,
  schedule_impact_days  int not null default 0,
  status                change_order_status not null default 'submitted',
  requested_by          uuid not null references users(id),
  decided_by            uuid references users(id),
  decided_at            timestamptz,
  created_at            timestamptz not null default now()
);
create index on change_orders(contract_id);

create table accruals (
  id              uuid primary key default gen_random_uuid(),
  budget_line_id  uuid not null references budget_lines(id),
  contract_id     uuid references contracts(id),
  period_month    date not null,        -- primer día del mes contable
  amount          numeric(18,2) not null,
  description     text,
  recognized_by   uuid not null references users(id),
  created_at      timestamptz not null default now()
);
create index on accruals(budget_line_id, period_month);
comment on table accruals is
  'NUNCA cuenta como Actual (decisión 8·03, cash basis) — solo refina '
  'el Forecast to Complete de la vista budget_line_rollup.';

create table invoices (
  id                uuid primary key default gen_random_uuid(),
  contract_id       uuid not null references contracts(id),
  invoice_number    text not null,
  invoice_date      date not null,
  due_date          date,
  net_amount        numeric(18,2) not null,
  tax_amount        numeric(18,2) not null default 0,
  retention_amount  numeric(18,2) not null default 0,
  status            invoice_status not null default 'submitted',
  approved_by       uuid references users(id),
  approved_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index on invoices(contract_id);
create index on invoices(status);

create table payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references invoices(id) on delete cascade,
  amount      numeric(18,2) not null,
  paid_date   date not null,
  imported_via_batch boolean not null default false, -- decisión 8·03: import en batch
  created_at  timestamptz not null default now()
);
create index on payments(invoice_id);
comment on table payments is
  'Un Invoice pasa a status=paid cuando la suma de sus Payments cubre '
  'net_amount+tax_amount-retention_amount. Ese momento dispara el Actual.';

-- ---------------------------------------------------------------------
-- 5. REVENUE — motor For Sale (único en MVP, decisión 8·04)
-- ---------------------------------------------------------------------

create table units (
  id            uuid primary key default gen_random_uuid(),
  phase_id      uuid not null references phases(id) on delete cascade,
  code          text not null,          -- "A101"
  unit_type     text not null,          -- "2BR"
  area_m2       numeric(10,2) not null,
  price_per_m2  numeric(14,2) not null,
  status        unit_status not null default 'available',
  created_at    timestamptz not null default now(),
  unique (phase_id, code)
);
create index on units(phase_id, status);

create table sales (
  id               uuid primary key default gen_random_uuid(),
  unit_id          uuid not null references units(id),
  sale_date        date not null,
  price_total      numeric(18,2) not null,
  payment_plan     jsonb not null default '{}', -- enganche/mensualidades/escrituración
  created_at       timestamptz not null default now()
);
create index on sales(unit_id);
comment on table sales is 'Sales != Cash Collections — ver tabla collections. §1.1.';

create table collections (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references sales(id) on delete cascade,
  due_date     date not null,
  amount       numeric(18,2) not null,
  paid_date    date,
  status       collection_status not null default 'pending',
  created_at   timestamptz not null default now()
);
create index on collections(sale_id, status);

-- ---------------------------------------------------------------------
-- 6. CAPITAL — equity y deuda (solo Equity First, decisión 8·07)
-- ---------------------------------------------------------------------

create table debt_facilities (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  lender_id         uuid not null references counterparties(id),
  loan_amount       numeric(18,2) not null,
  ltc               numeric(9,6),
  ltv               numeric(9,6),
  reference_rate    text,             -- ej. "TIIE", "SOFR"
  spread_bps        int,
  term_months       int,
  amortization_months int,
  interest_reserve  numeric(18,2) default 0,
  commitment_fee_pct numeric(9,6) default 0,
  created_at        timestamptz not null default now()
);
create index on debt_facilities(project_id);

create table debt_covenants (
  id                  uuid primary key default gen_random_uuid(),
  debt_facility_id    uuid not null references debt_facilities(id) on delete cascade,
  name                text not null,     -- "Minimum equity", "DSCR"
  threshold           text not null,
  last_tested_status  text,              -- captura manual, sin alertas automáticas en MVP (§5)
  last_tested_at      date
);

create table debt_draws (
  id                uuid primary key default gen_random_uuid(),
  debt_facility_id  uuid not null references debt_facilities(id) on delete cascade,
  period_month      date not null,
  requested_amount  numeric(18,2) not null,
  funded_amount     numeric(18,2),
  status            debt_draw_status not null default 'requested',
  funded_date       date,
  created_at        timestamptz not null default now()
);
create index on debt_draws(debt_facility_id, period_month);
comment on table debt_draws is
  'requested_amount lo pre-calcula el motor Equity First a partir del '
  'déficit de caja del mes (§4.4) — la UI permite ajustarlo antes de enviar.';

create table debt_payments (
  id                uuid primary key default gen_random_uuid(),
  debt_facility_id  uuid not null references debt_facilities(id) on delete cascade,
  period_month      date not null,
  interest_amount   numeric(18,2) not null default 0,
  principal_amount  numeric(18,2) not null default 0,
  created_at        timestamptz not null default now()
);
create index on debt_payments(debt_facility_id, period_month);

create table equity_investors (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  counterparty_id   uuid references counterparties(id), -- null = sponsor propio
  name              text not null,
  commitment_amount numeric(18,2) not null,
  created_at        timestamptz not null default now()
);
create index on equity_investors(project_id);

create table equity_contributions (
  id                  uuid primary key default gen_random_uuid(),
  equity_investor_id  uuid not null references equity_investors(id) on delete cascade,
  period_month        date not null,
  amount              numeric(18,2) not null,
  created_at          timestamptz not null default now()
);
create index on equity_contributions(equity_investor_id, period_month);

create table distributions (
  id                  uuid primary key default gen_random_uuid(),
  equity_investor_id  uuid not null references equity_investors(id) on delete cascade,
  period_month        date not null,
  amount              numeric(18,2) not null,
  created_at          timestamptz not null default now()
);
create index on distributions(equity_investor_id, period_month);

-- ---------------------------------------------------------------------
-- 7. BUSINESS PLAN — Scenario (solo UW) / Snapshot (ejecución) — §3.3
-- ---------------------------------------------------------------------

create table scenarios (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,          -- "Base" | "Downside" | "Upside" | custom
  status      scenario_status not null default 'draft',
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on scenarios(project_id);
comment on table scenarios is
  'Solo se crean/editan mientras projects.status = ''deal''. Al '
  'aprobar el Deal, el escenario elegido pasa a status=''chosen'' y se '
  'congela como el primer Snapshot (type=''baseline''). §3.3.';

create table scenario_assumptions (
  id            uuid primary key default gen_random_uuid(),
  scenario_id   uuid not null references scenarios(id) on delete cascade,
  key           text not null,   -- 'price_per_m2' | 'construction_cost_pct' | 'sales_pace' | 'interest_rate_bps' | ...
  value         numeric(18,6) not null,
  created_at    timestamptz not null default now()
);
create index on scenario_assumptions(scenario_id);
comment on table scenario_assumptions is
  'Clave/valor genérico a propósito: los supuestos de underwriting '
  'varían por asset class y evolucionan; no se fija una columna por '
  'supuesto. El linaje de cambios (decisión 8·10) vive en audit_logs.';

create table snapshots (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  type                snapshot_type not null,
  source_scenario_id  uuid references scenarios(id), -- solo se llena en type='baseline'
  period_month        date,                            -- null para 'baseline'
  created_by          uuid not null references users(id),
  created_at          timestamptz not null default now()
);
create index on snapshots(project_id, type, period_month);
comment on table snapshots is
  'Inmutable una vez creado — nunca se hace UPDATE, solo INSERT. '
  'Cada monthly close crea exactamente un snapshot type=''monthly_close''.';

create table cash_flow_periods (
  id            uuid primary key default gen_random_uuid(),
  snapshot_id   uuid not null references snapshots(id) on delete cascade,
  period_month  date not null,
  is_actual     boolean not null,  -- true = mes ya realizado dentro de este snapshot
  unique (snapshot_id, period_month)
);
create index on cash_flow_periods(snapshot_id);

create table cash_flow_lines (
  id                    uuid primary key default gen_random_uuid(),
  cash_flow_period_id   uuid not null references cash_flow_periods(id) on delete cascade,
  category              cash_flow_category not null,
  amount                numeric(18,2) not null
);
create index on cash_flow_lines(cash_flow_period_id, category);

create table return_metrics (
  id            uuid primary key default gen_random_uuid(),
  snapshot_id   uuid not null references snapshots(id) on delete cascade,
  scope         return_scope not null default 'project',
  metric_key    return_metric_key not null,
  value         numeric(18,6) not null,
  unique (snapshot_id, scope, metric_key)
);
create index on return_metrics(snapshot_id);

-- ---------------------------------------------------------------------
-- 8. PLATFORM CORE — approvals, documentos, notificaciones, auditoría
-- ---------------------------------------------------------------------

-- Reglas de aprobación: SEMILLA, no editable desde la UI en V1 (§4.7,
-- decisión 8·06). Ejemplo real de filas — ver sección 10 (seed data).
create table approval_rules (
  id              uuid primary key default gen_random_uuid(),
  entity_type     approval_entity_type not null,
  threshold_min   numeric(18,2) not null default 0,
  threshold_max   numeric(18,2),          -- null = sin tope superior
  required_role   project_role not null
);

create table approval_requests (
  id              uuid primary key default gen_random_uuid(),
  entity_type     approval_entity_type not null,
  entity_id       uuid not null,          -- FK polimórfica (change_orders/invoices/budget_changes/debt_draws)
  amount          numeric(18,2) not null,
  requested_by    uuid not null references users(id),
  required_role   project_role not null,
  status          approval_status not null default 'pending',
  decided_by      uuid references users(id),
  decided_at      timestamptz,
  comment         text,
  created_at      timestamptz not null default now()
);
create index on approval_requests(entity_type, entity_id);
create index on approval_requests(status, required_role);

create table documents (
  id            uuid primary key default gen_random_uuid(),
  owner_type    document_owner_type not null,
  owner_id      uuid not null,           -- FK polimórfica
  file_name     text not null,
  file_url      text not null,
  uploaded_by   uuid not null references users(id),
  uploaded_at   timestamptz not null default now()
);
create index on documents(owner_type, owner_id);

create table comments (
  id            uuid primary key default gen_random_uuid(),
  owner_type    document_owner_type not null,
  owner_id      uuid not null,
  user_id       uuid not null references users(id),
  body          text not null,
  created_at    timestamptz not null default now()
);
create index on comments(owner_type, owner_id);

create table audit_logs (
  id            uuid primary key default gen_random_uuid(),
  owner_type    audit_owner_type not null,
  owner_id      uuid not null,           -- FK polimórfica
  field_name    text not null,
  old_value     text,
  new_value     text,
  changed_by    uuid not null references users(id),
  reason        text,
  changed_at    timestamptz not null default now()
);
create index on audit_logs(owner_type, owner_id, changed_at);
comment on table audit_logs is
  'Cubre decisión 8·10 (linaje de assumptions desde el día 1) de forma '
  'genérica para cualquier objeto financiero, no solo scenario_assumptions.';

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id),
  type        notification_type not null,
  payload     jsonb not null default '{}',
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on notifications(user_id, is_read);

-- =====================================================================
-- 9. VISTAS DERIVADAS — "calculado, nunca capturado" (§4.1, §1.1)
-- =====================================================================

-- Rollup de Contract: current_amount = original + change orders aprobadas;
-- paid_amount = suma de payments; pending_invoices = facturas aprobadas
-- sin pagar completas.
create or replace view contract_rollup as
select
  c.id as contract_id,
  c.original_amount,
  c.original_amount + coalesce(co.approved_changes, 0) as current_amount,
  coalesce(pay.paid_amount, 0) as paid_amount,
  coalesce(inv.pending_invoices, 0) as pending_invoices
from contracts c
left join (
  select contract_id, sum(cost_impact) as approved_changes
  from change_orders where status = 'approved'
  group by contract_id
) co on co.contract_id = c.id
left join (
  select i.contract_id, sum(p.amount) as paid_amount
  from invoices i join payments p on p.invoice_id = i.id
  group by i.contract_id
) pay on pay.contract_id = c.id
left join (
  select contract_id, sum(net_amount + tax_amount - retention_amount) as pending_invoices
  from invoices where status = 'approved'
  group by contract_id
) inv on inv.contract_id = c.id;

-- Rollup de BudgetLine: los 5 números de §4.1.
--   committed   = suma de contract_rollup.current_amount de sus contratos
--   actual_cost = suma de payments de invoices PAID (cash basis, decisión 8·03)
--   current_amount = original + budget_changes aprobados
--   forecast_to_complete = current_amount - actual_cost (ajuste por método
--     de forecast se resuelve en la capa de aplicación, no en SQL: el
--     Cash Flow Engine lee esta vista y aplica la curva vigente)
--   forecast_final_cost = actual_cost + forecast_to_complete
create or replace view budget_line_rollup as
select
  bl.id as budget_line_id,
  bl.original_amount,
  bl.original_amount + coalesce(bc.approved_changes, 0) as current_amount,
  coalesce(cr.committed, 0) as committed_amount,
  coalesce(act.actual_cost, 0) as actual_cost,
  (bl.original_amount + coalesce(bc.approved_changes, 0)) - coalesce(act.actual_cost, 0)
    as forecast_to_complete_naive,
  bl.forecast_method
from budget_lines bl
left join (
  select budget_line_id, sum(amount) as approved_changes
  from budget_changes where approved_at is not null
  group by budget_line_id
) bc on bc.budget_line_id = bl.id
left join (
  select c.budget_line_id, sum(cr.current_amount) as committed
  from contracts c join contract_rollup cr on cr.contract_id = c.id
  group by c.budget_line_id
) cr on cr.budget_line_id = bl.id
left join (
  select c.budget_line_id, sum(p.amount) as actual_cost
  from contracts c
  join invoices i on i.contract_id = c.id and i.status = 'paid'
  join payments p on p.invoice_id = i.id
  group by c.budget_line_id
) act on act.budget_line_id = bl.id;

comment on view budget_line_rollup is
  'forecast_to_complete_naive es la línea recta simple; el forecast '
  'ajustado por método (S-Curve/Milestone/etc., §4.2) lo calcula el '
  'Cash Flow Engine en la capa de aplicación, no esta vista.';

-- =====================================================================
-- 10. SEED DATA — reglas de aprobación fijas (Approval Authorities, §4.7)
-- =====================================================================

insert into approval_rules (entity_type, threshold_min, threshold_max, required_role) values
  ('change_order', 0,        100000,  'project_management'),
  ('change_order', 100000,   500000,  'development'),
  ('change_order', 500000,   null,    'executive'),
  ('invoice',      0,        null,    'finance'),
  ('budget_change',0,        null,    'development'),
  ('debt_draw',    0,        null,    'finance');
