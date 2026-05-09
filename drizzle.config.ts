/**
 * Drizzle Kit configuration.
 *
 * `bun run db:generate` reads `src/server/persistence/schema.ts`, diffs it
 * against the prior migration set under `src/server/migrations`, and emits
 * a new SQL migration file describing the change. The runtime migration
 * runner in `src/server/persistence/migrate.ts` then applies them in order
 * at server start.
 *
 * We deliberately keep the migration directory under `src/server` so the
 * Docker build copies it as part of the server image without needing
 * extra COPY directives.
 */

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/persistence/schema.ts",
  out: "./src/server/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Used by `drizzle-kit studio` and `drizzle-kit push`. Production uses
    // `DATABASE_URL` from `docker-compose.yml`.
    url:
      process.env.DATABASE_URL ??
      "postgres://arimaa:arimaa@localhost:5432/arimaa",
  },
});
