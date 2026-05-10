/**
 * Production entrypoint for the Arimaatic API server.
 *
 * Responsibilities, in order:
 *
 * 1. Read configuration from environment variables.
 * 2. Run pending database migrations.
 * 3. Open the Postgres connection pool.
 * 4. Connect to NATS for cross-instance event fan-out.
 * 5. Construct the email sender (SMTP if configured, console fallback
 *    otherwise so a fresh checkout can run end-to-end without an MTA).
 * 6. Construct the JWT access-token signer from `JWT_SECRET`.
 * 7. Build the Fastify application and bind the configured port.
 * 8. Wire up graceful shutdown.
 *
 * Nothing in this file is required by the route handlers themselves
 * -- `server.ts` is independently testable; this module only exists so
 * the production process knows how to assemble the server with real
 * infrastructure.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createAuthTokenSigner, secretFromString } from "./auth/tokens";
import {
  ConsoleEmailSender,
  type EmailSender,
  SmtpEmailSender,
} from "./email/sender";
import { NatsEventBus } from "./events/natsBus";
import { runMigrations } from "./persistence/migrate";
import { buildPostgresDataStore } from "./persistence/postgresStore";
import { buildServer } from "./server";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Resolve the email sender. When `SMTP_HOST` is set we wire up real
 * SMTP via nodemailer; otherwise we fall back to the console sender
 * so a developer running `bun run server` against a bare database
 * still gets a working signup/verification flow (the verification
 * URL is logged to stdout).
 */
function buildEmailSender(): EmailSender {
  const host = process.env.SMTP_HOST;
  if (host === undefined || host === "") {
    return new ConsoleEmailSender();
  }
  const port = Number.parseInt(process.env.SMTP_PORT ?? "587", 10);
  const secure = (process.env.SMTP_SECURE ?? "false") === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = requireEnv("SMTP_FROM");
  return new SmtpEmailSender({
    host,
    port,
    secure,
    auth: user !== undefined && pass !== undefined ? { user, pass } : undefined,
    from,
  });
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  const natsUrl = requireEnv("NATS_URL");
  const jwtSecret = requireEnv("JWT_SECRET");
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? "http://localhost:8080";
  const port = Number.parseInt(process.env.PORT ?? "3001", 10);
  const host = process.env.HOST ?? "0.0.0.0";

  // Migrations are idempotent; running them on every boot keeps the
  // schema and the deployed code in lockstep without operators needing
  // to remember a separate command.
  await runMigrations(databaseUrl);

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  const store = buildPostgresDataStore(db);
  const events = await NatsEventBus.create(natsUrl);
  const emailSender = buildEmailSender();
  const tokenSigner = createAuthTokenSigner(secretFromString(jwtSecret));

  const app = buildServer({
    store,
    events,
    emailSender,
    tokenSigner,
    publicBaseUrl,
  });

  await app.listen({ host, port });

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
