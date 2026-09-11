-- Revenue — motor For Sale (§5): units, sales, collections y su vista
-- de rollup.
--
-- Retroactivo: units/sales/collections ya llevaban tiempo en schema.sql
-- (se crearon en producción desde el primer deploy de la base), pero
-- updated_at en units/collections y la vista sale_collection_rollup son
-- nuevos de esta vuelta — se probaron solo contra dev local y rompieron
-- "Crear unidad" en producción hasta correrlos a mano en Neon. Este
-- archivo lo deja documentado en el historial de migraciones.

do $$ begin
  create type unit_status as enum ('available', 'reserved', 'sold');
exception when duplicate_object then null; end $$;

do $$ begin
  create type collection_status as enum ('pending', 'paid', 'overdue');
exception when duplicate_object then null; end $$;

create table if not exists units (
  id            uuid primary key default gen_random_uuid(),
  phase_id      uuid not null references phases(id) on delete cascade,
  code          text not null,
  unit_type     text not null,
  area_m2       numeric(10,2) not null,
  price_per_m2  numeric(14,2) not null,
  status        unit_status not null default 'available',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (phase_id, code)
);
create index if not exists units_phase_id_status_idx on units(phase_id, status);
alter table units add column if not exists updated_at timestamptz not null default now();

create table if not exists sales (
  id               uuid primary key default gen_random_uuid(),
  unit_id          uuid not null references units(id),
  sale_date        date not null,
  price_total      numeric(18,2) not null,
  payment_plan     jsonb not null default '{}',
  created_at       timestamptz not null default now()
);
create index if not exists sales_unit_id_idx on sales(unit_id);
comment on table sales is 'Sales != Cash Collections — ver tabla collections. §1.1.';

create table if not exists collections (
  id           uuid primary key default gen_random_uuid(),
  sale_id      uuid not null references sales(id) on delete cascade,
  due_date     date not null,
  amount       numeric(18,2) not null,
  paid_date    date,
  status       collection_status not null default 'pending',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists collections_sale_id_status_idx on collections(sale_id, status);
alter table collections add column if not exists updated_at timestamptz not null default now();

create or replace view sale_collection_rollup as
select
  s.id as sale_id,
  s.unit_id,
  s.price_total,
  coalesce(sum(c.amount) filter (where c.status = 'paid'), 0) as collected_amount,
  coalesce(sum(c.amount) filter (where c.status = 'pending'), 0) as pending_amount,
  coalesce(sum(c.amount) filter (where c.status = 'overdue'), 0) as overdue_amount
from sales s
left join collections c on c.sale_id = s.id
group by s.id, s.unit_id, s.price_total;

comment on view sale_collection_rollup is
  'Collected-to-date vs. contratado (price_total) por Sale — Sales != Cash '
  'Collections (§1.1). overdue_amount depende de collections.status, que '
  'nadie transiciona automáticamente todavía: hoy siempre es 0 salvo que '
  'se marque a mano.';
