# Real Estate Development OS — Slice 1: Costs + Cash Flow Engine

Primer "vertical slice" del producto descrito en `docs/strategy/`: en vez de construir las 20 pantallas del MVP de una vez, se probó de punta a punta el riesgo técnico más alto (§10 del documento base) — el motor de Cost Forecast y el ciclo Budget → Contract → Invoice → Payment con reconocimiento de Actuals en cash-basis (decisión 8·03).

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript
- **PostgreSQL** vía **Drizzle ORM** — hoy contra Postgres local; el mismo `DATABASE_URL` apuntará a un proyecto de Supabase hospedado cuando se cree (no hay nada específico de Supabase en el código todavía: Auth/Storage se integran en una slice posterior)
- **Tailwind CSS** para la UI
- **Vitest** para pruebas unitarias

## Qué SÍ incluye esta slice

- Schema real corriendo (`docs/schema/schema.sql`, ya validado — ver `docs/schema/README.md`).
- `lib/forecast/engine.ts` — el motor de rolling forecast (Straight-line / S-Curve / Front·Back loaded) con "Actuals + Remaining Forecast = Forecast Final Cost" implementado y probado (`npm test`).
- Budget (Wireframe F) leyendo directo de la vista `budget_line_rollup` — los 5 números nunca son capturados a mano.
- Contract Detail (Wireframe G) con el flujo completo: crear factura → marcarla Paid → el Actual del Budget se actualiza solo.
- Probado real, no solo unit tests: un flujo de browser (Playwright, headless) creó una factura y la marcó pagada contra la app corriendo de verdad, confirmando que `Actual` sube exactamente cuando se registra el pago.

## Qué NO incluye a propósito (siguiente slice)

- Auth / multi-tenancy real (hoy no hay login; el seed crea un usuario/org de desarrollo).
- Approval Requests / umbrales de aprobación (§4.7) — las facturas se crean directo en `approved`.
- Plan (Gantt), Revenue, Capital, Business Plan, Monthly Close — todo lo que no sea Costs.
- Supabase Auth/Storage — se conectan cuando exista un proyecto de Supabase real.

## Cómo correrlo

```bash
npm install

# 1. Base de datos — un proyecto gratis en neon.tech o supabase.com es lo
#    más simple (Windows incluido: no requiere instalar Postgres ni psql,
#    db:migrate y db:seed corren en Node puro). Postgres local también
#    funciona si lo prefieres — es el mismo schema.sql cualquiera de los dos.
cp .env.example .env.local   # pega tu connection string en DATABASE_URL
npm run db:migrate           # aplica docs/schema/schema.sql
npm run db:seed              # crea un org/proyecto/contrato de ejemplo

# 2. Pruebas del motor de forecast
npm test

# 3. La app
npm run dev                  # http://localhost:3000
```

## Estructura

```
app/                      Next.js App Router — páginas
  page.tsx                 Home / Mis Proyectos
  projects/[id]/budget/    Budget (Wireframe F)
  budget-lines/[id]/       Budget Line Detail
  contracts/[id]/          Contract Detail (Wireframe G)
lib/
  db/                      Drizzle schema + client + seed
  forecast/                El motor de Cost Forecast (§4.2) y sus tests
  actions/                 Server Actions (crear factura, marcar pagada)
docs/
  strategy/                Los 3 documentos de arquitectura y decisiones de producto
  schema/                  schema.sql (fuente de verdad de la base de datos) + notas
```
