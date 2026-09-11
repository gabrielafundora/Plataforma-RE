import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tasks, milestones, phases, projects, users } from "@/lib/db/schema";
import { AppHeader } from "@/components/AppHeader";
import { ProjectNav } from "@/components/ProjectNav";
import { computeCriticalPath } from "@/lib/schedule/criticalPath";
import { createTask, updateTaskProgress, updateTask, createMilestone } from "@/lib/actions/schedule";

// Pantalla 5 — Schedule / Gantt (§3, §7.1). Una sola fase por proyecto
// (decisión 8·05). El Gantt es una tabla con una barra de línea de
// tiempo dibujada en CSS puro (posición/ancho en % relativos al rango
// del proyecto) — sin librería de gráficos, mismo espíritu que las
// matrices horizontales de Forecast/Cash Flow.
//
// Fuera de esta vuelta (disclosed, no silencioso): vincular una tarea a
// una Budget Line ("linkedBudgetLineIds" en la spec) y que mover su
// fecha recalcule el forecastMethod — necesita una tabla puente que no
// existe y un motor de curva nuevo para milestone/contract_schedule/
// linked_to_schedule (los 4 métodos que Forecast ya declara como no
// implementados). La ruta crítica que se muestra aquí es una
// simplificación (ver lib/schedule/criticalPath.ts) — no es CPM
// completo con holguras.
export const dynamic = "force-dynamic";

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

