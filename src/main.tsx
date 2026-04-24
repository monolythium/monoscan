import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./monoscan-app";

// Tokens + monoscan CSS — preserved verbatim from the static mockup.
import "../styles/tokens.css";
import "../styles/monoscan.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root mount point missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
