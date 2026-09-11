-- Capital — equity y deuda (§6, solo Equity First): debt_facilities,
-- debt_covenants, debt_draws, debt_payments, equity_investors,
-- equity_contributions, distributions, y sus dos vistas de rollup.
--
-- A diferencia de Revenue (que ya existía en producción desde el primer
-- deploy), estas tablas nunca se aplicaron a producción — es la primera
-- vez que este archivo se estrena para un módulo genuinamente nuevo, no
-- como reparación retroactiva de un incidente.

do $$ begin
  create type debt_draw_status as enum ('requested', 'submitted', 'approved', 'funded');
exception when duplicate_object then null; end $$;

create table if not exists debt_facilities (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  lender_id         uuid not null references counterparties(id),
  loan_amount       numeric(18,2) not null,
  ltc               numeric(9,6),
  ltv               numeric(9,6),
  reference_rate    text,
  spread_bps        int,
  term_months       int,
  amortization_months int,
  interest_reserve  numeric(18,2) default 0,
  commitment_fee_pct numeric(9,6) default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists debt_facilities_project_id_idx on debt_facilities(project_id);
alter table debt_facilities add column if not exists updated_at timestamptz not null default now();

create table if not exists debt_covenants (
  id                  uuid primary key default gen_random_uuid(),
  debt_facility_id    uuid not null references debt_facilities(id) on delete cascade,
  name                text not null,
  threshold           text not null,
  last_tested_status  text,
  last_tested_at      date
);

create table if not exists debt_draws (
  id                uuid primary key default gen_random_uuid(),
  debt_facility_id  uuid not null references debt_facilities(id) on delete cascade,
  period_month      date not null,
  requested_amount  numeric(18,2) not null,
  funded_amount     numeric(18,2),
  status            debt_draw_status not null default 'requested',
  funded_date       date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists debt_draws_facility_period_idx on debt_draws(debt_facility_id, period_month);
alter table debt_draws add column if not exists updated_at timestamptz not null default now();
comment on table debt_draws is
  'requested_amount lo pre-calcula el motor Equity First a partir del '
  'déficit de caja del mes (§4.4) — la UI permite ajustarlo antes de enviar.';

create table if not exists debt_payments (
  id                uuid primary key default gen_random_uuid(),
  debt_facility_id  uuid not null references debt_facilities(id) on delete cascade,
  period_month      date not null,
  interest_amount   numeric(18,2) not null default 0,
  principal_amount  numeric(18,2) not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists debt_payments_facility_period_idx on debt_payments(debt_facility_id, period_month);

create table if not exists equity_investors (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  counterparty_id   uuid references counterparties(id),
  name              text not null,
  commitment_amount numeric(18,2) not null,
  created_at        timestamptz not null default now()
);
create index if not exists equity_investors_project_id_idx on equity_investors(project_id);

create table if not exists equity_contributions (
  id                  uuid primary key default gen_random_uuid(),
  equity_investor_id  uuid not null references equity_investors(id) on delete cascade,
  period_month        date not null,
  amount              numeric(18,2) not null,
  created_at          timestamptz not null default now()
);
create index if not exists equity_contributions_investor_period_idx on equity_contributions(equity_investor_id, period_month);

create table if not exists distributions (
  id                  uuid primary key default gen_random_uuid(),
  equity_investor_id  uuid not null references equity_investors(id) on delete cascade,
  period_month        date not null,
  amount              numeric(18,2) not null,
  created_at          timestamptz not null default now()
);
create index if not exists distributions_investor_period_idx on distributions(equity_investor_id, period_month);

create or replace view debt_facility_rollup as
select
  f.id as debt_facility_id,
  f.loan_amount,
  coalesce(draws.funded, 0) as funded_amount,
  coalesce(pay.principal_paid, 0) as principal_paid,
  coalesce(draws.funded, 0) - coalesce(pay.principal_paid, 0) as outstanding_balance,
  f.loan_amount - (coalesce(draws.funded, 0) - coalesce(pay.principal_paid, 0)) as available_to_draw
from debt_facilities f
left join (
  select debt_facility_id, sum(funded_amount) as funded
  from debt_draws where status = 'funded'
  group by debt_facility_id
) draws on draws.debt_facility_id = f.id
left join (
  select debt_facility_id, sum(principal_amount) as principal_paid
  from debt_payments
  group by debt_facility_id
) pay on pay.debt_facility_id = f.id;

create or replace view equity_investor_rollup as
select
  ei.id as equity_investor_id,
  ei.project_id,
  ei.commitment_amount,
  coalesce(c.contributed, 0) as contributed_amount,
  coalesce(d.distributed, 0) as distributed_amount,
  ei.commitment_amount - coalesce(c.contributed, 0) as remaining_commitment
from equity_investors ei
left join (
  select equity_investor_id, sum(amount) as contributed
  from equity_contributions group by equity_investor_id
) c on c.equity_investor_id = ei.id
left join (
  select equity_investor_id, sum(amount) as distributed
  from distributions group by equity_investor_id
) d on d.equity_investor_id = ei.id;
