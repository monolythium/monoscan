// One-time browser-storage disclosure. Monoscan keeps the chosen theme
// and a few UI flags in localStorage; no HTTP cookies, no analytics, no
// cross-site tracking. The dismissal flag (`monolythium.cookie-notice.v1`)
// is itself a localStorage write — that's intentional and disclosed by
// the notice copy below.
//
// Bump CONSENT_KEY suffix if the copy changes substantively so
// previously-dismissed visitors see the new notice.

import { useEffect, useState } from "react";

const CONSENT_KEY = "monolythium.cookie-notice.v1";

function shouldShowInitially(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(CONSENT_KEY) !== "1";
  } catch {
    // Sandboxed iframe / strict mode — show by default.
    return true;
  }
}

export function CookieNotice() {
  // Render-as-hidden first to avoid a flash if the user previously
  // dismissed (matches Astro version's `hidden` attribute pattern).
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(shouldShowInitially());
  }, []);

  if (!open) return null;

  const dismiss = () => {
    setOpen(false);
    try {
      localStorage.setItem(CONSENT_KEY, "1");
    } catch {
      // best-effort
    }
  };

  return (
    <aside
      className="cookie-notice"
      role="region"
      aria-label="Browser storage notice"
    >
      <div className="cookie-notice__inner">
        <div className="cookie-notice__body">
          <strong>A note on browser storage.</strong>
          Monoscan keeps your theme choice and a few UI flags in your
          browser&apos;s local storage so the site remembers them between
          visits. We don&apos;t use analytics, third-party cookies, or
          cross-site tracking.{" "}
          <a
            href="https://monolythium.com/legal/privacy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Read the privacy policy
          </a>
          .
        </div>
        <button type="button" className="cookie-notice__ok" onClick={dismiss}>
          Got it
        </button>
      </div>
    </aside>
  );
}
