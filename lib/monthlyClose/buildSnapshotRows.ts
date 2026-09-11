// Monthly Close (§4.6, §7.1 pantalla 18) — paso 9, "Cerrar periodo".
//
// Esta app no tiene motor de versionado de datos por periodo (los
// invoices/collections/draws son siempre el estado "hoy", no "como se
// veía a fin de mes X") — así que un Monthly Close no reconstruye el
// pasado, congela el `MonthlyLedger`/returns YA calculados en vivo (los
// mismos que leen /cashflow y /returns) en las tablas de `snapshots`.
// Esta función es la parte pura: toma el ledger + métricas de retorno ya
// calculadas y las convierte en las filas a insertar — sin tocar la DB,
// para poder probarla igual que el resto de los motores (rollingForecast,
// computeCriticalPath, allocateEquityFirst, etc.).
import type { MonthlyLedger } from "@/lib/businessplan/monthlyLedger";

export type CashFlowCategory =
  | "revenue"
  | "cost"
  | "debt_draw"
  | "debt_interest"
  | "debt_principal"
  | "equity_contribution"
  | "equity_distribution";

export interface SnapshotPeriodRow {
  periodMonth: string; // "YYYY-MM-DD", siempre día 1
  isActual: boolean;
  lines: { category: CashFlowCategory; amount: number }[];
}

export interface SnapshotReturnMetric {
  scope: "project" | "equity";
  metricKey:
    | "irr_unlevered"
    | "irr_levered"
    | "moic"
    | "npv"
    | "profit_margin"
    | "total_development_cost"
    | "equity_required";
  value: number;
}

export interface ReturnsForSnapshot {
  unleveredIrr: number | null;
  leveredIrr: number | null;
  unleveredNpv: number;
  unleveredMoic: number | null;
  leveredMoic: number | null;
  profitMargin: number | null;
}

function addMonths(start: Date, n: number): string {
  const d = new Date(start.getFullYear(), start.getMonth() + n, 1);
  return d.toISOString().slice(0, 10);
}

/** Un renglón cash_flow_periods (+ sus cash_flow_lines) por mes del
 * horizonte — solo se omiten categorías en cero para no llenar la tabla
 * de ceros irrelevantes. */
export function buildCashFlowPeriodRows(ledger: MonthlyLedger): SnapshotPeriodRow[] {
  const rows: SnapshotPeriodRow[] = [];
  for (let i = 0; i < ledger.periods; i++) {
    const lines: { category: CashFlowCategory; amount: number }[] = [];
    const push = (category: CashFlowCategory, amount: number) => {
      if (amount !== 0) lines.push({ category, amount });
    };
    push("revenue", ledger.ingresos[i]);
    push("cost", ledger.egresos[i]);
    push("debt_draw", ledger.debtDrawsIn[i]);
    push("debt_interest", ledger.debtInterestOut[i]);
    push("debt_principal", ledger.debtPrincipalOut[i]);
    push("equity_contribution", ledger.equityIn[i]);
    push("equity_distribution", ledger.equityOut[i]);

    rows.push({
      periodMonth: addMonths(ledger.startMonth, i),
      isActual: i <= ledger.currentPeriodIndex,
      lines,
    });
  }
  return rows;
}

/** Solo se snapshotea lo que /returns ya calcula y muestra en vivo — sin
 * inventar yield_on_cost/development_spread/peak_equity, que ningún
 * motor de esta app calcula todavía (mismo corte ya declarado en
 * lib/businessplan/returns.ts). Un metric_key queda fuera de la lista si
 * su valor es null (p.ej. IRR de equity sin distribuciones todavía). */
export function buildReturnMetricRows(
  ledger: MonthlyLedger,
  returns: ReturnsForSnapshot
): SnapshotReturnMetric[] {
  const rows: SnapshotReturnMetric[] = [];
  const push = (scope: "project" | "equity", metricKey: SnapshotReturnMetric["metricKey"], value: number | null) => {
    if (value !== null && Number.isFinite(value)) rows.push({ scope, metricKey, value });
  };

  push("project", "irr_unlevered", returns.unleveredIrr);
  push("equity", "irr_levered", returns.leveredIrr);
  push("project", "npv", returns.unleveredNpv);
  push("project", "moic", returns.unleveredMoic);
  push("equity", "moic", returns.leveredMoic);
  push("project", "profit_margin", returns.profitMargin);
  push("project", "total_development_cost", ledger.totals.currentBudget);
  push("project", "equity_required", ledger.totals.equityCommitment);

  return rows;
}
