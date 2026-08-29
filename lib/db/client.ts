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

// Hosted Postgres (Neon, Supabase, RDS, etc.) requires TLS and usually
// presents a cert our local CA store doesn't know — a bare `new Pool()`
// against one of those fails the connection outright, which surfaces
// here as an opaque "Failed query" with no useful cause underneath.
// A plain local Postgres (localhost/127.0.0.1) doesn't speak TLS at
// all, so we only turn this on for everything else.
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

// A single pool for the whole process — fine for the local-dev vertical
// slice. Revisit connection management when this moves to a serverless
// host (Vercel + hosted Postgres) in a later slice.
const pool = new Pool({
  connectionString,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });
