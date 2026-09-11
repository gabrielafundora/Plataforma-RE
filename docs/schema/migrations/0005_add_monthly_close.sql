-- Business Plan Snapshot / Monthly Close (§3.3, §4.6, §7.1 pantalla 18).
--
-- scenarios/scenario_assumptions/snapshots/cash_flow_periods/
-- cash_flow_lines/return_metrics ya estaban en schema.sql desde el
-- scaffold original — igual que pasó con units/sales/collections y
-- tasks/milestones, lo más probable es que production ya las tenga
-- desde el primer deploy, pero este archivo no asume eso: todo con
-- "if not exists". `scenarios`/`scenario_assumptions` se crean aquí
-- solo porque snapshots.source_scenario_id las referencia por FK — esta
-- vuelta no tiene flujo de Deal/Underwriting, así que esa columna
-- siempre queda en null en la práctica (ver lib/db/schema.ts).

do $$ begin
  create type scenario_status as enum ('draft', 'chosen', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type snapshot_type as enum ('baseline', 'monthly_close');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cash_flow_category as enum (
    'revenue', 'cost', 'debt_draw', 'debt_interest', 'debt_principal',
    'equity_contribution', 'equity_distribution'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type return_metric_key as enum (
    'irr_unlevered', 'irr_levered', 'moic', 'npv', 'yield_on_cost',
    'development_spread', 'profit_margin', 'total_development_cost',
    'equity_required', 'peak_equity'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type return_scope as enum ('project', 'equity', 'asset');
exception when duplicate_object then null; end $$;

create table if not exists scenarios (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  name        text not null,
  status      scenario_status not null default 'draft',
  created_by  uuid not null references users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists scenarios_project_id_idx on scenarios(project_id);

create table if not exists scenario_assumptions (
  id            uuid primary key default gen_random_uuid(),
  scenario_id   uuid not null references scenarios(id) on delete cascade,
  key           text not null,
  value         numeric(18,6) not null,
  created_at    timestamptz not null default now()
);
create index if not exists scenario_assumptions_scenario_id_idx on scenario_assumptions(scenario_id);

create table if not exists snapshots (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  type                snapshot_type not null,
  source_scenario_id  uuid references scenarios(id),
  period_month        date,
  created_by          uuid not null references users(id),
  created_at          timestamptz not null default now()
);
create index if not exists snapshots_project_type_period_idx on snapshots(project_id, type, period_month);

create table if not exists cash_flow_periods (
  id            uuid primary key default gen_random_uuid(),
  snapshot_id   uuid not null references snapshots(id) on delete cascade,
  period_month  date not null,
  is_actual     boolean not null,
  unique (snapshot_id, period_month)
);
create index if not exists cash_flow_periods_snapshot_id_idx on cash_flow_periods(snapshot_id);

create table if not exists cash_flow_lines (
  id                    uuid primary key default gen_random_uuid(),
  cash_flow_period_id   uuid not null references cash_flow_periods(id) on delete cascade,
  category              cash_flow_category not null,
  amount                numeric(18,2) not null
);
create index if not exists cash_flow_lines_period_category_idx on cash_flow_lines(cash_flow_period_id, category);

create table if not exists return_metrics (
  id            uuid primary key default gen_random_uuid(),
  snapshot_id   uuid not null references snapshots(id) on delete cascade,
  scope         return_scope not null default 'project',
  metric_key    return_metric_key not null,
  value         numeric(18,6) not null,
  unique (snapshot_id, scope, metric_key)
);
create index if not exists return_metrics_snapshot_id_idx on return_metrics(snapshot_id);
