/* =====================================================
   Monoscan v4.0 — Primitives
   Shared atomic components. Imported as ES modules.
===================================================== */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { Fragment } from "react";

/* ---------- Icon set ----------
   Plain-stroke monoline icons at 16px default.
   `name` drives the glyph. Feel free to add more. */
const Icon = ({ name, size = 16, color = "currentColor", style = {} }: any) => {
  const base: any = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: color, strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", style: { display: "block", ...style } };
  switch (name) {
    case "home":         return <svg {...base}><path d="M3 10.5 12 3l9 7.5V21H3z"/><path d="M9 21v-7h6v7"/></svg>;
    case "operator":     return <svg {...base}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>;
    case "cluster":      return <svg {...base}><circle cx="12" cy="12" r="3"/><circle cx="5" cy="7" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="5" cy="17" r="2"/><circle cx="19" cy="17" r="2"/><path d="M7 7l2.5 3M17 7l-2.5 3M7 17l2.5-3M17 17l-2.5-3"/></svg>;
    case "marketplace":  return <svg {...base}><path d="M3 9h18M5 9v12h14V9M8 9V5a4 4 0 0 1 8 0v4"/></svg>;
    case "standby":      return <svg {...base}><circle cx="12" cy="12" r="8"/><path d="M12 4v4M18.5 5.5l-2.5 2.5"/></svg>;
    case "hardware":     return <svg {...base}><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg>;
    case "chip":         return <svg {...base}><rect x="6" y="6" width="12" height="12" rx="1"/><path d="M9 10h6v4H9zM3 9v2M3 13v2M21 9v2M21 13v2M9 3h2M13 3h2M9 21h2M13 21h2"/></svg>;
    case "ops":          return <svg {...base}><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></svg>;
    case "metrics":      return <svg {...base}><path d="M3 20V8M9 20V4M15 20v-7M21 20v-10"/></svg>;
    case "logs":         return <svg {...base}><path d="M4 4h16M4 8h16M4 12h10M4 16h16M4 20h12"/></svg>;
    case "audit":        return <svg {...base}><path d="M4 4h12l4 4v12H4z"/><path d="M8 12h8M8 16h5"/></svg>;
    case "services":     return <svg {...base}><rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/><circle cx="7" cy="7" r="0.7" fill={color}/><circle cx="7" cy="17" r="0.7" fill={color}/></svg>;
    case "bridges":      return <svg {...base}><path d="M2 17c2-4 4-4 6-4s3 4 8 4"/><path d="M2 13c2-4 4-4 6-4s4 4 8 4"/><path d="M6 17v-2M12 17v-2M18 17v-2"/></svg>;
    case "revenue":      return <svg {...base}><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9 10.5h6M8.5 13.5h7"/></svg>;
    case "protocol":     return <svg {...base}><path d="M12 3v18M4 8h16M6 8v10M18 8v10M4 18h16"/></svg>;
    case "explorer":     return <svg {...base}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.5-4.5"/></svg>;
    case "alerts":       return <svg {...base}><path d="M18 16V10a6 6 0 0 0-12 0v6l-2 3h16z"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>;
    case "wallet":       return <svg {...base}><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12h3"/><path d="M16 6V4H5a2 2 0 0 0-2 2"/></svg>;
    case "private-lock": return <svg {...base}><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15" r="1.4" fill={color}/></svg>;
    case "burn":         return <svg {...base}><path d="M12 22c-4 0-6-3-6-6 0-3 3-5 3-8 0 0 3 1 3 4 0-3 4-5 4-8 2 4 2 6 2 9 0 4-3 9-6 9z"/></svg>;
    case "install":      return <svg {...base}><path d="M12 3v14m-5-5 5 5 5-5M4 21h16"/></svg>;
    case "attestation":  return <svg {...base}><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>;
    case "keys":         return <svg {...base}><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M17 6l2 2M15 8l2 2"/></svg>;
    case "recovery":     return <svg {...base}><path d="M20 11a8 8 0 0 0-14-4.5L4 4M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14 4.5l2 2.5M20 20v-5h-5"/></svg>;
    case "setup":        return <svg {...base}><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></svg>;
    case "passkey":      return <svg {...base}><circle cx="8" cy="12" r="4"/><path d="m12 12 8 0M18 12v4M14 12v2"/></svg>;
    case "qr":           return <svg {...base}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14h1M14 20h3M20 17v4"/></svg>;
    case "shield-check": return <svg {...base}><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/></svg>;
    case "tpm":          return <svg {...base}><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/><circle cx="12" cy="12" r="1.2" fill={color}/></svg>;
    case "ota":          return <svg {...base}><path d="M12 3v10m-4-4 4 4 4-4"/><path d="M4 17a8 8 0 0 0 16 0"/></svg>;
    case "vouch":        return <svg {...base}><path d="M9 12l2 2 5-6"/><circle cx="12" cy="12" r="9"/></svg>;
    case "eject":        return <svg {...base}><path d="M5 19h14M12 4 5 14h14z"/></svg>;
    case "memo":         return <svg {...base}><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>;
    case "ask":          return <svg {...base}><path d="M21 12a9 9 0 1 1-4-7.5L21 3l-1 4"/><circle cx="12" cy="12" r="1" fill={color}/></svg>;
    case "palette":      return <svg {...base}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h10M7 11h6M7 15h10"/></svg>;
    case "play":         return <svg {...base}><path d="m6 4 14 8-14 8z" fill={color}/></svg>;
    case "pause":        return <svg {...base}><path d="M7 4h4v16H7zM13 4h4v16h-4z" fill={color}/></svg>;
    case "send":         return <svg {...base}><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/></svg>;
    case "chevron":      return <svg {...base}><path d="m9 6 6 6-6 6"/></svg>;
    case "check":        return <svg {...base}><path d="m5 12 5 5 9-9"/></svg>;
    case "close":        return <svg {...base}><path d="M6 6l12 12M18 6 6 18"/></svg>;
    case "info":         return <svg {...base}><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 8v0.1"/></svg>;
    case "warn":         return <svg {...base}><path d="M12 3 2 20h20z"/><path d="M12 10v5M12 18v0.1"/></svg>;
    case "err":          return <svg {...base}><circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/></svg>;
    default:             return <svg {...base}><circle cx="12" cy="12" r="9"/></svg>;
  }
};

