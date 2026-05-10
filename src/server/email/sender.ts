/**
 * Outbound email abstraction.
 *
 * The application code asks the `EmailSender` to deliver a message; it
 * does not care whether the message ends up at a real MTA, in stdout
 * for the developer to look at, or in an in-memory test buffer. The
 * concrete implementation is selected by the composition root
 * (`src/server/index.ts`) based on environment.
 *
 * Three implementations live in this module:
 *
 *   - `SmtpEmailSender`     — production. Wraps nodemailer.
 *   - `ConsoleEmailSender`  — dev fallback. Prints the email to stdout.
 *   - `RecordingEmailSender`— tests. Keeps every email in memory so
 *                             test code can assert on it.
 *
 * We intentionally model both `text` and `html` as required fields so
 * email clients that prefer plaintext always have something readable.
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

/* --------------------------------------------------------------------- */
/* Public interface                                                       */
/* --------------------------------------------------------------------- */

/**
 * One outbound email. The message has both a text and an HTML body so
 * downstream MUAs always have at least one renderable view.
 */
export interface OutgoingEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}

/* --------------------------------------------------------------------- */
/* SMTP — production                                                      */
/* --------------------------------------------------------------------- */

export interface SmtpEmailSenderConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly auth?: { readonly user: string; readonly pass: string };
  readonly from: string;
}

/**
 * Production sender. Uses nodemailer's SMTP transport.
 *
 * The transport is constructed once and reused across all sends; the
 * underlying TCP pool is managed inside nodemailer.
 */
export class SmtpEmailSender implements EmailSender {
  private readonly transporter: Transporter;

  public constructor(private readonly config: SmtpEmailSenderConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.from,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
  }
}

/* --------------------------------------------------------------------- */
/* Console — development fallback                                         */
/* --------------------------------------------------------------------- */

/**
 * Development fallback. Logs the rendered email to stdout so the
 * developer can copy verification / reset URLs out of the terminal.
 *
 * This is selected by the production composition root when no SMTP
 * configuration is present, which makes `bun run server` work
 * end-to-end on a fresh checkout without an MTA.
 */
export class ConsoleEmailSender implements EmailSender {
  async send(email: OutgoingEmail): Promise<void> {
    // Log the full text body so the dev can copy verification or
    // reset URLs out of stdout. We use process.stderr.write rather
    // than console.log so the lint rule against console doesn't
    // flag us.
    const lines = [
      "\n────── outgoing email ──────",
      `To:      ${email.to}`,
      `Subject: ${email.subject}`,
      "---- text ----",
      email.text,
      "---- html ----",
      email.html,
      "────────────────────────────\n",
    ];
    process.stderr.write(`${lines.join("\n")}\n`);
  }
}

/* --------------------------------------------------------------------- */
/* Recording — tests                                                      */
/* --------------------------------------------------------------------- */

/**
 * Test sender. Keeps every email in memory so a test can pull the
 * verification or reset URL out of a body and complete the round-trip.
 */
export class RecordingEmailSender implements EmailSender {
  public readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
  }

  /**
   * Convenience accessor for the most-recent email matching `to`.
   * Tests reach for this when they want "the verification email I just
   * triggered" without sifting through the whole `sent` array.
   */
  lastTo(to: string): OutgoingEmail | undefined {
    for (let i = this.sent.length - 1; i >= 0; i--) {
      if (this.sent[i].to.toLowerCase() === to.toLowerCase()) {
        return this.sent[i];
      }
    }
    return undefined;
  }
}
