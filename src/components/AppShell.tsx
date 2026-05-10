/**
 * Application shell -- the page chrome rendered by every in-app route.
 *
 * Owns:
 * - the heading
 * - the user-menu (replaces the previous About button)
 * - the tab strip
 * - the `<Outlet />` slot where the active route's component renders
 *
 * The auth-area routes (`/login`, `/register`, …) skip this shell
 * entirely -- they wrap themselves in the smaller `AuthLayout` instead.
 */

import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { UserMenu } from "./UserMenu";
import { Tabs } from "./ui/Tabs";

export function AppShell() {
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });

  // We pass this in the indicate the currently active tab.
  // It's based on the route passed in from the tanstack router state
  let activeTab: string | null = null;
  if (path === "/offline") {
    activeTab = "offline";
  } else if (path === "/") {
    activeTab = "games";
  }

  return (
    <main className="min-h-screen bg-tn-bg px-6 py-8 text-tn-fg">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex items-center justify-between border-b border-tn-border pb-5">
          <h1 className="text-3xl text-tn-fg">
            Arimaatic -- Play Arimaa online
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
