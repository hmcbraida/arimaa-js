/**
 * Runtime database migration runner.
 *
 * Called from the production server entrypoint immediately before binding
 * the HTTP port. The runner is idempotent -- Drizzle records applied
 * migrations in a `__drizzle_migrations` table and skips anything already
 * present -- so calling it on every start, including in development hot
 * reloads, is safe.
 *
 * Putting this in its own module (rather than inlining into `index.ts`)
 * keeps the migration concerns out of the route configuration code and
 * lets the test suite ignore migrations entirely (since tests use the
 * in-memory store).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * Resolve the absolute path to the migrations folder.
 *
 * The folder lives next to this file in source. In the Docker image it is
 * copied alongside the compiled JS, so an `import.meta.url` based lookup
 * works in both local development (running TS via bun) and the production
 * container (running compiled JS via bun).
 */
function migrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../migrations");
}

/**
 * Run any pending migrations against the configured database.
 *
 * The pool we create here is short-lived: we open it just to apply
 * migrations and close it before returning. The application's normal
 * Postgres pool is created separately and lives for the process lifetime.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: migrationsFolder() });
  } finally {
    await pool.end();
  }
}
