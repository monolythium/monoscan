/* =====================================================
   Monoscan — public chain explorer for Monolythium v2 (LythiumDAG-BFT).
   Hash-routed SPA. Live data flows through @monolythium/core-sdk against a
   public node's JSON-RPC + indexer; fixture data renders only when no node
   is reachable (offline/static preview).
===================================================== */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useMemo, useRef } from "react";
import {
  Icon, Sparkline, ClusterRing, StateMachinePill, Card,
} from "./primitives";
import { MONOSCAN_DATA, MARKETS } from "./data/fallback";
import { StatsPage, BurnPage, WalletsPage, WalletPage, TransactionsPage, TxPage, RoundPage, SearchPage, ProtocolPage } from "./monoscan-extras";
import { MarketsPage, MarketPage, liveMarketRowsFromNativeState } from "./monoscan-markets";
import {
  DiversityPage,
  ClusterDiversityPage,
  OraclePage,
  SpendingPolicyPage,
  ClusterDirectoryPage,
  ProverMarketPage,
  BridgePage,
} from "./monoscan-surfaces";
import {
  useChainStats,
  useClobMarkets,
  useClusterSet,
  useClusterStatus,
  useClusterApr,
  useHealthyClusters,
  useActiveClusters,
  useOperatorAuthority,
  useOperatorDuties,
  useOperatorInfo,
  useOperatorRisk,
  useOperatorSigningActivity,
  useClusterDelegators,
  useClusterEntity,
  useDelegationCap,
  useEntityRatchet,
  useMetricsRange,
  useNativeMarketState,
  useNativeSupply,
  useIndexerAvailability,
  useLiveOperatorRoster,
  useOperatorCapabilities,
  NATIVE_INITIAL_SUPPLY_LYTHOSHI,
} from "./data/hooks";
import { AskPage } from "./nl/AskPage";
import { MsThemeSwitcher } from "./monoscan-theme";
import { SearchModal } from "./SearchModal";
import { fmtAddr, fmtHashShort } from "./sdk/format";
import { LYTHOSHI_PER_LYTH } from "@monolythium/core-sdk";

/* --- light helpers (mirror desktop's primitives, lighter weight) --- */
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = (n) => n.toLocaleString();
const pct = (x, d=2) => `${(x*100).toFixed(d)}%`;
const ago = (s) => s; // already strings

const SCAN = MONOSCAN_DATA;
const CHAIN_ID = 69420;

const clusterLabel = (slot: number | string) => `C-${String(slot).padStart(3, "0")}`;

const openWalletStakeIntent = (cluster: any) => {
  const clusterId = String(cluster.slot);
  const label = clusterLabel(cluster.slot);
  const href = `monolythium://stake?cluster=${encodeURIComponent(label)}&clusterId=${encodeURIComponent(clusterId)}&chainId=${CHAIN_ID}`;
  void navigator.clipboard?.writeText(href);
  window.__msToast?.(`Opening desktop/mobile wallet staking flow for ${label}; link copied.`);
  window.location.href = href;
};

/* ============== HEADER NAV ============== */
// Primary surfaces render inline (7 tabs). The specialized network surfaces
// live under a single "Network" dropdown so the header stays one calm row and
// never wraps. Every route is still reachable as a deep-link; Burn folds into
// Statistics (#/burn deep-links to its supply-&-burn section).
export const PRIMARY_NAV: ReadonlyArray<readonly [string, string]> = [
  ["#/", "Overview"],
  ["#/transactions", "Transactions"],
  ["#/markets", "Markets"],
  ["#/clusters", "Clusters"],
  ["#/operators", "Operators"],
  ["#/wallets", "Wallets"],
  ["#/stats", "Statistics"],
];
export const NETWORK_NAV: ReadonlyArray<readonly [string, string]> = [
  ["#/oracle", "Oracle"],
  ["#/prover-market", "Provers"],
  ["#/bridge", "Bridge"],
  ["#/cluster-directory", "Directory"],
  ["#/diversity", "Diversity"],
  ["#/protocol", "Protocol"],
];

// A nav item is active on its own route and on its child routes. Burn folds
// into Statistics, so #/burn lights the Statistics tab.
export const navRouteMatches = (h: string, route: string): boolean =>
  route === h ||
  (h === "#/transactions" && route.startsWith("#/tx")) ||
  (h === "#/markets" && route.startsWith("#/market")) ||
  (h === "#/wallets" && route.startsWith("#/wallet")) ||
  // Clusters stays active for /cluster/:slot; the cluster-directory route lives
  // in the Network group and owns its own item there.
  (h === "#/clusters" && route.startsWith("#/cluster/")) ||
  (h === "#/operators" && route.startsWith("#/operator")) ||
  (h === "#/stats" && route.startsWith("#/burn")) ||
  (h === "#/oracle" && route.startsWith("#/oracle")) ||
  (h === "#/prover-market" && route.startsWith("#/prover")) ||
  (h === "#/bridge" && route.startsWith("#/bridge")) ||
  (h === "#/cluster-directory" && route.startsWith("#/cluster-directory")) ||
  (h === "#/diversity" && route.startsWith("#/diversity")) ||
  (h === "#/protocol" && route.startsWith("#/protocol"));

