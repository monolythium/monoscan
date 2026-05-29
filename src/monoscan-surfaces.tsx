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

const LYTHOSHI = 1_000_000_000_000_000_000n;

/** Format a raw lythoshi string as a LYTH amount (2 dp). */
function fmtLyth(raw: string | null | undefined): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  let v: bigint;
  try {
    v = BigInt(raw);
  } catch {
    return "—";
  }
  const whole = v / LYTHOSHI;
  const frac = ((v % LYTHOSHI) * 100n) / LYTHOSHI;
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
function Halo({ tone, label }: { tone: "ok" | "warn" | "err" | "neutral" | "gold"; label: string }) {
  const color =
    tone === "ok" ? "var(--ok)" :
    tone === "warn" ? "var(--warn)" :
    tone === "err" ? "var(--err)" :
    tone === "gold" ? "var(--gold)" : "var(--fg-400)";
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
  const color =
    tone === "ok" ? "var(--ok)" : tone === "warn" ? "var(--warn)" : tone === "err" ? "var(--err)" : "var(--gold)";
  return (
    <div className="ms-bar" style={{ marginTop: 4 }}>
      <div style={{ width: `${Math.max(0, Math.min(1, frac)) * 100}%`, background: color, boxShadow: `0 0 8px ${color}66` }}/>
    </div>
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
    <div style={{ display: "grid", gap: 12 }}>
      {axes.map(([label, bps, hint]) => (
        <div key={label}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 12.5, color: "var(--fg-200)" }}>{label}</span>
            <span className="mono num" style={{ fontSize: 12.5, color: "var(--fg-100)" }}>{bpsPct(bps)}</span>
          </div>
          <MeterBar frac={bps / DIVERSITY_SCORE_MAX} tone={diversityTone(bps)}/>
          <div className="mono" style={{ fontSize: 10, color: "var(--fg-500)", marginTop: 3 }}>{hint}</div>
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
    <div className="ms-page">
      <div className="ms-crumb">
        <a href="#/diversity" onClick={() => go("#/diversity")}>Node diversity</a>
        <span>›</span>
        <b>C-{String(clusterId + 1).padStart(3, "0")}</b>
      </div>
      <h1 className="ms-h1">Cluster diversity · C-{String(clusterId + 1).padStart(3, "0")}</h1>
      <p className="mono" style={{ color: "var(--fg-400)", marginBottom: 20 }}>
        Correlated-failure exposure across ASN, geography, and hosting class. A score near {DIVERSITY_SCORE_MAX} means
        the roster spreads evenly; near zero means it is concentrated in one provider / jurisdiction.
      </p>
      {view ? (
        <>
          <section className="ms-grid-2">
            <Card title="Diversity score" right={<span className="cap">PF-6 · 0..{DIVERSITY_SCORE_MAX} bps</span>}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
                <span className="mono num" style={{ fontSize: 40, color: "var(--fg-100)", letterSpacing: "-0.02em" }}>
                  {bpsPct(view.diversity.score)}
                </span>
                <Halo tone={diversityTone(view.diversity.score)} label={
                  view.diversity.score >= 6_000 ? "well diversified" : view.diversity.score >= 3_000 ? "moderate concentration" : "high concentration"
                }/>
              </div>
              <div className="mono" style={{ fontSize: 11, color: "var(--fg-500)" }}>
                unweighted mean of the three axis terms · {view.diversity.resolvedMembers} roster members resolved
              </div>
            </Card>
            <Card title="Axis breakdown">
              <DiversityBreakdownViz breakdown={view.diversity.breakdown}/>
            </Card>
          </section>
          <Card title="Operator network metadata">
            <table className="ms-table">
              <thead><tr><th>Operator</th><th>ASN</th><th>Geo</th><th>Hosting</th><th>PCR digest</th></tr></thead>
              <tbody>
                {view.operators.map((op) => (
                  <tr key={op.operatorId}>
                    <td className="mono" style={{ fontSize: 11 }}>{fmtHashShort(op.operatorId, 14, 6)}</td>
                    <td className="mono num">{op.asn > 0 ? `AS${op.asn}` : "—"}</td>
                    <td className="mono">{op.geoRegion || "—"}</td>
                    <td><Halo tone={op.hostingClass === "bareMetal" ? "ok" : op.hostingClass === "coLocation" ? "warn" : "neutral"} label={HOSTING_LABEL[op.hostingClass]}/></td>
                    <td className="mono" style={{ fontSize: 11, color: "var(--fg-400)" }}>
                      {op.pcrDigest && op.pcrDigest !== ZERO_HASH ? fmtHashShort(op.pcrDigest, 12, 6) : <span style={{ color: "var(--fg-600)" }}>no TPM quote</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      ) : (
        <p className="mono" style={{ color: "var(--fg-500)" }}>
          {q.isLoading ? "loading cluster diversity…" : `No diversity record for cluster C-${String(clusterId + 1).padStart(3, "0")}.`}
        </p>
      )}
    </div>
  );
};

/** PF-6 cluster-diversity index — `#/diversity`. */
const DiversityPage = ({ go }: any) => {
  const q = useClusterDiversitySet();
  const rows = q.data ?? [];
  const sorted = [...rows].sort((a, b) => b.diversity.score - a.diversity.score);
  const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.diversity.score, 0) / rows.length) : 0;
  const weakest = sorted.length ? sorted[sorted.length - 1] : null;
  return (
    <div className="ms-page">
      <h1 className="ms-h1">Node diversity</h1>
      <p className="mono" style={{ color: "var(--fg-400)", marginBottom: 20 }}>
        Per-cluster correlated-failure exposure (PF-6). The score is the entropy of the roster across autonomous
        systems, countries, and hosting classes — published on-chain, not editorialised here.
      </p>
      <section className="stats-counters">
        <StatCounter label="Clusters scored" value={`${rows.length}`} sub="lyth_clusterDiversity" tone="neutral"/>
        <StatCounter label="Average score" value={rows.length ? bpsPct(avg) : "—"} sub={`0..${DIVERSITY_SCORE_MAX} bps`} tone="neutral"/>
        <StatCounter
          label="Most concentrated"
          value={weakest ? bpsPct(weakest.diversity.score) : "—"}
          sub={weakest ? `C-${String(weakest.diversity.clusterId + 1).padStart(3, "0")}` : "—"}
          tone="neutral"
        />
      </section>
      <Card title="Cluster diversity scores" right={<span className="cap">PF-6</span>}>
        {sorted.length ? (
          <table className="ms-table">
            <thead><tr><th>Cluster</th><th>Score</th><th>ASN</th><th>Geo</th><th>Hosting</th><th>Members</th></tr></thead>
            <tbody>
              {sorted.map((v) => (
                <tr key={v.diversity.clusterId} style={{ cursor: "pointer" }} onClick={() => go(`#/diversity/${v.diversity.clusterId}`)}>
                  <td style={{ fontWeight: 500 }}>C-{String(v.diversity.clusterId + 1).padStart(3, "0")}</td>
                  <td><Halo tone={diversityTone(v.diversity.score)} label={bpsPct(v.diversity.score)}/></td>
                  <td className="mono num">{bpsPct(v.diversity.breakdown.asnVariance)}</td>
                  <td className="mono num">{bpsPct(v.diversity.breakdown.geoVariance)}</td>
                  <td className="mono num">{bpsPct(v.diversity.breakdown.hostingSpread)}</td>
                  <td className="mono num">{v.diversity.resolvedMembers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mono" style={{ color: "var(--fg-500)", fontSize: 12, margin: 0 }}>
            {q.isLoading ? "loading diversity scores…" : "no diversity records reported"}
          </p>
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
  return (
    <div className="ms-page">
      <h1 className="ms-h1">Oracle</h1>
      <p className="mono" style={{ color: "var(--fg-400)", marginBottom: 20 }}>
        Decentralised price oracle (MB-6). Each feed closes a round when at least its k-of-n signers agree within the
        deviation bound. Medians, signers, and feed parameters are read straight from the oracle precompile.
      </p>
      <section className="stats-counters">
        <StatCounter label="Configured feeds" value={`${feeds.length}`} sub="lyth_oracleDashboard" tone="neutral"/>
        <StatCounter label="Authorized signers" value={`${signers.length}`} sub="serves oracle writer" tone="neutral"/>
        <StatCounter
          label="Oracle admin"
          value={dash?.admin ? fmtAddrShort(dash.admin, "user", 10, 5) : "—"}
          sub="foundation multisig"
          tone="neutral"
        />
      </section>

      <Card title="Configured feeds" right={<span className="cap">MB-6</span>}>
        {feeds.length ? (
          <table className="ms-table">
            <thead>
              <tr>
                <th>Feed</th><th>Decimals</th><th>Signers</th><th>Heartbeat</th><th>Deviation</th>
                <th style={{ textAlign: "right" }}>Latest median</th><th>Finalized</th>
              </tr>
            </thead>
            <tbody>
              {feeds.map((f) => (
                <tr key={f.feedId}>
                  <td style={{ fontWeight: 500 }}>
                    {feedDisplayName(f)}
                    <div className="mono" style={{ fontSize: 10, color: "var(--fg-500)" }}>{fmtHashShort(f.feedId, 12, 6)}</div>
                  </td>
                  <td className="mono num">{f.decimals}</td>
                  <td className="mono">
                    <b style={{ color: "var(--gold)" }}>{f.minSigners}</b>
                    <span style={{ color: "var(--fg-500)" }}>-of-{f.allowedWritersLen}</span>
                  </td>
                  <td className="mono num">{f.heartbeatSecs}s</td>
                  <td className="mono num">{bpsPct(f.deviationBps)}</td>
                  <td className="mono num" style={{ textAlign: "right", color: "var(--fg-100)" }}>{fmtPrice(f.latestMedian, f.decimals)}</td>
                  <td className="mono" style={{ fontSize: 11, color: "var(--fg-400)" }}>
                    {f.finalizedAtBlock !== null ? (
                      <>#{f.finalizedAtBlock.toLocaleString()}<div style={{ fontSize: 10, color: "var(--fg-500)" }}>round {f.latestRoundId} · {f.observationsLen} obs</div></>
                    ) : <span style={{ color: "var(--fg-600)" }}>no round closed</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mono" style={{ color: "var(--fg-500)", fontSize: 12, margin: 0 }}>
            {q.isLoading ? "loading feeds…" : "no feeds configured on this peer"}
          </p>
        )}
      </Card>

      <Card title="Active signer roster" right={<span className="cap">writer set</span>}>
        {signers.length ? (
          <table className="ms-table">
            <thead><tr><th>Signer</th><th>Serves oracle writer</th><th style={{ textAlign: "right" }}>Bond</th><th>Allowed feeds</th></tr></thead>
            <tbody>
              {signers.map((s) => (
                <tr key={s.address}>
                  <td className="mono" style={{ fontSize: 11 }}>{fmtAddrShort(s.address, "user", 14, 6)}</td>
                  <td><Halo tone={s.servesOracleWriter ? "ok" : "err"} label={s.servesOracleWriter ? "authorized" : "revoked"}/></td>
                  <td className="mono num" style={{ textAlign: "right" }}>{fmtLyth(s.bond)}</td>
                  <td className="mono" style={{ fontSize: 11, color: "var(--fg-400)" }}>
                    {s.feeds.length
                      ? s.feeds.map((fid) => feeds.find((f) => f.feedId === fid)?.label ?? fmtHashShort(fid, 8, 4)).join(" · ")
                      : <span style={{ color: "var(--fg-600)" }}>global only</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mono" style={{ color: "var(--fg-500)", fontSize: 12, margin: 0 }}>
            {q.isLoading ? "loading signers…" : "no authorized signers reported"}
          </p>
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
  return (
    <div className="ms-page">
      <h1 className="ms-h1">Cluster directory</h1>
      <p className="mono" style={{ color: "var(--fg-400)", marginBottom: 20 }}>
        Every DVT cluster the chain has formed (MB-5). A cluster appears the moment it activates at an epoch boundary —
        fed by the on-chain <span className="mono" style={{ color: "var(--gold)" }}>ClusterFormed</span> event, not a heartbeat sweep.
      </p>
      <section className="stats-counters">
        <StatCounter label="Clusters" value={`${clusters.length}`} sub="lyth_clusterDirectory" tone="neutral"/>
        <StatCounter label="Active" value={`${counts.active ?? 0}`} sub="signing now" tone="neutral"/>
        <StatCounter label="Forming" value={`${counts.forming ?? 0}`} sub="awaiting epoch" tone="neutral"/>
        <StatCounter label="Current epoch" value={dir?.currentEpoch !== null && dir?.currentEpoch !== undefined ? `${dir.currentEpoch}` : "—"} sub="directory snapshot" tone="neutral"/>
      </section>
      <Card title="Directory" right={<span className="cap">MB-5</span>}>
        {clusters.length ? (
          <table className="ms-table">
            <thead>
              <tr>
                <th>Cluster</th><th>Status</th><th>Anchor</th><th>Roster</th><th>Live</th><th>Epoch</th><th>Formed</th>
              </tr>
            </thead>
            <tbody>
              {clusters.map((c) => (
                <tr key={c.clusterId} style={{ cursor: "pointer" }} onClick={() => go(`#/cluster/${c.clusterId + 1}`)}>
                  <td style={{ fontWeight: 500 }}>C-{String(c.clusterId + 1).padStart(3, "0")}</td>
                  <td><Halo tone={formationHaloTone(c.status)} label={c.status}/></td>
                  <td className="mono" style={{ fontSize: 11, color: "var(--fg-400)" }}>{fmtAddrShort(c.anchorAddress, "user", 12, 6)}</td>
                  <td className="mono num">{c.roster.length} BLS keys</td>
                  <td className="mono">
                    <b style={{ color: c.liveMembers >= c.threshold ? "var(--ok)" : "var(--err)" }}>{c.liveMembers}</b>
                    <span style={{ color: "var(--fg-500)" }}>/{c.size}</span>
                    <span className="mono" style={{ fontSize: 10, color: "var(--fg-500)", marginLeft: 4 }}>thr {c.threshold}</span>
                  </td>
                  <td className="mono num">{c.effectiveEpoch}</td>
                  <td className="mono num" style={{ fontSize: 11, color: "var(--fg-400)" }}>{c.formedAtBlock !== null ? `#${c.formedAtBlock.toLocaleString()}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mono" style={{ color: "var(--fg-500)", fontSize: 12, margin: 0 }}>
            {q.isLoading ? "loading directory…" : "no clusters reported by this peer"}
          </p>
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
  return (
    <div className="ms-page">
      <h1 className="ms-h1">Prover market</h1>
      <p className="mono" style={{ color: "var(--fg-400)", marginBottom: 20 }}>
        GPU proof-request market (MB-4). Buyers escrow a max fee against a verification key + deadline; registered GPU
        provers bid down to the floor of {PROVER_FEE_FLOOR_LYTH} LYTH (bond {PROVER_BOND_MIN_LYTH} LYTH to register).
      </p>
      <section className="stats-counters">
        <StatCounter label="Open requests" value={`${openCount}`} sub={`${requests.length} total`} tone="neutral"/>
        <StatCounter label="Live bids" value={`${bids.length}`} sub="lyth_proverMarket" tone="neutral"/>
        <StatCounter label="Registered provers" value={`${provers.length}`} sub="SERVES_GPU_PROVE" tone="neutral"/>
        <StatCounter label="Fee floor" value={`${PROVER_FEE_FLOOR_LYTH} LYTH`} sub={`bond ${PROVER_BOND_MIN_LYTH} LYTH`} tone="neutral"/>
      </section>

      <Card title="Proof requests" right={<span className="cap">MB-4</span>}>
        {requests.length ? (
          <table className="ms-table">
            <thead>
              <tr>
                <th>Request</th><th>State</th><th>Vkey hash</th><th style={{ textAlign: "right" }}>Max fee</th>
                <th>Deadline</th><th>Assigned</th><th>Bids</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td className="mono" style={{ fontSize: 11 }}>{fmtHashShort(r.id, 12, 6)}
                    <div style={{ fontSize: 10, color: "var(--fg-500)" }}>buyer {fmtAddrShort(r.buyer, "user", 8, 4)}</div>
                  </td>
                  <td><Halo tone={proverStateTone(r.state)} label={r.state}/></td>
                  <td className="mono" style={{ fontSize: 11, color: "var(--fg-400)" }}>{fmtHashShort(r.vkeyHash, 12, 6)}</td>
                  <td className="mono num" style={{ textAlign: "right" }}>{fmtLyth(r.maxFee)}</td>
                  <td className="mono" style={{ fontSize: 11, color: "var(--fg-400)" }}>{new Date(r.deadline * 1000).toISOString().slice(0, 16).replace("T", " ")}</td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {r.assignedProver ? (
                      <>{fmtAddrShort(r.assignedProver, "user", 8, 4)}<div style={{ fontSize: 10, color: "var(--fg-500)" }}>won {fmtLyth(r.winningFee)}</div></>
                    ) : <span style={{ color: "var(--fg-600)" }}>—</span>}
                  </td>
                  <td className="mono num">{bidsByRequest[r.id] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mono" style={{ color: "var(--fg-500)", fontSize: 12, margin: 0 }}>
            {q.isLoading ? "loading requests…" : "no proof requests reported"}
          </p>
        )}
      </Card>

      <section className="tx-split">
        <Card title="Open bids">
          {bids.length ? (
            <table className="ms-table ms-table--tight">
              <thead><tr><th>Request</th><th>Prover</th><th style={{ textAlign: "right" }}>Fee</th></tr></thead>
              <tbody>
                {bids.map((b, i) => (
                  <tr key={`${b.requestId}-${b.prover}-${i}`}>
                    <td className="mono" style={{ fontSize: 11, color: "var(--fg-400)" }}>{fmtHashShort(b.requestId, 10, 4)}</td>
                    <td className="mono" style={{ fontSize: 11 }}>{fmtAddrShort(b.prover, "user", 8, 4)}</td>
                    <td className="mono num" style={{ textAlign: "right" }}>{fmtLyth(b.fee)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mono" style={{ color: "var(--fg-500)", fontSize: 12, margin: 0 }}>no open bids</p>
          )}
        </Card>
        <Card title="Registered provers">
          {provers.length ? (
            <table className="ms-table ms-table--tight">
              <thead><tr><th>Prover</th><th>GPU prove</th><th style={{ textAlign: "right" }}>Fee floor</th><th style={{ textAlign: "right" }}>Bond</th></tr></thead>
              <tbody>
                {provers.map((p) => (
                  <tr key={p.address}>
                    <td className="mono" style={{ fontSize: 11 }}>{fmtAddrShort(p.address, "user", 8, 4)}</td>
                    <td><Halo tone={p.servesGpuProve ? "ok" : "err"} label={p.servesGpuProve ? "yes" : "no"}/></td>
                    <td className="mono num" style={{ textAlign: "right" }}>{fmtLyth(p.feeFloor)}</td>
                    <td className="mono num" style={{ textAlign: "right" }}>{fmtLyth(p.bond)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mono" style={{ color: "var(--fg-500)", fontSize: 12, margin: 0 }}>no registered provers</p>
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
      <table className="ms-table">
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
                <td className="mono" style={{ fontSize: 11 }}>
                  <span style={{ color: "var(--fg-100)" }}>{r.asset}</span>
                  <div style={{ fontSize: 10, color: "var(--fg-500)" }}>{fmtHashShort(r.bridgeId, 10, 4)}</div>
                </td>
                <td>
                  <Halo tone={breakerTone(r.breaker)} label={r.breaker}/>
                  {r.breaker === "paused" && r.pausedAtBlock !== null && (
                    <div className="mono" style={{ fontSize: 10, color: "var(--fg-500)", marginTop: 2 }}>
                      paused #{r.pausedAtBlock.toLocaleString()}
                    </div>
                  )}
                </td>
                <td style={{ minWidth: 180 }}>
                  {r.capPerWindow !== null ? (
                    <>
                      <div className="mono" style={{ fontSize: 11, color: "var(--fg-200)" }}>
                        {fmtLyth(r.drainedThisBucket)} / {fmtLyth(r.capPerWindow)}
                      </div>
                      <MeterBar frac={prox ?? 0} tone={proxTone === "neutral" ? "gold" : proxTone}/>
                      <div className="mono" style={{ fontSize: 10, color: "var(--fg-500)", marginTop: 2 }}>
                        {prox !== null ? `${(prox * 100).toFixed(1)}% drained` : ""} · window {r.windowBlocks.toLocaleString()} blocks
                      </div>
                    </>
                  ) : (
                    <span className="mono" style={{ fontSize: 11, color: "var(--fg-600)" }}>no drain cap</span>
                  )}
                </td>
                <td className="mono num" style={{ textAlign: "right" }}>{r.remaining !== null ? fmtLyth(r.remaining) : "—"}</td>
                <td className="mono num" style={{ fontSize: 11, color: "var(--fg-400)" }}>{r.resumeCooldownBlocks.toLocaleString()} blk</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
};

const BridgePage = ({ go: _go }: any) => {
  const q = useBridgeRouteHealth();
  const routes = q.data ?? [];
  const paused = routes.filter((r) => r.breaker === "paused").length;
  const armed = routes.filter((r) => r.breaker === "armed").length;
  const nearCap = routes.filter((r) => (r.proximity ?? 0) >= 0.9).length;
  return (
    <div className="ms-page">
      <h1 className="ms-h1">Bridge health</h1>
      <p className="mono" style={{ color: "var(--fg-400)", marginBottom: 20 }}>
        Per-route drain-cap proximity and circuit-breaker state (MB-2). Each route caps how much of an asset can drain
        per window; the breaker pauses claims when crossed, then waits out a resume cooldown.
      </p>
      <section className="stats-counters">
        <StatCounter label="Routes" value={`${routes.length}`} sub="lyth_bridgeRouteHealth" tone="neutral"/>
        <StatCounter label="Armed" value={`${armed}`} sub="breaker live" tone="neutral"/>
        <StatCounter label="Paused" value={`${paused}`} sub="breaker tripped" tone="neutral"/>
        <StatCounter label="Near cap" value={`${nearCap}`} sub="≥ 90% drained" tone="neutral"/>
      </section>
      {routes.length ? (
        <BridgeHealthCard routes={routes}/>
      ) : (
        <Card title="Route health + circuit breaker" right={<span className="cap">MB-2</span>}>
          <p className="mono" style={{ color: "var(--fg-500)", fontSize: 12, margin: 0 }}>
            {q.isLoading ? "loading route health…" : "no bridge routes reported by this peer"}
          </p>
        </Card>
      )}
    </div>
  );
};

/* --------------------------- local StatCounter ---------------------------- */
/* Mirrors the StatCounter shape + classes in monoscan-extras.tsx (kept local
   to avoid a cross-module import — both surfaces share the same `.stats-counter`
   CSS in styles/monoscan.css). */
const StatCounter = ({ label, value, sub, tone }: any) => (
  <div className={`stats-counter stats-counter--${tone || "neutral"}`}>
    <div className="mono stats-counter__label">{label}</div>
    <div className="mono num stats-counter__value">{value}</div>
    <div className="mono stats-counter__sub">{sub}</div>
  </div>
);

export {
  DiversityPage,
  ClusterDiversityPage,
  OraclePage,
  SpendingPolicyPage,
  ClusterDirectoryPage,
  ProverMarketPage,
  BridgePage,
};
