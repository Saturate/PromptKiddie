import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

let pool: pg.Pool | undefined;

/** Resolve the Postgres connection string from the environment. */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env (or export DATABASE_URL) " +
        "and ensure Postgres is running (docker compose up -d).",
    );
  }
  return url;
}

/** Lazily-created singleton Drizzle client backed by a pg Pool. */
export function getDb() {
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl() });
  }
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof getDb>;

/** Close the underlying pool (call before process exit in short-lived commands). */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export { schema };
