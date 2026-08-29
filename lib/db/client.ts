import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

// `pg` ships as CommonJS; under "type": "module" its named exports
// don't come through cleanly, so destructure off the default import.
const { Pool } = pg;
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and point it " +
      "at a local Postgres with docs/schema/schema.sql already applied."
  );
}

// A single pool for the whole process — fine for the local-dev vertical
// slice. Revisit connection management when this moves to a serverless
// host (Vercel + hosted Postgres) in a later slice.
const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
