/**
 * Application shell — the page chrome rendered by every route.
 *
 * Owns:
 * - the heading
 * - the tab strip
 * - the `<Outlet />` slot where the active route's component renders
 *
 * The tab strip's "active" state is derived from the current path so
 * the offline route highlights the Offline tab, and any other route
 * (games list or session view) highlights Games.
 */

import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Tabs } from "./ui/Tabs";

export function AppShell() {
  const navigate = useNavigate();
  const path = useRouterState({ select: (state) => state.location.pathname });

  // The session view is a sub-screen of the games tab so we treat
  // it the same way for highlighting purposes.
  const activeTab = path === "/offline" ? "offline" : "games";

  return (
    <main className="min-h-screen bg-stone-50 px-6 py-8 text-stone-950">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="border-b border-stone-300 pb-5">
          <h1 className="text-3xl font-semibold text-stone-950">Arimaa</h1>
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
