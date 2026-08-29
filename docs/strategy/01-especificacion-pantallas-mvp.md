# Especificación de pantallas MVP (nivel wireframe)

> **Continúa de:** `00-analisis-arquitectura-y-mvp.md` — las 20 pantallas del inventario (sección 7.1), con las 12 decisiones de producto ya cerradas.
> **Objetivo:** el nivel de detalle que necesita un diseñador para empezar Figma y un ingeniero para empezar el schema, sin ambigüedad de alcance.

Cada pantalla se especifica con cinco campos fijos: **Propósito**, **Qué muestra** (KPIs/campos clave), **Acciones principales**, **Permisos por rol**, y **Relaciones de datos / navegación**. Los wireframes visuales anotados (Artifact) cubren 12 patrones de pantalla que agrupan las 20 — varias pantallas comparten el mismo patrón visual (lista jerárquica, detalle con tabs, wizard) y se señala explícitamente dónde.

Roles usados en "Permisos" (ver `00-...md` sección 4.7): **Admin** (Project Admin) · **Dev** (Development) · **PM** (Project Management) · **Constr** (Construction) · **Fin** (Finance) · **Sales** · **Exec** (Executive) · **Consult** (Consultant) · **Contractor** · **External** (colaborador externo genérico).

---

## 1. Home / Mis Proyectos

| Campo | Detalle |
|---|---|
| Propósito | Punto de entrada tras login; responde "¿qué proyectos tengo y cuáles necesitan mi atención?" |
| Qué muestra | Lista de proyectos (nombre, asset class, status Deal/Active/Closed, % avance, alerta si hay variance material). Sin analytics consolidado (decisión 8·12). |
| Acciones | Crear nuevo Deal/Proyecto · Abrir proyecto · Filtrar por status |
| Permisos | Todos ven solo los proyectos donde son `ProjectMember`. Admin de Organization ve todos. |
| Relaciones / navegación | Cada fila → Project Dashboard (pantalla 2). "Crear nuevo" → Project Setup Wizard (pantalla 3). *Patrón visual: Wireframe A — Lista.* |

## 2. Project Dashboard

| Campo | Detalle |
|---|---|
| Propósito | Responde en segundos "¿cómo va el proyecto y qué significa para mi inversión?" — unifica Dashboard ejecutivo + Project Overview de los documentos originales. |
| Qué muestra | KPIs Cost / Schedule / Sales / Capital / Returns, cada uno Current vs. Baseline vs. Variance (ver `00-...md` §5, tabla del Planteamiento). Bloques: Current Budget, Committed, Paid, Forecast Final Cost, Contingency remaining · % complete, Completion date, Critical path, Delayed milestones · % sold, Contracted, Collections · Equity invested, Debt drawn, Debt available, Remaining equity need. |
| Acciones | Ninguna transaccional — todo es navegación. Botón "Cerrar el mes" si el periodo está abierto (→ Monthly Close). |
| Permisos | Todos los roles del proyecto ven el dashboard; los números de **retornos del sponsor** (IRR/MOIC, ver info financiera sensible en `00-...md` §4.7) se ocultan a PM/Construction/Sales por default. |
| Relaciones / navegación | Cada KPI es clic­able al módulo/detalle correspondiente (Budget, Schedule, Sales Forecast, Debt Facility, Returns). *Patrón visual: Wireframe B — Dashboard.* |

## 3. Project Setup Wizard (incl. Deal/UW + comparación de Scenarios)

