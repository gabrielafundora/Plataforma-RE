// Applies docs/schema/schema.sql directly via the `pg` driver — no
// `psql` CLI required. Cross-platform on purpose: `psql "$DATABASE_URL"`
// needs both the Postgres client tools installed and a Unix-style
// shell, neither of which a plain Windows + Node setup has.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Client } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local first.");
}

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, "../../docs/schema/schema.sql");

async function main() {
  const sql = readFileSync(schemaPath, "utf8");
  const client = new Client({
    connectionString,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });

  await client.connect();
  console.log(`Applying ${schemaPath}…`);
  try {
    await client.query(sql);
    console.log("Schema applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
