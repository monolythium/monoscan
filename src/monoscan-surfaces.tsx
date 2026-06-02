/* =====================================================
   Monoscan — new chain-feature surfaces.

   Six neutral, factual explorer surfaces for the chain features landed this
   session, rendered through the SDK seam (`sdk/surfaces.ts` types + the
   fixture-backed hooks in `data/hooks.ts`):

     - PF-6  Node diversity + operator metadata  (#/diversity, #/diversity/:id)
     - MB-6  Oracle dashboard                    (#/oracle)
     - PF-4  Spending-policy dimensions          (rendered on the agent view +
                                                  #/policy/:addr; SpendingPolicyCard)
     - MB-5  Cluster directory                   (#/cluster-directory)
     - MB-4  Prover market                       (#/prover-market)
     - MB-2  Bridge health + circuit breaker     (#/bridge, BridgeHealthCard)

   Transparency posture: monoscan renders neutral, factual chain data. No
   editorialised verdicts beyond on-chain risk labels — operator fees and
   policy dims are shown as on-chain facts; the operator UI defers here.
===================================================== */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { LYTHOSHI_PER_LYTH } from "@monolythium/core-sdk";
import { Card } from "./primitives";
import { fmtAddr, fmtAddrShort, fmtHashShort } from "./sdk/format";
import {
  useBridgeRouteHealth,
  useClusterDirectory,
  useClusterDiversity,
  useClusterDiversitySet,
  useOracleDashboard,
  useProverMarket,
  useSpendingPolicy,
} from "./data/hooks";
import {
  DIVERSITY_SCORE_MAX,
  PROVER_BOND_MIN_LYTH,
  PROVER_FEE_FLOOR_LYTH,
  type BridgeBreakerState,
  type BridgeRouteHealth,
  type ClusterFormationStatus,
  type HostingClass,
  type OracleFeed,
  type ProverMarketState,
  type SpendingPolicyDimensions,
  type TimeOfDayWindow,
} from "./sdk/surfaces";

/* ----------------------------- shared helpers ----------------------------- */

/** Format a raw lythoshi string as a LYTH amount (2 dp).
 *  1 LYTH = 1,000,000,000,000,000,000 lythoshi (18 decimals) —
 *  `LYTHOSHI_PER_LYTH` from the SDK, the same scale every wallet/RPC surface uses. */
function fmtLyth(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  let v: bigint;
  try {
    v = BigInt(raw);
  } catch {
    return "—";
  }
  const whole = v / LYTHOSHI_PER_LYTH;
  const frac = ((v % LYTHOSHI_PER_LYTH) * 100n) / LYTHOSHI_PER_LYTH;
  return `${whole.toLocaleString()}.${frac.toString().padStart(2, "0")} LYTH`;
}

/** Format a raw scaled price using its feed decimals. */
function fmtPrice(raw: string | null | undefined, decimals: number): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  let v: bigint;
  try {
    v = BigInt(raw);
  } catch {
    return "—";
  }
  const scale = 10n ** BigInt(Math.max(0, decimals));
  const whole = v / scale;
  const frac = scale > 1n ? (v % scale).toString().padStart(decimals, "0").slice(0, 6) : "";
  return frac ? `${whole.toLocaleString()}.${frac}` : whole.toLocaleString();
}

/** Basis points (0..10000) → "NN.NN%". */
function bpsPct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function intPct(frac: number | null | undefined): string {
  if (!Number.isFinite(frac ?? NaN)) return "—";
  return `${Math.round(Math.max(0, Math.min(1, frac ?? 0)) * 100)}%`;
}

/** Diversity score (0..10000) → a chromatic-halo tone. */
function diversityTone(bps: number): "ok" | "warn" | "err" {
  if (bps >= 6_000) return "ok";
  if (bps >= 3_000) return "warn";
  return "err";
}

const HOSTING_LABEL: Record<HostingClass, string> = {
  bareMetal: "bare-metal",
  coLocation: "co-location",
  cloud: "cloud",
};

const ZERO_HASH = `0x${"00".repeat(32)}`;

/** A small chromatic halo dot + label — the design's status-as-halo idiom. */
type SurfaceTone = "ok" | "warn" | "err" | "neutral" | "gold";

function toneColor(tone: SurfaceTone): string {
  return (
    tone === "ok" ? "var(--ok)" :
    tone === "warn" ? "var(--warn)" :
    tone === "err" ? "var(--err)" :
    tone === "gold" ? "var(--gold)" : "var(--fg-400)"
  );
}

function clamp01(frac: number | null | undefined): number {
  return Number.isFinite(frac ?? NaN) ? Math.max(0, Math.min(1, frac ?? 0)) : 0;
}

function ratio(n: number, d: number): number {
  return d > 0 ? n / d : 0;
}

function Halo({ tone, label }: { tone: SurfaceTone; label: string }) {
  const color = toneColor(tone);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%", background: color,
        boxShadow: `0 0 8px ${color}, 0 0 16px ${color}55`, display: "inline-block",
      }}/>
      <span className="mono" style={{ fontSize: 11, color: "var(--fg-200)", letterSpacing: "0.04em" }}>{label}</span>
    </span>
  );
}

