/**
 * Application shell — the page chrome rendered by every in-app route.
 *
 * Owns:
 * - the heading
 * - the user-menu (replaces the previous About button)
 * - the tab strip
 * - the `<Outlet />` slot where the active route's component renders
 *
 * The auth-area routes (`/login`, `/register`, …) skip this shell
 * entirely — they wrap themselves in the smaller `AuthLayout` instead.
 *
 * The tab strip's "active" state is derived from the current path:
 * `/offline` lights the Offline tab; everything else lights Games. The
 * Preferences page deliberately does not switch a tab — it lives
 * outside the games/offline split — so we keep the Games tab
 * highlighted for it (closest reasonable answer) so the strip is not
 * left in a confusing "neither" state.
 */

import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { UserMenu } from "./UserMenu";
import { Tabs } from "./ui/Tabs";

export function AppShell() {
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });

  const activeTab = path === "/offline" ? "offline" : "games";

  return (
    <main className="min-h-screen bg-tn-bg px-6 py-8 text-tn-fg">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex items-center justify-between border-b border-tn-border pb-5">
          <h1 className="text-3xl text-tn-fg">
            Arimaatic -- an Arimaa application
          </h1>
          <UserMenu />
        </header>
        <Tabs
          tabs={[
            { id: "games", label: "Games" },
            { id: "offline", label: "Offline" },
          ]}
          activeId={activeTab}
          onChange={(id) => {
            if (id === "offline") {
              void navigate({ to: "/offline" });
            } else {
              void navigate({ to: "/" });
            }
          }}
        >
          <Outlet />
        </Tabs>
      </div>
    </main>
  );
}