| Campo | Detalle |
|---|---|
| Propósito | Único punto de entrada para evaluar una oportunidad (Deal/UW) y, si se aprueba, promoverla a Project activo (decisión 8·01). |
| Qué muestra | Pasos: (1) Project — nombre, ubicación, `currency`/`market` (decisión 8·02), SPV; (2) Strategy — Development/Acquisition; (3) Asset — Residential for Sale (único en MVP, decisión 8·04); (4) Assumptions — precio/m², costo estimado, ritmo de venta, tasa; (5) Scenarios — comparar Base/Downside/Upside moviendo los supuestos del paso 4 (ver `00-...md` §3.3); (6) Capital — Equity only o Equity+Debt; (7) Team — asignar Project Roles. |
| Acciones | Guardar como Deal (borrador) · Agregar/duplicar Scenario · **Aprobar Deal → Project** (congela el Scenario elegido como Baseline, primer Snapshot) |
| Permisos | Crear Deal: cualquier Dev/Admin. **Aprobar** (promover a Project): requiere rol Admin o Dev con `Approve` (ver Approval Authorities). |
| Relaciones / navegación | Al aprobar, crea `Project` + `Snapshot` Baseline + copia Team. El Scenario no elegido queda archivado (solo lectura, para referencia histórica del UW). *Patrón visual: Wireframe C — Wizard + comparación de escenarios.* |

## 4. Project Team & Permisos

| Campo | Detalle |
|---|---|
| Propósito | Administrar quién tiene acceso al proyecto y con qué rol. |
| Qué muestra | Tabla Team Member × Project Role (roles fijos predeterminados, decisión 8·06) × Internal/External. |
| Acciones | Agregar/quitar miembro · Cambiar rol (de la lista fija) · Marcar como External Collaborator (limita a My Tasks/My Contracts/My Documents/My Approvals) |
| Permisos | Solo Admin edita. Todos los demás roles ven la lista en modo lectura. |
| Relaciones / navegación | Cada rol determina Module Access + Action Permission (ver `00-...md` §4.7); no hay editor de permisos custom en V1. *Patrón visual: Wireframe D — Tabla de administración.* |

## 5. Schedule / Gantt

| Campo | Detalle |
|---|---|
| Propósito | Programa del proyecto — tareas, dependencias, milestones, responsables. |
| Qué muestra | Gantt con Task, Start, End, Duration, % Progress, Predecessor, Owner. Milestones marcados. Una sola fase por proyecto (decisión 8·05). |
| Acciones | Crear/editar tarea · Definir predecesor y lag · Marcar milestone · Vincular tarea a Budget Line (campo `linkedBudgetLineIds`) |
| Permisos | Edit: Dev, PM, Construction. View: todos los demás. |
| Relaciones / navegación | Cambiar fecha de una tarea vinculada a una `BudgetLine` recalcula su `forecastMethod` (ver `00-...md` §4.2) → dispara recálculo del Cash Flow Engine. *Patrón visual: Wireframe E — Gantt.* |

## 6. Budget (jerárquico)

| Campo | Detalle |
|---|---|
| Propósito | Vista consolidada del presupuesto — el módulo más maduro del MVP. |
| Qué muestra | Jerarquía Category → Cost Code → Sub-code, con columnas Original / Changes / Current / Committed / Paid / Forecast / Variance (todas calculadas, no capturadas — ver `00-...md` §4.1). |
| Acciones | Expandir/colapsar niveles · Exportar a Excel · Ir a Budget Line Detail |
| Permisos | Edit (crear/ajustar líneas): Dev, PM, Finance. View: todos. |
| Relaciones / navegación | Cada fila → Budget Line Detail (pantalla 7). *Patrón visual: Wireframe F — Tabla jerárquica financiera.* |

## 7. Budget Line Detail

| Campo | Detalle |
|---|---|
| Propósito | El detalle transaccional de una partida — responde los 5 números (Original/Current/Committed/Actual/Forecast Final) sin captura manual. |
| Qué muestra | Historial de Contratos, Change Orders, Accruals, Invoices, Payments ligados a la línea. Método de forecast vigente (Straight-line/S-Curve/Contract schedule/etc., ver `00-...md` §4.2). |
| Acciones | Cambiar método de forecast (con justificación, va a Audit Trail) · Ver contrato asociado |
| Permisos | Edit: Dev, PM, Finance. View: todos. |
| Relaciones / navegación | → Contract Detail (pantalla 9) por cada contrato ligado. *Reusa patrón de Wireframe F, con panel de detalle lateral.* |

## 8. Contracts (lista)