// Single grouped dropdown for the specialized network surfaces. Keeps the
// header to one row; the trigger lights when any grouped route is active and
// closes on outside-click, Escape, or navigation.
const NetworkMenu = ({ go, route }: any) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const groupActive = NETWORK_NAV.some(([h]) => navRouteMatches(h, route));
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  // Close whenever the route changes (e.g. after picking an item).
  useEffect(() => { setOpen(false); }, [route]);
  return (
    <div className="ms-nav__group" ref={ref}>
      <button
        type="button"
        className={`ms-nav__item ms-nav__trigger ${groupActive ? "is-active" : ""} ${open ? "is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Network
        <span className="ms-nav__caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="ms-nav__menu" role="menu">
          {NETWORK_NAV.map(([h, l]) => (
            <a
              key={h}
              href={h}
              role="menuitem"
              onClick={() => { go(h); setOpen(false); }}
              className={`ms-nav__menu-item ${navRouteMatches(h, route) ? "is-active" : ""}`}
            >
              {l}
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

const Header = ({ go, route }: any) => {
  const [searchOpen, setSearchOpen] = useState(false);

  // Global ⌘K / Ctrl+K opens the search modal. Skipped when an
  // editable target is focused so the keystroke still works inside the
  // Ask page or any future text inputs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      setSearchOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <header className="ms-header">
        <a href="#/" onClick={()=>go("#/")} className="ms-brand">
          <img className="ms-brand__mark" src="/brand/monolythium.svg" alt="" width="32" height="32"/>
          <div>
            <b>Monoscan</b>
            <small>live · testnet · chain_id 69420</small>
          </div>
        </a>
        <button
          type="button"
          className="ms-search-btn"
          onClick={() => setSearchOpen(true)}
          aria-label="Open search"
          title="Search (⌘K)"
        >
          <Icon name="explorer" size={14}/>
          <span>Search</span>
          <span className="ms-search-btn__kbd mono">⌘K</span>
        </button>
        <button
          type="button"
          className={`ms-ask-btn ${route.startsWith("#/ask") ? "is-active" : ""}`}
          onClick={()=>go("#/ask")}
          aria-label="Ask Monoscan a natural-language question"
          title="Ask Monoscan in plain English"
        >
          <span className="ms-ask-btn__spark"/>
          <span>Ask</span>
          <span className="ms-ask-btn__hint mono">NL</span>
        </button>
        <nav className="ms-nav">
          {PRIMARY_NAV.map(([h, l]) => (
            <a
              key={h}
              href={h}
              onClick={() => go(h)}
              className={`ms-nav__item ${navRouteMatches(h, route) ? "is-active" : ""}`}
            >
              {l}
            </a>
          ))}
          <NetworkMenu go={go} route={route} />
        </nav>
        <MsThemeSwitcher/>
      </header>
      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        go={go}
      />
    </>
  );
};

/* ============== LANDING (rebuilt — calm, human-first) ============== */
const fmtUsd = (n) => n>=1e9 ? `$${(n/1e9).toFixed(2)}B` : n>=1e6 ? `$${(n/1e6).toFixed(1)}M` : n>=1e3 ? `$${(n/1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;
const lythoshiToLythNumber = (value: string | bigint | number | null | undefined) => {
  if (value === null || value === undefined || value === "") return 0;
  try {
    const raw = BigInt(value);
    return Number(raw / LYTHOSHI_PER_LYTH) + Number(raw % LYTHOSHI_PER_LYTH) / Number(LYTHOSHI_PER_LYTH);
  } catch {
    const n = Number(value);
    return Number.isFinite(n) ? n / Number(LYTHOSHI_PER_LYTH) : 0;
  }
};
const fmtLythSupplyCompact = (value: string | bigint | number | null | undefined) => {
  const lyth = lythoshiToLythNumber(value);
  if (lyth >= 1_000_000) {
    const millions = lyth / 1_000_000;
    const nearWholeMillion = Math.abs(millions - Math.round(millions)) < 0.0000005;
    return `${millions.toLocaleString(undefined, { maximumFractionDigits: nearWholeMillion ? 2 : 5 })}M`;
  }
  if (lyth >= 1_000) return `${(lyth / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`;
  return lyth.toLocaleString(undefined, { maximumFractionDigits: 5 });
};
const fmtLythSupplyReadable = (value: string | bigint | number | null | undefined) => {
  const lyth = lythoshiToLythNumber(value);
  return lyth.toLocaleString(undefined, {
    minimumFractionDigits: lyth % 1 === 0 ? 0 : 2,
    maximumFractionDigits: lyth >= 1_000_000 ? 2 : 5,
  });
};
// Precise (non-compacted) LYTH amount for bonded stake / TVS / vote weight.
// Accepts a raw lythoshi value and returns e.g. "5,000 LYTH"; "—" on null/NaN.
export const fmtLythAmount = (value: string | bigint | number | null | undefined) => {
  if (value === null || value === undefined || value === "") return "—";
  const n = lythoshiToLythNumber(value);
  return Number.isFinite(n) ? `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} LYTH` : "—";
};
// Compact large integer counts (e.g. execution units) — 1.28M / 4.2K / 940.
export const fmtCountCompact = (value: number | null | undefined) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`;
  if (n >= 1_000) return `${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`;
  return n.toLocaleString();
};
// Render a cluster directory descriptor's stake (raw lythoshi string) defensively:
// a real value formats as LYTH; null means the directory endpoint does not carry
// a stake/weight field yet (honest "not indexed", never a dead "pending").
// TODO(core-sdk): cluster-directory descriptor lacks a stake/weight field
// (directoryEntryToCluster sets stake:null, stakeIndexed:false) — wire it through
// once lyth_clusterDirectory / lyth_clusterStatus exposes bonded/TVS/vote-weight.
export const fmtClusterStake = (cl: any) =>
  cl?.stake !== null && cl?.stake !== undefined ? fmtLythAmount(cl.stake) : "not indexed";
// One-based padded cluster label from a zero-based protocol cluster id.
export const cName = (id: number | string) => `C-${String(Number(id) + 1).padStart(3, "0")}`;
const surfaceLabel = (method = "") =>
  method
    .replace(/^lyth_/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
const surfaceSourceLabel = (method = "") => {
  const label = surfaceLabel(method);
  if (!method) return "Live surface";
  if (method.startsWith("lyth_")) return label;
  if (method.includes("_") || method.includes("-")) return label;
  return label || "Live surface";
};
const LANDING_METRIC_SELECTORS = ["committed_round", "mempool_depth", "proposer_latency", "attestation_rate"] as const;

const Landing = ({ go }: any) => {
  const c = SCAN.consensus;
  const markets = MARKETS || [];
  const [round, setRound] = useState(c.round);
  const [latencySeries, setLatencySeries] = useState(()=>Array.from({length:60},(_,i)=>340+Math.sin(i*0.4)*16+Math.random()*14));
  const [rateSeries, setRateSeries]       = useState(()=>Array.from({length:60},(_,i)=>2.8+Math.sin(i*0.3)*0.15+Math.random()*0.08));

  const chainStats = useChainStats();
  const nativeSupply = useNativeSupply();
  const liveClobMarkets = useClobMarkets(25);
  const nativeMarketState = useNativeMarketState();
  const indexerAvailability = useIndexerAvailability();
  const liveClusters = useClusterSet();
  const liveMetrics = useMetricsRange(LANDING_METRIC_SELECTORS);
  const operatorCapabilities = useOperatorCapabilities();
  const liveStats = chainStats.data ?? null;
  const hasLiveStats = liveStats !== null;
  const liveMode = indexerAvailability.liveChain;
  const liveClobRows = liveClobMarkets.data?.markets ?? [];
  const nativeSpotRows = useMemo(
    () => liveMarketRowsFromNativeState(nativeMarketState.data?.spotMarkets ?? []),
    [nativeMarketState.data],
  );
  const liveMarketRows = liveClobRows.length > 0 ? liveClobRows : nativeSpotRows;
  const liveMarketSource = liveClobRows.length > 0 ? "lyth_clobMarkets" : nativeSpotRows.length > 0 ? "native-market-state" : "live market index";
  const liveMarketSourceLabel = liveClobRows.length > 0 ? "CLOB market feed" : nativeSpotRows.length > 0 ? "native market state" : "live market index";
  const hasLiveMarketResponse = (liveClobMarkets.data !== undefined && liveClobMarkets.data !== null)
    || (nativeMarketState.data !== undefined && nativeMarketState.data !== null);
  const liveMarketCount = liveMarketRows.length;
  // Human-facing caption for the live market state. The raw RPC method name
  // (liveMarketSource) reads like a debug label on a headline card, so surface
  // plain copy and keep the method name only in the title tooltip.
  const liveMarketCaption = hasLiveMarketResponse
    ? liveMarketCount > 0 ? "" : "awaiting price feed"
    : liveMode ? "live endpoint pending" : "";
  // 24h-volume headline: there is no quote-notional traded-volume aggregate
  // on-chain yet — CLOB rows carry only unscaled tick/lot integers with no
  // quote-decimal metadata, so any price*volume sum would be a fabricated USD
  // figure. In live mode we therefore show an honest "—" (see displayedVol24h);
  // the fixture preview keeps its illustrative total.
  // TODO(core-sdk): no quote-notional traded-volume aggregate (see monoscan-markets.tsx).

  // Only animate the local fixture ticker when no live chain data is
  // reaching us. When chain stats / metrics are live the displayed values
  // come from the polled hooks; the interval would just thrash React.
  useEffect(() => {
    if (chainStats.data) return;
    const id = setInterval(() => {
      setRound(r => r + 1);
      setLatencySeries(s => [...s.slice(1), 340+Math.sin(Date.now()/4000)*16+Math.random()*14]);
      setRateSeries(s => [...s.slice(1), 2.8+Math.sin(Date.now()/5000)*0.15+Math.random()*0.08]);
    }, 380);
    return () => clearInterval(id);
  }, [chainStats.data]);

  // Fixture-derived market values (LYTH price, mcap, 24h vol, movers) are a
  // design-preview illusion drawn from the static MARKETS fixture — they must
  // NEVER reach a live screen, even a degraded one. liveMode is the SOLE gate:
  // when the chain is live these collapse to neutral empties so a node that
  // stops returning market state can never leak a fabricated $8.42 price or
  // fake gainers/losers/most-traded.
  const mono = liveMode ? { price: 0, chg24h: 0, sparkline: [] } : (markets.find(m=>m.sym==="LYTH") || { price: 8.42, chg24h: 2.4, sparkline: [] });
  const vol24h = liveMode ? 0 : markets.reduce((a,t)=>a+t.vol24h,0);
  const mcap   = liveMode ? 0 : markets.reduce((a,t)=>a+t.mcap,0);
  const gainers = liveMode ? [] : [...markets].sort((a,b)=>b.chg24h-a.chg24h).slice(0,5);
  const losers  = liveMode ? [] : [...markets].sort((a,b)=>a.chg24h-b.chg24h).slice(0,5);
  const byVol   = liveMode ? [] : [...markets].sort((a,b)=>b.vol24h-a.vol24h).slice(0,5);
  const tvs     = parseFloat(c.tvs); // M LYTH
  const avgApy  = 6.4;
  const pubSupply = parseFloat(SCAN.supply.public); // M LYTH circulating public
  const pubPct    = SCAN.supply.publicPct;          // % of total
  const privPct   = 100 - pubPct;
  const totalSupply = pubSupply / (pubPct/100);     // implied total (M)
  const privSupply  = totalSupply - pubSupply;      // M LYTH shielded
  const displayedVol24h = liveMode ? null : vol24h;
  const liveSupply = nativeSupply.data ?? null;
  const liveInitialSupply = liveSupply?.initialSupplyLythoshi ?? NATIVE_INITIAL_SUPPLY_LYTHOSHI;
  const liveCurrentSupply = liveSupply?.circulatingSupplyLythoshi ?? liveInitialSupply;
  const liveBurnedSupply = liveSupply?.totalBurnedLythoshi ?? "0";
  const displayedRound = liveStats?.latestHeight ?? (liveMode ? null : round);
  const liveClusterCount = liveStats?.clusters.total ?? liveClusters.data?.length ?? null;
  const livePeerCount = liveStats?.peerCount ?? null;
  const liveMempoolDepth = liveStats
    ? liveStats.mempool.ready + liveStats.mempool.pending
    : null;
  const metricSeries = liveMetrics.data?.series ?? [];
  const latestMetricValue = (selector: string) => {
    const series = metricSeries.find((s: any) => s.selector === selector);
    const sample = series?.samples?.at(-1) ?? null;
    if (!sample) return null;
    return {
      value: Number(sample.value),
      unit: series?.unit ?? null,
      blockNumber: Number(sample.blockNumber),
    };
  };
  // Numeric sample arrays for the live confidence-strip sparklines. Returns the
  // already-fetched lyth_metricsRange samples (oldest→newest) for a selector, or
  // [] when the node retains no series — callers then render a flat placeholder
  // bar so every tile keeps equal height.
  const metricSamples = (selector: string): number[] => {
    const series = metricSeries.find((s: any) => s.selector === selector);
    return (series?.samples ?? [])
      .map((s: any) => Number(s.value))
      .filter((n: number) => Number.isFinite(n));
  };
  const proposerLatency = latestMetricValue("proposer_latency");
  const attestationRate = latestMetricValue("attestation_rate");
  const latencySamples = metricSamples("proposer_latency");
  const mempoolSamples = metricSamples("mempool_depth");
  const attestSamples = metricSamples("attestation_rate");
  const reportedSurfaces = Object.entries(operatorCapabilities.data?.surfaces ?? {});
  const operatorSurfaces = reportedSurfaces.length
    ? reportedSurfaces.slice(0, 6).map(([method, cap]: any) => ({
        label: surfaceLabel(method),
        method,
        sourceLabel: surfaceSourceLabel(method),
        status: cap.status,
        tracking: cap.tracking ?? "reported by operator capabilities",
      }))
    : [
        ["Cluster directory", "lyth_clusterDirectory"],
        ["Cluster status", "lyth_clusterStatus"],
        ["Operator risk", "lyth_operatorRisk"],
        ["Transaction feed", "lyth_txFeed"],
        ["Search index", "lyth_search"],
        ["CLOB markets", "lyth_clobMarkets"],
      ].map(([label, method]) => ({
        label,
        method,
        sourceLabel: surfaceSourceLabel(method),
        status: operatorCapabilities.isLoading ? "loading" : liveMode ? "not reported" : "wired",
        tracking: liveMode ? "capability advertisement not returned by live node" : "typed SDK method with null-safe page handling",
      }));

  return (
    <div className="ms-page ms-overview">
      {/* ---------- WELCOME HERO ---------- */}
      <section className="ov-hero">
        <div className="ov-hero__left">
          <div className="ov-hero__tag">
            <span className="ov-livedot"/>
            <span className="mono" style={{fontSize:11,letterSpacing:"0.14em",textTransform:"uppercase",color:"var(--fg-300)"}}>
              {hasLiveStats
                ? `Monolythium · round ${fmt(liveStats.latestHeight)} · ${liveStats.peerCount} peers`
                : liveMode
                  ? "Monolythium · connecting to live node"
                : `Monolythium · demo feed · ${c.ratePerSec.toFixed(1)} rounds/s`}
            </span>
          </div>
          <h1 className="ov-hero__title">
            The <span style={{color:"var(--gold)"}}>Monolythium</span> network,<br/>
            <span style={{color:"var(--fg-300)"}}>in plain sight.</span>
          </h1>
          <p className="ov-hero__desc">
            Monoscan is the public explorer for Monolythium's Starfish DAG — every transfer,
            trade, stake reward, vertex, and commit reconciled against {liveClusterCount ?? (liveMode ? "—" : c.signers.total)} live clusters.
            Search anything, or jump straight into live markets, clusters, wallets, and rounds.
          </p>
          <div className="ov-hero__ctas">
            <button onClick={()=>go("#/markets")} className="ov-cta ov-cta--primary">Browse markets</button>
            <a href="https://monolythium.com/get-lyth" className="ov-cta">Get LYTH ↗</a>
            <button onClick={()=>go("#/clusters")} className="ov-cta">Stake with a cluster</button>
          </div>
        </div>

        {/* 4 headline numbers — what anyone cares about */}
        <div className="ov-hero__stats">
          <HeadlineStat
            label="LYTH"
            value={hasLiveMarketResponse ? (liveMarketCount > 0 ? "live" : "not listed") : liveMode ? "—" : `$${mono.price.toFixed(3)}`}
            sub={hasLiveMarketResponse ? `${liveMarketCount} market${liveMarketCount === 1 ? "" : "s"}` : liveMode ? "checking market state" : `mcap ${fmtUsd(mcap)}`}
            delta={hasLiveMarketResponse || liveMode ? liveMarketCaption : `${mono.chg24h>=0?"+":""}${mono.chg24h.toFixed(2)}% · 24h`}
            deltaTitle={hasLiveMarketResponse ? `market source · ${liveMarketSourceLabel}` : undefined}
            tone={hasLiveMarketResponse ? (liveMarketCount > 0 ? "ok" : "neutral") : liveMode ? "neutral" : mono.chg24h>=0?"ok":"err"}
            spark={hasLiveMarketResponse || liveMode ? [] : mono.sparkline||[]}
            onClick={()=>go("#/market/LYTH")}
            accent
          />
          {liveMode ? (
            <HeadlineStat
              label="LYTH burned"
              value={liveSupply ? fmtLythSupplyCompact(liveBurnedSupply) : "—"}
              sub={liveSupply ? "LYTH removed from circulating supply" : "checking burn"}
              delta={liveSupply ? "" : "unavailable"}
              tone={liveSupply ? "gold" : "neutral"}
              onClick={()=>go("#/burn")}
            />
          ) : (
            <HeadlineStat
              label="Value staked"
              value={`${tvs.toFixed(0)}M LYTH`}
              sub={`≈ ${fmtUsd(tvs*1_000_000 * mono.price)} · secures the chain`}
              delta={`+${avgApy.toFixed(1)}% APY · average`}
              tone="gold"
              onClick={()=>go("#/clusters")}
            />
          )}
          <HeadlineStat
            label="24h volume"
            value={displayedVol24h === null ? "—" : fmtUsd(displayedVol24h)}
            sub={hasLiveMarketResponse ? `${liveMarketCount} market${liveMarketCount === 1 ? "" : "s"} · volume pending` : liveMode ? "checking market state" : `across ${markets.length} markets`}
            delta={hasLiveMarketResponse ? "" : liveMode ? "endpoint pending" : "+12.4% vs 7d avg"}
            deltaTitle={hasLiveMarketResponse ? `market source · ${liveMarketSourceLabel}` : undefined}
            tone={hasLiveMarketResponse && liveMarketCount === 0 ? "neutral" : "ok"}
            onClick={()=>go("#/markets")}
          />
          {liveMode ? (
            <HeadlineStat
              label="LYTH supply"
              value={liveSupply ? fmtLythSupplyReadable(liveCurrentSupply) : "—"}
              sub={liveSupply
                  ? `genesis ${fmtLythSupplyCompact(liveInitialSupply)} · burned ${fmtLythSupplyCompact(liveBurnedSupply)}`
                : nativeSupply.isLoading
                  ? "checking supply"
                  : "supply pending"}
              delta={liveSupply ? "" : "unavailable"}
              tone={liveSupply ? "gold" : "neutral"}
              onClick={()=>go("#/burn")}
            />
          ) : (
            <SupplySplitStat
              publicM={pubSupply}
              privateM={privSupply}
              totalM={totalSupply}
              pubPct={pubPct}
              privTxs30d={SCAN.supply.privateTxs30d}
            />
          )}
          <HeroTelemetryStrip
            mempoolDepth={liveMempoolDepth ?? (liveMode ? null : c.mempool)}
            attestationPct={attestationRate ? attestationRate.value / 100 : (liveMode ? null : 97.8)}
            latencyMs={proposerLatency ? proposerLatency.value : (liveMode ? null : c.commitLatencyP95Ms)}
          />
        </div>
      </section>

      {/* ---------- WHAT'S MOVING ---------- */}
      {indexerAvailability.liveChain ? (
        <Card
          title="Markets"
          sub={`${indexerAvailability.disabled
            ? `${indexerAvailability.reason ?? "Indexer is unavailable on the connected node"}.`
            : hasLiveMarketResponse
              ? `${liveMarketSourceLabel} reports ${liveMarketCount} market${liveMarketCount === 1 ? "" : "s"}.`
              : "Awaiting live market-state response."} Gainers, losers, and most-traded cards return when the live aggregate index exposes those rolling windows.`}
        />
      ) : (
        <section className="ov-moving">
          <MoveCard title="Top gainers · 24h" rows={gainers} kind="gain" go={go}/>
          <MoveCard title="Top losers · 24h"  rows={losers}  kind="loss" go={go}/>
          <MoveCard title="Most traded · 24h" rows={byVol}   kind="vol"  go={go}/>
        </section>
      )}

      {/* ---------- OPERATOR SURFACES + DENOMINATIONS ---------- */}
      <section className="ms-grid-2 cl-detail-grid">
        <Card
          title="Live operator surfaces"
          sub="Operator-facing live surfaces exposed by the node and indexer."
          right={<a className="ms-link" href="#/operators" onClick={()=>go("#/operators")}>Open →</a>}
        >
          {operatorSurfaces.map((row) => (
            <div key={row.method} className="ms-prop">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:14}}>
                <span style={{fontSize:13}}>{row.label}</span>
                <span className="mono" title={row.method} style={{fontSize:11,color:"var(--gold)"}}>{row.sourceLabel}</span>
              </div>
              <div className="mono" style={{display:"flex",alignItems:"center",gap:8,fontSize:10.5,color:"var(--fg-400)",marginTop:5}}>
                <span className={`pill ${row.status === "available" || row.status === "wired" ? "ok" : "warn"}`} style={{fontSize:9.5,padding:"2px 7px"}}>
                  {row.status}
                </span>
                <span>{row.tracking}</span>
              </div>
            </div>
          ))}
        </Card>

        {/* TODO(core-sdk): lyth_circulatingSupply has no {publicAmount, privateAmount,
            publicPct} breakdown. On a live chain Monoscan shows the total native
            supply from lyth_circulatingSupply and keeps the static two-denomination
            framing below; the per-denomination public/private numbers stay honest
            "—" until the split endpoint exists. */}
        <Card
          title="Two denominations"
          sub="Transparent LYTH and shielded LYTH-p share one supply model with different privacy guarantees."
          right={<span className="cap">irreversible · by design</span>}
        >
          <p className="mono" style={{fontSize:12,color:"var(--fg-400)",lineHeight:1.55,margin:"0 0 14px"}}>
            Public LYTH is fully transparent. Private LYTH‑p hides amounts at the protocol layer —
            no mixers, no opt-in. You choose per transaction.
            {liveMode ? " The live node reports total supply but not yet the public/private split." : ""}
          </p>
          <div className="ms-denoms">
            <div className="ms-denom ms-denom--total">
              <div className="cap" style={{color:"var(--gold)"}}>Total LYTH supply</div>
              <div className="mono" style={{fontSize:24,color:"var(--fg-100)",marginTop:6}}>
                {liveMode ? (liveSupply ? fmtLythSupplyReadable(liveCurrentSupply) : "—") : `${totalSupply.toFixed(0)}M`}
              </div>
              <div className="mono" style={{fontSize:10.5,color:"var(--fg-400)",marginTop:3}}>
                {liveMode
                  ? liveSupply
                    ? `genesis ${fmtLythSupplyCompact(liveInitialSupply)} · burned ${fmtLythSupplyCompact(liveBurnedSupply)}`
                    : "supply pending"
                  : `${SCAN.supply.publicPct}% public · ${privPct.toFixed(0)}% shielded`}
              </div>
              <div className="ms-bar"><div style={{width:"100%", background:"var(--gold)"}}/></div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>
                {liveMode ? (liveSupply ? "current total" : "unavailable") : "offline fixture total"}
              </div>
            </div>
            <div className="ms-denom">
              <div className="cap" style={{color:"var(--gold)"}}>Public · LYTH</div>
              <div className="mono" style={{fontSize:22,color:"var(--fg-100)",marginTop:6}}>
                {liveMode ? "—" : `${SCAN.supply.public}M`}
              </div>
              <div className="mono" style={{fontSize:10.5,color:"var(--fg-400)",marginTop:3}}>
                {liveMode ? "live split endpoint pending" : "circulating · introspectable"}
              </div>
              <div className="ms-bar"><div style={{width:`${liveMode ? 0 : SCAN.supply.publicPct}%`, background:"var(--gold)"}}/></div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>
                {liveMode ? "awaiting public/private supply split" : `${SCAN.supply.publicPct}% of total`}
              </div>
            </div>
            <div className="ms-denom ms-denom--private">
              <div className="cap">Private · LYTH-p</div>
              <div className="mono" style={{fontSize:22,color:"var(--fg-200)",marginTop:6}}>
                — <span style={{fontSize:11,color:"var(--fg-500)"}}>opaque</span>
              </div>
              <div className="mono" style={{fontSize:10.5,color:"var(--fg-400)",marginTop:3}}>
                {liveMode ? "private-tx aggregate requires indexer" : `${fmt(SCAN.supply.privateTxs30d)} private txs · 30d`}
              </div>
              <div className="ms-bar"><div style={{width:"100%",background:"repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 4px, transparent 4px 8px)"}}/></div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>amounts protocol-hidden</div>
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
};

/* ---- Landing helpers ---- */
const HeroTelemetryStrip = ({ mempoolDepth, attestationPct, latencyMs }: any) => {
  const depth = typeof mempoolDepth === "number" && Number.isFinite(mempoolDepth) ? mempoolDepth : null;
  const pressure = depth === null ? 18 : Math.max(8, Math.min(100, depth / 12));
  const attest = typeof attestationPct === "number" && Number.isFinite(attestationPct)
    ? Math.max(0, Math.min(100, attestationPct))
    : null;
  const latency = typeof latencyMs === "number" && Number.isFinite(latencyMs) ? latencyMs : null;
  return (
    <div className="ov-hero-telemetry">
        <div>
          <span className="mono">Mempool pressure</span>
          <b className="mono num">{depth === null ? "—" : fmt(depth)}</b>
          <i><em style={{ width: `${pressure}%` }}/></i>
        </div>
        <div>
          <span className="mono">Attestation rate</span>
          <b className="mono num">{attest === null ? "—" : `${attest.toFixed(2)}%`}</b>
          <i><em style={{ width: `${attest ?? 0}%` }}/></i>
        </div>
        <div>
          <span className="mono">Commit latency</span>
          <b className="mono num">{latency === null ? "—" : `${latency.toFixed(0)}ms`}</b>
          <i><em style={{ width: `${latency === null ? 0 : Math.max(6, Math.min(100, latency / 6))}%` }}/></i>
        </div>
    </div>
  );
};

const HeadlineStat = ({ label, value, sub, delta, deltaTitle, tone, spark, accent, onClick }: any) => {
  const toneColor = tone==="ok" ? "var(--ok)" : tone==="err" ? "var(--err)" : tone==="gold" ? "var(--gold)" : "var(--fg-400)";
  return (
    <div className={`ov-hstat ${accent?"ov-hstat--accent":""} ${onClick?"ov-hstat--click":""}`} onClick={onClick}>
      <div className="ov-hstat__label">{label}</div>
      <div className="ov-hstat__value mono num">{value}</div>
      {sub && <div className="ov-hstat__sub mono">{sub}</div>}
      {delta && <div className="ov-hstat__delta mono" style={{color:toneColor}} title={deltaTitle}>{delta}</div>}
      {spark && spark.length>0 && (
        <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="ov-hstat__spark">
          <path d={spark.slice(-30).map((v,i,arr)=>{
            const min=Math.min(...arr), max=Math.max(...arr);
            const x = (i/(arr.length-1))*100;
            const y = max===min?14:28-((v-min)/(max-min))*28;
            return `${i===0?"M":"L"}${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(" ")} fill="none" stroke={toneColor} strokeWidth="1.3"/>
        </svg>
      )}
    </div>
  );
};

/* Supply split — takes the 4th headline slot. Shows public vs shielded as
   a split bar so the irreversible private denomination is a headline fact,
   not a footnote. */
const SupplySplitStat = ({ publicM, privateM, totalM, pubPct, privTxs30d }: any) => {
  const privPct = 100 - pubPct;
  return (
    <div className="ov-hstat ov-hstat--supply">
      <div className="ov-hstat__label">LYTH supply</div>
      <div className="ov-hstat__value mono num" style={{fontSize:26}}>
        {totalM.toFixed(0)}M
        <span style={{fontSize:11,color:"var(--fg-500)",marginLeft:6,letterSpacing:"0.04em"}}>total</span>
      </div>

      <div className="ov-supply-bar" aria-label={`${pubPct}% public, ${privPct.toFixed(0)}% shielded`}>
        <div className="ov-supply-bar__pub" style={{width:`${pubPct}%`}}/>
        <div className="ov-supply-bar__priv" style={{width:`${privPct}%`}}/>
      </div>

      <div className="ov-supply-legend mono">
        <div>
          <span className="ov-supply-dot ov-supply-dot--pub"/>
          <b>{publicM.toFixed(0)}M</b> public
          <span style={{color:"var(--fg-500)"}}>  ·  {pubPct}%</span>
        </div>
        <div>
          <span className="ov-supply-dot ov-supply-dot--priv"/>
          <b>{privateM.toFixed(0)}M</b> shielded
          <span style={{color:"var(--fg-500)"}}>  ·  {privPct.toFixed(0)}%</span>
        </div>
      </div>

      <div className="ov-hstat__delta mono" style={{color:"var(--fg-400)",marginTop:2}}>
        {fmt(privTxs30d)} private txs · 30d
      </div>
    </div>
  );
};

const MiniSeries = ({ data, color, height=24 }: any) => {
  const min = Math.min(...data), max = Math.max(...data);
  const W = 100;
  const pts = data.map((v,i)=>{
    const x = (i/(data.length-1))*W;
    const y = max===min ? height/2 : height-((v-min)/(max-min))*(height-2)-1;
    return `${i===0?"M":"L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{display:"block",width:"100%",height,marginTop:6}}>
      <path d={`${pts} L${W},${height} L0,${height} Z`} fill={color} fillOpacity="0.10"/>
      <path d={pts} fill="none" stroke={color} strokeWidth="1.2"/>
    </svg>
  );
};

// Live confidence-strip filler. In live mode the demo sparklines are gone, so
// tiles would otherwise have uneven heights. Render a thin MiniSeries from the
// already-fetched lyth_metricsRange samples when the node retains >=2 points,
// else a fixed-height muted placeholder bar so every tile lines up.
const LiveStripTrail = ({ samples, color, height = 28 }: any) => {
  if (Array.isArray(samples) && samples.length >= 2) {
    return <MiniSeries data={samples} color={color} height={height}/>;
  }
  return (
    <div
      aria-hidden="true"
      style={{ height, marginTop: 6, borderRadius: 2, background: "var(--fg-700)", opacity: 0.4 }}
    />
  );
};

const MoveCard = ({ title, rows, kind, go }: any) => (
  <div className="ms-card ov-movecard">
    <div className="ms-card__head">
      <div className="ms-card__title"><h3>{title}</h3></div>
      <div className="ms-card__actions">
        <a className="ms-link" href="#/markets" onClick={()=>go("#/markets")}>All markets →</a>
      </div>
    </div>
    <div className="ms-card__body" style={{padding:0}}>
      {rows.map((t,i)=>{
        const val = kind==="vol" ? fmtUsd(t.vol24h) : `${t.chg24h>=0?"+":""}${t.chg24h.toFixed(2)}%`;
        const color = kind==="loss" ? "var(--err)" : kind==="gain" ? "var(--ok)" : "var(--gold)";
        return (
          <div key={t.sym} className="ov-moverow" onClick={()=>go(`#/market/${t.sym}`)}>
            <span className="mono" style={{fontSize:10.5,color:"var(--fg-500)",width:18}}>{i+1}</span>
            <span style={{
              width:22,height:22,borderRadius:"50%",background:`oklch(0.62 0.17 ${t.sym.charCodeAt(0)*7%360})`,
              color:"#fff",fontSize:9,fontFamily:"var(--f-mono)",fontWeight:600,display:"grid",placeItems:"center",
            }}>{t.sym.slice(0,2)}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12.5,color:"var(--fg-100)",fontWeight:500}}>{t.sym}</div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>${t.price<1?t.price.toFixed(4):t.price.toFixed(2)}</div>
            </div>
            <span className="mono num" style={{fontSize:12,color,fontWeight:500}}>{val}</span>
          </div>
        );
      })}
    </div>
  </div>
);

