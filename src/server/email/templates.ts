/**
 * Templates for the transactional emails we send.
 *
 * Templates produce both a plaintext and an HTML body. We construct
 * them in code (rather than pulling in a templating engine) because
 * there are only two of them and the logic is simple -- anything more
 * involved would be over-engineered for the current product scope.
 *
 * Each template exports a single function that accepts a typed input
 * and returns an `OutgoingEmail` ready to hand to the `EmailSender`.
 */

import type { OutgoingEmail } from "./sender";

/* --------------------------------------------------------------------- */
/* HTML escaping                                                          */
/* --------------------------------------------------------------------- */

/**
 * Minimal HTML escape. We never trust an interpolated value to be safe
 * inside an HTML body; if the username happened to contain `<script>`
 * it would otherwise execute when an email reader rendered the body.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* --------------------------------------------------------------------- */
/* Email-verification template                                            */
/* --------------------------------------------------------------------- */

export interface EmailVerificationTemplateInput {
  readonly to: string;
  readonly username: string;
  /** A fully-qualified URL the user can click to confirm their email. */
  readonly verifyUrl: string;
}

export function renderEmailVerification(
  input: EmailVerificationTemplateInput,
): OutgoingEmail {
  const text = `Hi ${input.username},

Welcome to Arimaatic! Please confirm your email address by visiting:

${input.verifyUrl}

If you did not create this account you can ignore this message; the
link will expire on its own.

-- Arimaatic`;

  const html = `<!doctype html>
<html><body style="font-family: sans-serif; line-height: 1.5;">
<p>Hi ${escapeHtml(input.username)},</p>
<p>Welcome to Arimaatic! Please confirm your email address by clicking the link below:</p>
<p><a href="${escapeHtml(input.verifyUrl)}">${escapeHtml(input.verifyUrl)}</a></p>
<p>If you did not create this account you can ignore this message; the link will expire on its own.</p>
<p>-- Arimaatic</p>
</body></html>`;

  return {
    to: input.to,
    subject: "Confirm your Arimaatic email address",
    text,
    html,
  };
}

/* --------------------------------------------------------------------- */
/* Password-reset template                                                */
/* --------------------------------------------------------------------- */

export interface PasswordResetTemplateInput {
  readonly to: string;
  readonly username: string;
  /** A fully-qualified URL that opens the password-reset form. */
  readonly resetUrl: string;
}

export function renderPasswordReset(
  input: PasswordResetTemplateInput,
): OutgoingEmail {
  const text = `Hi ${input.username},

Someone (hopefully you) requested a password reset for your Arimaatic
account. To choose a new password, visit:

${input.resetUrl}

If this was not you, you can ignore this message; the link will expire
on its own and your existing password is unchanged.

-- Arimaatic`;

  const html = `<!doctype html>
<html><body style="font-family: sans-serif; line-height: 1.5;">
<p>Hi ${escapeHtml(input.username)},</p>
<p>Someone (hopefully you) requested a password reset for your Arimaatic account. To choose a new password, click the link below:</p>
<p><a href="${escapeHtml(input.resetUrl)}">${escapeHtml(input.resetUrl)}</a></p>
<p>If this was not you, you can ignore this message; the link will expire on its own and your existing password is unchanged.</p>
<p>-- Arimaatic</p>
</body></html>`;

  return {
    to: input.to,
    subject: "Reset your Arimaatic password",
    text,
    html,
  };
}
