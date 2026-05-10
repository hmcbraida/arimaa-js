/**
 * Page chrome for the auth-area screens.
 *
 * The login / register / verify-email / reset-password / login-pending
 * routes are rendered *outside* the main tab strip, because the tabs
 * are conceptually navigation between in-app sections -- not relevant
 * before the user has signed in. This layout provides a minimal
 * heading and a centred card so the screens have consistent framing
 * without each one having to reproduce the same Tailwind incantations.
 */

import type { ReactNode } from "react";

interface AuthLayoutProps {
  readonly title: string;
  /** Optional subtitle rendered under the page title. */
  readonly subtitle?: ReactNode;
  readonly children: ReactNode;
}

export function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
  return (
    <main className="min-h-screen bg-tn-bg px-6 py-12 text-tn-fg">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl text-tn-fg">Arimaatic</h1>
          <h2 className="text-lg text-tn-fg">{title}</h2>
          {subtitle !== undefined && (
            <p className="text-sm text-tn-fg-muted">{subtitle}</p>
          )}
        </header>
        <section className="flex flex-col gap-4 border border-tn-border bg-tn-panel p-6">
          {children}
        </section>
      </div>
    </main>
  );
}
