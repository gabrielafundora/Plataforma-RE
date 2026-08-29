# Schema del MVP — notas de lectura

`schema.sql` es DDL de PostgreSQL 14+ **ejecutable y verificado**: corre limpio de punta a punta (44 tablas, 2 vistas, seed data de approval rules) y se probó insertando datos reales a través de toda la cadena Budget→Contract→Invoice→Payment para confirmar que el reconocimiento de Actual en cash-basis (decisión 8·03) funciona exactamente como se decidió — antes de pagar una factura aprobada, `actual_cost` es 0; al registrarse el `Payment`, sube automáticamente.

Deriva directamente de `docs/strategy/00-analisis-arquitectura-y-mvp.md` (secciones 3 y 5) y `docs/strategy/01-especificacion-pantallas-mvp.md`, con las 12 decisiones de producto ya incorporadas al modelo de datos.

## Cómo está organizado

El archivo sigue el mismo orden de dominios que la sección 3.2 del documento base:

1. Enums
2. Organización, acceso y estructura de proyecto
3. Plan (schedule)
4. Costs (budget, contratos, change orders, accruals, invoices, pagos)
5. Revenue (motor For Sale)
6. Capital (equity y deuda)
7. Business Plan (Scenario / Snapshot)
8. Platform Core (approvals, documentos, notificaciones, auditoría)
9. Vistas derivadas
10. Seed data

## Cinco decisiones de diseño que vale la pena entender antes de tocar el schema

**1. Los 5 números de una Budget Line nunca son columnas.**
`original_amount` es la única cantidad que se captura en `budget_lines`. `current_amount`, `committed_amount`, `actual_cost` y `forecast_final_cost` se derivan en la vista `budget_line_rollup` a partir de `budget_changes`, `contracts`, `invoices` y `payments`. Esto hace estructuralmente imposible que un desarrollador "edite el forecast a mano" y rompa la trazabilidad (§4.1 del documento base).

**2. `project_role` es un `ENUM`, no una tabla.**
Es deliberado (decisión 8·06): los roles son fijos en el MVP, así que modelarlos como enum evita construir un editor de roles que nadie pidió. `role_permissions` sí es una tabla — semilla, no editable desde la UI — para que el motor de permisos lea de datos y no de código hardcodeado, y no haya que migrar nada si algún día se habilita un editor.

**3. `Scenario` y `Snapshot` son tablas distintas con reglas de vida distintas.**
`scenarios`/`scenario_assumptions` solo se crean y editan mientras `projects.status = 'deal'` (aplicado a nivel de aplicación, no con un CHECK de base de datos, porque depende de una máquina de estados). Al aprobar el Deal, el escenario elegido pasa a `status='chosen'` y se copia como el primer `snapshot` (`type='baseline'`). Los `snapshots` **nunca se actualizan**, solo se insertan — es la garantía de inmutabilidad que pide §3.3.

**4. `Accrual` nunca toca `actual_cost`.**
La tabla `accruals` existe y se usa para refinar el forecast remanente, pero la vista `budget_line_rollup` calcula `actual_cost` exclusivamente a partir de `payments` sobre `invoices` en estado `paid`. Es la decisión de cash-basis (8·03) aplicada literalmente en el `JOIN` de la vista, no solo documentada en un comentario.

**5. Multi-mercado vive en tres columnas, no en un motor fiscal.**
`projects.currency`/`projects.market` y `contracts.net_amount`/`tax_amount`/`retention_amount` (mismos campos en `invoices`) son genéricos y de captura manual. No hay tablas de tasas de IVA mexicano ni de sales tax por estado — eso es exactamente lo que la decisión 8·02 dejó fuera del MVP.

## Lo que falta a propósito

- **Multi-fase / multi-asset-class**: `phases` existe pero la aplicación crea exactamente una fase por proyecto en el MVP (decisión 8·05). El schema no lo impide con un CHECK porque es una regla de producto, no de integridad de datos — más fácil de relajar después si hace falta.
- **Funding waterfall configurable**: no hay tabla de reglas de waterfall. Equity First (decisión 8·07) se implementa en la lógica de la aplicación que escribe `equity_contributions`/`debt_draws`, no en el schema.
- **Motor de sensibilidad multi-variable / Impact Engine**: fuera de alcance del schema del MVP. El único requisito de datos que sí se resolvió ahora es que `audit_logs` puede registrar el linaje de cualquier `scenario_assumption` o campo financiero (decisión 8·10), para no tener que reconstruir el motor de cálculo cuando se construya el Impact Engine.

## Cómo probarlo

```bash
createdb re_os_dev
psql -d re_os_dev -f docs/schema/schema.sql
```

Requiere la extensión `pgcrypto` (se crea automáticamente vía `CREATE EXTENSION IF NOT EXISTS` al inicio del archivo) para `gen_random_uuid()`.