/** A horizontal proportion bar (0..1). */
function MeterBar({ frac, tone }: { frac: number; tone: "ok" | "warn" | "err" | "gold" }) {
  const color = toneColor(tone);
  return (
    <div className="ms-bar" style={{ marginTop: 4 }}>
      <div style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%`, background: color, boxShadow: `0 0 8px ${color}66` }}/>
    </div>
  );
}

function SurfaceHero({ eyebrow, title, body, children }: any) {
  return (
    <section className="surface-hero">
      <div className="surface-hero__copy">
        <div className="surface-hero__eyebrow mono">
          <span className="surface-live-dot"/>
          <span>{eyebrow}</span>
        </div>
        <h1 className="surface-hero__title">{title}</h1>
        <p className="surface-hero__body">{body}</p>
      </div>
      <div className="surface-hero__panel">
        {children}
      </div>
    </section>
  );
}

function SurfaceMetric({ label, value, sub, tone = "neutral", meter }: any) {
  return (
    <div className={`surface-metric surface-metric--${tone}`}>
      <div className="mono surface-metric__label">{label}</div>
      <div className="mono num surface-metric__value">{value}</div>
      {sub && <div className="mono surface-metric__sub">{sub}</div>}
      {meter}
    </div>
  );
}

function SurfaceMeter({ frac, tone = "gold", label, value }: { frac: number | null | undefined; tone?: SurfaceTone; label?: string; value?: string }) {
  const safe = clamp01(frac);
  const style = {
    "--surface-meter-fill": toneColor(tone),
    "--surface-meter-pct": `${safe * 100}%`,
  } as any;
  return (
    <div className={`surface-meter surface-meter--${tone}`} style={style}>
      {(label || value) && (
        <div className="surface-meter__meta">
          <span>{label}</span>
          <b>{value ?? intPct(safe)}</b>
        </div>
      )}
      <div className="surface-meter__track"><span/></div>
    </div>
  );
}

function SurfaceEmpty({ loading, empty }: { loading: boolean; empty: string }) {
  return (
    <p className="mono surface-empty">
      {loading ? "loading live read…" : empty}
    </p>
  );
}

const KV = ({ label, value, mono }: any) => (
  <div className="tx-kv__row">
    <span className="mono tx-kv__k">{label}</span>
    <span className={`${mono ? "mono" : ""} tx-kv__v`}>{value}</span>
  </div>
);

/* ========================================================================== */
/* PF-6 — Node diversity + operator metadata                                  */
/* ========================================================================== */

/** Three-axis diversity breakdown viz: ASN / geo / hosting entropy bars. */
function DiversityBreakdownViz({ breakdown }: { breakdown: { asnVariance: number; geoVariance: number; hostingSpread: number } }) {
  const axes: Array<[string, number, string]> = [
    ["ASN spread", breakdown.asnVariance, "autonomous-system entropy"],
    ["Geo spread", breakdown.geoVariance, "country-distribution entropy"],
    ["Hosting spread", breakdown.hostingSpread, "bare-metal / co-lo / cloud entropy"],
  ];
  return (
    <div className="surface-axis-list">
      {axes.map(([label, bps, hint]) => (
        <div className="surface-axis" key={label}>
          <SurfaceMeter frac={bps / DIVERSITY_SCORE_MAX} tone={diversityTone(bps)} label={label} value={bpsPct(bps)}/>
          <div className="mono surface-axis__hint">{hint}</div>
        </div>
      ))}
    </div>
  );
}

/** PF-6 cluster diversity detail — `#/diversity/:id`. */
const ClusterDiversityPage = ({ id, go }: any) => {
  const clusterId = Number.isFinite(Number(id)) ? Number(id) : 0;
  const q = useClusterDiversity(clusterId);
  const view = q.data;
  return (
    <div className="ms-page ms-surface-page ms-diversity-page ms-diversity-detail-page">
      <div className="ms-crumb">
        <a href="#/diversity" onClick={() => go("#/diversity")}>Node diversity</a>
        <span>›</span>
        <b>C-{String(clusterId + 1).padStart(3, "0")}</b>
      </div>
      <SurfaceHero
        eyebrow="PF-6 · Starfish signer roster"
        title={`Cluster diversity · C-${String(clusterId + 1).padStart(3, "0")}`}
        body="Correlated-failure exposure for the operators that sign Starfish DAG vertices and commits. Scores are on-chain bps across ASN, geography, and hosting class; unavailable live reads render as empty states."
      >
        <SurfaceMetric
          label="Diversity score"
          value={view ? bpsPct(view.diversity.score) : "—"}
          sub={`0..${DIVERSITY_SCORE_MAX} bps · ${view?.diversity.resolvedMembers ?? 0} members resolved`}
          tone={view ? diversityTone(view.diversity.score) : "neutral"}
          meter={view ? <SurfaceMeter frac={view.diversity.score / DIVERSITY_SCORE_MAX} tone={diversityTone(view.diversity.score)}/> : undefined}
        />
        {view ? (
          <DiversityBreakdownViz breakdown={view.diversity.breakdown}/>
        ) : (
          <SurfaceEmpty loading={q.isLoading} empty={`No diversity record for cluster C-${String(clusterId + 1).padStart(3, "0")}.`}/>
        )}
      </SurfaceHero>
      {view ? (
        <>
          <section className="surface-detail-grid">
            <Card title="Diversity score" right={<span className="cap">PF-6 · 0..{DIVERSITY_SCORE_MAX} bps</span>}>
              <div className="surface-score-readout">
                <span className="mono num surface-score-readout__value">{bpsPct(view.diversity.score)}</span>
                <Halo tone={diversityTone(view.diversity.score)} label={
                  view.diversity.score >= 6_000 ? "well diversified" : view.diversity.score >= 3_000 ? "moderate concentration" : "high concentration"
                }/>
              </div>
              <SurfaceMeter frac={view.diversity.score / DIVERSITY_SCORE_MAX} tone={diversityTone(view.diversity.score)}/>
              <div className="mono surface-card-note">unweighted mean of the three axis terms · {view.diversity.resolvedMembers} roster members resolved</div>
            </Card>
            <Card title="Axis breakdown">
              <DiversityBreakdownViz breakdown={view.diversity.breakdown}/>
            </Card>
          </section>
          <Card title="Operator network metadata">
            <div className="surface-table-wrap">
              <table className="ms-table surface-table">
                <thead><tr><th>Operator</th><th>ASN</th><th>Geo</th><th>Hosting</th><th>PCR digest</th></tr></thead>
                <tbody>
                  {view.operators.map((op) => (
                    <tr key={op.operatorId}>
                      <td className="mono surface-code">{fmtHashShort(op.operatorId, 14, 6)}</td>
                      <td className="mono num">{op.asn > 0 ? `AS${op.asn}` : "—"}</td>
                      <td className="mono">{op.geoRegion || "—"}</td>
                      <td><Halo tone={op.hostingClass === "bareMetal" ? "ok" : op.hostingClass === "coLocation" ? "warn" : "neutral"} label={HOSTING_LABEL[op.hostingClass]}/></td>
                      <td className="mono surface-code surface-muted">
                        {op.pcrDigest && op.pcrDigest !== ZERO_HASH ? fmtHashShort(op.pcrDigest, 12, 6) : <span>no TPM quote</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
};

/** PF-6 cluster-diversity index — `#/diversity`. */
const DiversityPage = ({ go }: any) => {
  const q = useClusterDiversitySet();
  const rows = q.data ?? [];
  const sorted = [...rows].sort((a, b) => b.diversity.score - a.diversity.score);
  const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.diversity.score, 0) / rows.length) : 0;
  const strongest = sorted.length ? sorted[0] : null;
  const weakest = sorted.length ? sorted[sorted.length - 1] : null;
  return (
    <div className="ms-page ms-surface-page ms-diversity-page">
      <SurfaceHero
        eyebrow="PF-6 · Starfish commit signers"
        title="Node diversity"
        body="Per-cluster correlated-failure exposure for the operator rosters that sign DAG vertices and commits. Scores are on-chain bps across autonomous systems, countries, and hosting classes; empty live sets stay empty."
      >
        <SurfaceMetric
          label="Average score"
          value={rows.length ? bpsPct(avg) : "—"}
          sub={`${rows.length} clusters scored`}
          tone={rows.length ? diversityTone(avg) : "neutral"}
          meter={rows.length ? <SurfaceMeter frac={avg / DIVERSITY_SCORE_MAX} tone={diversityTone(avg)}/> : undefined}
        />
        <div className="surface-panel-list">
          <SurfaceMeter
            frac={strongest ? strongest.diversity.score / DIVERSITY_SCORE_MAX : 0}
            tone={strongest ? diversityTone(strongest.diversity.score) : "neutral"}
            label={strongest ? `Strongest · C-${String(strongest.diversity.clusterId + 1).padStart(3, "0")}` : "Strongest"}
            value={strongest ? bpsPct(strongest.diversity.score) : "—"}
          />
          <SurfaceMeter
            frac={weakest ? weakest.diversity.score / DIVERSITY_SCORE_MAX : 0}
            tone={weakest ? diversityTone(weakest.diversity.score) : "neutral"}
            label={weakest ? `Most concentrated · C-${String(weakest.diversity.clusterId + 1).padStart(3, "0")}` : "Most concentrated"}
            value={weakest ? bpsPct(weakest.diversity.score) : "—"}
          />
        </div>
      </SurfaceHero>
      <section className="surface-metrics">
        <SurfaceMetric label="Clusters scored" value={`${rows.length}`} sub="diversity scores" tone="neutral"/>
        <SurfaceMetric label="Average score" value={rows.length ? bpsPct(avg) : "—"} sub={`0..${DIVERSITY_SCORE_MAX} bps`} tone={rows.length ? diversityTone(avg) : "neutral"}/>
        <SurfaceMetric
          label="Most concentrated"
          value={weakest ? bpsPct(weakest.diversity.score) : "—"}
          sub={weakest ? `C-${String(weakest.diversity.clusterId + 1).padStart(3, "0")}` : "—"}
          tone={weakest ? diversityTone(weakest.diversity.score) : "neutral"}
        />
      </section>
      <Card title="Cluster diversity scores" right={<span className="cap">PF-6</span>}>
        {sorted.length ? (
          <div className="surface-table-wrap">
            <table className="ms-table surface-table">
              <thead><tr><th>Cluster</th><th>Score</th><th>ASN</th><th>Geo</th><th>Hosting</th><th>Members</th></tr></thead>
              <tbody>
                {sorted.map((v) => (
                  <tr key={v.diversity.clusterId} style={{ cursor: "pointer" }} onClick={() => go(`#/diversity/${v.diversity.clusterId}`)}>
                    <td className="surface-strong">C-{String(v.diversity.clusterId + 1).padStart(3, "0")}</td>
                    <td className="surface-score-cell">
                      <Halo tone={diversityTone(v.diversity.score)} label={bpsPct(v.diversity.score)}/>
                      <SurfaceMeter frac={v.diversity.score / DIVERSITY_SCORE_MAX} tone={diversityTone(v.diversity.score)}/>
                    </td>
                    <td className="surface-score-cell surface-score-cell--compact"><SurfaceMeter frac={v.diversity.breakdown.asnVariance / DIVERSITY_SCORE_MAX} tone={diversityTone(v.diversity.breakdown.asnVariance)} value={bpsPct(v.diversity.breakdown.asnVariance)}/></td>
                    <td className="surface-score-cell surface-score-cell--compact"><SurfaceMeter frac={v.diversity.breakdown.geoVariance / DIVERSITY_SCORE_MAX} tone={diversityTone(v.diversity.breakdown.geoVariance)} value={bpsPct(v.diversity.breakdown.geoVariance)}/></td>
                    <td className="surface-score-cell surface-score-cell--compact"><SurfaceMeter frac={v.diversity.breakdown.hostingSpread / DIVERSITY_SCORE_MAX} tone={diversityTone(v.diversity.breakdown.hostingSpread)} value={bpsPct(v.diversity.breakdown.hostingSpread)}/></td>
                    <td className="mono num">{v.diversity.resolvedMembers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <SurfaceEmpty loading={q.isLoading} empty="no diversity records reported"/>
        )}
      </Card>
    </div>
  );
};

/* ========================================================================== */
/* MB-6 — Oracle dashboard                                                    */
/* ========================================================================== */

function feedDisplayName(feed: OracleFeed): string {
  return feed.label ?? fmtHashShort(feed.feedId, 12, 6);
}

const OraclePage = ({ go: _go }: any) => {
  const q = useOracleDashboard();
  const dash = q.data;
  const feeds = dash?.feeds ?? [];
  const signers = dash?.signers ?? [];
  const finalizedFeeds = feeds.filter((f) => f.finalizedAtBlock !== null).length;
  const authorizedSigners = signers.filter((s) => s.servesOracleWriter).length;
  const signerTarget = Math.max(authorizedSigners, ...feeds.map((f) => f.allowedWritersLen), 0);
  const feedHealth = ratio(finalizedFeeds, feeds.length);
  const signerCoverage = ratio(authorizedSigners, signerTarget);
  const quorumNeed = feeds.reduce((acc, f) => acc + f.minSigners, 0);
  const quorumSlots = feeds.reduce((acc, f) => acc + f.allowedWritersLen, 0);
  const quorumFrac = ratio(quorumNeed, quorumSlots);
  return (
    <div className="ms-page ms-surface-page ms-oracle-page">
      <SurfaceHero
        eyebrow="MB-6 · oracle rounds"
        title="Oracle feed rounds"
        body="Each feed closes an on-chain round when its k-of-n writer set agrees within the configured deviation bound. Medians, signer state, and feed parameters are read from the oracle precompile."
      >
        <SurfaceMetric
          label="Feed round health"
          value={feeds.length ? `${finalizedFeeds}/${feeds.length}` : "—"}
          sub="feeds with a finalized round"
          tone={!feeds.length ? "neutral" : feedHealth >= 0.8 ? "ok" : feedHealth >= 0.5 ? "warn" : "err"}
          meter={<SurfaceMeter frac={feedHealth} tone={!feeds.length ? "neutral" : feedHealth >= 0.8 ? "ok" : feedHealth >= 0.5 ? "warn" : "err"}/>}
        />
        <div className="surface-panel-list">
          <SurfaceMeter
            frac={signerCoverage}
            tone={!signerTarget ? "neutral" : signerCoverage >= 1 ? "ok" : signerCoverage >= 0.6 ? "warn" : "err"}
            label="Authorized signer coverage"
            value={signerTarget ? `${authorizedSigners}/${signerTarget}` : "—"}
          />
          <SurfaceMeter
            frac={quorumFrac}
            tone={quorumSlots ? "gold" : "neutral"}
            label="Aggregate k-of-n quorum"
            value={quorumSlots ? `${quorumNeed}/${quorumSlots}` : "—"}
          />
        </div>
      </SurfaceHero>
      <section className="surface-metrics">
        <SurfaceMetric label="Configured feeds" value={`${feeds.length}`} sub="oracle dashboard" tone="neutral"/>
        <SurfaceMetric label="Authorized signers" value={`${authorizedSigners}`} sub={`${signers.length} writers reported`} tone={authorizedSigners === signers.length ? "ok" : "warn"}/>
        <SurfaceMetric
          label="Oracle admin"
          value={dash?.admin ? fmtAddrShort(dash.admin, "user", 10, 5) : "—"}
          sub="on-chain admin if exposed"
          tone="neutral"
        />
      </section>

      <Card title="Configured feeds" right={<span className="cap">MB-6</span>}>
        {feeds.length ? (
          <div className="surface-table-wrap">
            <table className="ms-table surface-table">
              <thead>
                <tr>
                  <th>Feed</th><th>Decimals</th><th>Quorum</th><th>Heartbeat</th><th>Deviation</th>
                  <th style={{ textAlign: "right" }}>Latest median</th><th>Finalized round</th>
                </tr>
              </thead>
              <tbody>
                {feeds.map((f) => {
                  const quorum = ratio(f.minSigners, f.allowedWritersLen);
                  return (
                    <tr key={f.feedId}>
                      <td className="surface-strong">
                        {feedDisplayName(f)}
                        <div className="mono surface-code surface-muted">{fmtHashShort(f.feedId, 12, 6)}</div>
                      </td>
                      <td className="mono num">{f.decimals}</td>
                      <td className="surface-quorum-cell">
                        <div className="mono surface-quorum-cell__text"><b>{f.minSigners}</b><span>-of-{f.allowedWritersLen}</span></div>
                        <SurfaceMeter frac={quorum} tone="gold" value={intPct(quorum)}/>
                      </td>
                      <td className="mono num">{f.heartbeatSecs}s</td>
                      <td className="mono num">{bpsPct(f.deviationBps)}</td>
                      <td className="mono num surface-value-right">{fmtPrice(f.latestMedian, f.decimals)}</td>
                      <td className="mono surface-code">
                        {f.finalizedAtBlock !== null ? (
                          <>#{f.finalizedAtBlock.toLocaleString()}<div className="surface-muted">round {f.latestRoundId} · {f.observationsLen ?? "—"} obs</div></>
                        ) : <span className="surface-muted">no round closed</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <SurfaceEmpty loading={q.isLoading} empty="no feeds configured on this peer"/>
        )}
      </Card>

      <Card title="Active signer roster" right={<span className="cap">writer set</span>}>
        {signers.length ? (
          <div className="surface-table-wrap">
            <table className="ms-table surface-table">
              <thead><tr><th>Signer</th><th>Writer status</th><th style={{ textAlign: "right" }}>Bond</th><th>Feed coverage</th></tr></thead>
              <tbody>
                {signers.map((s) => {
                  const feedFrac = feeds.length ? s.feeds.length / feeds.length : 0;
                  return (
                    <tr key={s.address}>
                      <td className="mono surface-code">{fmtAddrShort(s.address, "user", 14, 6)}</td>
                      <td><Halo tone={s.servesOracleWriter ? "ok" : "err"} label={s.servesOracleWriter ? "authorized" : "revoked"}/></td>
                      <td className="mono num surface-value-right">{fmtLyth(s.bond)}</td>
                      <td className="surface-feed-coverage">
                        <div className="mono surface-feed-coverage__labels">
                          {s.feeds.length
                            ? s.feeds.map((fid) => feeds.find((f) => f.feedId === fid)?.label ?? fmtHashShort(fid, 8, 4)).join(" · ")
                            : <span className="surface-muted">global only</span>}
                        </div>
                        {feeds.length > 0 && <SurfaceMeter frac={feedFrac} tone={feedFrac >= 0.8 ? "ok" : feedFrac >= 0.4 ? "warn" : "neutral"} value={`${s.feeds.length}/${feeds.length}`}/>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <SurfaceEmpty loading={q.isLoading} empty="no authorized signers reported"/>
        )}
      </Card>
    </div>
  );
};

/* ========================================================================== */
/* PF-4 — Spending-policy dimensions (§18.8)                                  */
/* ========================================================================== */

function timeWindowLabel(w: TimeOfDayWindow | null): string {
  if (!w || !w.enabled) return "any hour";
  const fmtH = (h: number) => `${String(h).padStart(2, "0")}:00`;
  return `${fmtH(w.startHour)}–${fmtH(w.endHour)} UTC`;
}

function expiryLabel(unixSecs: number | null): string {
  if (unixSecs === null) return "never expires";
  return new Date(unixSecs * 1000).toISOString().slice(0, 10);
}

/**
 * §18.8 spending-policy dimensions card. Rendered on the agent/account view
 * and on `#/policy/:addr`. Shows on-chain facts only — no verdicts.
 */
export const SpendingPolicyCard = ({ policy }: { policy: SpendingPolicyDimensions | null }) => {
  if (!policy || !policy.configured) {
    return (
      <Card title="Spending policy (§18.8)" right={<span className="cap">PF-4</span>}>
        <p className="mono" style={{ color: "var(--fg-500)", fontSize: 12, margin: 0 }}>
          No spending policy is configured for this account.
        </p>
      </Card>
    );
  }
  const capRow = (label: string, cap: string | null, spent: string | null) => {
    const capBig = cap ? BigInt(cap) : null;
    const spentBig = spent ? BigInt(spent) : 0n;
    const frac = capBig && capBig > 0n ? Number((spentBig * 10000n) / capBig) / 10000 : null;
    return (
      <div style={{ padding: "10px 0", borderBottom: "1px solid var(--fg-800, rgba(255,255,255,0.04))" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 12.5, color: "var(--fg-200)" }}>{label}</span>
          <span className="mono num" style={{ fontSize: 12.5, color: cap ? "var(--fg-100)" : "var(--fg-600)" }}>
            {cap ? fmtLyth(cap) : "no cap"}
          </span>
        </div>
        {cap && (
          <>
            <MeterBar frac={frac ?? 0} tone={(frac ?? 0) >= 0.9 ? "err" : (frac ?? 0) >= 0.6 ? "warn" : "ok"}/>
            <div className="mono" style={{ fontSize: 10, color: "var(--fg-500)", marginTop: 3 }}>
              spent {fmtLyth(spent)} {frac !== null ? `· ${(frac * 100).toFixed(0)}% of window` : ""}
            </div>
          </>
        )}
      </div>
    );
  };
  return (
    <Card
      title="Spending policy (§18.8)"
      right={<Halo tone={policy.disabled ? "err" : "ok"} label={policy.disabled ? "disabled" : "active"}/>}
    >
      <div style={{ marginBottom: 8 }}>
        {capRow("Per-transaction cap", policy.perTxCapLythoshi, null)}
        {capRow("Daily cap", policy.dailyCapLythoshi, policy.dailySpentLythoshi)}
        {capRow("Weekly cap", policy.weeklyCapLythoshi, policy.weeklySpentLythoshi)}
        {capRow("Monthly cap", policy.monthlyCapLythoshi, policy.monthlySpentLythoshi)}
      </div>
      <div className="tx-kv">
        <KV label="Category allow-list" value={
          policy.categoryAllowRoot && policy.categoryAllowRoot !== ZERO_HASH
            ? `root ${fmtHashShort(policy.categoryAllowRoot, 10, 6)}`
            : "any category"
        } mono/>
        <KV label="Destination allow-list" value={
          policy.destinationAllowRoot && policy.destinationAllowRoot !== ZERO_HASH
            ? `root ${fmtHashShort(policy.destinationAllowRoot, 10, 6)}`
            : "any destination"
        } mono/>
        <KV label="Time-of-day window" value={timeWindowLabel(policy.timeWindow)} mono/>
        <KV label="Policy expiry" value={expiryLabel(policy.expiryUnixSecs)} mono/>
        <KV label="Policy version" value={`v${policy.policyVersion}`} mono/>
      </div>
    </Card>
  );
};

/** Standalone §18.8 policy view — `#/policy/:addr`. */
const SpendingPolicyPage = ({ addr, go }: any) => {
  const q = useSpendingPolicy(addr || undefined);
  return (
    <div className="ms-page">
      <div className="ms-crumb">
        <a href="#/wallets" onClick={() => go("#/wallets")}>Accounts</a>
        <span>›</span>
        <b>{addr ? fmtAddrShort(addr, "user", 12, 6) : "policy"}</b>
      </div>
      <h1 className="ms-h1">Spending policy</h1>
      <p className="mono" style={{ color: "var(--fg-400)", marginBottom: 20 }}>
        Agent spending-policy dimensions for <span className="mono" style={{ color: "var(--gold)" }}>{addr ? fmtAddr(addr) : "—"}</span> (WP §18.8).
      </p>
      <section style={{ maxWidth: 640 }}>
        <SpendingPolicyCard policy={q.data ?? null}/>
      </section>
    </div>
  );
};

/* ========================================================================== */
/* MB-5 — Cluster directory                                                   */
/* ========================================================================== */

function formationHaloTone(status: ClusterFormationStatus): "ok" | "warn" | "err" | "neutral" | "gold" {
  return status === "active" ? "ok" : status === "forming" ? "gold" : status === "draining" ? "warn" : "neutral";
}

const ClusterDirectoryPage = ({ go }: any) => {
  const q = useClusterDirectory();
  const dir = q.data;
  const clusters = dir?.clusters ?? [];
  const counts = clusters.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] ?? 0) + 1;
    return acc;
  }, {});
  const liveMembers = clusters.reduce((acc, c) => acc + c.liveMembers, 0);
  const totalMembers = clusters.reduce((acc, c) => acc + c.size, 0);
  const quorumReady = clusters.filter((c) => c.liveMembers >= c.threshold).length;
  const liveFrac = ratio(liveMembers, totalMembers);
  return (
    <div className="ms-page ms-surface-page ms-cluster-directory-page">
      <SurfaceHero
        eyebrow="MB-5 · on-chain ClusterFormed"
        title="Cluster directory"
        body="Every cluster the chain has formed for Starfish DAG signing. Entries appear at the epoch boundary from on-chain ClusterFormed state, then show the live roster capacity available to sign vertices and commits."
      >
        <SurfaceMetric
          label="Live signer capacity"
          value={totalMembers ? `${liveMembers}/${totalMembers}` : "—"}
          sub={`${quorumReady}/${clusters.length} clusters at threshold`}
          tone={!clusters.length ? "neutral" : liveFrac >= 0.8 ? "ok" : liveFrac >= 0.5 ? "warn" : "err"}
          meter={<SurfaceMeter frac={liveFrac} tone={!clusters.length ? "neutral" : liveFrac >= 0.8 ? "ok" : liveFrac >= 0.5 ? "warn" : "err"}/>}
        />
        <div className="surface-status-bars">
          {(["active", "forming", "draining", "retired"] as ClusterFormationStatus[]).map((status) => (
            <SurfaceMeter
              key={status}
              frac={ratio(counts[status] ?? 0, clusters.length)}
              tone={formationHaloTone(status)}
              label={status}
              value={`${counts[status] ?? 0}`}
            />
          ))}
        </div>
      </SurfaceHero>
      <section className="surface-metrics">
        <SurfaceMetric label="Clusters" value={`${clusters.length}`} sub="directory snapshot" tone="neutral"/>
        <SurfaceMetric label="Active" value={`${counts.active ?? 0}`} sub="signing vertices" tone="ok"/>
        <SurfaceMetric label="Forming" value={`${counts.forming ?? 0}`} sub="awaiting epoch" tone="gold"/>
        <SurfaceMetric label="Current epoch" value={dir?.currentEpoch !== null && dir?.currentEpoch !== undefined ? `${dir.currentEpoch}` : "—"} sub="directory snapshot" tone="neutral"/>
      </section>
      <Card title="Directory" right={<span className="cap">MB-5</span>}>
        {clusters.length ? (
          <div className="surface-table-wrap">
            <table className="ms-table surface-table">
              <thead>
                <tr>
                  <th>Cluster</th><th>Status</th><th>Anchor</th><th>Roster</th><th>Live quorum</th><th>Epoch</th><th>Formed</th>
                </tr>
              </thead>
              <tbody>
                {clusters.map((c) => {
                  const thresholdFrac = ratio(c.liveMembers, c.threshold);
                  const memberFrac = ratio(c.liveMembers, c.size);
                  const liveTone = c.liveMembers >= c.threshold ? "ok" : c.liveMembers > 0 ? "warn" : "err";
                  return (
                    <tr key={c.clusterId} style={{ cursor: "pointer" }} onClick={() => go(`#/cluster/${c.clusterId + 1}`)}>
                      <td className="surface-strong">C-{String(c.clusterId + 1).padStart(3, "0")}</td>
                      <td><Halo tone={formationHaloTone(c.status)} label={c.status}/></td>
                      <td className="mono surface-code surface-muted">{c.anchorAddress ? fmtAddrShort(c.anchorAddress, "user", 12, 6) : "pending anchor"}</td>
                      <td className="mono num">{(c.roster.length || c.size).toLocaleString()} BLS keys</td>
                      <td className="surface-live-cell">
                        <div className="mono surface-live-cell__text">
                          <b>{c.liveMembers}</b><span>/{c.size}</span><small>thr {c.threshold}</small>
                        </div>
                        <SurfaceMeter frac={memberFrac} tone={liveTone} value={`${Math.round(clamp01(thresholdFrac) * 100)}% threshold`}/>
                      </td>
                      <td className="mono num">{c.effectiveEpoch}</td>
                      <td className="mono num surface-code surface-muted">{c.formedAtBlock !== null ? `#${c.formedAtBlock.toLocaleString()}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <SurfaceEmpty loading={q.isLoading} empty="no clusters reported by this peer"/>
        )}
      </Card>
    </div>
  );
};

/* ========================================================================== */
/* MB-4 — Prover market                                                       */
/* ========================================================================== */

const PROVER_STATE_TONE: Record<ProverMarketState, "ok" | "warn" | "err" | "neutral" | "gold"> = {
  open: "gold",
  assigned: "warn",
  settled: "ok",
  slashed: "err",
  expired: "neutral",
};

/** Tone for a proof-request state (the SDK widens the state to `string`). */
function proverStateTone(state: string): "ok" | "warn" | "err" | "neutral" | "gold" {
  return PROVER_STATE_TONE[state as ProverMarketState] ?? "neutral";
}

const ProverMarketPage = ({ go: _go }: any) => {
  const q = useProverMarket();
  const market = q.data;
  const requests = market?.requests ?? [];
  const bids = market?.bids ?? [];
  const provers = market?.provers ?? [];
  const bidsByRequest = bids.reduce<Record<string, number>>((acc, b) => {
    acc[b.requestId] = (acc[b.requestId] ?? 0) + 1;
    return acc;
  }, {});
  const openCount = requests.filter((r) => r.state === "open").length;
  const assignedCount = requests.filter((r) => r.state === "assigned").length;
  const settledCount = requests.filter((r) => r.state === "settled").length;
  const maxBids = Math.max(1, ...Object.values(bidsByRequest));
  const avgBidsPerOpen = openCount ? bids.length / openCount : 0;
  const stateCounts = requests.reduce<Record<string, number>>((acc, r) => {
    acc[r.state] = (acc[r.state] ?? 0) + 1;
    return acc;
  }, {});
  return (
    <div className="ms-page ms-surface-page ms-prover-market-page">
      <SurfaceHero
        eyebrow="MB-4 · GPU proof market"
        title="Prover market"
        body={`Proof buyers escrow a max fee for work bound to a verification key, deadline, and committed Starfish data. Registered GPU provers bid down to the ${PROVER_FEE_FLOOR_LYTH} LYTH floor when the live projection exposes requests.`}
      >
        <SurfaceMetric
          label="Bid pressure"
          value={openCount ? `${avgBidsPerOpen.toFixed(1)}x` : "—"}
          sub={`${bids.length} live bids across ${openCount} open requests`}
          tone={!openCount ? "neutral" : avgBidsPerOpen >= 2 ? "ok" : avgBidsPerOpen >= 1 ? "gold" : "warn"}
          meter={<SurfaceMeter frac={ratio(bids.length, Math.max(1, openCount * 3))} tone={!openCount ? "neutral" : avgBidsPerOpen >= 2 ? "ok" : avgBidsPerOpen >= 1 ? "gold" : "warn"}/>}
        />
        <div className="surface-status-bars">
          {(["open", "assigned", "settled", "slashed", "expired"] as ProverMarketState[]).map((state) => (
            <SurfaceMeter
              key={state}
              frac={ratio(stateCounts[state] ?? 0, requests.length)}
              tone={proverStateTone(state)}
              label={state}
              value={`${stateCounts[state] ?? 0}`}
            />
          ))}
        </div>
      </SurfaceHero>
      <section className="surface-metrics">
        <SurfaceMetric label="Open requests" value={`${openCount}`} sub={`${requests.length} total`} tone="gold"/>
        <SurfaceMetric label="Assigned" value={`${assignedCount}`} sub="prover selected" tone="warn"/>
        <SurfaceMetric label="Settled" value={`${settledCount}`} sub="proof accepted" tone="ok"/>
        <SurfaceMetric label="Registered provers" value={`${provers.length}`} sub="SERVES_GPU_PROVE" tone="neutral"/>
        <SurfaceMetric label="Fee floor" value={`${PROVER_FEE_FLOOR_LYTH} LYTH`} sub={`bond ${PROVER_BOND_MIN_LYTH} LYTH`} tone="neutral"/>
      </section>

      <Card title="Proof requests" right={<span className="cap">MB-4</span>}>
        {requests.length ? (
          <div className="surface-table-wrap">
            <table className="ms-table surface-table">
              <thead>
                <tr>
                  <th>Request</th><th>State</th><th>Vkey hash</th><th style={{ textAlign: "right" }}>Max fee</th>
                  <th>Deadline</th><th>Assigned</th><th>Bid pressure</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => {
                  const bidCount = bidsByRequest[r.id] ?? 0;
                  return (
                    <tr key={r.id}>
                      <td className="mono surface-code">{fmtHashShort(r.id, 12, 6)}
                        <div className="surface-muted">buyer {fmtAddrShort(r.buyer, "user", 8, 4)}</div>
                      </td>
                      <td><Halo tone={proverStateTone(r.state)} label={r.state}/></td>
                      <td className="mono surface-code surface-muted">{fmtHashShort(r.vkeyHash, 12, 6)}</td>
                      <td className="mono num surface-value-right">{fmtLyth(r.maxFee)}</td>
                      <td className="mono surface-code surface-muted">{new Date(r.deadline * 1000).toISOString().slice(0, 16).replace("T", " ")}</td>
                      <td className="mono surface-code">
                        {r.assignedProver ? (
                          <>{fmtAddrShort(r.assignedProver, "user", 8, 4)}<div className="surface-muted">won {fmtLyth(r.winningFee)}</div></>
                        ) : <span className="surface-muted">—</span>}
                      </td>
                      <td className="surface-bid-cell">
                        <SurfaceMeter frac={bidCount / maxBids} tone={bidCount > 1 ? "ok" : bidCount === 1 ? "gold" : "neutral"} label={`${bidCount} bids`} value={bidCount ? `${bidCount}/${maxBids}` : "0"}/>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <SurfaceEmpty loading={q.isLoading} empty="no proof requests reported"/>
        )}
      </Card>

      <section className="tx-split surface-split">
        <Card title="Open bids">
          {bids.length ? (
            <div className="surface-table-wrap">
              <table className="ms-table ms-table--tight surface-table">
                <thead><tr><th>Request</th><th>Prover</th><th style={{ textAlign: "right" }}>Fee</th></tr></thead>
                <tbody>
                  {bids.map((b, i) => (
                    <tr key={`${b.requestId}-${b.prover}-${i}`}>
                      <td className="mono surface-code surface-muted">{fmtHashShort(b.requestId, 10, 4)}</td>
                      <td className="mono surface-code">{fmtAddrShort(b.prover, "user", 8, 4)}</td>
                      <td className="mono num surface-value-right">{fmtLyth(b.fee)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mono surface-empty">no open bids</p>
          )}
        </Card>
        <Card title="Registered provers">
          {provers.length ? (
            <div className="surface-table-wrap">
              <table className="ms-table ms-table--tight surface-table">
                <thead><tr><th>Prover</th><th>GPU prove</th><th style={{ textAlign: "right" }}>Fee floor</th><th style={{ textAlign: "right" }}>Bond</th></tr></thead>
                <tbody>
                  {provers.map((p) => (
                    <tr key={p.address}>
                      <td className="mono surface-code">{fmtAddrShort(p.address, "user", 8, 4)}</td>
                      <td><Halo tone={p.servesGpuProve ? "ok" : "err"} label={p.servesGpuProve ? "yes" : "no"}/></td>
                      <td className="mono num surface-value-right">{fmtLyth(p.feeFloor)}</td>
                      <td className="mono num surface-value-right">{fmtLyth(p.bond)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mono surface-empty">no registered provers</p>
          )}
        </Card>
      </section>
    </div>
  );
};

/* ========================================================================== */
/* MB-2 — Bridge health + circuit breaker                                     */
/* ========================================================================== */

function breakerTone(state: BridgeBreakerState): "ok" | "warn" | "err" | "neutral" {
  return state === "armed" ? "ok" : state === "paused" ? "err" : "neutral";
}

/**
 * MB-2 bridge health card: per-route drain-cap proximity + circuit-breaker
 * state, breaker rendered as a chromatic halo. Reusable on any bridge view.
 */
export const BridgeHealthCard = ({ routes }: { routes: readonly BridgeRouteHealth[] }) => {
  if (routes.length === 0) return null;
  return (
    <Card title="Route health + circuit breaker" right={<span className="cap">MB-2</span>}>
      <div className="surface-table-wrap">
        <table className="ms-table surface-table">
          <thead>
            <tr>
              <th>Route</th><th>Breaker</th><th>Drain cap (window)</th><th style={{ textAlign: "right" }}>Remaining</th><th>Cooldown</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => {
              const prox = r.proximity;
              const proxTone = prox === null ? "neutral" : prox >= 0.9 ? "err" : prox >= 0.6 ? "warn" : "ok";
              return (
                <tr key={`${r.bridgeId}-${r.asset}`}>
                  <td className="mono surface-code">
                    <span className="surface-strong">{r.asset}</span>
                    <div className="surface-muted">{fmtHashShort(r.bridgeId, 10, 4)}</div>
                  </td>
                  <td>
                    <Halo tone={breakerTone(r.breaker)} label={r.breaker}/>
                    {r.breaker === "paused" && r.pausedAtBlock !== null && (
                      <div className="mono surface-muted surface-row-note">
                        paused #{r.pausedAtBlock.toLocaleString()}
                      </div>
                    )}
                  </td>
                  <td className="surface-cap-cell">
                    {r.capPerWindow !== null ? (
                      <>
                        <div className="mono surface-cap-cell__amount">
                          {fmtLyth(r.drainedThisBucket)} / {fmtLyth(r.capPerWindow)}
                        </div>
                        <MeterBar frac={prox ?? 0} tone={proxTone === "neutral" ? "gold" : proxTone}/>
                        <div className="mono surface-muted">
                          {prox !== null ? `${(prox * 100).toFixed(1)}% drained` : ""} · window {r.windowBlocks.toLocaleString()} blocks
                        </div>
                      </>
                    ) : (
                      <span className="mono surface-muted">no drain cap</span>
                    )}
                  </td>
                  <td className="mono num surface-value-right">{r.remaining !== null ? fmtLyth(r.remaining) : "—"}</td>
                  <td className="mono num surface-code surface-muted">{r.resumeCooldownBlocks.toLocaleString()} blk</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

const BridgePage = ({ go: _go }: any) => {
  const q = useBridgeRouteHealth();
  const routes = q.data ?? [];
  const paused = routes.filter((r) => r.breaker === "paused").length;
  const armed = routes.filter((r) => r.breaker === "armed").length;
  const nearCap = routes.filter((r) => (r.proximity ?? 0) >= 0.9).length;
  const cappedRoutes = routes.filter((r) => r.capPerWindow !== null);
  const maxProximity = cappedRoutes.reduce((max, r) => Math.max(max, r.proximity ?? 0), 0);
  const avgProximity = cappedRoutes.length ? cappedRoutes.reduce((sum, r) => sum + (r.proximity ?? 0), 0) / cappedRoutes.length : 0;
  const sortedRoutes = [...routes].sort((a, b) => (b.proximity ?? -1) - (a.proximity ?? -1));
  return (
    <div className="ms-page ms-surface-page ms-bridge-page">
      <SurfaceHero
        eyebrow="MB-2 · route capacity"
        title="Bridge health"
        body="Per-route drain-cap proximity and circuit-breaker state for on-chain bridge routes. Each asset route drains against a block-window cap; a tripped breaker pauses claims until the cooldown clears."
      >
        <SurfaceMetric
          label="Capacity used"
          value={cappedRoutes.length ? intPct(avgProximity) : "—"}
          sub={`${cappedRoutes.length}/${routes.length} routes capped · max ${intPct(maxProximity)}`}
          tone={!cappedRoutes.length ? "neutral" : maxProximity >= 0.9 ? "err" : maxProximity >= 0.6 ? "warn" : "ok"}
          meter={<SurfaceMeter frac={avgProximity} tone={!cappedRoutes.length ? "neutral" : maxProximity >= 0.9 ? "err" : maxProximity >= 0.6 ? "warn" : "ok"}/>}
        />
        <div className="surface-route-list">
          {sortedRoutes.slice(0, 5).map((r) => {
            const proxTone = r.proximity === null ? "neutral" : r.proximity >= 0.9 ? "err" : r.proximity >= 0.6 ? "warn" : "ok";
            return (
              <SurfaceMeter
                key={`${r.bridgeId}-${r.asset}`}
                frac={r.proximity}
                tone={proxTone}
                label={`${r.asset} · ${r.breaker}`}
                value={r.proximity !== null ? intPct(r.proximity) : "uncapped"}
              />
            );
          })}
        </div>
      </SurfaceHero>
      <section className="surface-metrics">
        <SurfaceMetric label="Routes" value={`${routes.length}`} sub="route health" tone="neutral"/>
        <SurfaceMetric label="Armed" value={`${armed}`} sub="breaker live" tone="ok"/>
        <SurfaceMetric label="Paused" value={`${paused}`} sub="breaker tripped" tone={paused ? "err" : "neutral"}/>
        <SurfaceMetric label="Near cap" value={`${nearCap}`} sub=">= 90% drained" tone={nearCap ? "err" : "neutral"}/>
      </section>
      {routes.length ? (
        <BridgeHealthCard routes={routes}/>
      ) : (
        <Card title="Route health + circuit breaker" right={<span className="cap">MB-2</span>}>
          <SurfaceEmpty loading={q.isLoading} empty="no bridge routes reported by this peer"/>
        </Card>
      )}
    </div>
  );
};

export {
  DiversityPage,
  ClusterDiversityPage,
  OraclePage,
  SpendingPolicyPage,
  ClusterDirectoryPage,
  ProverMarketPage,
  BridgePage,
};
