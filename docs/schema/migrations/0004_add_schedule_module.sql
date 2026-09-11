-- Plan — schedule, tareas, milestones (§3, decisión 8·05: 1 sola fase
-- por proyecto). tasks/milestones ya estaban en schema.sql desde el
-- scaffold original del proyecto (antes de este módulo tener pantalla
-- o acciones) — igual que pasó con units/sales/collections de Revenue,
-- lo más probable es que production ya las tenga desde el primer
-- deploy, pero este archivo no asume eso: todo con "if not exists".

create table if not exists tasks (
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
create index if not exists tasks_phase_id_idx on tasks(phase_id);

create table if not exists milestones (
  id          uuid primary key default gen_random_uuid(),
  phase_id    uuid not null references phases(id) on delete cascade,
  task_id     uuid references tasks(id),
  name        text not null,
  target_date date not null,
  is_critical boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists milestones_phase_id_idx on milestones(phase_id);
