/**
 * TanStack Router setup for the Arimaa SPA.
 *
 * The router defines three top-level routes:
 *
 * - `/`              the games-list tab
 * - `/offline`       the original local-only game (preserved for offline play)
 * - `/sessions/:id`  a networked session viewed by id
 *
 * The root route renders a layout component (defined in
 * `src/components/AppShell.tsx`) that draws the page chrome and the
 * tab strip. The tab strip mirrors the route — clicking "Games"
 * navigates to `/`; clicking "Offline" navigates to `/offline`. The
 * networked session screen uses the same chrome but does not switch
 * tabs because it is conceptually a child of the games tab.
 */

import {
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { AppShell } from "./components/AppShell";
import { GamesTab } from "./components/games/GamesTab";
import { NetworkGameTab } from "./components/games/NetworkGameTab";
import { OfflineTab } from "./components/games/OfflineTab";

const rootRoute = createRootRoute({
  component: AppShell,
});

const gamesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: GamesTab,
});

const offlineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/offline",
  component: OfflineTab,
});

const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sessions/$id",
  component: NetworkGameTab,
});

const routeTree = rootRoute.addChildren([
  gamesRoute,
  offlineRoute,
  sessionRoute,
]);

// `import.meta.env.BASE_URL` is injected by Vite from the `base` option in
// vite.config.ts ("/arimaatic/"). Passing it here lets TanStack Router strip
// the prefix before matching routes, so `/arimaatic/offline` matches
// `/offline` as expected when the app is served from a sub-path.
export const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL,
});

// Register the typed router globally so `useNavigate`, `useParams`,
// and `<Link>` are fully type-safe. This is the canonical TanStack
// Router declaration-merge incantation.
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