| Campo | Detalle |
|---|---|
| Propósito | Registro de todos los compromisos contractuales del proyecto. |
| Qué muestra | Contract ID, Counterparty, Cost Code, Original/Current amount, Paid, Pending invoices, Status. |
| Acciones | Nuevo contrato · Filtrar por cost code/status/counterparty |
| Permisos | Edit: Dev, PM, Construction. View: todos. |
| Relaciones / navegación | Cada fila → Contract Detail (pantalla 9). *Patrón visual: Wireframe A — Lista (mismo patrón que Home).* |

## 9. Contract Detail

| Campo | Detalle |
|---|---|
| Propósito | Vista de 360° de un contrato — general, financiero, fechas, términos comerciales, documentos, y sus Change Orders/Invoices. |
| Qué muestra | Tabs: **General** (counterparty, scope, cost code, owner, status) · **Financial** (original/current/paid/pending/remaining) · **Change Orders** · **Invoices & Payments** · **Documents**. |
| Acciones | Nueva factura (→ flujo de aprobación, ver `00-...md` §7.2·A) · Nuevo Change Order (→ pantalla 10) · Adjuntar documento |
| Permisos | Edit: Dev, PM, Construction. Approve (CO/Invoice según umbral): PM/Development Director/CEO según monto (Approval Authorities). View: todos, salvo términos comerciales sensibles ocultos a roles operativos si así se marca. |
| Relaciones / navegación | Cada Invoice al marcarse **Paid** dispara el reconocimiento de Actual (decisión 8·03, cash basis) → recalcula Budget Line → Cash Flow Engine. *Patrón visual: Wireframe G — Detalle con tabs.* |

## 10. Change Orders / Invoices (con approvals)

| Campo | Detalle |
|---|---|
| Propósito | Bandeja transversal de cambios y facturas en cualquier estado del flujo de aprobación (complementa la vista embebida en Contract Detail). |
| Qué muestra | Lista con Cost Impact, Schedule Impact, Status (Submitted/Reviewed/Approved/Scheduled/Paid), Aprobador pendiente. |
| Acciones | Aprobar/Rechazar (si el usuario es el aprobador asignado) · Ver detalle completo (Change Order + impacto en Budget + impacto en IRR antes/después — la "V0" del Impact Engine, ver `00-...md` §7.2·B) |
| Permisos | Approve: según Approval Authorities por monto. View: todos. |
| Relaciones / navegación | Es la misma cola que alimenta My Approvals (pantalla 19), filtrada a Change Orders/Invoices. *Patrón visual: Wireframe A — Lista, con badge de status.* |

## 11. Cost Forecast

| Campo | Detalle |
|---|---|
| Propósito | El rolling forecast mensual — corazón técnico del producto (ver `00-...md` §4.2). |
| Qué muestra | Gráfico de curva (Actual acumulado vs. Forecast Final Cost) + tabla mensual por Cost Code: Actual, Forecast remanente, método vigente. |
| Acciones | Cambiar método de un Cost Code (Straight-line/S-Curve/Milestone/Contract schedule/Linked to Schedule/Manual) |
| Permisos | Edit: Dev, Finance. View: todos. |
| Relaciones / navegación | Alimenta directamente el bloque "Egresos" del Project Cash Flow (pantalla 16). *Patrón visual: Wireframe H — Chart + tabla mensual.* |

## 12. Residential Inventory

| Campo | Detalle |
|---|---|
| Propósito | Inventario de unidades del motor For Sale (único Revenue Engine en MVP, decisión 8·04). |
| Qué muestra | Grid de unidades: Unit, Type, m², Price/m², Price total, Status (Available/Reserved/Sold). |
| Acciones | Registrar venta (crea `Sale` + `paymentPlanId`) · Ajustar precio/incremento · Filtrar por status |
| Permisos | Edit: Sales, Dev. View: todos. |
| Relaciones / navegación | Cada unidad vendida → Sales/Collections Forecast (pantalla 13). *Patrón visual: Wireframe I — Grid de inventario.* |

## 13. Sales / Collections Forecast

