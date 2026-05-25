/**
 * Monoscan router.
 *
 * The current page tree is hash-routed (`#/cluster/123`) inside `App` —
 * TanStack Router is mounted at the top level so deep links, back/forward,
 * and future per-page boundaries all flow through one router instance.
 *
 * Compat strategy: a single catch-all route renders `<App />`; `App` keeps
 * its hash dispatcher for now and exposes a `go(hash)` callback. Clean URL
 * routes can be promoted surface by surface.
 *
 * Hash-base note: we intentionally use `createMemoryHistory` here because
 * the explorer is served as static `dist/` behind Caddy/nginx — no SSR,
 * and the static host does not always rewrite SPA paths. Hash-based
 * navigation is preserved at the App level; the router is mounted purely
 * to keep future clean URL routing straightforward. When clean URLs are
 * enabled, switch to `createBrowserHistory` + Caddy SPA fallback.
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
