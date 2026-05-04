/**
 * Monoscan router.
 *
 * The current page tree is hash-routed (`#/cluster/123`) inside `App` —
 * historical from the React-via-CDN scaffold. Stage 2 wires TanStack Router
 * at the top level so deep links + back/forward + the (future) per-page
 * `<Suspense>` boundaries all flow through one router instance.
 *
 * Compat strategy: a single catch-all route renders `<App />`; `App` keeps
 * its hash dispatcher for now and exposes a `go(hash)` callback. Stage 3
 * promotes each of the routes documented in `plans/monoscan.md` to a real
 * TanStack route definition (e.g. `/block/$hash`, `/tx/$hash`,
 * `/address/$addr`, `/operator/$addr`). The seam is one router-tree edit
 * per surface.
 *
 * Hash-base note: we intentionally use `createMemoryHistory` here because
 * the explorer is served as static `dist/` behind Caddy/nginx — no SSR,
 * and the static host does not always rewrite SPA paths. Hash-based
 * navigation is preserved at the App level; the router is mounted purely
 * to give us the seam for the next stage's URL surface. When we promote
 * to clean URLs, switch to `createBrowserHistory` + Caddy SPA fallback.
 */

import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  Outlet,
} from "@tanstack/react-router";
import { App } from "./monoscan-app";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: App,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