| Campo | Detalle |
|---|---|
| Propósito | Distingue explícitamente Sales (contratado) de Cash Collections (cobrado) — ver `00-...md` §1.1. |
| Qué muestra | Calendario de cobranza por unidad vendida: enganche, pagos durante construcción, escrituración. Ritmo de absorción proyectado vs. real. |
| Acciones | Registrar cobro (actual de Revenue) · Ajustar curva de absorción |
| Permisos | Edit: Sales, Finance. View: todos. |
| Relaciones / navegación | Alimenta el bloque "Ingresos" del Project Cash Flow (pantalla 16). *Reusa patrón de Wireframe H.* |

## 14. Debt Facility

| Campo | Detalle |
|---|---|
| Propósito | Underwriting y administración del crédito de construcción (único, decisión 8·07: solo Equity First). |
| Qué muestra | Lender, loan amount, LTC/LTV, rate/spread, term/amortization, interest reserve, commitment fee, saldo actual, covenants (captura manual, sin alertas automáticas en MVP). |
| Acciones | Editar términos (solo antes de la primera disposición) · Registrar covenant test |
| Permisos | Edit: Finance, Dev. View: todos salvo pricing si se marca sensible. |
| Relaciones / navegación | → Debt Draws (pantalla 15). *Patrón visual: Wireframe J — Ficha de facility.* |

## 15. Debt Draws

| Campo | Detalle |
|---|---|
| Propósito | Ejecutar y dar seguimiento a las disposiciones de deuda que calcula automáticamente el Cash Flow Engine (ver `00-...md` §4.4). |
| Qué muestra | Lista de draws: mes, monto solicitado, status (Requested/Submitted/Approved/Funded), saldo resultante, interés acumulado. |
| Acciones | Solicitar draw (pre-llenado por el motor Equity First) · Adjuntar draw certificate · Marcar Funded |
| Permisos | Edit: Finance. Approve: Dev/Admin. View: todos. |
| Relaciones / navegación | Cada draw funded actualiza saldo de deuda → recalcula Returns (pantalla 17). *Reusa patrón de Wireframe A — Lista.* |

## 16. Project Cash Flow

| Campo | Detalle |
|---|---|
| Propósito | La lectura directa del Cash Flow Engine — no es una pantalla con lógica propia (ver `00-...md` §4.3). |
| Qué muestra | Ledger mensual: Ingresos (collections) − Egresos (cost forecast) = Cash flow antes de financiamiento · Debt draws/interest/payments · Equity contributions/distributions · Cash flow neto acumulado. |
| Acciones | Ninguna — solo lectura y export. Cambiar de vista Unlevered/Levered. |
| Permisos | View: todos (montos agregados); el detalle de equity por inversionista se oculta a roles operativos. |
| Relaciones / navegación | → Returns/Business Plan (pantalla 17) para las métricas derivadas. *Patrón visual: Wireframe K — Ledger mensual.* |

## 17. Returns / Business Plan

| Campo | Detalle |
|---|---|
| Propósito | Resultado derivado — nunca captura assumptions manualmente (decisión 8·09). Compara Baseline vs. Actual vs. Current Forecast por Snapshot (ver `00-...md` §3.3). |
| Qué muestra | IRR (unlevered/levered), MOIC, NPV, Yield on Cost, Development Spread, Profit Margin, Sources & Uses — cada uno con su columna Baseline / Current Forecast / Actual y variance. |
| Acciones | Seleccionar Snapshot para comparar · Export a Excel/PDF |
| Permisos | View: Admin, Dev, Finance, Exec. Oculto por default a PM/Construction/Sales (información financiera sensible, §4.7). |
| Relaciones / navegación | Cada Snapshot fue generado por un Monthly Close (pantalla 18) — no se editan aquí. *Reusa patrón de Wireframe K, con selector de Snapshot.* |

## 18. Monthly Close (wizard de 9 pasos)

