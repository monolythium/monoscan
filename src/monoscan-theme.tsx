import { useEffect, useRef, useState } from "react";

const THEMES = [
  { id: "default", label: "Default", swatch: "#e8a942", desc: "Warm amber" },
  { id: "monolythium", label: "Monolythium", swatch: "#6366f1", desc: "Indigo" },
  { id: "monolabs", label: "Monolabs", swatch: "#34d399", desc: "Teal" },
  { id: "monoplay", label: "Monoplay", swatch: "#ef4444", desc: "Crimson" },
  { id: "glass", label: "Liquid Glass", swatch: "#8b9dff", desc: "Frosted" },
  { id: "aurora", label: "Aurora", swatch: "#d36bff", desc: "Purple" },
  { id: "crimson", label: "Crimson", swatch: "#e6545c", desc: "Burgundy" },
  { id: "neon", label: "Neon", swatch: "#00ffc8", desc: "Terminal" },
  { id: "midnight", label: "Midnight", swatch: "#a78bfa", desc: "Violet" },
  { id: "retro", label: "Retro CRT", swatch: "#ffb84d", desc: "Amber" },
  { id: "mono", label: "Mono", swatch: "#f5f5f5", desc: "Black and white" },
  { id: "light", label: "Light", swatch: "#f7f3ea", desc: "Paper" },
] as const;

type ThemeId = (typeof THEMES)[number]["id"];

function readTheme(): ThemeId {
  try {
    const saved = localStorage.getItem("monarch.theme");
    return THEMES.some((t) => t.id === saved) ? (saved as ThemeId) : "monolythium";
  } catch {
    return "monolythium";
  }
}

function applyTheme(id: ThemeId): void {
  document.documentElement.setAttribute("data-theme", id);
  try {
    localStorage.setItem("monarch.theme", id);
  } catch {
    // Storage can be blocked in hardened browsers; visual state still applies.
  }
}

export function MsThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(readTheme);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!open) return;
    const click = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const esc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", click);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", click);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === "monarch.theme" && THEMES.some((t) => t.id === event.newValue)) {
        setTheme(event.newValue as ThemeId);
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <div className="ms-theme" ref={ref}>
      <button
        className={`ms-theme__btn ${open ? "is-open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-label={`Theme: ${current.label}`}
        title={`Theme: ${current.label}`}
        type="button"
      >
        <span className="ms-theme__swatch" style={{ background: current.swatch }} />
      </button>
      {open && (
        <div className="ms-theme__pop" role="menu">
          <div className="ms-theme__pop-head">
            <div className="ms-theme__pop-title">Appearance</div>
            <div className="ms-theme__pop-sub">Syncs with Monarch Desktop and Wallet</div>
          </div>
          <div className="ms-theme__grid">
            {THEMES.map((option) => (
              <button
                key={option.id}
                className={`ms-theme__opt ${option.id === theme ? "is-active" : ""}`}
                onClick={() => {
                  setTheme(option.id);
                  setOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                <span className="ms-theme__opt-swatch" style={{ background: option.swatch }} />
                <span className="ms-theme__opt-text">
                  <b>{option.label}</b>
                  <small>{option.desc}</small>
                </span>
                {option.id === theme && (
                  <svg className="ms-theme__opt-check" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m2 6 3 3 5-7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
