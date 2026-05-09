/**
 * Production entrypoint for the Arimaa session API server.
 *
 * Responsibilities, in order:
 *
 * 1. Read configuration from environment variables.
 * 2. Run pending database migrations.
 * 3. Open the application's Postgres connection pool.
 * 4. Connect to NATS for cross-instance event fan-out.
 * 5. Build the Fastify application and bind the configured port.
 * 6. Wire up graceful shutdown so SIGINT / SIGTERM tear everything down.
 *
 * Nothing in this file is required by the route handlers themselves.
 * `server.ts` is independently testable; this module only exists so the
 * production process knows how to assemble the server with real
 * infrastructure.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { NatsEventBus } from "./events/natsBus";
import { runMigrations } from "./persistence/migrate";
import { PostgresSessionStore } from "./persistence/postgresStore";
import { buildServer } from "./server";

/**
 * Read a required environment variable or throw a descriptive error.
 * Centralizing this avoids each call site re-implementing the same
 * fallback story, and ensures startup fails fast and loudly when
 * configuration is incomplete.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  const natsUrl = requireEnv("NATS_URL");
  const port = Number.parseInt(process.env.PORT ?? "3001", 10);
  const host = process.env.HOST ?? "0.0.0.0";

  // Migrations are idempotent; running them on every boot keeps the
  // schema and the deployed code in lockstep without operators needing
  // to remember a separate command.
  await runMigrations(databaseUrl);

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  const store = new PostgresSessionStore(db);
  const events = await NatsEventBus.create(natsUrl);

  const app = buildServer({ store, events });

  // Bind the port. We don't catch errors here because Fastify already
  // logs them to stderr and returns a rejected promise; node will exit
  // with a non-zero status.
  await app.listen({ host, port });

  // Graceful shutdown. We wait for in-flight requests to drain, close
  // the websocket connections, drain NATS, then close the pool.
  const shutdown = async (signal: string) => {
    try {
      console.error(`Received ${signal}, shutting down`);
      await app.close();
      await events.close();
      await pool.end();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
