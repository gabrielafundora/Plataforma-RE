// Schedule / Gantt (§7.1, pantalla 5) — ruta crítica simplificada.
//
// `tasks.predecessor_task_id` es singular (una tarea tiene a lo más un
// predecesor, no varios) — la estructura de dependencias es un bosque
// de árboles, no un grafo general. Eso hace que el CPM completo
// (forward/backward pass, holgura/float por tarea) sea más de lo que
// esta vuelta necesita: lo que de verdad determina cuándo termina el
// proyecto es la cadena de tareas, encadenadas por predecessor, que
// llega hasta la que termina más tarde. Esa cadena es "la ruta
// crítica" en este recorte — no tiene holgura calculada por tarea,
// solo marca qué tareas son las que, si se atrasan, atrasan el
// proyecto completo.
export interface TaskNode {
  id: string;
  endDate: string; // "YYYY-MM-DD"
  predecessorTaskId: string | null;
}

export function computeCriticalPath(tasks: TaskNode[]): Set<string> {
  if (tasks.length === 0) return new Set();

  const byId = new Map(tasks.map((t) => [t.id, t]));
  let last = tasks[0];
  for (const t of tasks) {
    if (t.endDate > last.endDate) last = t;
  }

  const chain = new Set<string>();
  let current: TaskNode | undefined = last;
  // `!chain.has(current.id)` corta cualquier ciclo accidental en los
  // datos (predecessor_task_id no tiene una restricción en schema.sql
  // que impida uno) en vez de dejar el loop correr para siempre.
  while (current && !chain.has(current.id)) {
    chain.add(current.id);
    current = current.predecessorTaskId ? byId.get(current.predecessorTaskId) : undefined;
  }
  return chain;
}