const Vital = ({label, value, delta, tone, big}: any) => (
  <div className={`ms-vital ${big?"ms-vital--big":""}`}>
    <div className="cap">{label}</div>
    <div className="mono ms-vital__num">{value}</div>
    <div className="mono" style={{fontSize:10, color: tone==="ok"?"var(--ok)":tone==="warn"?"var(--warn)":"var(--fg-400)"}}>
      {delta}
    </div>
  </div>
);

const SignersHist = ({data}: any) => (
  <div style={{display:"flex",gap:2,alignItems:"flex-end",height:42,marginTop:8}}>
    {data.map((v,i)=>{
      const c = v>=7 ? "var(--ok)" : v>=5 ? "var(--warn)" : "var(--err)";
      const h = v>=7 ? 28 : v>=5 ? 20 : 38;
      return <span key={i} style={{flex:1,minWidth:2,height:h,background:c,borderRadius:1,boxShadow:`0 0 4px ${c}55`}}/>;
    })}
  </div>
);

/* ============== CLUSTER DETAIL (rebuilt — ring hero + plain-language health) ============== */
const ClusterPage = ({ slot, go }: any) => {
  const cl = SCAN.clusters.find(c => String(c.slot)===String(slot)) || SCAN.clusters[0];
  const liveClusterId = Math.max(0, Number(cl.slot) - 1);
  const liveClusters = useClusterSet();
  const liveCluster = liveClusters.data?.find(c => c.id === liveClusterId) ?? null;
  const clusterStatus = useClusterStatus(liveClusterId);
  const liveStatus = clusterStatus.data;
  const clusterApr = useClusterApr(liveClusterId);
  // lyth_clusterApr (core-sdk 0.3.14) exposes a real annualized reward rate
  // (aprBps → percent); null when the node hasn't indexed the reward window.
  const liveApyPct = clusterApr.data ? Number(clusterApr.data.aprBps) / 100 : null;
  const delegators = useClusterDelegators(liveClusterId);
  const delegationCap = useDelegationCap();
  const clusterEntity = useClusterEntity(liveClusterId);
  const entityRatchet = useEntityRatchet();
  const indexerAvailability = useIndexerAvailability();
  const showLiveHero = indexerAvailability.liveChain || liveCluster !== null || liveStatus !== null && liveStatus !== undefined;
  const apy = clusterApy(cl);
  const liveRingMembers = liveStatus?.members?.length
    ? liveStatus.members.map((m, i) => ({
        id: m.operatorId,
        handle: fmtHashShort(m.operatorId, 10, 6),
        addrShort: m.operatorId,
        role: m.state,
        rep: null,
        vertexRate: null,
        state: m.state === "active" ? "live" : m.state === "lagging" ? "lag" : m.state === "standby" ? "standby" : "down",
      }))
    : null;
  const ringMembers = showLiveHero ? (liveRingMembers ?? []) : cl.opMembers.map((m,i)=>({ ...m, id: m.handle+i }));
  const liveOperators = liveStatus?.live ?? null;
  const totalOperators = liveStatus?.size ?? liveCluster?.size ?? (showLiveHero ? null : cl.size);
  const threshold = liveStatus?.threshold ?? liveCluster?.threshold ?? (showLiveHero ? null : 5);
  const quorum = liveStatus?.quorum ?? null;
  const healthy = showLiveHero
    ? (quorum ? quorum === "ok" : liveCluster?.aggregateHealth === "ok")
    : cl.state==="nominal";
  const summary = showLiveHero
    ? quorum === "ok" && liveOperators !== null && totalOperators !== null && threshold !== null
      ? `Operating nominally. ${liveOperators} of ${totalOperators} operators are live, above the ${threshold}-of-${totalOperators} quorum threshold.`
      : quorum === "degraded" && liveOperators !== null && totalOperators !== null
        ? `Some operators are degraded or offline. ${liveOperators} of ${totalOperators} are live.`
        : quorum === "halted" && liveOperators !== null && totalOperators !== null
          ? `Below quorum. ${liveOperators} of ${totalOperators} operators are live.`
          : `Live cluster descriptor is available${liveCluster?.aggregateHealth ? ` with ${liveCluster.aggregateHealth} aggregate health` : ""}. Detailed status is not reported by this node yet.`
    : cl.state==="nominal"
      ? `Operating nominally. All ${cl.members} of ${cl.size} operators are signing vertices on time, well above the 5-of-7 quorum threshold.`
      : cl.state==="maintenance"
        ? `One operator is degraded or offline. ${cl.members} of ${cl.size} are signing — still safely above quorum.`
        : `Below quorum. ${cl.members} of ${cl.size} operators signing — delegated stake is safe but not earning until quorum is restored.`;
  const memberRows = liveStatus?.members?.length
    ? liveStatus.members.map((m) => ({
        handle: fmtHashShort(m.operatorId, 10, 6),
        addrShort: m.operatorId,
        blsPubkey: m.blsPubkey,
        role: m.state,
        rep: null,
        vertexRate: null,
        state: m.state === "active" ? "live" : m.state === "lagging" ? "lag" : m.state,
      }))
    : showLiveHero ? [] : cl.opMembers;
  const liveClusterKey = liveStatus?.members?.[0]?.blsPubkey ?? liveCluster?.pubkey ?? null;
  const [selectedMember, setSelectedMember] = useState<any | null>(null);
  useEffect(() => {
    if (!selectedMember) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedMember(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedMember]);

  return (
    <div className="ms-page">
      <div className="ms-crumb">
        <a href="#/clusters" onClick={()=>go("#/clusters")}>Clusters</a>
        <span>›</span>
        <b>{showLiveHero ? `C-${String(liveClusterId + 1).padStart(3, "0")}` : cl.name}</b>
      </div>

      {/* Ring hero — left: ring + standby tray, right: plain-language health + 4 key stats + stake CTA */}
      <section className="cl-hero cl-hero--dynamic">
        <div className="cl-hero__ring">
          <ClusterRing members={ringMembers} threshold={threshold ?? 0} totalOperators={totalOperators ?? ringMembers.length} size={300}/>
          <div className="cl-bench">
            {showLiveHero ? (
              <>
                <div className="cap" style={{marginBottom:8,textAlign:"center"}}>Live roster</div>
                <div className="mono" style={{fontSize:11,color:"var(--fg-400)",textAlign:"center",lineHeight:1.5}}>
                  {memberRows.length > 0
                    ? `${memberRows.length} operator${memberRows.length === 1 ? "" : "s"} reported by cluster status`
                    : "member roster not reported by this node"}
                </div>
              </>
            ) : (
              <>
                <div className="cap" style={{marginBottom:8,textAlign:"center"}}>Standby bench · {cl.backupCount}/3</div>
                <div className="cl-bench__row">
                  {cl.backups.map((b,i)=>(
                    <div key={i} className="cl-bench__op" title={`${b.handle} · queue #${b.queuePos} · promotes if an active op is jailed`}>
                      <div className="cl-bench__dot"/>
                      <div className="mono" style={{fontSize:10,color:"var(--fg-300)"}}>{b.handle.slice(0,6)}</div>
                    </div>
                  ))}
                  {Array.from({length: 3 - cl.backupCount}).map((_,i)=>(
                    <div key={`e${i}`} className="cl-bench__op cl-bench__op--empty" title="Vacant standby seat">
                      <div className="cl-bench__dot cl-bench__dot--empty"/>
                      <div className="mono" style={{fontSize:10,color:"var(--fg-600)"}}>vacant</div>
                    </div>
                  ))}
                </div>
                <div className="mono" style={{fontSize:9.5,color:"var(--fg-500)",textAlign:"center",marginTop:8,letterSpacing:"0.06em",lineHeight:1.5}}>
                  promotes to active<br/>if a cluster is jailed
                </div>
              </>
            )}
          </div>
        </div>
        <div className="cl-hero__body">
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
            <span className="cl-rank-badge">
              {showLiveHero
                ? `#${liveClusterId + 1}${liveClusters.data?.length ? ` of ${liveClusters.data.length}` : ""}`
                : `#${cl.rank} of 100`}
            </span>
            <span className="cap">DVT cluster · {totalOperators ?? "?"} operators · {threshold ?? "?"}-of-{totalOperators ?? "?"} BFT</span>
          </div>
          <h1 className="ms-h1" style={{marginTop:4,marginBottom:4}}>
            {showLiveHero ? `C-${String(liveClusterId + 1).padStart(3, "0")}` : cl.name}
          </h1>
          <div className="mono" style={{fontSize:11,color:"var(--fg-500)",letterSpacing:"0.03em",marginBottom:8}}>
            C-{String(cl.slot).padStart(3,"0")} · {showLiveHero ? "live protocol descriptor" : "operator-named cluster"}
          </div>
          <div className="cl-hero__summary">
            <span className="cl-health-dot" style={{background: healthy ? "var(--ok)" : cl.state==="maintenance" ? "var(--warn)" : "var(--err)"}}/>
            <p>{summary}</p>
          </div>

          {/* Recruitment notice */}
          {showLiveHero ? (
            <div className="cl-notice cl-notice--closed">
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div className="cl-notice__icon" style={{color:"var(--fg-500)"}}>◉</div>
                <div className="mono" style={{fontSize:12,color:"var(--fg-300)",letterSpacing:"0.04em"}}>
                  <b style={{color:"var(--fg-200)"}}>OPERATOR INTAKE</b>
                  <span style={{color:"var(--fg-500)",margin:"0 8px"}}>·</span>
                  not reported yet
                </div>
              </div>
            </div>
          ) : cl.recruiting ? (
            <div className="cl-notice cl-notice--open">
              <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                <div className="cl-notice__icon">●</div>
                <div style={{flex:1}}>
                  <div className="mono" style={{fontSize:12,color:"var(--gold)",letterSpacing:"0.06em",fontWeight:600}}>
                    CLUSTER OPEN · {cl.recruitSeats} seat{cl.recruitSeats>1?"s":""} available
                  </div>
                  <p className="mono" style={{fontSize:11.5,color:"var(--fg-300)",margin:"4px 0 0",lineHeight:1.5}}>
                    Looking for operators — {cl.recruitReason}. Use MonarchOS to review requirements and submit your application.
                  </p>
                </div>
                <button className="ov-cta ov-cta--primary" style={{padding:"8px 14px",fontSize:11}} onClick={()=>window.__msToast?.("Opens in MonarchOS — not part of this preview")}>
                  Apply via MonarchOS →
                </button>
              </div>
            </div>
          ) : (
            <div className="cl-notice cl-notice--closed">
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div className="cl-notice__icon" style={{color:"var(--fg-500)"}}>◉</div>
                <div className="mono" style={{fontSize:12,color:"var(--fg-300)",letterSpacing:"0.04em"}}>
                  <b style={{color:"var(--fg-200)"}}>CLUSTER CLOSED</b>
                  <span style={{color:"var(--fg-500)",margin:"0 8px"}}>·</span>
                  full bench · not accepting operator applications
                </div>
              </div>
            </div>
          )}

          <div className="cl-hero__stats">
            <div className="cl-bigstat cl-bigstat--gold">
              <div className="cap">Current APY</div>
              <div className="cl-bigstat__num mono num">{showLiveHero ? (liveApyPct !== null ? fmtClusterApy(liveApyPct) : "not indexed") : fmtClusterApy(apy)}</div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>
                {showLiveHero
                  ? (liveApyPct !== null ? "annualized reward · per delegated stake" : "reward aggregate unavailable")
                  : "paid in LYTH · per delegated stake"}
              </div>
            </div>
            <div className="cl-bigstat">
              <div className="cap">TVS</div>
              <div className="cl-bigstat__num mono num">{showLiveHero ? "not indexed" : `${cl.tvs}M`}</div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>
                {showLiveHero
                  ? (indexerAvailability.disabled ? indexerAvailability.reason ?? "indexer disabled" : "live TVS endpoint unavailable")
                  : "LYTH delegated"}
              </div>
            </div>
            <div className="cl-bigstat">
              <div className="cap">Reward · 30d</div>
              <div className="cl-bigstat__num mono num" style={{color:"var(--gold)"}}>
                {showLiveHero ? "not indexed" : `+${fmt(cl.reward30d)}`}
              </div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>
                {showLiveHero ? "reward history unavailable" : "LYTH distributed"}
              </div>
            </div>
            <div className="cl-bigstat">
              <div className="cap">Vertex inclusion</div>
              <div className="cl-bigstat__num mono num" style={{color: showLiveHero ? "var(--fg-300)" : (cl.vertexInclude>0.98 ? "var(--ok)" : "var(--warn)")}}>
                {showLiveHero ? "not indexed" : pct(cl.vertexInclude,1)}
              </div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>
                {showLiveHero ? "per-cluster vertex history unavailable" : "clusters tracked"}
              </div>
            </div>
          </div>

          <div className="cl-hero__ctas">
            <button className="ov-cta ov-cta--primary" onClick={()=>openWalletStakeIntent(showLiveHero ? { slot: liveClusterId + 1 } : cl)}>
              {showLiveHero ? `Stake with C-${String(liveClusterId + 1).padStart(3, "0")}` : `Stake with ${cl.name}`}
            </button>
            <button
              className="ov-cta"
              disabled={showLiveHero && !liveClusterKey}
              onClick={()=>{
                const keyToCopy = showLiveHero ? liveClusterKey : cl.aggKey;
                if (keyToCopy) {
                  navigator.clipboard?.writeText(keyToCopy);
                  window.__msToast?.("Cluster key copied");
                }
              }}
            >
              Copy cluster key
            </button>
            <span className="mono" style={{fontSize:10,color:"var(--fg-500)",marginLeft:"auto"}}>
              {showLiveHero ? (liveClusterKey ? fmtHashShort(liveClusterKey) : "key not reported") : fmtHashShort(cl.aggKey)}
            </span>
          </div>
        </div>
      </section>

      <section className="ms-grid-2 cl-detail-grid">
        <Card title="Live protocol descriptor">
          <div className="cl-protocol-summary">
            <div className="cl-protocol-summary__status">
              <span className={`cl-protocol-summary__dot ${liveStatus?.live ? "is-ok" : "is-muted"}`}/>
              <div>
                <span className="mono">cluster</span>
                <b>{cName(liveClusterId)}</b>
              </div>
            </div>
            <div className="cl-protocol-summary__metric">
              <span className="mono">quorum</span>
              <b className="mono">{liveStatus?.quorum ?? liveCluster?.aggregateHealth ?? "not reported"}</b>
            </div>
            <div className="cl-protocol-summary__metric">
              <span className="mono">operators</span>
              <b className="mono">{liveStatus ? `${liveStatus.live}/${liveStatus.size}` : "—"}</b>
            </div>
            <div className="cl-protocol-summary__metric">
              <span className="mono">stake</span>
              <b className="mono">{fmtClusterStake(liveCluster)}</b>
            </div>
          </div>
          <div className="cl-protocol-facts">
            <div><span className="mono">Internal id</span><b className="mono">{liveClusterId}</b></div>
            <div><span className="mono">Active</span><b>{liveStatus ? (liveStatus.live > 0 ? "yes" : "no") : liveCluster ? (liveCluster.active ? "yes" : "no") : "not reported"}</b></div>
            <div><span className="mono">Last update</span><b className="mono">{liveStatus ? `block #${Number(liveStatus.lastUpdateHeight).toLocaleString()}` : "—"}</b></div>
            <div><span className="mono">Delegators</span><b className="mono">{delegators.data ? `${delegators.data.count}` : "—"}</b></div>
            <div><span className="mono">Delegation cap</span><b>{delegationCap.data ? (delegationCap.data.capBps === 4294967295 ? "disabled" : `${delegationCap.data.capBps} bps`) : "—"}</b></div>
            <div><span className="mono">Entity</span><b className="mono">{clusterEntity.data?.entity ?? "—"}</b></div>
            <div><span className="mono">Entity ratchet</span><b className="mono">{entityRatchet.data ? `${entityRatchet.data.active}/${entityRatchet.data.threshold === 4294967295 ? "unset" : entityRatchet.data.threshold}` : "—"}</b></div>
            <div><span className="mono">First BLS key</span><b className="mono" title={liveStatus?.members?.[0]?.blsPubkey ?? liveCluster?.pubkey ?? undefined}>{fmtHashShort(liveStatus?.members?.[0]?.blsPubkey ?? liveCluster?.pubkey ?? "—")}</b></div>
          </div>
          <div className="mono cl-protocol-note">
            Cluster status, quorum, and member BLS keys come from public RPC. Economic aggregates are hidden until live TVS, reward history, and vertex-inclusion endpoints exist.
          </div>
        </Card>
        <Card title={`Members · ${memberRows.length} operator${memberRows.length === 1 ? "" : "s"}`}>
          <div className="cl-member-grid">
            {memberRows.length === 0 ? (
              <div className="cl-member-empty mono">
                No live member roster is reported for this cluster yet.
              </div>
            ) : memberRows.map((m, i) => {
              const role = operatorRoleMeta(m.role);
              const stateTone = m.state === "live" ? "ok" : m.state === "lag" ? "warn" : m.state === "standby" ? "info" : "err";
              const source = showLiveHero ? "live cluster status" : "fixture preview";
              return (
                <button
                  key={m.addrShort ?? `${m.handle}-${i}`}
                  type="button"
                  className={`cl-member-card is-${stateTone}`}
                  onClick={()=>setSelectedMember({ ...m, source })}
                >
                  <span className="cl-member-card__glow" aria-hidden="true"/>
                  <span
                    className="ms-avatar cl-member-card__avatar"
                    style={{background:`oklch(0.62 0.16 ${String(m.handle).charCodeAt(0)*7%360})`}}
                    aria-hidden="true"
                  />
                  <span className="cl-member-card__body">
                    <span className="cl-member-card__name mono">{m.handle}</span>
                    <span className="cl-member-card__id mono">{fmtHashShort(m.addrShort, 8, 4)}</span>
                    <span className="cl-member-card__meta">
                      <span className={`pill ${role.tone === "neutral" ? "" : role.tone}`}>{role.label}</span>
                    </span>
                    <span className="cl-member-card__foot mono">
                      {showLiveHero
                        ? (m.blsPubkey ? `BLS ${fmtHashShort(m.blsPubkey, 8, 0)}` : "BLS not reported")
                        : `${m.rep == null ? "rep -" : `rep ${m.rep.toFixed(2)}`}`}
                    </span>
                  </span>
                  <span className="cl-member-card__status" aria-hidden="true"/>
                </button>
              );
            })}
          </div>
        </Card>

        {showLiveHero ? (
          <Card title="Reward stream · last 30 days">
            <div className="mono" style={{color:"var(--fg-400)",fontSize:12,lineHeight:1.55,padding:"6px 2px"}}>
              Live reward-history aggregates are not exposed by this node yet.
            </div>
          </Card>
        ) : (
          <Card title="Reward stream · last 30 days">
            <Sparkline data={cl.rewardHist} width={520} height={140} color="var(--gold)"/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginTop:14}}>
              <Stat label="Consensus" value={`${fmt(cl.streams.consensus)} LYTH`}/>
              <Stat label="Service" value={`${fmt(cl.streams.service)} LYTH`}/>
              <Stat label="Builder" value={`${fmt(cl.streams.builder)} LYTH`}/>
            </div>
            <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:10,letterSpacing:"0.04em"}}>
              split · 1/7 even per protocol-default fee policy
            </div>
          </Card>
        )}
      </section>

      <section className="ms-grid-2 cl-detail-grid cl-history-grid">
        {showLiveHero ? (
          <>
            <Card title="Recent vertices">
              <div className="mono" style={{color:"var(--fg-400)",fontSize:12,lineHeight:1.55,padding:"6px 2px"}}>
                Per-cluster vertex history is not exposed by the live index yet.
              </div>
            </Card>
            <Card title="State history · last 14 days">
              <div className="mono" style={{color:"var(--fg-400)",fontSize:12,lineHeight:1.55,padding:"6px 2px"}}>
                Historical cluster state and slash records are not exposed by this node yet.
              </div>
            </Card>
          </>
        ) : (
          <>
            <Card title="Recent vertices">
              {cl.recentVertices.map((v,i)=>(
                <div key={i} className="ms-vrow">
                  <div className="mono" style={{color:"var(--gold)",fontSize:13,minWidth:90}}>r·{fmt(v.round)}</div>
                  <div className="mono" style={{flex:1,fontSize:11,color:"var(--fg-300)"}}>
                    {v.txCount} txs · DAC {v.dac?"✓":"✗"} · agg {v.blsAggMs.toFixed(1)}ms
                  </div>
                  <div className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>{fmtHashShort(v.hashShort)}</div>
                </div>
              ))}
            </Card>
            <Card title="State history · last 14 days">
              <div style={{display:"flex",gap:3,height:36,alignItems:"flex-end"}}>
                {cl.stateHist.map((s,i)=>{
                  const c = s==="nominal"?"var(--ok)":s==="maintenance"?"var(--warn)":"var(--err)";
                  const h = s==="nominal"?28:s==="maintenance"?20:36;
                  return <span key={i} title={s} style={{flex:1,height:h,background:c,borderRadius:1,boxShadow:`0 0 4px ${c}66`}}/>;
                })}
              </div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-400)",marginTop:8,display:"flex",justifyContent:"space-between"}}>
                <span>14d ago</span><span>now</span>
              </div>
              <div style={{marginTop:18}}>
                <div className="cap" style={{marginBottom:6}}>Slash history</div>
                {cl.slashHist.length === 0
                  ? <div className="mono" style={{fontSize:11,color:"var(--ok)"}}>· clean since genesis</div>
                  : cl.slashHist.map((s,i)=><div key={i} className="mono" style={{fontSize:11,color:"var(--err)"}}>{s}</div>)}
              </div>
            </Card>
          </>
        )}
      </section>
      {selectedMember && (() => {
        const role = operatorRoleMeta(selectedMember.role);
        const operatorId = selectedMember.addrShort ?? "not reported";
        const blsKey = selectedMember.blsPubkey ?? "not reported";
        const source = selectedMember.source ?? (showLiveHero ? "live cluster status" : "fixture preview");
        return (
          <div className="cl-member-modal" role="dialog" aria-modal="true" aria-label="Operator details" onClick={()=>setSelectedMember(null)}>
            <div className="cl-member-modal__panel" onClick={(event)=>event.stopPropagation()}>
              <div className="cl-member-modal__head">
                <div style={{display:"flex",alignItems:"center",gap:12,minWidth:0}}>
                  <span
                    className="ms-avatar cl-member-modal__avatar"
                    style={{background:`oklch(0.62 0.16 ${String(selectedMember.handle).charCodeAt(0)*7%360})`}}
                    aria-hidden="true"
                  />
                  <div style={{minWidth:0}}>
                    <div className="mono cl-member-modal__title">{selectedMember.handle}</div>
                    <div className="mono cl-member-modal__sub">{source}</div>
                  </div>
                </div>
                <button type="button" className="cl-member-modal__close" onClick={()=>setSelectedMember(null)} aria-label="Close operator details">x</button>
              </div>
              <div className="cl-member-modal__body">
                <div className="cl-member-modal__summary">
                  <span className={`pill ${role.tone === "neutral" ? "" : role.tone}`}>{role.label}</span>
                  <span className="mono">state {selectedMember.state ?? "unknown"}</span>
                  {selectedMember.rep != null && <span className="mono">rep {selectedMember.rep.toFixed(2)}</span>}
                  {selectedMember.vertexRate != null && <span className="mono">vertex {pct(selectedMember.vertexRate,1)}</span>}
                </div>
                <div className="cl-member-modal__kv">
                  <div>
                    <span className="mono">Operator id</span>
                    <code>{operatorId}</code>
                  </div>
                  <div>
                    <span className="mono">BLS public key</span>
                    <code>{blsKey}</code>
                  </div>
                  <div>
                    <span className="mono">Data source</span>
                    <code>{source}</code>
                  </div>
                </div>
                <div className="cl-member-modal__actions">
                  <button
                    type="button"
                    className="ov-cta"
                    disabled={!selectedMember.addrShort}
                    onClick={()=>{
                      if (selectedMember.addrShort) {
                        navigator.clipboard?.writeText(selectedMember.addrShort);
                        window.__msToast?.("Operator id copied");
                      }
                    }}
                  >
                    Copy operator id
                  </button>
                  <button
                    type="button"
                    className="ov-cta"
                    disabled={!selectedMember.blsPubkey}
                    onClick={()=>{
                      if (selectedMember.blsPubkey) {
                        navigator.clipboard?.writeText(selectedMember.blsPubkey);
                        window.__msToast?.("BLS key copied");
                      }
                    }}
                  >
                    Copy BLS key
                  </button>
                  <button
                    type="button"
                    className="ov-cta ov-cta--primary"
                    disabled={!selectedMember.addrShort}
                    onClick={()=>{
                      if (selectedMember.addrShort) {
                        setSelectedMember(null);
                        go(`#/operator/${encodeURIComponent(selectedMember.addrShort)}`);
                      }
                    }}
                  >
                    Open operator page
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

const Stat = ({label, value, custom, tone}: any) => {
  const color = tone==="ok"?"var(--ok)":tone==="warn"?"var(--warn)":tone==="gold"?"var(--gold)":"var(--fg-100)";
  return (
    <div className="ms-stat">
      <div className="cap">{label}</div>
      {custom ? <div style={{marginTop:4}}>{custom}</div>
              : <div className="mono" style={{fontSize:18, color, marginTop:2, letterSpacing:"-0.01em"}}>{value}</div>}
    </div>
  );
};

const KVRow = ({ label, value, mono }: any) => (
  <div className="tx-kv__row">
    <span className="mono tx-kv__k">{label}</span>
    <span className={`${mono ? "mono" : ""} tx-kv__v`} style={{wordBreak:"break-all"}}>{value}</span>
  </div>
);

// Human label + 3-tone pill for a raw operator protocol state. jailed/offline
// must read as an error (red), not amber. Falls back to the raw string.
const OPERATOR_ROLE_META: Record<string, { label: string; tone: string }> = {
  active: { label: "active", tone: "ok" },
  live: { label: "active", tone: "ok" },
  signing: { label: "active", tone: "ok" },
  lagging: { label: "lagging", tone: "warn" },
  degraded: { label: "lagging", tone: "warn" },
  standby: { label: "standby", tone: "neutral" },
  queued: { label: "standby", tone: "neutral" },
  offline: { label: "offline", tone: "err" },
  jailed: { label: "jailed", tone: "err" },
  tombstoned: { label: "tombstoned", tone: "err" },
};
export const operatorRoleMeta = (state: string | null | undefined) => {
  const meta = state ? OPERATOR_ROLE_META[String(state).toLowerCase()] : undefined;
  return meta ?? { label: state ?? "unknown", tone: "neutral" };
};

// Human labels for operator service-capability keys (offline fixture card).
const CAPABILITY_LABELS: Record<string, string> = {
  rpc: "RPC",
  stateSync: "State sync",
  snapshots: "Snapshots",
  archival: "Archival",
  prover: "Prover",
  bridge: "Bridge",
  oracle: "Oracle",
};
export const capabilityLabel = (key: string) =>
  CAPABILITY_LABELS[key] ??
  key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^\w/, (m) => m.toUpperCase());

/* ============== OPERATOR PROFILE ============== */
const operatorDetailTone = (tone: string | null | undefined): "ok" | "warn" | "info" | "err" =>
  tone === "ok" ? "ok" : tone === "warn" ? "warn" : tone === "err" ? "err" : "info";

const fmtRoundish = (value: bigint | number | string | null | undefined) => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "bigint") return value.toLocaleString();
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : String(value);
};

const copyOperatorValue = (label: string, value: string | null | undefined) => {
  if (!value || value === "—") return;
  void navigator.clipboard?.writeText(value);
  window.__msToast?.(`${label} copied`);
};

const OperatorProfileStat = ({ label, value, sub, tone = "info" }: any) => (
  <div className={`op-profile-stat is-${tone}`}>
    <span className="mono">{label}</span>
    <b className="mono num">{value}</b>
    {sub ? <small>{sub}</small> : null}
  </div>
);

const OperatorHeroKey = ({ label, value }: any) => {
  const display = value && String(value).trim().length > 0 ? String(value) : "—";
  const canCopy = display !== "—";
  return (
    <div className="op-hero-key">
      <span className="mono">{label}</span>
      <code>{display}</code>
      {canCopy && (
        <button type="button" onClick={() => copyOperatorValue(label, display)}>
          Copy
        </button>
      )}
    </div>
  );
};

const OperatorFact = ({ label, value, tone = "neutral" }: any) => (
  <div className={`op-fact is-${tone}`}>
    <span className="mono">{label}</span>
    <b className="mono">{value}</b>
  </div>
);

const OperatorPage = ({ addr, go }: any) => {
  const liveOperatorId = /^0x[0-9a-fA-F]{64}$/.test(addr) ? addr : undefined;
  const fixtureMatch = SCAN.operators.find(o => o.addrShort===addr);
  const op = fixtureMatch ?? SCAN.operators[0];
  // Drive the page from live data when the URL carries a real 32-byte
  // operator id. The fixture profile only renders when monoscan is in
  // offline / design-preview mode (no live operator handle).
  const useLiveProfile = liveOperatorId !== undefined;
  const indexerAvailability = useIndexerAvailability();
  const roster = useLiveOperatorRoster();
  const liveMembership = liveOperatorId
    ? roster.operators.find((row) => row.operatorId === liveOperatorId) ?? null
    : null;
  const operatorInfo = useOperatorInfo(liveOperatorId);
  const authority = useOperatorAuthority(liveOperatorId);
  const authorityIndex = authority.data?.authorityIndex;
  const signing = useOperatorSigningActivity(authorityIndex, 25);
  const duties = useOperatorDuties(authorityIndex, 100);
  const risk = useOperatorRisk(authorityIndex, 250);
  const signedCount = signing.data?.entries.filter((row) => row.status === "signed").length ?? null;
  const missedCount = signing.data?.entries.filter((row) => row.status === "missed").length ?? null;
  const jailStatus = risk.data?.jailStatus
    ? "reason" in risk.data.jailStatus
      ? risk.data.jailStatus.reason
      : risk.data.jailStatus.tombstoned
        ? "tombstoned"
        : risk.data.jailStatus.jailed
          ? `jailed until ${risk.data.jailStatus.jailedUntilHeight}`
          : "clear"
    : null;
  const keyRotation = duties.data?.duties.keyRotation;
  const keyRotationLabel = keyRotation && "nextRound" in keyRotation
    ? `round ${fmtRoundish(keyRotation.nextRound)}`
    : "—";
  if (indexerAvailability.liveChain && !useLiveProfile) {
    return (
      <div className="ms-page ms-operator-profile">
        <div className="ms-crumb op-profile-crumb">
          <a href="#/operators" onClick={()=>go("#/operators")}>Operators</a>
          <span>›</span>
          <b>unresolved</b>
        </div>
        <Card title="Operator not resolved">
          <div className="op-empty-state mono">
            Live operator pages require a 32-byte operator id from the live cluster roster. Local operator fixture profiles are hidden while connected to a live chain.
          </div>
        </Card>
      </div>
    );
  }
  const identitySeed = useLiveProfile ? (liveOperatorId ?? addr) : op.handle;
  const profileRole = operatorRoleMeta(
    useLiveProfile ? (liveMembership?.state ?? operatorInfo.data?.lifecycleState) : (op.slashes === 0 ? "active" : "lagging"),
  );
  const profileTone = operatorDetailTone(profileRole.tone);
  const liveClusterIds = Array.from(new Set([
    ...(liveMembership ? [liveMembership.clusterId] : []),
    ...(operatorInfo.data?.activeClusterIds ?? []),
  ]));
  const primaryClusterLabel = useLiveProfile
    ? liveClusterIds.length === 0
      ? "—"
      : liveClusterIds.length === 1
        ? cName(liveClusterIds[0])
        : `${liveClusterIds.length} clusters`
    : `${op.memberships.length} clusters`;
  const displayName = useLiveProfile
    ? (operatorInfo.data?.moniker ?? operatorInfo.data?.alias ?? (liveOperatorId ? fmtHashShort(liveOperatorId, 12, 6) : addr))
    : op.handle;
  const displayId = useLiveProfile ? (liveOperatorId ?? addr) : op.addrShort;
  const blsKey = authority.data?.blsPubkey || liveMembership?.blsPubkey || operatorInfo.data?.blsKeyFingerprint || "";
  const chainAddress = useLiveProfile
    ? operatorInfo.data?.chainAddress
      ? fmtAddr(operatorInfo.data.chainAddress, "user")
      : "—"
    : op.addrShort;
  const signingTotal = signing.data?.entries.length ?? null;
  const signingPercent = signingTotal && signedCount !== null ? Math.round((signedCount / signingTotal) * 100) : null;
  const signingSummary = signedCount === null ? "—" : `${signedCount}/${signingTotal ?? 0}`;
  const riskTone = risk.data
    ? risk.data.missRateBps >= risk.data.thresholdBps
      ? "err"
      : risk.data.missRateBps > 0
        ? "warn"
        : "ok"
    : "info";
  const riskDeg = risk.data && risk.data.thresholdBps > 0
    ? Math.max(0, Math.min(360, (risk.data.missRateBps / risk.data.thresholdBps) * 360))
    : 0;
  const riskColor = riskTone === "ok" ? "var(--ok)" : riskTone === "warn" ? "var(--warn)" : riskTone === "err" ? "var(--err)" : "var(--info)";
  const attestationDuty = duties.data?.duties.attestation;
  const liveCapabilityEntries = Object.entries(operatorInfo.data?.capability ?? {}).filter(([, value]) => value !== null && value !== undefined);
  const publishedCapabilityCount = useLiveProfile
    ? liveCapabilityEntries.length
    : Object.values(op.caps).filter(Boolean).length;
  const heartbeatPoints = profileTone === "ok"
    ? "0,42 34,42 44,18 56,62 68,30 80,42 128,42 138,24 150,56 164,42 220,42"
    : profileTone === "warn"
      ? "0,42 36,42 46,24 58,58 72,36 86,42 126,42 136,18 148,62 162,42 220,42"
      : "0,42 40,42 48,30 58,52 70,42 118,42 126,32 136,52 150,42 220,42";
  return (
    <div className="ms-page ms-operator-profile">
      <div className="ms-crumb op-profile-crumb">
        <a href="#/operators" onClick={()=>go("#/operators")}>Operators</a>
        <span>›</span>
        <b>{useLiveProfile ? (liveOperatorId ? fmtHashShort(liveOperatorId) : addr) : op.handle}</b>
      </div>
      <section className={`ms-op-hero op-profile-hero is-${profileTone}`}>
        <div className="op-profile-hero__main">
          <div className="op-profile-identity">
            <div className={`op-profile-signal is-${profileTone}`} aria-hidden="true">
              <span className="op-profile-signal__ring op-profile-signal__ring--outer"/>
              <span className="op-profile-signal__ring op-profile-signal__ring--inner"/>
              <span
                className="ms-avatar op-profile-signal__avatar"
                style={{background:`oklch(0.62 0.16 ${operatorAvatarHue(identitySeed)})`}}
              />
              <span className="op-profile-signal__dot"/>
            </div>
            <div className="op-profile-title">
              <div className="op-profile-kicker">
                <span className={`op-profile-live is-${profileTone}`}/>
                <span className="mono">{useLiveProfile ? "Live operator identity" : "Preview operator identity"}</span>
              </div>
              <h1 className={useLiveProfile ? "ms-h1 mono" : "ms-h1"}>{displayName}</h1>
              <p className="mono">
                {useLiveProfile
                  ? `${primaryClusterLabel} · ${profileRole.label}${authorityIndex !== undefined && authorityIndex !== null ? ` · authority #${authorityIndex}` : ""}`
                  : `${op.addrShort} · ${op.region} · active since ${op.activeSince}`}
              </p>
            </div>
          </div>
          <svg className="op-profile-heartbeat" viewBox="0 0 220 84" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 42H220"/>
            <polyline points={heartbeatPoints}/>
          </svg>
        </div>
        <div className="op-profile-hero__stats">
          <OperatorProfileStat label="State" value={profileRole.label} sub={useLiveProfile ? "cluster status" : "preview health"} tone={profileTone}/>
          <OperatorProfileStat label="Cluster" value={primaryClusterLabel} sub={useLiveProfile ? `${roster.clusterCount ?? "—"} clusters scanned` : `${op.memberships.length} memberships`} tone="info"/>
          <OperatorProfileStat label="Authority" value={authorityIndex !== undefined && authorityIndex !== null ? `#${authorityIndex}` : "—"} sub={authority.data?.active ? "active authority" : authority.data ? "inactive authority" : "not resolved"} tone={authority.data?.active ? "ok" : authority.data ? "warn" : "info"}/>
          <OperatorProfileStat
            label="Miss rate"
            value={risk.data ? `${(risk.data.missRateBps / 100).toFixed(2)}%` : useLiveProfile ? "—" : op.slashes === 0 ? "0.00%" : "watch"}
            sub={risk.data ? `${risk.data.windowRounds} round window` : useLiveProfile ? "risk endpoint pending" : `${op.slashes} slash events`}
            tone={useLiveProfile ? riskTone : op.slashes === 0 ? "ok" : "warn"}
          />
        </div>
        <div className="op-profile-hero__panels">
          <div className="op-profile-panel op-profile-panel--identity">
            <div className="op-profile-panel__head">
              <span className="mono">Identity</span>
              <b>{useLiveProfile ? "live keys" : "preview record"}</b>
            </div>
            <div className="op-identity-stack op-identity-stack--hero">
              <div className="op-hero-key-list">
                <OperatorHeroKey label="Operator id" value={displayId}/>
                <OperatorHeroKey label="Chain address" value={chainAddress}/>
                <OperatorHeroKey label="BLS key" value={blsKey}/>
              </div>
              <div className="op-hero-facts">
                <span><small className="mono">Lifecycle</small><b className="mono">{operatorInfo.data?.lifecycleState ?? (useLiveProfile ? "—" : "active")}</b></span>
                <span><small className="mono">Bonded</small><b className="mono">{useLiveProfile ? fmtLythAmount(operatorInfo.data?.bondedAmount) : `${fmt(op.bonded)} LYTH`}</b></span>
                <span><small className="mono">Commission</small><b className="mono">{operatorInfo.data?.commissionBps !== null && operatorInfo.data?.commissionBps !== undefined ? `${(operatorInfo.data.commissionBps / 100).toFixed(2)}%` : "—"}</b></span>
                <span><small className="mono">Delegators</small><b className="mono">{operatorInfo.data?.delegationCount ?? "—"}</b></span>
              </div>
            </div>
          </div>
          <div className="op-profile-panel">
            <div className="op-profile-panel__head">
              <span className="mono">Reputation</span>
              <b>{useLiveProfile ? "indexer" : op.reputation.toFixed(3)}</b>
            </div>
            {useLiveProfile ? (
              <div className="op-hero-note mono">
                Reputation history is waiting on an indexed peer. The score follows inclusion rate, RTT, and completed duties.
              </div>
            ) : (
              <div className="op-hero-spark">
                <Sparkline data={op.repHist} width={300} height={86} color="var(--ok)"/>
              </div>
            )}
          </div>
          <div className="op-profile-panel">
            <div className="op-profile-panel__head">
              <span className="mono">Services</span>
              <b>{publishedCapabilityCount || "—"}</b>
            </div>
            {useLiveProfile ? (
              liveCapabilityEntries.length ? (
                <div className="op-hero-cap-list">
                  {liveCapabilityEntries.slice(0, 6).map(([key, value]) => (
                    <span key={key} className="mono" title={String(value)}>{capabilityLabel(key)}</span>
                  ))}
                </div>
              ) : (
                <div className="op-hero-note mono">
                  No service capability mask has been published by this operator yet.
                </div>
              )
            ) : (
              <div className="op-hero-cap-list">
                {Object.entries(op.caps).filter(([, v]) => v).map(([key]) => (
                  <span key={key} className="mono">{capabilityLabel(key)}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="op-profile-row">
        <Card title="Cluster memberships">
          {useLiveProfile && liveClusterIds.length > 0 ? (
            <div className="op-membership-grid">
              {liveClusterIds.map((clusterId) => {
                const isRosterCluster = liveMembership?.clusterId === clusterId;
                const role = operatorRoleMeta(isRosterCluster ? liveMembership?.state : operatorInfo.data?.lifecycleState);
                const tone = operatorDetailTone(role.tone);
                return (
                  <button key={clusterId} type="button" className={`op-membership-card is-${tone}`} onClick={()=>go(`#/cluster/${clusterId + 1}`)}>
                    <span className="op-membership-card__pulse" aria-hidden="true"/>
                    <span className="mono op-membership-card__label">{cName(clusterId)}</span>
                    <span className={`pill ${role.tone === "neutral" ? "" : role.tone}`}>{role.label}</span>
                    <span className="mono op-membership-card__meta">
                      {isRosterCluster
                        ? liveMembership?.blsPubkey
                          ? `BLS ${fmtHashShort(liveMembership.blsPubkey, 12, 0)}`
                          : "BLS not reported"
                        : "reported by operator info"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : useLiveProfile ? (
            <div className="op-empty-state mono">
              No live cluster membership resolved for this operator id. Reward / joined-round / role aggregates require an indexed peer
              {indexerAvailability.disabled ? ` (${indexerAvailability.reason ?? "indexer disabled"})` : ""}.
            </div>
          ) : (
            <div className="op-membership-grid">
              {op.memberships.map(m=>(
                <button key={m.slot} type="button" className="op-membership-card is-ok" onClick={()=>go(`#/cluster/${m.slot}`)}>
                  <span className="op-membership-card__pulse" aria-hidden="true"/>
                  <span className="mono op-membership-card__label">C-{String(m.slot).padStart(3,"0")}</span>
                  <span className="pill ok">{m.role}</span>
                  <span className="mono op-membership-card__meta">joined {m.joined} · +{fmt(m.reward30d)} 30d</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </section>

      <section className="op-profile-row">
        <Card title="Upcoming duties">
          <div className="op-duty-grid">
            <OperatorFact
              label="Attestation"
              value={attestationDuty ? `${fmtRoundish(attestationDuty.startRound)}-${fmtRoundish(attestationDuty.endRound)}` : "—"}
              tone={attestationDuty ? "ok" : "neutral"}
            />
            <OperatorFact label="Duty kind" value={attestationDuty?.kind ? attestationDuty.kind.replace(/_/g, " ") : "—"} tone="neutral"/>
            <OperatorFact label="Current round" value={duties.data ? fmtRoundish(duties.data.currentRound) : "—"} tone="neutral"/>
            <OperatorFact label="Horizon" value={duties.data ? `${duties.data.horizonRounds} rounds` : "—"} tone="neutral"/>
            <OperatorFact label="Key rotation" value={keyRotationLabel} tone={keyRotation && "nextRound" in keyRotation ? "ok" : "neutral"}/>
            <OperatorFact label="Risk sample" value={risk.data ? fmtRoundish(risk.data.dataHeight) : "—"} tone="neutral"/>
          </div>
          {risk.data?.reasons?.length ? (
            <div className="op-risk-reasons mono">
              {risk.data.reasons.map((reason) => <span key={reason}>{reason}</span>)}
            </div>
          ) : null}
        </Card>
      </section>

      <section className="op-profile-row">
        <Card title="Risk and signing">
          <div className="op-risk-wide">
            <div className="op-risk-layout">
              <div className="op-risk-meter" style={{background:`conic-gradient(${riskColor} ${riskDeg}deg, rgba(255,255,255,0.065) ${riskDeg}deg 360deg)`}}>
                <div>
                  <b className="mono">{risk.data ? `${(risk.data.missRateBps / 100).toFixed(2)}%` : "—"}</b>
                  <span className="mono">miss rate</span>
                </div>
              </div>
              <div className="op-risk-stats">
                <OperatorFact label="Signed" value={signingPercent !== null ? `${signingPercent}%` : signingSummary} tone={signedCount !== null && signedCount > 0 ? "ok" : "neutral"}/>
                <OperatorFact label="Missed" value={missedCount ?? "—"} tone={missedCount && missedCount > 0 ? "warn" : "neutral"}/>
                <OperatorFact label="Headroom" value={risk.data ? `${(risk.data.remainingHeadroomBps / 100).toFixed(2)}%` : "—"} tone={riskTone}/>
                <OperatorFact label="Jail status" value={jailStatus ?? "—"} tone={riskTone}/>
              </div>
            </div>
            {signing.data?.entries?.length ? (
              <div className="op-signing-list">
                {signing.data.entries.slice(0, 12).map((row) => {
                  const tone = row.status === "signed" ? "ok" : row.status === "missed" ? "err" : "warn";
                  return (
                    <div key={`${row.round}-${row.status}`} className={`op-signing-row is-${tone}`}>
                      <span className="mono">round {fmtRoundish(row.round)}</span>
                      <span className={`pill ${tone}`}>{row.status}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="op-empty-state mono">
                Recent signing activity appears after the operator authority index resolves.
              </div>
            )}
          </div>
        </Card>
      </section>
    </div>
  );
};

/* ============== CLUSTERS LIST (rebuilt — human-first) ============== */
/* APY derived from 30d reward / TVS, annualized. Guards against a ~0 TVS
   divisor (returns 0 rather than Infinity/NaN, keeping sorts/averages stable);
   display sites pass the result through fmtClusterApy so a 0 reads as "—". */
const clusterApy = (cl) => {
  const tvsMono = parseFloat(cl.tvs) * 1_000_000;
  if (!(tvsMono > 0)) return 0;
  return (cl.reward30d * 12 / tvsMono) * 100;
};
// Render an APY number as a percent, or "—" when it is 0 / non-finite
// (near-zero TVS divisor) so a fixture can't show a misleading 0.00%.
export const fmtClusterApy = (apy: number) =>
  Number.isFinite(apy) && apy > 0 ? `${apy.toFixed(2)}%` : "—";

const _positiveInt = (value: any, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
};
const _clusterId = (cl: any) => {
  const id = Number(cl?.id);
  return Number.isFinite(id) && id >= 0 ? Math.trunc(id) : 0;
};
export const liveClusterSlot = (cl: any) => _clusterId(cl) + 1;
export const liveClusterLabel = (cl: any) => `C-${String(liveClusterSlot(cl)).padStart(3, "0")}`;
export const liveClusterRosterFor = (cl: any, operators: readonly any[] = []) => {
  const clusterId = _clusterId(cl);
  return operators.filter((row) => Number(row?.clusterId) === clusterId);
};
const _operatorIsActive = (state: string | null | undefined) =>
  state === "active" || state === "live" || state === "signing";
const _operatorIsStandby = (state: string | null | undefined) =>
  state === "standby" || state === "queued" || state === "backup";
const _operatorRingState = (state: string | null | undefined) =>
  _operatorIsActive(state) ? "live" : state === "lagging" || state === "degraded" ? "lag" : "standby";
export const liveClusterSeatSummary = (cl: any, operators: readonly any[] = []) => {
  const rosterRows = liveClusterRosterFor(cl, operators);
  const size = _positiveInt(cl?.size, rosterRows.length || _positiveInt(cl?.threshold, 1));
  const threshold = Math.min(size, _positiveInt(cl?.threshold, Math.max(1, Math.ceil(size * 0.7))));
  const active = rosterRows.filter((row) => _operatorIsActive(row?.state)).length;
  const standby = rosterRows.filter((row) => _operatorIsStandby(row?.state)).length;
  return { size, threshold, active, standby, reported: rosterRows.length, known: rosterRows.length > 0 };
};
export const liveClusterRingMembers = (cl: any, operators: readonly any[] = []) => {
  const rosterRows = liveClusterRosterFor(cl, operators);
  if (rosterRows.length > 0) {
    return rosterRows.map((row, i) => ({
      id: row?.operatorId ?? `${_clusterId(cl)}-${i}`,
      state: _operatorRingState(row?.state),
    }));
  }
  return [];
};

const ClustersPage = ({go}: any) => {
  const liveClusters = useClusterSet();
  const activeClustersLive = useActiveClusters();
  const healthyClustersLive = useHealthyClusters();
  const roster = useLiveOperatorRoster();
  const indexerAvailability = useIndexerAvailability();
  const [tab, setTab]       = useState("active"); // active|inactive
  const [filter, setFilter] = useState("all"); // all|nominal|maintenance|open (active tab) · all|jailed|queued (inactive tab)
  const [sort, setSort]     = useState("tvs"); // tvs|apy|members|diversity
  const active     = SCAN.clusters.filter(c=>c.active);
  const inactive   = SCAN.clusters.filter(c=>!c.active);
  const jailed     = inactive.filter(c=>c.inactiveReason==="jailed");
  const queued     = inactive.filter(c=>c.inactiveReason==="below-top-100");
  const nominal    = active.filter(c=>c.state==="nominal").length;
  const maint      = active.filter(c=>c.state==="maintenance").length;
  const openCount  = active.filter(c=>c.recruiting).length;
  const liveDescriptors = liveClusters.data ?? null;
  const liveDescriptorCount = liveDescriptors?.length ?? null;
  const liveActiveCount = activeClustersLive.data?.length ?? null;
  const liveHealthyCount = healthyClustersLive.data?.length ?? null;
  // The chain reports live cluster descriptors with id/size/threshold but no
  // TVS / APY / reward history yet. When live data resolves, surface that
  // gap instead of showing the fixture's invented economic aggregates.
  const haveLiveDirectory = indexerAvailability.liveChain || liveDescriptors !== null;
  const fixtureTvs = active.reduce((a,c)=>a+parseFloat(c.tvs),0);
  const fixtureAvgApy = active.reduce((a,c)=>a+clusterApy(c),0)/active.length;
  const fixtureTopApy = Math.max(...active.map(clusterApy));
  const fixtureMinToEnter = parseFloat(active[active.length-1].tvs);
  const totalTvs   = haveLiveDirectory ? null : fixtureTvs;
  const avgApy     = haveLiveDirectory ? null : fixtureAvgApy;
  const topApy     = haveLiveDirectory ? null : fixtureTopApy;
  const minToEnter = haveLiveDirectory ? null : fixtureMinToEnter;
  const liveActiveDescriptors = haveLiveDirectory ? (liveDescriptors ?? []).filter((c) => c.active) : [];
  const liveInactiveDescriptors = haveLiveDirectory ? (liveDescriptors ?? []).filter((c) => !c.active) : [];
  const liveDegradedCount = liveActiveDescriptors.filter((c) => c.aggregateHealth !== "ok").length;
  const top100ActiveCount = haveLiveDirectory ? (liveActiveCount ?? (liveDescriptors ? liveActiveDescriptors.length : null)) : active.length;
  const top100DegradedCount = haveLiveDirectory ? (liveDescriptors ? liveDegradedCount : null) : maint;
  const top100HealthyCount = haveLiveDirectory
    ? (liveHealthyCount ?? (top100ActiveCount !== null && top100DegradedCount !== null ? Math.max(0, top100ActiveCount - top100DegradedCount) : null))
    : nominal;
  const liveActiveFiltered = liveActiveDescriptors.filter((c) =>
    filter === "all" ? true : filter === "nominal" ? c.aggregateHealth === "ok" : filter === "maintenance" ? c.aggregateHealth !== "ok" : true,
  );
  const liveInactiveFiltered = liveInactiveDescriptors.filter((c) =>
    filter === "all" ? true : filter === "jailed" ? c.aggregateHealth === "jailed" : c.aggregateHealth !== "jailed",
  );
  const firstLiveCluster = liveDescriptors && liveDescriptors.length > 0 ? liveDescriptors[0] : null;
  const liveQuorumLabel = firstLiveCluster
    ? `${firstLiveCluster.threshold ?? "?"}-of-${firstLiveCluster.size ?? "?"} BFT`
    : null;

  // reset filter when switching tabs so stale "jail" filter doesn't stick on active tab, etc.
  const switchTab = (t) => { setTab(t); setFilter("all"); };

  const featured = [...active]
    .filter(c=>c.state==="nominal")
    .sort((a,b)=>clusterApy(b)-clusterApy(a))
    .slice(0,6);

  const activeFiltered = active
    .filter(c => filter==="all" ? true : filter==="open" ? c.recruiting : c.state===filter)
    .sort((a,b)=>{
      if (sort==="apy")       return clusterApy(b)-clusterApy(a);
      if (sort==="members")   return b.members-a.members;
      if (sort==="diversity") return b.diversity-a.diversity;
      return parseFloat(b.tvs)-parseFloat(a.tvs);
    });

  const inactiveFiltered = inactive
    .filter(c => filter==="all" ? true : filter==="jailed" ? c.inactiveReason==="jailed" : c.inactiveReason==="below-top-100")
    .sort((a,b)=>{
      // jailed first (they may rejoin soon), then queued by closest to promotion
      if (a.inactiveReason !== b.inactiveReason) return a.inactiveReason==="jailed" ? -1 : 1;
      return parseFloat(b.tvs) - parseFloat(a.tvs);
    });

  return (
    <div className="ms-page ms-overview ms-clusters-page">
      {/* ---------- INTRO HERO ---------- */}
      <section className="ov-hero cl-overview-hero">
        <div className="ov-hero__left">
          <div className="ov-hero__tag">
            <span className="ov-livedot"/>
            <span className="mono" style={{fontSize:11,letterSpacing:"0.14em",textTransform:"uppercase",color:"var(--fg-300)"}}>
              {haveLiveDirectory
                ? `${liveActiveCount ?? "—"} active descriptors · ${liveHealthyCount ?? "—"} healthy · ${liveQuorumLabel ?? "BFT pending"}`
                : `${active.length} active descriptors · ${nominal} healthy · 5-of-7 BFT`}
            </span>
          </div>
          <h1 className="ov-hero__title">
            Pick <span style={{color:"var(--gold)"}}>who secures</span><br/>
            <span style={{color:"var(--fg-300)"}}>your stake.</span>
          </h1>
          <p className="ov-hero__desc">
            {haveLiveDirectory && firstLiveCluster
              ? `The live chain reports ${liveDescriptorCount} cluster descriptor${liveDescriptorCount === 1 ? "" : "s"} with ${liveQuorumLabel ?? "BFT quorum"}. Roster and quorum are live; TVS, APY, and reward history appear once the aggregate index lands.`
              : haveLiveDirectory
                ? "Awaiting the live cluster directory. Monoscan will not show seeded TVS, APY, reward, or standby-bench rows while connected to the live chain."
              : "Every cluster is a 7-operator DVT set. The protocol elects the top 100 by TVS into the active cluster set — others wait in the wings until their stake grows. Stake with any active cluster; your delegation will roll over automatically if rankings shift."}
          </p>
          <div className="ov-hero__ctas">
            <button onClick={()=>go(firstLiveCluster ? `#/cluster/${liveClusterSlot(firstLiveCluster)}` : haveLiveDirectory ? "#/clusters" : `#/cluster/${featured[0]?.slot||1}`)} className="ov-cta ov-cta--primary">
              {haveLiveDirectory ? (firstLiveCluster ? "Open live cluster →" : "Live clusters pending") : "Top-yield cluster →"}
            </button>
            <button onClick={()=>haveLiveDirectory ? switchTab("active") : setFilter("open")} className="ov-cta">
              {haveLiveDirectory
                ? liveDescriptorCount !== null
                  ? `${liveDescriptorCount} live descriptor${liveDescriptorCount === 1 ? "" : "s"}`
                  : "checking live directory"
                : `● ${openCount} open for ops`}
            </button>
          </div>
        </div>
        <div className="ov-hero__stats">
          <HeadlineStat label="Active clusters" value={haveLiveDirectory ? (liveActiveCount !== null ? `${liveActiveCount}` : "—") : `${active.length}/100`}
            sub={haveLiveDirectory ? (liveDescriptorCount !== null ? `${liveDescriptorCount} live descriptors` : "awaiting live directory") : `${inactive.length} inactive · ${jailed.length} jailed`}
            delta={haveLiveDirectory ? (liveHealthyCount !== null ? `${liveHealthyCount} healthy` : "") : jailed.length===0?"all healthy":`${jailed.length} cooling down`}
            tone={haveLiveDirectory ? "neutral" : jailed.length===0?"ok":"err"}/>
          <HeadlineStat
            label="Total value staked"
            value={totalTvs !== null ? `${totalTvs.toFixed(0)}M LYTH` : "—"}
            sub={totalTvs !== null ? "across active clusters" : "not exposed by live data yet"}
            delta={totalTvs !== null ? "+0.4M · 24h" : ""}
            tone="gold"
            accent
          />
          <HeadlineStat
            label="Average APY"
            value={avgApy !== null ? `${avgApy.toFixed(2)}%` : "—"}
            sub={avgApy !== null ? `top cluster · ${topApy!.toFixed(2)}%` : "no reward aggregate endpoint"}
            delta={avgApy !== null ? "paid in LYTH" : ""}
            tone="ok"
          />
          <HeadlineStat
            label="Top 100 active / degraded"
            value={top100ActiveCount !== null && top100DegradedCount !== null ? `${top100ActiveCount}/${top100DegradedCount}` : "—/—"}
            sub={top100HealthyCount !== null ? `${top100HealthyCount} healthy in the active set` : "awaiting live health descriptors"}
            delta={top100DegradedCount !== null && top100DegradedCount > 0 ? `${top100DegradedCount} degraded` : top100DegradedCount === 0 ? "none degraded" : ""}
            tone={top100DegradedCount !== null && top100DegradedCount > 0 ? "warn" : "ok"}
          />
        </div>
      </section>

      {/* ---------- LIVE CLUSTER NOTICE ---------- */}
      {haveLiveDirectory && liveDescriptorCount !== null && (
        <Card
          title="Live cluster directory"
          sub={`Live data reports ${liveDescriptorCount} cluster${liveDescriptorCount === 1 ? "" : "s"}${liveQuorumLabel ? ` · ${liveQuorumLabel}` : ""}. This view now keeps the card and table layout while marking TVS/APY/reward history as pending until the aggregate endpoint exists.`}
        />
      )}

      {/* ---------- ACTIVE / INACTIVE TABBED LIST ---------- */}
      <section>
        <div className="cl-tabs">
          <button className={`cl-tab ${tab==="active"?"is-active":""}`} onClick={()=>switchTab("active")}>
            <span className="cl-tab__label">Active</span>
            <span className="cl-tab__count mono">{haveLiveDirectory ? liveActiveDescriptors.length : active.length}</span>
            <span className="cl-tab__sub">{haveLiveDirectory ? "reported live" : "earning rewards"}</span>
          </button>
          <button className={`cl-tab ${tab==="inactive"?"is-active":""}`} onClick={()=>switchTab("inactive")}>
            <span className="cl-tab__label">Inactive</span>
            <span className="cl-tab__count mono">{haveLiveDirectory ? liveInactiveDescriptors.length : inactive.length}</span>
            <span className="cl-tab__sub">{haveLiveDirectory ? `${liveDegradedCount} degraded active` : `${jailed.length} jailed · ${queued.length} queued`}</span>
          </button>
        </div>

        {tab==="active" ? (
          <>
            <p className="ov-section-desc" style={{marginBottom:14,maxWidth:720}}>
              {haveLiveDirectory
                ? "Active rows come from the live cluster directory. Economic rank, APY, TVS, and rewards remain pending until the node exposes reward-history aggregates."
                : "Top 100 by TVS. These are the active clusters earning rewards this epoch. If a cluster is jailed, it drops into Inactive and must complete a 100-round cooldown before re-election."}
            </p>
            <div className="cl-chips">
              <div className="cl-chipgroup">
                {(haveLiveDirectory
                  ? [["all",`All · ${liveActiveDescriptors.length}`],["nominal",`Healthy · ${liveHealthyCount ?? liveActiveDescriptors.filter((c) => c.aggregateHealth === "ok").length}`],["maintenance",`Degraded · ${liveDegradedCount}`]]
                  : [["all",`All · ${active.length}`],["nominal",`Live · ${nominal}`],["maintenance",`Degraded · ${maint}`],["open",`● Open for ops · ${openCount}`]]
                ).map(([k,l])=>(
                  <button key={k} className={`cl-chip ${filter===k?"is-active":""}`} onClick={()=>setFilter(k)}>{l}</button>
                ))}
              </div>
              {!haveLiveDirectory && (
              <div className="cl-chipgroup">
                <span className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.1em",marginRight:8}}>SORT BY</span>
                {[["tvs","TVS"],["apy","APY"],["members","Members"],["diversity","Diversity"]].map(([k,l])=>(
                  <button key={k} className={`cl-chip cl-chip--sort ${sort===k?"is-active":""}`} onClick={()=>setSort(k)}>{l}</button>
                ))}
              </div>
              )}
            </div>

            <Card title="">
              <table className="ms-table cl-table">
                <thead><tr>
                  <th style={{width:44}}>#</th>
                  <th>Cluster</th>
                  <th>State</th>
                  <th>Bench</th>
                  <th style={{textAlign:"right"}}>TVS</th>
                  <th style={{textAlign:"right"}}>APY</th>
                  <th style={{textAlign:"right"}}>Reward 30d</th>
                  <th style={{textAlign:"right"}}>Vertex incl.</th>
                </tr></thead>
                <tbody>
                  {haveLiveDirectory ? (liveActiveFiltered.length === 0 ? (
                    <tr>
                      <td colSpan={8}>
                        <div className="mono" style={{color:"var(--fg-400)",fontSize:12,lineHeight:1.55,padding:"14px 8px"}}>
                          No active live clusters match this filter.
                        </div>
                      </td>
                    </tr>
                  ) : liveActiveFiltered.map((cl, i)=>{
                    const slotLabel = liveClusterLabel(cl);
                    const summary = liveClusterSeatSummary(cl, roster.operators);
                    return (
                      <tr key={cl.id} onClick={()=>go(`#/cluster/${cl.id + 1}`)}>
                        <td className="mono" style={{color:"var(--gold)",fontWeight:600}}>#{i + 1}</td>
                        <td>
                          <div style={{fontWeight:500,fontSize:13,color:"var(--fg-100)"}}>{slotLabel}</div>
                          <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:1,letterSpacing:"0.02em"}}>cluster id {cl.id} · {cl.threshold}-of-{cl.size} BFT</div>
                        </td>
                        <td>
                          <span className={`pill ${cl.aggregateHealth === "ok" ? "ok" : "warn"}`} style={{fontSize:10,padding:"2px 7px"}}>
                            {cl.aggregateHealth ?? "unknown"}
                          </span>
                        </td>
                        <td className="mono" style={{fontSize:10.5,color:"var(--fg-500)"}}>
                          {summary.known ? `${summary.active}/${summary.size} active` : `${summary.threshold}/${summary.size} BFT`}
                        </td>
                        <td className="mono num" style={{textAlign:"right",color:"var(--fg-500)"}}>{fmtClusterStake(cl)}</td>
                        <td className="mono num" style={{textAlign:"right",color:"var(--fg-500)"}}>not indexed</td>
                        <td className="mono num" style={{textAlign:"right",color:"var(--fg-500)"}}>not indexed</td>
                        <td className="mono num" style={{textAlign:"right",color:"var(--fg-500)"}}>not indexed</td>
                      </tr>
                    );
                  })) : activeFiltered.map(cl=>(
                    <tr key={cl.slot} onClick={()=>go(`#/cluster/${cl.slot}`)}>
                      <td className="mono" style={{color:cl.rank<=10?"var(--gold)":"var(--fg-400)",fontWeight:cl.rank<=10?600:400}}>#{cl.rank}</td>
                      <td>
                        <div style={{fontWeight:500,fontSize:13,color:"var(--fg-100)"}}>
                          {cl.name}
                          {cl.recruiting && <span className="cl-open-tag cl-open-tag--inline" title={`${cl.recruitSeats} seat(s) open`}>OPEN</span>}
                        </div>
                        <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:1,letterSpacing:"0.02em"}}>C-{String(cl.slot).padStart(3,"0")} · {cl.members}/{cl.size} live</div>
                      </td>
                      <td><StateMachinePill state={cl.state} compact/></td>
                      <td>
                        <span className="cl-bench-inline mono">
                          {Array.from({length:3}).map((_,b)=>(
                            <span key={b} className={`cl-bench-pip ${b<cl.backupCount?"is-filled":"is-empty"}`}/>
                          ))}
                          <span style={{color:"var(--fg-500)",fontSize:10.5,marginLeft:4}}>{cl.backupCount}/3</span>
                        </span>
                      </td>
                      <td className="mono num" style={{textAlign:"right"}}>{cl.tvs}M</td>
                      <td className="mono num" style={{textAlign:"right",color:"var(--gold)"}}>{fmtClusterApy(clusterApy(cl))}</td>
                      <td className="mono num" style={{textAlign:"right",color:"var(--gold)"}}>+{fmt(cl.reward30d)}</td>
                      <td className="mono num" style={{textAlign:"right"}}>{pct(cl.vertexInclude,1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        ) : (
          <>
            <p className="ov-section-desc" style={{marginBottom:14,maxWidth:720}}>
              {haveLiveDirectory
                ? "Inactive rows come only from the live cluster directory. Jail cooldowns, queued-rank gaps, and promotion thresholds stay blank until those live aggregates are exposed."
                : <>Not earning this epoch. <span style={{color:"var(--state-jail, #ff6b6b)"}}>Jailed</span> clusters were demoted after a slashing event and must stay live for <span style={{color:"var(--fg-200)"}}>100 rounds</span> before they're eligible for re-election. <span style={{color:"var(--fg-300)"}}>Queued</span> clusters are fully formed but sit below the rank-100 threshold of <span style={{color:"var(--fg-200)"}}>{minToEnter !== null ? `${minToEnter.toFixed(2)}M LYTH` : "—"}</span>.</>}
            </p>
            <div className="cl-chips">
              <div className="cl-chipgroup">
                {(haveLiveDirectory
                  ? [["all",`All · ${liveInactiveDescriptors.length}`],["jailed","Jailed · —"],["queued","Queued · —"]]
                  : [["all",`All · ${inactive.length}`],["jailed",`Jailed · ${jailed.length}`],["queued",`Queued · ${queued.length}`]]
                ).map(([k,l])=>(
                  <button key={k} className={`cl-chip ${filter===k?"is-active":""}`} onClick={()=>setFilter(k)}>{l}</button>
                ))}
              </div>
            </div>

            <Card title="">
              <table className="ms-table cl-table">
                <thead><tr>
                  <th style={{width:44}}>#</th>
                  <th>Cluster</th>
                  <th>Reason</th>
                  <th>Bench</th>
                  <th style={{textAlign:"right"}}>TVS</th>
                  <th style={{textAlign:"right"}}>Gap to #100</th>
                  <th style={{textAlign:"right"}}>Cooldown</th>
                </tr></thead>
                <tbody>
                  {haveLiveDirectory ? (liveInactiveFiltered.length === 0 ? (
                    <tr>
                      <td colSpan={7}>
                        <div className="mono" style={{color:"var(--fg-400)",fontSize:12,lineHeight:1.55,padding:"14px 8px"}}>
                          No inactive clusters are reported by the live directory.
                        </div>
                      </td>
                    </tr>
                  ) : liveInactiveFiltered.map((cl)=>(
                    <tr key={cl.id} onClick={()=>go(`#/cluster/${cl.id + 1}`)} className="cl-waiting-row">
                      <td className="mono" style={{color:"var(--fg-500)"}}>#{cl.id + 1}</td>
                      <td>
                        <div style={{fontWeight:500,fontSize:13,color:"var(--fg-200)"}}>C-{String(cl.id + 1).padStart(3, "0")}</div>
                        <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:1,letterSpacing:"0.02em"}}>
                          cluster id {cl.id} · {cl.threshold}-of-{cl.size} BFT
                        </div>
                      </td>
                      <td>
                        <span className="pill warn" style={{fontSize:10,padding:"2px 7px"}}>{cl.aggregateHealth ?? "inactive"}</span>
                      </td>
                      <td className="mono" style={{fontSize:10.5,color:"var(--fg-500)"}}>—</td>
                      <td className="mono num" style={{textAlign:"right",color:"var(--fg-500)"}}>—</td>
                      <td className="mono num" style={{textAlign:"right",color:"var(--fg-500)"}}>—</td>
                      <td className="mono num" style={{textAlign:"right",color:"var(--fg-500)"}}>—</td>
                    </tr>
                  ))) : inactiveFiltered.map(cl=>{
                    const isJailed = cl.inactiveReason==="jailed";
                    const cdPct = isJailed ? ((100 - cl.cooldownRoundsLeft) / 100) : 0;
                    return (
                      <tr key={cl.slot} onClick={()=>go(`#/cluster/${cl.slot}`)} className="cl-waiting-row">
                        <td className="mono" style={{color:"var(--fg-500)"}}>#{cl.rank}</td>
                        <td>
                          <div style={{fontWeight:500,fontSize:13,color:"var(--fg-200)"}}>
                            {cl.name}
                            {cl.recruiting && <span className="cl-open-tag cl-open-tag--inline" title={`${cl.recruitSeats} seat(s) open`}>OPEN</span>}
                          </div>
                          <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:1,letterSpacing:"0.02em"}}>
                            C-{String(cl.slot).padStart(3,"0")} · {cl.members}/{cl.size} live
                          </div>
                        </td>
                        <td>
                          {isJailed
                            ? <span className="pill" style={{padding:"2px 8px",fontSize:10,background:"rgba(255,107,107,0.08)",color:"var(--state-jail, #ff6b6b)",border:"1px solid rgba(255,107,107,0.3)",letterSpacing:"0.04em"}}>JAILED</span>
                            : <span className="pill" style={{padding:"2px 8px",fontSize:10,background:"rgba(255,255,255,0.03)",color:"var(--fg-400)",border:"1px solid var(--fg-700)",letterSpacing:"0.04em"}}>BELOW #100</span>}
                        </td>
                        <td>
                          <span className="cl-bench-inline mono">
                            {Array.from({length:3}).map((_,b)=>(
                              <span key={b} className={`cl-bench-pip ${b<cl.backupCount?"is-filled":"is-empty"}`}/>
                            ))}
                            <span style={{color:"var(--fg-500)",fontSize:10.5,marginLeft:4}}>{cl.backupCount}/3</span>
                          </span>
                        </td>
                        <td className="mono num" style={{textAlign:"right",color:"var(--fg-300)"}}>{cl.tvs}M</td>
                        <td className="mono num" style={{textAlign:"right",color:isJailed?"var(--fg-500)":"var(--warn)"}}>
                          {isJailed ? "—" : `−${cl.tvsToPromote}M`}
                        </td>
                        <td style={{textAlign:"right"}}>
                          {isJailed ? (
                            <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"flex-end"}}>
                              <div className="cl-cooldown-bar" title={`${cl.cooldownRoundsLeft} rounds remaining`}>
                                <div className="cl-cooldown-fill" style={{width:`${cdPct*100}%`}}/>
                              </div>
                              <span className="mono num" style={{fontSize:11,color:"var(--state-jail, #ff6b6b)",minWidth:56,textAlign:"right"}}>
                                {cl.cooldownRoundsLeft}/100
                              </span>
                            </div>
                          ) : (
                            <span className="mono" style={{fontSize:11,color:"var(--fg-500)"}}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </section>
    </div>
  );
};

/* Small operator ring — 7 dots around a circle with quorum arc, compact */
const MiniRing = ({ members, size=110, threshold=5, centerValue, centerLabel = "LIVE" }: any) => {
  const cx = size/2, cy = size/2;
  const r  = size*0.34;
  const live = members.filter(m=>m.state==="live").length;
  const total = members.length;
  const circ = 2*Math.PI*(r+10);
  const filled = total > 0 ? (live/total)*circ : 0;
  const healthy = live>=threshold;
  const stroke = healthy ? "var(--state-nominal, #73d13d)" : "var(--state-jail, #ff6b6b)";
  return (
    <div className="cl-mini-ring" style={{position:"relative",width:size,height:size,margin:"10px auto 0"}}>
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r+10} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2"/>
        <circle cx={cx} cy={cy} r={r+10} fill="none" stroke={stroke} strokeWidth="2"
          strokeDasharray={`${filled} ${circ}`}
          strokeDashoffset={circ*0.25}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{filter:`drop-shadow(0 0 4px ${stroke}88)`,transition:"stroke-dasharray 500ms ease-out"}}/>
        {members.map((m,i)=>{
          const a = (i/total)*Math.PI*2 - Math.PI/2;
          const x = cx + Math.cos(a)*r;
          const y = cy + Math.sin(a)*r;
          const c = m.state==="live"?"var(--state-nominal, #73d13d)":m.state==="lag"?"var(--state-maintenance, #f2b441)":m.state==="standby"?"var(--info, #8ab4d6)":"var(--state-jail, #ff6b6b)";
          return <circle key={i} cx={x} cy={y} r={6} fill="var(--ink-2, #161428)" stroke={c} strokeWidth="1.5" style={{filter:`drop-shadow(0 0 3px ${c}66)`}}/>;
        })}
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
        <div className="mono num" style={{fontSize:14,color:"var(--fg-100)",letterSpacing:0}}>{centerValue ?? `${live}/${total}`}</div>
        <div className="mono" style={{fontSize:8.5,color:"var(--fg-500)",letterSpacing:0}}>{centerLabel}</div>
      </div>
    </div>
  );
};

type OperatorCardMetric = { label: string; value: string };
type OperatorCardRow = {
  mode: "live" | "fixture";
  key: string;
  search: string;
  clusterSearch: string;
  stateKind: string;
  href: string;
  tone: "ok" | "warn" | "info" | "err";
  avatarHue: number;
  name: string;
  id: string;
  pillLabel: string;
  pillTone: string;
  clusterLabel: string;
  kvLabel?: string;
  kvValue?: string;
  metrics?: OperatorCardMetric[];
};

const operatorAvatarHue = (seed: string) =>
  Array.from(seed).reduce((sum, ch, idx) => sum + ch.charCodeAt(0) * (idx + 1), 0) % 360;

const OperatorsPage = ({go}: any) => {
  const clusters = useClusterSet();
  const healthyClusters = useHealthyClusters();
  const roster = useLiveOperatorRoster();
  const indexerAvailability = useIndexerAvailability();
  const liveCount = clusters.data?.length ?? null;
  const healthyCount = healthyClusters.data?.length ?? null;
  // The chain publishes per-cluster member rosters but no rich operator
  // profile yet (lyth_operatorInfo returns "not registered" until an
  // operator opts in via the node registry precompile). Fall back to the
  // fixture roster only when the cluster directory is unreachable — show
  // a typed empty/operator-id row whenever the live data resolves.
  const useLiveRoster = indexerAvailability.liveChain || (roster.loaded && roster.operators.length > 0);
  const [operatorQuery, setOperatorQuery] = useState("");
  const [operatorStateFilter, setOperatorStateFilter] = useState("all");
  const [operatorClusterFilter, setOperatorClusterFilter] = useState("");
  const [operatorVisible, setOperatorVisible] = useState(60);
  const liveActiveOps = roster.operators.filter((op) => _operatorIsActive(op.state)).length;
  const liveStandbyOps = roster.operators.filter((op) => _operatorIsStandby(op.state)).length;
  const liveLaggingOps = roster.operators.filter((op) => op.state === "lagging" || op.state === "degraded").length;
  const cleanFixtureOps = SCAN.operators.filter((op) => op.slashes === 0).length;
  const avgFixtureRep = SCAN.operators.reduce((sum, op) => sum + op.reputation, 0) / SCAN.operators.length;
  useEffect(() => {
    setOperatorVisible(60);
  }, [operatorQuery, operatorStateFilter, operatorClusterFilter, useLiveRoster]);
  const liveOperatorRows = useMemo<OperatorCardRow[]>(() => roster.operators.map((op) => {
    const cluster = `C-${String(op.clusterId + 1).padStart(3, "0")}`;
    const isLagging = op.state === "lagging" || op.state === "degraded";
    const stateKind = _operatorIsActive(op.state) ? "active" : _operatorIsStandby(op.state) ? "standby" : isLagging ? "lagging" : "issues";
    const role = operatorRoleMeta(op.state);
    const tone = _operatorIsActive(op.state) ? "ok" : isLagging ? "warn" : _operatorIsStandby(op.state) ? "info" : "err";
    return {
      mode: "live",
      key: op.operatorId,
      search: `${op.operatorId} ${op.blsPubkey ?? ""} ${op.state ?? ""} ${cluster} cluster-${op.clusterId + 1}`.toLowerCase(),
      clusterSearch: `${cluster} cluster-${op.clusterId + 1} ${op.clusterId + 1}`.toLowerCase(),
      stateKind,
      href: `#/operator/${encodeURIComponent(op.operatorId)}`,
      tone,
      avatarHue: operatorAvatarHue(op.operatorId),
      name: fmtHashShort(op.operatorId, 10, 4),
      id: fmtHashShort(op.operatorId, 14, 8),
      pillLabel: role.label,
      pillTone: role.tone,
      clusterLabel: cluster,
      kvLabel: "BLS",
      kvValue: op.blsPubkey ? fmtHashShort(op.blsPubkey, 10, 0) : "not reported",
    };
  }), [roster.operators]);
  const fixtureOperatorRows = useMemo<OperatorCardRow[]>(() => SCAN.operators.map((op) => {
    const clustersText = op.memberships.map((m) => `C-${String(m.slot).padStart(3, "0")} cluster-${m.slot}`).join(" ");
    return {
      mode: "fixture",
      key: op.addrShort,
      search: `${op.handle} ${op.addrShort} ${op.region} ${clustersText}`.toLowerCase(),
      clusterSearch: `${op.region} ${clustersText}`.toLowerCase(),
      stateKind: op.slashes === 0 ? "clean" : "issues",
      href: `#/operator/${op.addrShort}`,
      tone: op.slashes === 0 ? "ok" : "warn",
      avatarHue: operatorAvatarHue(op.handle),
      name: op.handle,
      id: op.addrShort,
      pillLabel: op.region,
      pillTone: "neutral",
      clusterLabel: `${op.memberships.length} clusters`,
      metrics: [
        { label: "Rep", value: op.reputation.toFixed(3) },
        { label: "Uptime", value: pct(op.uptime, 1) },
        { label: "Bonded", value: fmt(op.bonded) },
      ],
    };
  }), []);
  const allOperatorRows = useLiveRoster ? liveOperatorRows : fixtureOperatorRows;
  const operatorStateOptions = useLiveRoster
    ? [["all", "All"], ["active", "Active"], ["standby", "Standby"], ["lagging", "Lagging"], ["issues", "Issues"]]
    : [["all", "All"], ["clean", "Clean"], ["issues", "Issues"]];
  const normalizedOperatorQuery = operatorQuery.trim().toLowerCase();
  const normalizedOperatorCluster = operatorClusterFilter.trim().toLowerCase();
  const filteredOperatorRows = allOperatorRows.filter((row) => {
    if (normalizedOperatorQuery && !row.search.includes(normalizedOperatorQuery)) return false;
    if (normalizedOperatorCluster && !row.clusterSearch.includes(normalizedOperatorCluster)) return false;
    if (operatorStateFilter !== "all" && row.stateKind !== operatorStateFilter) return false;
    return true;
  });
  const visibleOperatorRows = filteredOperatorRows.slice(0, operatorVisible);
  const hiddenOperatorRows = Math.max(0, filteredOperatorRows.length - visibleOperatorRows.length);
  return (
    <div className="ms-page ms-operators-page">
      <section className="op-overview-hero">
        <div className="op-overview-hero__copy">
          <div className="op-overview-hero__tag">
            <span className="ov-livedot"/>
            <span className="mono">
              {useLiveRoster
                ? `${roster.operators.length} live roster rows${liveCount !== null ? ` · ${liveCount} cluster descriptor${liveCount===1?"":"s"}` : ""}`
                : `${SCAN.operators.length} preview operators · identity follows address`}
            </span>
          </div>
          <h1 className="op-overview-hero__title">Operator roster</h1>
          <p className="op-overview-hero__desc">
            Operators carry stable identity across clusters. Live rows come from cluster status; richer reputation, uptime, bonded amount, and slash history appear once operator aggregates are indexed.
          </p>
        </div>
        <div className="op-overview-hero__stats">
          <div className="op-stat-card">
            <span className="mono">Operators</span>
            <b className="mono num">{useLiveRoster ? roster.operators.length : SCAN.operators.length}</b>
            <small>{useLiveRoster ? "reported by cluster status" : "offline preview set"}</small>
          </div>
          <div className="op-stat-card">
            <span className="mono">Active</span>
            <b className="mono num">{useLiveRoster ? liveActiveOps : SCAN.operators.length}</b>
            <small>{useLiveRoster ? `${liveStandbyOps} standby · ${liveLaggingOps} lagging` : `${cleanFixtureOps} clean slash records`}</small>
          </div>
          <div className="op-stat-card">
            <span className="mono">Clusters</span>
            <b className="mono num">{liveCount !== null ? liveCount : "—"}</b>
            <small>{healthyCount !== null ? `${healthyCount} healthy` : useLiveRoster ? "live descriptors" : "preview topology"}</small>
          </div>
          <div className="op-stat-card op-stat-card--accent">
            <span className="mono">Reputation</span>
            <b className="mono num">{useLiveRoster ? "—" : avgFixtureRep.toFixed(3)}</b>
            <small>{useLiveRoster ? "aggregate pending" : "preview average"}</small>
          </div>
        </div>
      </section>

      <Card title={useLiveRoster ? "Live operator roster" : "Operator preview roster"}>
        <div className="op-toolbar">
          <label className="op-search">
            <span className="mono">Search</span>
            <input
              value={operatorQuery}
              onChange={(event)=>setOperatorQuery(event.target.value)}
              placeholder={useLiveRoster ? "operator id, BLS key, state" : "handle, address, region"}
            />
          </label>
          <label className="op-search op-search--small">
            <span className="mono">{useLiveRoster ? "Cluster" : "Region / cluster"}</span>
            <input
              value={operatorClusterFilter}
              onChange={(event)=>setOperatorClusterFilter(event.target.value)}
              placeholder={useLiveRoster ? "C-001" : "eu-west or C-001"}
            />
          </label>
          <div className="op-filter-group" role="group" aria-label="Operator status filter">
            {operatorStateOptions.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={`op-filter ${operatorStateFilter === value ? "is-active" : ""}`}
                onClick={()=>setOperatorStateFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="op-toolbar__count mono">
            {filteredOperatorRows.length}/{allOperatorRows.length}
          </div>
        </div>
        {useLiveRoster && allOperatorRows.length === 0 ? (
          <div className="op-empty mono">
            {roster.loaded
              ? "No live operator roster rows are reported by the connected cluster-status endpoints."
              : "Checking live operator roster."}
          </div>
        ) : filteredOperatorRows.length === 0 ? (
          <div className="op-empty mono">
            No operators match the current filters.
          </div>
        ) : (
          <div className="op-card-grid">
            {visibleOperatorRows.map((row) => (
              <button key={row.key} type="button" className={`op-card is-${row.tone}`} onClick={()=>go(row.href)}>
                <span className="op-card__glow" aria-hidden="true"/>
                <span className="op-card__head">
                  <span className="ms-avatar op-card__avatar" style={{background:`oklch(0.62 0.16 ${row.avatarHue})`}}/>
                  <span className="op-card__state" aria-hidden="true"/>
                </span>
                <span className={`op-card__name ${row.mode === "live" ? "mono" : ""}`}>{row.name}</span>
                <span className="op-card__id mono">{row.id}</span>
                <span className="op-card__meta">
                  <span className={`pill ${row.pillTone === "neutral" ? "" : row.pillTone}`}>{row.pillLabel}</span>
                  <span className="op-card__cluster mono">{row.clusterLabel}</span>
                </span>
                {row.metrics ? (
                  <span className="op-card__metrics">
                    {row.metrics.map((metric) => (
                      <span key={metric.label}><small>{metric.label}</small><b className="mono">{metric.value}</b></span>
                    ))}
                  </span>
                ) : (
                  <span className="op-card__kv mono">
                    <span>{row.kvLabel}</span>
                    <b>{row.kvValue}</b>
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {hiddenOperatorRows > 0 && (
          <div className="op-show-more">
            <button type="button" className="ov-cta" onClick={()=>setOperatorVisible((n) => n + 60)}>
              Show 60 more
            </button>
            <span className="mono">{hiddenOperatorRows} hidden by render limit</span>
          </div>
        )}
        {useLiveRoster && (
          <div className="mono op-roster-note">
            Only live cluster-status fields are shown here. Reputation, uptime, bonded amount, and slash history are hidden until a real operator aggregate endpoint is indexed
            {indexerAvailability.disabled ? ` (${indexerAvailability.reason ?? "indexer disabled"})` : ""}.
          </div>
        )}
      </Card>
    </div>
  );
};

/* ============== APP ============== */
const App = () => {
  const [route, setRoute] = useState(window.location.hash || "#/");
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || "#/");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = (h) => { window.location.hash = h; setRoute(h); };

  // Lightweight toast channel (for clipboard copies, preview-only actions, etc.)
  const [toast, setToast] = useState<string | null>(null);
  useEffect(()=>{
    window.__msToast = (msg: string) => {
      setToast(msg);
      clearTimeout(window.__msToastT);
      window.__msToastT = setTimeout(()=>setToast(null), 2400);
    };
    return () => { delete window.__msToast; };
  },[]);

  const parts = route.replace(/^#\//,"").split("/");
  let page;
  if (parts[0]==="" || parts[0]==="overview") page = <Landing go={go}/>;
  else if (parts[0]==="markets")   page = <MarketsPage go={go}/>;
  else if (parts[0]==="market")    page = <MarketPage sym={decodeURIComponent(parts[1]||"LYTH")} go={go}/>;
  else if (parts[0]==="cluster")    page = <ClusterPage slot={parts[1]} go={go}/>;
  else if (parts[0]==="clusters")   page = <ClustersPage go={go}/>;
  else if (parts[0]==="operator")   page = <OperatorPage addr={decodeURIComponent(parts[1]||"")} go={go}/>;
  else if (parts[0]==="operators")  page = <OperatorsPage go={go}/>;
  else if (parts[0]==="stats")      page = <StatsPage go={go}/>;
  else if (parts[0]==="burn")       page = <BurnPage go={go}/>;
  else if (parts[0]==="get-monolythium" || parts[0]==="get-lyth") {
    // Genesis sale moved to monolythium.com. Redirect for deep links.
    if (typeof window !== "undefined") window.location.replace("https://monolythium.com/get-lyth");
    page = <div style={{padding: 40, textAlign: "center", color: "var(--fg-300)"}}>Redirecting to monolythium.com/get-lyth …</div>;
  }
  else if (parts[0]==="protocol")   page = <ProtocolPage go={go}/>;
  else if (parts[0]==="diversity" && parts[1]) page = <ClusterDiversityPage id={parts[1]} go={go}/>;
  else if (parts[0]==="diversity")  page = <DiversityPage go={go}/>;
  else if (parts[0]==="oracle")     page = <OraclePage go={go}/>;
  else if (parts[0]==="policy")     page = <SpendingPolicyPage addr={decodeURIComponent(parts[1]||"")} go={go}/>;
  else if (parts[0]==="cluster-directory" || parts[0]==="clusters-directory") page = <ClusterDirectoryPage go={go}/>;
  else if (parts[0]==="prover-market" || parts[0]==="prover") page = <ProverMarketPage go={go}/>;
  else if (parts[0]==="bridge" || parts[0]==="bridges") page = <BridgePage go={go}/>;
  else if (parts[0]==="transactions") page = <TransactionsPage go={go}/>;
  else if (parts[0]==="wallets")    page = <WalletsPage go={go}/>;
  else if (parts[0]==="wallet")     page = <WalletPage addr={decodeURIComponent(parts[1]||"")} go={go}/>;
  else if (parts[0]==="tx")         page = <TxPage hash={decodeURIComponent(parts[1]||"")} go={go}/>;
  else if (parts[0]==="round")      page = <RoundPage round={parts[1]} go={go}/>;
  else if (parts[0]==="search")     page = <SearchPage q={decodeURIComponent(parts[1]||"")} go={go}/>;
  else if (parts[0]==="ask")        page = <AskPage initialQuery={parts[1] ? decodeURIComponent(parts[1]) : undefined} go={go}/>;
  else page = <Landing go={go}/>;

  return (
    <div className="ms-app">
      <Header go={go} route={route}/>
      <main className="ms-main">{page}</main>
      <footer className="ms-footer">
        <span>monoscan · public read-only explorer</span>
        <span className="mono ms-footer__entity">Mono Labs R&amp;D LLC · San Francisco</span>
        <span style={{flex:1}}/>
        <span className="mono ms-footer__guarantees">node-pubkey verified · TLS · no tracking</span>
        <span className="ms-footer__socials">
          <a href="https://x.com/monolythium" className="ms-social" style={{['--brand' as any]: '255, 255, 255'}} aria-label="X / Twitter" target="_blank" rel="noopener">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M12.6 0h2.5L9.6 6.3 16 16h-5l-3.9-5.1L2.7 16H.2L6 9.2 0 0h5.1l3.5 4.7L12.6 0zm-.9 14.5h1.4L4.4 1.4H3l8.7 13.1z"/></svg>
          </a>
          <a href="https://discord.gg/monolythium" className="ms-social" style={{['--brand' as any]: '88, 101, 242'}} aria-label="Discord" target="_blank" rel="noopener">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 2.5A12.5 12.5 0 0 0 10.3 1.5l-.1.3a10 10 0 0 1 2.8 1.1A11 11 0 0 0 5 3 10 10 0 0 1 7.8 1.8L7.7 1.5A12.5 12.5 0 0 0 4.5 2.5c-2 2.6-2.6 5.2-2.3 7.7A11.6 11.6 0 0 0 5.7 12l.8-1a8 8 0 0 1-1.3-.6l.3-.2c2.5 1.1 5.2 1.1 7.7 0l.3.2a8 8 0 0 1-1.3.6l.8 1a11.6 11.6 0 0 0 3.5-1.8c.4-3-.6-5.5-2.2-7.7zM6.3 8.7c-.8 0-1.4-.7-1.4-1.6S5.5 5.5 6.3 5.5s1.5.7 1.4 1.6c0 .9-.6 1.6-1.4 1.6zm3.4 0c-.8 0-1.4-.7-1.4-1.6S8.9 5.5 9.7 5.5s1.4.7 1.4 1.6-.6 1.6-1.4 1.6z"/></svg>
          </a>
          <a href="https://t.me/mono_announcements" className="ms-social" style={{['--brand' as any]: '42, 171, 238'}} aria-label="Telegram · announcements" target="_blank" rel="noopener">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 1.6 1.3 6.4c-.8.3-.8 1.4 0 1.7l3.1 1 1.2 3.7c.2.7 1.1.9 1.6.4l1.7-1.6 3.2 2.4c.6.4 1.4.1 1.6-.6L14.9 2.5c.1-.7-.6-1.2-1.4-.9zM6.5 9.3l5.1-3.4c.2-.1.3.1.2.2L7.3 10.5l-.1 1.8L6.5 9.3z"/></svg>
          </a>
          <a href="https://github.com/monolythium" className="ms-social" style={{['--brand' as any]: '240, 246, 252'}} aria-label="GitHub" target="_blank" rel="noopener">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
          </a>
        </span>
      </footer>
      {toast && (
        <div className="ms-toast">
          <span className="ms-toast__dot"/>
          <span className="mono" style={{fontSize:12}}>{toast}</span>
        </div>
      )}
    </div>
  );
};

export { App };
