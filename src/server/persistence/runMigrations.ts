/**
 * Standalone migration runner script.
 *
 * `bun run src/server/persistence/runMigrations.ts` (or `bun run db:migrate`
 * via the package.json shortcut) applies pending migrations against the
 * database referenced by `DATABASE_URL`. Useful for one-off operations and
 * for the docker compose entrypoint when we want to keep migration logic
 * out of the server's hot start path during debugging.
 *
 * In normal production runs the server itself calls `runMigrations` at
 * boot, so this script is a developer convenience rather than a
 * deployment requirement.
 */

import { runMigrations } from "./migrate";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl === "") {
    throw new Error("DATABASE_URL must be set");
  }
  await runMigrations(databaseUrl);
  console.error("Migrations applied");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