/* ---------- StatusDot ---------- */
const StatusDot = ({ kind = "ok", pulse = false, size = 8 }: any) => {
  const c =
    kind === "ok"   ? "var(--ok)"   :
    kind === "warn" ? "var(--warn)" :
    kind === "err"  ? "var(--err)"  :
    kind === "info" ? "var(--info)" :
    kind === "gold" ? "var(--gold)" : "var(--fg-400)";
  return (
    <span style={{
      width: size, height: size, borderRadius: "50%",
      background: c, display: "inline-block",
      boxShadow: `0 0 ${size}px ${c}, 0 0 ${size * 2}px ${c}66`,
      animation: pulse ? `pulse 1.8s var(--e-out) infinite` : "none",
    }}/>
  );
};

/* ---------- Pill ---------- */
const Pill = ({ tone = "default", children, mono = false, style = {}, onClick }: any) => (
  <span
    onClick={onClick}
    className={`pill ${tone === "default" ? "" : tone}${mono ? " mono" : ""}`}
    style={{ cursor: onClick ? "pointer" : "default", ...style }}
  >{children}</span>
);

/* ---------- Kbd ---------- */
const Kbd = ({ children, style = {} }: any) => (
  <span style={{
    display: "inline-block",
    padding: "1px 6px",
    borderRadius: "4px",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid var(--fg-700)",
    fontFamily: "var(--f-mono)",
    fontSize: "10px",
    letterSpacing: "0.04em",
    color: "var(--fg-300)",
    ...style,
  }}>{children}</span>
);

/* ---------- Halo (heading-size metric) ---------- */
const Halo = ({ kind = "gold", children, size = 32, mono = true }: any) => {
  const color = kind === "gold" ? "var(--gold)" : kind === "err" ? "var(--err)" : "var(--fg-100)";
  return (
    <span style={{
      fontFamily: mono ? "var(--f-mono)" : "var(--f-sans)",
      fontSize: size, fontWeight: 300, letterSpacing: "-0.02em",
      color,
      textShadow: kind === "gold" ? "0 0 12px var(--gold-bg)" : "none",
      fontVariantNumeric: "tabular-nums",
    }}>{children}</span>
  );
};

