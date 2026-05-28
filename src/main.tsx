import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { queryClient } from "./data/hooks";

// Self-hosted typography — matches monolythium.com + docs.monolythium.com
// so the three surfaces share the same font cascade. Replaces the previous
// IBM Plex Google Fonts CDN link in index.html.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";

// Monoscan design tokens and styles.
import "../styles/tokens.css";
import "../styles/themes.css";
import "../styles/monoscan.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root mount point missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