| Campo | Detalle |
|---|---|
| Propósito | El ritual mensual que retiene al usuario — ver `00-...md` §4.6 y el diagrama en loop. Wizard guiado de una sola sesión, no 9 pantallas sueltas (§7.2·C). |
| Qué muestra | Barra de progreso con los 9 pasos: (1) marcar invoices Paid — nativo + import batch; (2) revisar budget/CO; (3) actualizar forecast remanente; (4) actualizar schedule; (5) actualizar ventas/cobranza; (6) recalcular deuda/interés/equity; (7) recalcular cash flow/retornos; (8) revisar variance drivers; (9) cerrar periodo. |
| Acciones | Guardar y continuar (checkpoint por paso) · Cerrar periodo (crea `Snapshot` inmutable, ya no editable) |
| Permisos | Iniciar/cerrar: Dev, Finance, Admin. Los demás roles pueden completar pasos específicos si se les asigna (ej. Sales confirma paso 5). |
| Relaciones / navegación | Al cerrar, genera el `Snapshot` que alimenta Returns (17) y Portfolio (si existiera). *Patrón visual: Wireframe L — Wizard guiado.* |

## 19. My Approvals

| Campo | Detalle |
|---|---|
| Propósito | Un solo lugar transversal para "qué necesita mi atención" (principio de UX §9·4) — no dispersar approvals por módulo. |
| Qué muestra | Cola de `ApprovalRequest` asignados al usuario: Change Orders, Invoices, Budget Changes, Debt Draws — con monto, quién lo generó, cuánto lleva pendiente. |
| Acciones | Aprobar / Rechazar / Ver detalle completo (redirige al objeto: Contract Detail, Debt Draws, etc.) |
| Permisos | Cada usuario ve solo lo que le corresponde aprobar según Approval Authorities. |
| Relaciones / navegación | Es una vista filtrada de `ApprovalRequest` — no duplica datos. *Patrón visual: Wireframe A — Lista, variante "inbox".* |

## 20. Reports & Export

| Campo | Detalle |
|---|---|
| Propósito | Los 4–5 reportes core del MVP (decisión 8·08) — el resto es backlog explícito. |
| Qué muestra | Dashboard (export), Budget vs Actual, Cost Forecast, Business Plan/Returns — cada uno exportable a Excel/PDF. |
| Acciones | Seleccionar reporte · Elegir rango de fechas/Snapshot · Exportar |
| Permisos | Lo que cada rol puede exportar respeta lo que puede ver en pantalla (info sensible no se filtra por PDF). |
| Relaciones / navegación | Cada reporte es una vista de export de datos que ya existen en otras pantallas — no hay captura aquí. *Patrón visual: Wireframe A — Lista simple.* |

---

## Pantallas de Platform Core (transversales, fuera de las 20 numeradas)

Heredadas del Blueprint pero acotadas a lo que el MVP realmente construye (ver `00-...md` §4.7 y §6):

| Pantalla | Alcance en MVP |
|---|---|
| Organization Users | Lista simple de usuarios de la organización y a qué proyectos pertenecen |
| Notifications Center | Feed de notificaciones básicas (contract expiring, CO pendiente, draw due, budget excedido) — sin reglas configurables |
| Audit Trail | Log de cambios en objetos financieros (quién/cuándo/qué cambió), navegable desde cada objeto, no como pantalla independiente de primer nivel |

*Explícitamente fuera del MVP (decisión 8·06): Role Template editor, Permissions Matrix editor, Approval Rules editor — los roles y reglas de aprobación son fijos.*

---

## Mapa de patrones visuales → pantallas

| Patrón (wireframe) | Pantallas que lo usan |
|---|---|
| **A — Lista** | 1, 8, 10, 15, 19, 20 |
| **B — Dashboard** | 2 |
| **C — Wizard + escenarios** | 3 |
| **D — Tabla de administración** | 4 |
| **E — Gantt** | 5 |
| **F — Tabla jerárquica financiera** | 6, 7 |
| **G — Detalle con tabs** | 9 |
| **H — Chart + tabla mensual** | 11, 13 |
| **I — Grid de inventario** | 12 |
| **J — Ficha de facility** | 14 |
| **K — Ledger mensual** | 16, 17 |
| **L — Wizard guiado** | 18 |

Los wireframes visuales anotados de estos 12 patrones se publicaron como Artifact — ver el enlace compartido en la conversación.