/* ---------- Avatar ---------- */
const Avatar = ({ hue = 200, size = 24, letter, style = {} }: any) => (
  <span style={{
    width: size, height: size, borderRadius: "50%",
    background: `linear-gradient(135deg, oklch(0.62 0.18 ${hue}), oklch(0.48 0.14 ${(hue + 60) % 360}))`,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    fontFamily: "var(--f-mono)", fontSize: size * 0.4, color: "rgba(255,255,255,0.85)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.2)",
    ...style,
  }}>{letter}</span>
);

/* ---------- Sparkline ---------- */
const Sparkline = ({ data = [], width = 120, height = 28, color = "var(--gold)", fill = true }: any) => {
  if (!data.length) return null;
  const min = Math.min(...data), max = Math.max(...data) || 1;
  const range = max - min || 1;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * width,
    height - ((v - min) / range) * height * 0.85 - height * 0.1,
  ]);
  const d = "M " + pts.map(p => p.map(n => n.toFixed(1)).join(" ")).join(" L ");
  const area = d + ` L ${width} ${height} L 0 ${height} Z`;
  const gid = `sp-${Math.random().toString(36).slice(2, 7)}`;
  return (
    <svg width={width} height={height} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25"/>
          <stop offset="100%" stopColor={color} stopOpacity="0"/>
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gid})`}/>}
      <path d={d} fill="none" stroke={color} strokeWidth="1.3" style={{ filter: `drop-shadow(0 0 3px ${color}88)` }}/>
    </svg>
  );
};

/* ---------- Rolling digit (per-digit odometer) ---------- */
const RollingDigit = ({ digit, size = 32 }: any) => {
  const d = String(digit);
  if (!/\d/.test(d)) {
    return <span style={{ display: "inline-block", fontFamily: "var(--f-mono)", fontSize: size, fontWeight: 300, color: "var(--gold)" }}>{d}</span>;
  }
  const n = parseInt(d, 10);
  const lh = size * 1.0;
  return (
    <span style={{ display: "inline-block", height: lh, overflow: "hidden", verticalAlign: "top", width: size * 0.6 }}>
      <span style={{
        display: "flex", flexDirection: "column",
        transform: `translateY(-${n * lh}px)`,
        transition: "transform 540ms cubic-bezier(0.2, 0.8, 0.2, 1)",
      }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <span key={i} style={{
            height: lh, lineHeight: `${lh}px`, textAlign: "center",
            fontFamily: "var(--f-mono)", fontSize: size, fontWeight: 300,
            color: "var(--gold)",
            textShadow: "0 0 12px var(--gold-bg)",
            fontVariantNumeric: "tabular-nums",
          }}>{i}</span>
        ))}
      </span>
    </span>
  );
};

/* ---------- RoundTicker (replaces BlockTicker) ---------- */
const RoundTicker = ({ round, size = 44, label = "DAG round" }: any) => {
  const s = round.toLocaleString();
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      <span className="cap">{label}</span>
      <span style={{ display: "inline-flex", alignItems: "baseline" }}>
        {s.split("").map((c, i) => <RollingDigit key={`${c}-${i}-${round}`} digit={c} size={size}/>)}
      </span>
    </div>
  );
};

/* ---------- QuorumBar (n-of-m fill) ---------- */
const QuorumBar = ({ have, total, threshold, size = 22, gap = 4, showLabel = true }: any) => {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap }}>
        {Array.from({ length: total }).map((_, i) => {
          const filled = i < have;
          const atThreshold = i + 1 === threshold;
          const inQuorum = i < threshold;
          const color = !filled ? "var(--fg-700)" :
                        inQuorum ? "var(--state-nominal)" :
                        "var(--gold)";
          return (
            <span key={i} style={{
              flex: 1,
              height: size, minWidth: 12,
              borderRadius: 4,
              background: color,
              boxShadow: filled ? `0 0 8px ${color}66` : "none",
              outline: atThreshold ? `1px dashed var(--state-nominal)` : "none",
              outlineOffset: 2,
              transition: "all 220ms var(--e-out)",
            }}/>
          );
        })}
      </div>
      {showLabel && (
        <div className="mono" style={{ fontSize: 11, color: "var(--fg-300)", letterSpacing: "0.04em" }}>
          <b style={{ color: "var(--fg-100)", fontWeight: 500 }}>{have}/{total}</b>
          {" · threshold "}
          <b style={{ color: "var(--state-nominal)", fontWeight: 500 }}>{threshold}-of-{total}</b>
          {" BFT"}
        </div>
      )}
    </div>
  );
};

/* ---------- StateMachinePill ----------
   Shows current state + transitions. */
const STATE_ORDER = ["nominal", "maintenance", "jail", "collapsed"];
const STATE_META = {
  nominal:     { label: "Nominal",     color: "var(--state-nominal)",     rule: "7/7" },
  maintenance: { label: "Degraded",    color: "var(--state-maintenance)", rule: "6/7" },
  jail:        { label: "Jail",        color: "var(--state-jail)",        rule: "5/7" },
  collapsed:   { label: "Collapsed",   color: "var(--state-collapsed)",   rule: "≤4/7" },
};
const StateMachinePill = ({ state = "nominal", compact = false }: any) => {
  const m = STATE_META[state];
  if (compact) {
    return (
      <span className="pill mono" style={{
        color: m.color,
        background: `${m.color}22`,
        borderColor: `${m.color}55`,
        fontWeight: 500,
        letterSpacing: "0.06em",
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: m.color, boxShadow: `0 0 6px ${m.color}` }}/>
        {m.rule} · {m.label}
      </span>
    );
  }
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--f-mono)", fontSize: 11 }}>
      {STATE_ORDER.map((s, i) => {
        const sm = STATE_META[s];
        const isCur = s === state;
        return (
          <Fragment key={s}>
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 5,
              padding: "3px 8px",
              borderRadius: 999,
              color: isCur ? sm.color : "var(--fg-500)",
              background: isCur ? `${sm.color}22` : "transparent",
              border: `1px solid ${isCur ? sm.color + "55" : "var(--fg-700)"}`,
              fontWeight: isCur ? 600 : 400,
              letterSpacing: "0.06em",
            }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: isCur ? sm.color : "var(--fg-600)", boxShadow: isCur ? `0 0 6px ${sm.color}` : "none" }}/>
              {sm.rule} {sm.label}
            </span>
            {i < STATE_ORDER.length - 1 && <span style={{ color: "var(--fg-600)", fontSize: 11 }}>›</span>}
          </Fragment>
        );
      })}
    </div>
  );
};

/* ---------- AttestationBadge ---------- */
const AttestationBadge = ({ ok = true, pcrShort = "pcr:—", stale = false }: any) => {
  const tone = !ok ? "err" : stale ? "warn" : "ok";
  const label = !ok ? "FAILED" : stale ? "STALE" : "ATTESTED";
  const color = tone === "ok" ? "var(--state-nominal)" : tone === "warn" ? "var(--state-maintenance)" : "var(--state-jail)";
  return (
    <span className="mono" style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "4px 10px 4px 8px",
      borderRadius: 999,
      background: `${color}15`,
      border: `1px solid ${color}44`,
      color,
      fontSize: 11, letterSpacing: "0.06em", fontWeight: 500,
    }}>
      <Icon name="shield-check" size={13}/>
      {label}
      <span style={{ color: "var(--fg-400)", fontWeight: 400 }}>· {pcrShort}</span>
    </span>
  );
};

/* ---------- BondMeter ---------- */
const BondMeter = ({ posted, atRisk, liquidation = 0.75, unit = "LYTH" }: any) => {
  const pct = atRisk / posted;
  const warn = pct > 0.5;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <div className="cap">Bond posted</div>
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 20, color: "var(--fg-100)", letterSpacing: "-0.02em" }}>
            {posted.toLocaleString()} <span style={{ fontSize: 12, color: "var(--fg-400)" }}>{unit}</span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="cap">At risk</div>
          <div style={{ fontFamily: "var(--f-mono)", fontSize: 14, color: warn ? "var(--warn)" : "var(--fg-200)" }}>
            {atRisk.toLocaleString()} {unit}
          </div>
        </div>
      </div>
      <div style={{ position: "relative", height: 8, borderRadius: 4, background: "rgba(255,255,255,0.04)", overflow: "hidden" }}>
        <div style={{
          position: "absolute", inset: 0, width: `${pct * 100}%`,
          background: warn ? "var(--warn)" : "var(--ok)",
          boxShadow: warn ? "0 0 12px var(--warn)" : "0 0 8px var(--ok)",
          transition: "width 400ms var(--e-out)",
        }}/>
        <div style={{
          position: "absolute", top: -2, bottom: -2,
          left: `${liquidation * 100}%`, width: 1,
          background: "var(--err)", opacity: 0.8,
        }}/>
      </div>
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-400)", display: "flex", justifyContent: "space-between" }}>
        <span>utilization {(pct * 100).toFixed(1)}%</span>
        <span>liquidation @ {(liquidation * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
};

/* ---------- SigningStrip — 3-state (included / missed / dac-fault) ---------- */
const SigningStrip = ({ data = [], label = "Last 23 rounds" }: any) => {
  // data: array of strings: "ok" | "miss" | "fault" — or numbers (7 = all live, treat 7 as ok, <7 maintenance, <5 err)
  const normalized = data.map(v => {
    if (typeof v === "string") return v;
    if (v >= 7) return "ok";
    if (v >= 5) return "miss";
    return "fault";
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 2, alignItems: "flex-end" }}>
        {normalized.map((v, i) => {
          const c = v === "ok" ? "var(--ok)" : v === "miss" ? "var(--warn)" : "var(--err)";
          const h = v === "ok" ? 14 : v === "miss" ? 10 : 18;
          return <span key={i} style={{ width: 5, height: h, background: c, borderRadius: 1, boxShadow: `0 0 4px ${c}77` }}/>;
        })}
      </div>
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-400)", letterSpacing: "0.06em" }}>
        {label}
      </div>
    </div>
  );
};

/* ---------- ClusterRing (7 avatars in a circle, 5-of-7 quorum arc) ---------- */
const ClusterRing = ({ members = [], threshold = 5, size = 260 }: any) => {
  const cx = size / 2, cy = size / 2;
  const r = size * 0.38;
  const have = members.filter(m => m.state === "live").length;

  // quorum arc — fraction filled = have / members.length
  const total = members.length;
  const circumference = 2 * Math.PI * (r + 22);
  const filled = (have / total) * circumference;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ position: "absolute", inset: 0 }}>
        {/* outer threshold ring background */}
        <circle cx={cx} cy={cy} r={r + 22} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="3"/>
        {/* filled portion */}
        <circle
          cx={cx} cy={cy} r={r + 22}
          fill="none"
          stroke={have >= threshold ? "var(--state-nominal)" : "var(--state-jail)"}
          strokeWidth="3"
          strokeDasharray={`${filled} ${circumference}`}
          strokeDashoffset={circumference * 0.25}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ filter: `drop-shadow(0 0 6px ${have >= threshold ? "var(--state-nominal)" : "var(--state-jail)"})`, transition: "stroke-dasharray 500ms var(--e-out)" }}
        />
        {/* threshold tick */}
        <line
          x1={cx} y1={cy - (r + 22) - 6} x2={cx} y2={cy - (r + 22) + 6}
          stroke="var(--state-nominal)" strokeWidth="1.5"
          transform={`rotate(${(threshold / total) * 360 - 90} ${cx} ${cy})`}
          opacity="0.6"
        />
        {/* inner glow */}
        <circle cx={cx} cy={cy} r={r - 14} fill="url(#innerGlow)"/>
        <defs>
          <radialGradient id="innerGlow">
            <stop offset="0%" stopColor="var(--gold)" stopOpacity="0.12"/>
            <stop offset="100%" stopColor="var(--gold)" stopOpacity="0"/>
          </radialGradient>
        </defs>
      </svg>

      {/* members positioned around the ring */}
      {members.map((m, i) => {
        const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(angle) * r - 20;
        const y = cy + Math.sin(angle) * r - 20;
        const isYou = m.role === "you";
        const color = m.state === "live" ? "var(--state-nominal)" :
                      m.state === "lag"  ? "var(--state-maintenance)" :
                      "var(--state-jail)";
        return (
          <div key={m.id} title={`${m.handle} · ${m.addrShort} · rep ${m.rep.toFixed(2)}`} style={{
            position: "absolute",
            left: x, top: y,
            width: 40, height: 40, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: isYou
              ? "linear-gradient(135deg, var(--gold), var(--gold-lo))"
              : "var(--ink-2)",
            border: `2px solid ${color}`,
            boxShadow: `0 0 10px ${color}55`,
            fontFamily: "var(--f-mono)", fontSize: 10,
            color: isYou ? "var(--ink)" : "var(--fg-200)",
            fontWeight: 600,
            letterSpacing: "0.04em",
          }}>
            {m.handle.slice(0, 4)}
          </div>
        );
      })}

      {/* center info */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        pointerEvents: "none", textAlign: "center", gap: 2,
      }}>
        <div className="cap">operators live</div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 38, fontWeight: 300, color: have >= threshold ? "var(--fg-100)" : "var(--state-jail)", letterSpacing: "-0.02em", lineHeight: 1 }}>
          {have}<span style={{ color: "var(--fg-500)" }}>/{total}</span>
        </div>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-400)", letterSpacing: "0.08em" }}>
          threshold {threshold}-of-{total}
        </div>
      </div>
    </div>
  );
};

/* ---------- PrivateBadge ---------- */
const PrivateBadge = ({ style = {} }: any) => (
  <span className="mono denom-private-badge" style={style}>
    <Icon name="private-lock" size={12}/>
    PRIVATE · irreversible
  </span>
);

/* ---------- AlgoBadge ---------- */
const AlgoBadge = ({ algo, short }: any) => {
  const v =
    algo === "slhdsa"  ? "var(--algo-slhdsa)"  :
    algo === "mldsa"   ? "var(--algo-mldsa)"   :
    algo === "bls"     ? "var(--algo-bls)"     :
    algo === "ed25519" ? "var(--algo-ed25519)" :
    algo === "passkey" ? "var(--algo-passkey)" : "var(--fg-300)";
  return (
    <span className="mono" style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "2px 8px",
      borderRadius: 4,
      background: `${v}15`,
      border: `1px solid ${v}55`,
      color: v,
      fontSize: 10, letterSpacing: "0.08em", fontWeight: 500, textTransform: "uppercase",
    }}>
      {short}
    </span>
  );
};

/* ---------- StandbyTray ---------- */
const StandbyTray = ({ active, standbys = [] }: any) => (
  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
    <div className="card" style={{ flex: 1, minWidth: 160, padding: 14, background: "var(--gold-bg)", border: "1px solid oklch(0.82 0.14 78 / 0.3)" }}>
      <div className="cap" style={{ color: "var(--gold)" }}>Active · Cluster {active}</div>
      <div style={{ fontFamily: "var(--f-mono)", fontSize: 20, color: "var(--fg-100)", marginTop: 4 }}>C-{String(active).padStart(3, "0")}</div>
      <div className="mono" style={{ fontSize: 10, color: "var(--fg-400)", marginTop: 4, letterSpacing: "0.04em" }}>earning consensus + service</div>
    </div>
    {standbys.map(s => (
      <div key={s.slot} className="card" style={{ flex: 1, minWidth: 160, padding: 14 }}>
        <div className="cap">{s.role}</div>
        <div style={{ fontFamily: "var(--f-mono)", fontSize: 20, color: "var(--fg-200)", marginTop: 4 }}>C-{String(s.slot).padStart(3, "0")}</div>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-400)", marginTop: 4, letterSpacing: "0.04em" }}>
          liveness {(s.liveness * 100).toFixed(1)}% · YTD {s.rewardYTD}
        </div>
      </div>
    ))}
  </div>
);

/* ---------- Divider ---------- */
const Divider = ({ vertical = false, style = {} }: any) => (
  <span style={{
    background: "var(--fg-700)",
    ...(vertical ? { width: 1, alignSelf: "stretch" } : { height: 1, width: "100%" }),
    ...style,
  }}/>
);

/* ---------- SectionHead ---------- */
const SectionHead = ({ title, sub, right }: any) => (
  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14 }}>
    <div>
      <div style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-0.01em" }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: "var(--fg-400)", marginTop: 2 }}>{sub}</div>}
    </div>
    {right}
  </div>
);

/* ---------- Card ----------
   Generic glass-frame card with title + optional right slot. Lifted out of
   monoscan-app.tsx so monoscan-extras.tsx can use it without a circular
   import. */
const Card = ({ title, right, children }: any) => (
  <div className="ms-card">
    <div className="ms-card__head">
      <h3>{title}</h3>
      {right}
    </div>
    <div className="ms-card__body">{children}</div>
  </div>
);

/* Named exports — replaces the legacy window-attach pattern. */
export {
  Icon, StatusDot, Pill, Kbd, Halo, Avatar, Sparkline, RollingDigit, RoundTicker,
  QuorumBar, StateMachinePill, STATE_META, STATE_ORDER,
  AttestationBadge, BondMeter, SigningStrip, ClusterRing,
  PrivateBadge, AlgoBadge, StandbyTray,
  Divider, SectionHead, Card,
};
