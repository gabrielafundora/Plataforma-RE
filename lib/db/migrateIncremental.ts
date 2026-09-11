// Aplica las migraciones pendientes de docs/schema/migrations/ contra la
// base a la que apunta DATABASE_URL.
//
// A diferencia de migrate.ts (que re-aplica TODO docs/schema/schema.sql
// con create table sin "if not exists" — seguro solo contra una base
// vacía, para dev), este script está pensado para correr repetidamente
// contra una base que YA existe y tiene datos, como producción: cada
// archivo de migración es idempotente (if not exists / add column if
// not exists) y la tabla `schema_migrations` registra cuáles ya se
// aplicaron, para no releerlos innecesariamente en cada corrida.
//
// Se ejecuta automáticamente en cada deploy de Vercel vía el script
// "vercel-build" — el arreglo de raíz a dos incidentes seguidos
// (projects.forecast_months, y luego units/collections.updated_at) en
// los que un cambio de schema se probó solo contra la base de dev local
// y nunca llegó a producción hasta que alguien lo corrió a mano en la
// consola de Neon. De aquí en adelante, todo cambio a schema.sql debe
// venir acompañado de su propio archivo en migrations/ — ver
// docs/schema/README.md.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set.");
}

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../docs/schema/migrations");

async function main() {
  const client = new Client({
    connectionString,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    // "if not exists" a propósito: en una base nueva, docs/schema/schema.sql
    // ya crea esta tabla (sección 0); en una base existente que todavía no
    // la tiene (como producción, hasta su primer deploy con este script),
    // esto la crea sin depender de correr schema.sql completo otra vez.
    await client.query(`
      create table if not exists schema_migrations (
        id uuid primary key default gen_random_uuid(),
        filename text not null unique,
        applied_at timestamptz not null default now()
      );
    `);

    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const { rows: appliedRows } = await client.query<{ filename: string }>(
      "select filename from schema_migrations"
    );
    const applied = new Set(appliedRows.map((r) => r.filename));
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log("No hay migraciones pendientes.");
      return;
    }

    for (const file of pending) {
      const sql = readFileSync(path.join(migrationsDir, file), "utf8");
      console.log(`Aplicando ${file}…`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("commit");
        console.log(`  ✓ ${file}`);
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }

    console.log(`${pending.length} migración(es) aplicada(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
