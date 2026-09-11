-- Agrega projects.forecast_months (horizonte del Cost Forecast, §4.2).
--
-- Retroactivo: este cambio se agregó a schema.sql/schema.ts al construir
-- la pantalla de Forecast, se probó solo contra la base de dev local, y
-- rompió producción (toda query de Drizzle sobre `projects` tronaba)
-- hasta que se corrió a mano en la consola de Neon. Este archivo lo deja
-- documentado en el historial de migraciones que nace a partir de aquí.
alter table projects
  add column if not exists forecast_months integer not null default 24;