export default async function ProjectSchedulePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));

  if (!project) {
    return (
      <>
        <AppHeader />
        <main className="mx-auto max-w-6xl px-6 py-12 text-ink-soft">Proyecto no encontrado.</main>
      </>
    );
  }

  const [phase] = await db.select().from(phases).where(eq(phases.projectId, projectId));

  const taskRows = phase
    ? (
        await db
          .select({
            id: tasks.id,
            name: tasks.name,
            startDate: tasks.startDate,
            endDate: tasks.endDate,
            progressPct: tasks.progressPct,
            predecessorTaskId: tasks.predecessorTaskId,
            lagDays: tasks.lagDays,
            ownerUserId: tasks.ownerUserId,
          })
          .from(tasks)
          .where(eq(tasks.phaseId, phase.id))
          .orderBy(tasks.startDate)
      ).map((t) => ({ ...t, progressPct: Number(t.progressPct) }))
    : [];

  const milestoneRows = phase
    ? await db
        .select({
          id: milestones.id,
          name: milestones.name,
          targetDate: milestones.targetDate,
          isCritical: milestones.isCritical,
          taskId: milestones.taskId,
        })
        .from(milestones)
        .where(eq(milestones.phaseId, phase.id))
        .orderBy(milestones.targetDate)
    : [];

  const userRows = await db.select({ id: users.id, fullName: users.fullName }).from(users);
  const userNameById = new Map(userRows.map((u) => [u.id, u.fullName]));
  const taskNameById = new Map(taskRows.map((t) => [t.id, t.name]));

  const criticalPath = computeCriticalPath(
    taskRows.map((t) => ({ id: t.id, endDate: t.endDate, predecessorTaskId: t.predecessorTaskId }))
  );

  // --- Stats para las tarjetas de arriba ---
  const pctComplete =
    taskRows.length > 0 ? Math.round(taskRows.reduce((s, t) => s + t.progressPct, 0) / taskRows.length) : 0;
  const completionDate = taskRows.length > 0 ? taskRows.reduce((max, t) => (t.endDate > max ? t.endDate : max), taskRows[0].endDate) : null;
  const today = new Date().toISOString().slice(0, 10);
  const overdueMilestones = milestoneRows.filter((m) => m.targetDate < today).length;

  // --- Rango de fechas para dibujar las barras del Gantt ---
  const allDates = [
    ...taskRows.flatMap((t) => [t.startDate, t.endDate]),
    ...milestoneRows.map((m) => m.targetDate),
  ];
  const rangeStart = allDates.length > 0 ? allDates.reduce((min, d) => (d < min ? d : min)) : today;
  const rangeEnd = allDates.length > 0 ? allDates.reduce((max, d) => (d > max ? d : max)) : today;
  const rangeDays = Math.max(1, daysBetween(rangeStart, rangeEnd));

  const barStyle = (start: string, end: string) => {
    const left = (daysBetween(rangeStart, start) / rangeDays) * 100;
    const width = Math.max((daysBetween(start, end) / rangeDays) * 100, 0.5);
    return { left: `${left}%`, width: `${width}%` };
  };

  return (
    <>
      <AppHeader crumb={<Link href="/" className="hover:text-blueprint">Mis Proyectos</Link>} />
      <ProjectNav projectId={projectId} active="schedule" />
      <main className="mx-auto max-w-[1400px] px-6 py-12">
        <div className="text-sm text-ink-soft">Schedule</div>
        <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{project.name}</h1>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="% complete" value={`${pctComplete}%`} />
          <Stat label="Completion date" value={completionDate ?? "—"} />
          <Stat label="Ruta crítica" value={`${criticalPath.size} tarea${criticalPath.size === 1 ? "" : "s"}`} />
          <Stat
            label="Milestones"
            value={`${milestoneRows.length} total${overdueMilestones > 0 ? ` · ${overdueMilestones} vencidos` : ""}`}
            tone={overdueMilestones > 0 ? "bad" : undefined}
          />
        </div>

        <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-surface shadow-sm">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b border-line bg-surface-2 text-xs font-medium text-ink-soft">
              <tr>
                <th className="sticky left-0 z-10 min-w-[200px] bg-surface-2 px-4 py-3 text-left">Task</th>
                <th className="min-w-[260px] px-4 py-3 text-left">Timeline</th>
                <th className="px-4 py-3 text-left">Start</th>
                <th className="px-4 py-3 text-left">End</th>
                <th className="px-4 py-3 text-right">Duration</th>
                <th className="min-w-[150px] px-4 py-3 text-left">% Progress</th>
                <th className="px-4 py-3 text-left">Predecessor</th>
                <th className="px-4 py-3 text-left">Owner</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {taskRows.map((t) => {
                const isCritical = criticalPath.has(t.id);
                const style = barStyle(t.startDate, t.endDate);
                return (
                  <tr key={t.id} className={isCritical ? "bg-redline-soft/20" : ""}>
                    <td className="sticky left-0 z-10 bg-surface px-4 py-3 text-ink">
                      {t.name}
                      {isCritical && <span className="ml-1.5 text-xs font-medium text-redline">crítica</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="relative h-4 w-full rounded bg-surface-2">
                        <div
                          className={`absolute top-0 h-4 rounded ${isCritical ? "bg-redline/70" : "bg-blueprint/70"}`}
                          style={style}
                        >
                          <div
                            className={`h-4 rounded-l ${isCritical ? "bg-redline" : "bg-blueprint"}`}
                            style={{ width: `${t.progressPct}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{t.startDate}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{t.endDate}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-ink-faint">
                      {daysBetween(t.startDate, t.endDate)}d
                    </td>
                    <td className="px-4 py-3">
                      <form action={updateTaskProgress} className="flex items-center gap-1.5">
                        <input type="hidden" name="taskId" value={t.id} />
                        <input
                          type="number"
                          name="progressPct"
                          min={0}
                          max={100}
                          defaultValue={t.progressPct}
                          className="w-16 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink"
                        />
                        <button className="rounded-lg border border-line-strong px-2 py-1 text-xs font-medium text-ink-soft transition-colors hover:bg-paper">
                          %
                        </button>
                      </form>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-faint">
                      {t.predecessorTaskId ? taskNameById.get(t.predecessorTaskId) ?? "—" : "—"}
                      {t.predecessorTaskId && t.lagDays !== 0 ? ` (+${t.lagDays}d)` : ""}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-faint">
                      {t.ownerUserId ? userNameById.get(t.ownerUserId) ?? "—" : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <details>
                        <summary className="cursor-pointer text-xs font-medium text-blueprint">Editar</summary>
                        <TaskEditForm task={t} projectId={projectId} taskRows={taskRows} userRows={userRows} />
                      </details>
                    </td>
                  </tr>
                );
              })}
              {taskRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-ink-soft">
                    Sin tareas todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <h2 className="mt-10 text-sm font-medium text-ink-soft">+ Nueva tarea</h2>
        <form
          action={createTask}
          className="mt-3 flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface p-5 shadow-sm"
        >
          <input type="hidden" name="projectId" value={projectId} />
          <Field label="Nombre">
            <input name="name" required placeholder="Cimentación" className="w-48 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
          </Field>
          <Field label="Inicio">
            <input type="date" name="startDate" required className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
          </Field>
          <Field label="Fin">
            <input type="date" name="endDate" required className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
          </Field>
          <Field label="Predecesor">
            <select name="predecessorTaskId" className="w-40 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink">
              <option value="">Ninguno</option>
              {taskRows.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Lag (días)">
            <input type="number" name="lagDays" defaultValue={0} className="w-20 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
          </Field>
          <Field label="Owner">
            <select name="ownerUserId" className="w-40 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink">
              <option value="">Sin asignar</option>
              {userRows.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </select>
          </Field>
          <button className="rounded-lg bg-blueprint px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">
            Crear tarea
          </button>
        </form>

        <h2 className="mt-10 font-display text-lg font-semibold text-ink">Milestones</h2>
        <ul className="mt-3 grid gap-2">
          {milestoneRows.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4 text-sm shadow-sm">
              <span className="font-medium text-ink">{m.name}</span>
              <span className="text-ink-faint">· {m.targetDate}</span>
              {m.targetDate < today && <span className="text-xs font-medium text-redline">vencido</span>}
              {m.isCritical && (
                <span className="rounded-full bg-redline-soft px-2 py-0.5 text-xs font-medium text-redline">Crítico</span>
              )}
              {m.taskId && <span className="text-xs text-ink-faint">vinculado a {taskNameById.get(m.taskId) ?? "—"}</span>}
            </li>
          ))}
          {milestoneRows.length === 0 && <li className="text-sm text-ink-soft">Sin milestones todavía.</li>}
        </ul>
        <form action={createMilestone} className="mt-3 flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface p-4 shadow-sm">
          <input type="hidden" name="projectId" value={projectId} />
          <Field label="Nombre">
            <input name="name" required placeholder="Entrega de obra gris" className="w-48 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
          </Field>
          <Field label="Fecha">
            <input type="date" name="targetDate" required className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink" />
          </Field>
          <Field label="Vincular a tarea">
            <select name="taskId" className="w-40 rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink">
              <option value="">Ninguna</option>
              {taskRows.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-1.5 pb-2 text-xs font-medium text-ink-soft">
            <input type="checkbox" name="isCritical" value="true" />
            Crítico
          </label>
          <button className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:bg-paper">
            Agregar milestone
          </button>
        </form>

        <p className="mt-8 max-w-2xl text-xs text-ink-faint">
          La ruta crítica (filas en rojo) es la cadena de tareas, encadenadas por predecesor, que termina
          en la fecha de término más tardía — no es CPM completo con holguras por tarea. Vincular una tarea
          a una partida de Budget para que su forecast use el método "Linked to Schedule" queda fuera de
          esta vuelta.
        </p>
      </main>
    </>
  );
}

function TaskEditForm({
  task,
  projectId,
  taskRows,
  userRows,
}: {
  task: { id: string; name: string; startDate: string; endDate: string; predecessorTaskId: string | null; lagDays: number; ownerUserId: string | null };
  projectId: string;
  taskRows: { id: string; name: string }[];
  userRows: { id: string; fullName: string }[];
}) {
  return (
    <form action={updateTask} className="mt-2 flex flex-wrap items-end gap-3 rounded-lg border border-line-strong bg-paper p-3">
      <input type="hidden" name="taskId" value={task.id} />
      <input type="hidden" name="projectId" value={projectId} />
      <Field label="Nombre">
        <input name="name" required defaultValue={task.name} className="w-40 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink" />
      </Field>
      <Field label="Inicio">
        <input type="date" name="startDate" required defaultValue={task.startDate} className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink" />
      </Field>
      <Field label="Fin">
        <input type="date" name="endDate" required defaultValue={task.endDate} className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink" />
      </Field>
      <Field label="Predecesor">
        <select name="predecessorTaskId" defaultValue={task.predecessorTaskId ?? ""} className="w-32 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink">
          <option value="">Ninguno</option>
          {taskRows.filter((t) => t.id !== task.id).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Lag (días)">
        <input type="number" name="lagDays" defaultValue={task.lagDays} className="w-16 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink" />
      </Field>
      <Field label="Owner">
        <select name="ownerUserId" defaultValue={task.ownerUserId ?? ""} className="w-32 rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink">
          <option value="">Sin asignar</option>
          {userRows.map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </select>
      </Field>
      <button className="rounded-lg bg-blueprint px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90">
        Guardar
      </button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-ink-soft">
      {label}
      {children}
    </label>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone === "bad" ? "text-redline" : "text-ink"}`}>
        {value}
      </div>
    </div>
  );
}
