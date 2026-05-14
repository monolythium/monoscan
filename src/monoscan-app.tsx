/* =====================================================
   Monoscan — public chain explorer for Monolythium v4.0
   Three views: Landing · Cluster detail · Operator profile.
   Hash-routed; data is faked but shape-true to data.tsx.
===================================================== */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useMemo } from "react";
import {
  Icon, Sparkline, ClusterRing, StateMachinePill, Card,
} from "./primitives";
import { MONOSCAN_DATA, MARKETS } from "./data/mock";
import { StatsPage, WalletsPage, WalletPage, TxPage, RoundPage, SearchPage, ProtocolPage } from "./monoscan-extras";
import { MarketsPage, MarketPage } from "./monoscan-markets";
import {
  useChainHead,
  useChainStrip,
  useLatestBlocks,
  useClusterSet,
  useClusterStatus,
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
} from "./data/hooks";
import { AskPage } from "./nl/AskPage";
import { MsThemeSwitcher } from "./monoscan-theme";

/* --- light helpers (mirror desktop's primitives, lighter weight) --- */
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = (n) => n.toLocaleString();
const pct = (x, d=2) => `${(x*100).toFixed(d)}%`;
const ago = (s) => s; // already strings
const shortHex = (value = "", head = 8, tail = 4) =>
  value.length > head + tail + 3 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;

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

/* ============== TOP STRIP ============== */
/**
 * Renders the live top strip. `round` arrives already-resolved by the App
 * (live RPC long-poll first, mock fallback second); the rest of the fields
 * are best-effort live values from `useChainStrip` and degrade quietly to
 * the mocked values when the node is unreachable.
 */
const ChainStrip = ({ round, latencyMs, ratePerSec, signers, strip }: any) => {
  const block = strip?.blockNumber;
  const peers = strip?.peerCount;
  const syncState = strip?.syncState;
  const syncLag = strip?.syncLag;
  const netVersion = strip?.netVersion;
  return (
    <div className="ms-strip">
      <span className="ms-strip__dot"/>
      <span className="ms-strip__label">CHAIN LIVE</span>
      <Sep/>
      <Field label="round" value={fmt(round)} accent/>
      <Sep/>
      {block !== null && block !== undefined ? (
        <>
          <Field label="block" value={fmt(block)}/>
          <Sep/>
        </>
      ) : null}
      <Field label="rate" value={`${ratePerSec.toFixed(1)}/s`}/>
      <Sep/>
      <Field label="commit p95" value={`${latencyMs}ms`}/>
      <Sep/>
      <Field label="clusters" value={`${signers.live}/${signers.total} live`}/>
      {peers !== null && peers !== undefined ? (
        <>
          <Sep/>
          <Field label="peers" value={fmt(peers)}/>
        </>
      ) : null}
      {syncState ? (
        <>
          <Sep/>
          <Field label="sync" value={syncLag !== null && syncLag !== undefined ? `${syncState} · lag ${fmt(syncLag)}` : syncState}/>
        </>
      ) : null}
      <span style={{flex:1}}/>
      <Field label="network" value={netVersion ? `chain-id ${netVersion}` : "testnet 69420"}/>
      <Sep/>
      <Field label="proto" value="whitepaper v4.0"/>
    </div>
  );
};
const Sep = () => <span className="ms-strip__sep"/>;
const Field = ({label, value, accent}: any) => (
  <span className="ms-strip__field">
    <span>{label}</span>
    <b style={accent ? {color:"var(--gold)"} : {}}>{value}</b>
  </span>
);

/* ============== HEADER NAV ============== */
const Header = ({ go, route }: any) => {
  const [q, setQ] = useState("");
  const submit = (e) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    if (/^\d+$/.test(v)) go(`#/round/${v}`);
    else if (v.startsWith("0x")) go(`#/operator/${v}`);
    else if (/^c-\d+/i.test(v)) go(`#/cluster/${v.slice(2)}`);
    else go(`#/search/${encodeURIComponent(v)}`);
  };
  return (
    <header className="ms-header">
      <a href="#/" onClick={()=>go("#/")} className="ms-brand">
        <span className="ms-brand__mark"/>
        <div>
          <b>Monoscan</b>
          <small>monolythium v4.0 explorer</small>
        </div>
      </a>
      <form onSubmit={submit} className="ms-search">
        <Icon name="explorer" size={14}/>
        <input
          value={q}
          onChange={e=>setQ(e.target.value)}
          placeholder="Round number · cluster C-044 · operator 0x… · vertex hash · tx hash"
        />
        <span className="ms-search__hint">enter ↵</span>
      </form>
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
        {[
          ["#/",            "Overview"],
          ["#/markets",     "Markets"],
          ["#/clusters",    "Clusters"],
          ["#/operators",   "Operators"],
          ["#/wallets",     "Wallets"],
          ["#/stats",       "Statistics"],
          ["#/protocol",    "Protocol"],
        ].map(([h, l]) => (
          <a key={h} href={h} onClick={()=>go(h)}
            className={`ms-nav__item ${route===h ? "is-active" : ""}`}>{l}</a>
        ))}
      </nav>
      <MsThemeSwitcher/>
    </header>
  );
};

/* ============== LANDING (rebuilt — calm, human-first) ============== */
const fmtUsd = (n) => n>=1e9 ? `$${(n/1e9).toFixed(2)}B` : n>=1e6 ? `$${(n/1e6).toFixed(1)}M` : n>=1e3 ? `$${(n/1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;

const Landing = ({ go }: any) => {
  const c = SCAN.consensus;
  const markets = MARKETS || [];
  const [round, setRound] = useState(c.round);
  const [latencySeries, setLatencySeries] = useState(()=>Array.from({length:60},(_,i)=>340+Math.sin(i*0.4)*16+Math.random()*14));
  const [rateSeries, setRateSeries]       = useState(()=>Array.from({length:60},(_,i)=>2.8+Math.sin(i*0.3)*0.15+Math.random()*0.08));
  const [showDeep, setShowDeep] = useState(false);

  // Live latest blocks for the on-chain feed strip. Falls back to the mocked
  // recent vertices when the node is offline so the page never goes blank.
  // TODO(monolythium-vision): once mono-core OI-0070 lands the indexer's
  // per-vertex breakdown (transaction count, BLS-agg ms, DAC coverage, cluster
  // attribution), swap these block headers for the richer vertex shape the
  // designs demand.
  const liveBlocks = useLatestBlocks(8);

  useEffect(() => {
    const id = setInterval(() => {
      setRound(r => r + 1);
      setLatencySeries(s => [...s.slice(1), 340+Math.sin(Date.now()/4000)*16+Math.random()*14]);
      setRateSeries(s => [...s.slice(1), 2.8+Math.sin(Date.now()/5000)*0.15+Math.random()*0.08]);
    }, 380);
    return () => clearInterval(id);
  }, []);

  const mono = markets.find(m=>m.sym==="LYTH") || { price: 8.42, chg24h: 2.4 };
  const vol24h = markets.reduce((a,t)=>a+t.vol24h,0);
  const mcap   = markets.reduce((a,t)=>a+t.mcap,0);
  const gainers = [...markets].sort((a,b)=>b.chg24h-a.chg24h).slice(0,5);
  const losers  = [...markets].sort((a,b)=>a.chg24h-b.chg24h).slice(0,5);
  const byVol   = [...markets].sort((a,b)=>b.vol24h-a.vol24h).slice(0,5);
  const tvs     = parseFloat(c.tvs); // M LYTH
  const avgApy  = 6.4;
  const pubSupply = parseFloat(SCAN.supply.public); // M LYTH circulating public
  const pubPct    = SCAN.supply.publicPct;          // % of total
  const privPct   = 100 - pubPct;
  const totalSupply = pubSupply / (pubPct/100);     // implied total (M)
  const privSupply  = totalSupply - pubSupply;      // M LYTH shielded

  return (
    <div className="ms-page ms-overview">
      {/* ---------- WELCOME HERO ---------- */}
      <section className="ov-hero">
        <div className="ov-hero__left">
          <div className="ov-hero__tag">
            <span className="ov-livedot"/>
            <span className="mono" style={{fontSize:11,letterSpacing:"0.14em",textTransform:"uppercase",color:"var(--fg-300)"}}>
              Monolythium · network live · {c.ratePerSec.toFixed(1)} rounds/s
            </span>
          </div>
          <h1 className="ov-hero__title">
            The <span style={{color:"var(--gold)"}}>Monolythium</span> network,<br/>
            <span style={{color:"var(--fg-300)"}}>in plain sight.</span>
          </h1>
          <p className="ov-hero__desc">
            Monoscan is the public explorer for Monolythium — every transfer, every trade, every stake
            reward, reconciled against {c.signers.total} live clusters.
            Search anything, or dig into the data below.
          </p>
          <div className="ov-hero__ctas">
            <button onClick={()=>go("#/markets")} className="ov-cta ov-cta--primary">Browse markets</button>
            <button onClick={()=>go("#/clusters")} className="ov-cta">Stake with a cluster</button>
            <button onClick={()=>document.getElementById("ov-feed")?.scrollIntoView({block:"center",behavior:"smooth"})} className="ov-cta ov-cta--ghost">See it live ↓</button>
          </div>
        </div>

        {/* 4 headline numbers — what anyone cares about */}
        <div className="ov-hero__stats">
          <HeadlineStat
            label="LYTH"
            value={`$${mono.price.toFixed(3)}`}
            sub={`mcap ${fmtUsd(mcap)}`}
            delta={`${mono.chg24h>=0?"+":""}${mono.chg24h.toFixed(2)}% · 24h`}
            tone={mono.chg24h>=0?"ok":"err"}
            spark={mono.sparkline||[]}
            onClick={()=>go("#/market/LYTH")}
            accent
          />
          <HeadlineStat
            label="Value staked"
            value={`${tvs.toFixed(0)}M LYTH`}
            sub={`≈ ${fmtUsd(tvs*1_000_000 * mono.price)} · secures the chain`}
            delta={`+${avgApy.toFixed(1)}% APY · average`}
            tone="gold"
            onClick={()=>go("#/clusters")}
          />
          <HeadlineStat
            label="24h volume"
            value={fmtUsd(vol24h)}
            sub={`across ${markets.length} markets`}
            delta="+12.4% vs 7d avg"
            tone="ok"
            onClick={()=>go("#/markets")}
          />
          <SupplySplitStat
            publicM={pubSupply}
            privateM={privSupply}
            totalM={totalSupply}
            pubPct={pubPct}
            privTxs30d={SCAN.supply.privateTxs30d}
          />
        </div>
      </section>

      {/* ---------- NETWORK CONFIDENCE STRIP ---------- */}
      <section className="ov-conf">
        <div className="ov-conf__item">
          <div className="ov-conf__label">Round</div>
          <div className="ov-conf__num mono num">{fmt(round)}</div>
          <div className="ov-conf__hint mono">committed ~340ms ago</div>
        </div>
        <div className="ov-conf__item">
          <div className="ov-conf__label">Commit latency</div>
          <div style={{display:"flex",alignItems:"baseline",gap:8}}>
            <div className="ov-conf__num mono num" style={{fontSize:24}}>{c.commitLatencyP95Ms}ms</div>
            <span className="mono" style={{fontSize:10,color:"var(--ok)"}}>p95 · healthy</span>
          </div>
          <MiniSeries data={latencySeries} color="var(--ok)" height={28}/>
        </div>
        <div className="ov-conf__item">
          <div className="ov-conf__label">Throughput</div>
          <div style={{display:"flex",alignItems:"baseline",gap:8}}>
            <div className="ov-conf__num mono num" style={{fontSize:24}}>{c.ratePerSec.toFixed(2)}<span style={{fontSize:14,color:"var(--fg-400)"}}>/s</span></div>
            <span className="mono" style={{fontSize:10,color:"var(--fg-400)"}}>rounds</span>
          </div>
          <MiniSeries data={rateSeries} color="var(--gold)" height={28}/>
        </div>
        <div className="ov-conf__item">
          <div className="ov-conf__label">Operator quorum · last 100 rounds</div>
          <SignersHist data={c.signersHist}/>
          <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:6,letterSpacing:"0.04em"}}>
            100 clusters · 7 or 10 operators per cluster
          </div>
        </div>
        <button className="ov-conf__toggle mono" onClick={()=>setShowDeep(s=>!s)}>
          {showDeep ? "− Hide operator metrics" : "+ Operator metrics"}
        </button>
      </section>

      {showDeep && (
        <section className="ov-deep">
          <Vital label="Vertex inclusion"     value={pct(c.vertexInclude,2)}     delta="-0.2pp" tone="ok"/>
          <Vital label="DAC coverage"         value={pct(c.dacCoverage,2)}       delta="+0.1pp" tone="ok"/>
          <Vital label="Reed-Solomon shards"  value={`${(c.shards/1000).toFixed(1)}k/s`} delta="+380" tone="ok"/>
          <Vital label="BLS aggregation p95"  value={`${c.blsAggMs}ms`}          delta="-0.3ms" tone="ok"/>
          <Vital label="Mempool depth"        value={fmt(c.mempool)}             delta="+112"   tone="warn"/>
          <Vital label="Private throughput"   value="0.91k/s"                    delta="steady" tone="ok"/>
        </section>
      )}

      {/* ---------- WHAT'S MOVING ---------- */}
      <section className="ov-moving">
        <MoveCard title="Top gainers · 24h" rows={gainers} kind="gain" go={go}/>
        <MoveCard title="Top losers · 24h"  rows={losers}  kind="loss" go={go}/>
        <MoveCard title="Most traded · 24h" rows={byVol}   kind="vol"  go={go}/>
      </section>

      {/* ---------- LIVE FEED ---------- */}
      <section id="ov-feed" className="ov-feed">
        <div className="ov-feed__head">
          <div>
            <h3 className="ov-section-title">Live on-chain</h3>
            <p className="ov-section-desc">Every round commits a batch of encrypted transactions to the DAG. Click any row for its full receipt.</p>
          </div>
          <div className="mono" style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:"var(--fg-400)",letterSpacing:"0.04em"}}>
            <span className="ov-livedot"/> streaming · {c.ratePerSec.toFixed(1)}/s
          </div>
        </div>

        <div className="ov-feed__grid">
          <div className="ov-feed__list">
            {liveBlocks.data && liveBlocks.data.length > 0
              ? liveBlocks.data.slice(0, 8).map((b: any, i: number) => {
                  const num = Number(b.number ?? 0);
                  const gas = Number(b.gas_used ?? b.gasUsed ?? 0);
                  const limit = Number(b.gas_limit ?? b.gasLimit ?? 1);
                  const fillPct = limit > 0 ? (gas / limit) * 100 : 0;
                  const slot = (num % 28) + 1;
                  return (
                    <div
                      key={(b.hash as string) ?? i}
                      className="ov-feed__row"
                      onClick={() => go(`#/round/${num}`)}
                    >
                      <span className="mono" style={{color:"var(--gold)",fontSize:12.5,minWidth:90,letterSpacing:"0.02em"}}>r·{fmt(num)}</span>
                      <span className="mono" style={{color:"var(--fg-300)",fontSize:11.5,minWidth:70}}>C-{String(slot).padStart(3,"0")}</span>
                      <span className="mono" style={{color:"var(--fg-200)",fontSize:11.5,flex:1}}>{fmt(gas)} gas used</span>
                      <span className="mono" style={{color:"var(--fg-500)",fontSize:10.5}}>{fillPct.toFixed(1)}%</span>
                      <span className="pill ok" style={{padding:"2px 7px",fontSize:9.5}}>committed</span>
                    </div>
                  );
                })
              : SCAN.recentVertices.slice(0,8).map((v,i)=>(
                  <div key={i} className="ov-feed__row" onClick={()=>go(`#/cluster/${v.clusterSlot}`)}>
                    <span className="mono" style={{color:"var(--gold)",fontSize:12.5,minWidth:90,letterSpacing:"0.02em"}}>r·{fmt(v.round)}</span>
                    <span className="mono" style={{color:"var(--fg-300)",fontSize:11.5,minWidth:70}}>C-{String(v.clusterSlot).padStart(3,"0")}</span>
                    <span className="mono" style={{color:"var(--fg-200)",fontSize:11.5,flex:1}}>{v.txCount} txs settled</span>
                    <span className="mono" style={{color:"var(--fg-500)",fontSize:10.5}}>{v.blsAggMs.toFixed(1)}ms</span>
                    <span className={`pill ${v.dac?"ok":"warn"}`} style={{padding:"2px 7px",fontSize:9.5}}>
                      {v.dac ? "committed" : "pending"}
                    </span>
                  </div>
                ))}
          </div>
          <aside className="ov-feed__side">
            <div className="cap" style={{marginBottom:8}}>Top staking clusters</div>
            {SCAN.clusters.slice(0,5).map(cl=>(
              <div key={cl.slot} className="ov-cluster-row" onClick={()=>go(`#/cluster/${cl.slot}`)}>
                <div>
                  <div className="mono" style={{fontSize:12.5,color:"var(--fg-100)",fontWeight:500}}>C-{String(cl.slot).padStart(3,"0")}</div>
                  <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:1}}>{cl.members}/{cl.size} live · {cl.tvs}M TVS</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div className="mono num" style={{fontSize:12.5,color:"var(--gold)"}}>{(5.8+Math.random()*1.4).toFixed(2)}%</div>
                  <div className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>APY</div>
                </div>
              </div>
            ))}
            <a href="#/clusters" onClick={()=>go("#/clusters")} className="mono ov-seeall">See all clusters →</a>
          </aside>
        </div>
      </section>

      {/* ---------- OPERATOR SURFACES + DENOMINATIONS ---------- */}
      <section className="ms-grid-2">
        <Card title="Live operator surfaces" right={<a className="ms-link" href="#/operators" onClick={()=>go("#/operators")}>Open →</a>}>
          {[
            ["Cluster directory", "lyth_clusterDirectory"],
            ["Cluster status", "lyth_clusterStatus"],
            ["Operator risk", "lyth_operatorRisk"],
          ].map(([label, method]) => (
            <div key={method} className="ms-prop">
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:14}}>
                <span style={{fontSize:13}}>{label}</span>
                <span className="mono" style={{fontSize:11,color:"var(--gold)"}}>{method}</span>
              </div>
              <div className="mono" style={{fontSize:10.5,color:"var(--fg-500)",marginTop:5}}>
                wired through the TypeScript SDK with typed failure/null handling
              </div>
            </div>
          ))}
        </Card>

        <Card title="Two denominations" right={<span className="cap">irreversible · by design</span>}>
          <p className="mono" style={{fontSize:12,color:"var(--fg-400)",lineHeight:1.55,margin:"0 0 14px"}}>
            Public LYTH is fully transparent. Private LYTH‑p hides amounts at the protocol layer —
            no mixers, no opt-in. You choose per transaction.
          </p>
          <div className="ms-denoms">
            <div className="ms-denom">
              <div className="cap" style={{color:"var(--gold)"}}>Public · LYTH</div>
              <div className="mono" style={{fontSize:22,color:"var(--fg-100)",marginTop:6}}>{SCAN.supply.public}M</div>
              <div className="mono" style={{fontSize:10.5,color:"var(--fg-400)",marginTop:3}}>circulating · introspectable</div>
              <div className="ms-bar"><div style={{width:`${SCAN.supply.publicPct}%`, background:"var(--gold)"}}/></div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>{SCAN.supply.publicPct}% of total</div>
            </div>
            <div className="ms-denom ms-denom--private">
              <div className="cap">Private · LYTH-p</div>
              <div className="mono" style={{fontSize:22,color:"var(--fg-200)",marginTop:6}}>
                — <span style={{fontSize:11,color:"var(--fg-500)"}}>opaque</span>
              </div>
              <div className="mono" style={{fontSize:10.5,color:"var(--fg-400)",marginTop:3}}>{fmt(SCAN.supply.privateTxs30d)} private txs · 30d</div>
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
const HeadlineStat = ({ label, value, sub, delta, tone, spark, accent, onClick }: any) => {
  const toneColor = tone==="ok" ? "var(--ok)" : tone==="err" ? "var(--err)" : tone==="gold" ? "var(--gold)" : "var(--fg-400)";
  return (
    <div className={`ov-hstat ${accent?"ov-hstat--accent":""} ${onClick?"ov-hstat--click":""}`} onClick={onClick}>
      <div className="ov-hstat__label">{label}</div>
      <div className="ov-hstat__value mono num">{value}</div>
      {sub && <div className="ov-hstat__sub mono">{sub}</div>}
      {delta && <div className="ov-hstat__delta mono" style={{color:toneColor}}>{delta}</div>}
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

const MoveCard = ({ title, rows, kind, go }: any) => (
  <div className="ms-card ov-movecard">
    <div className="ms-card__head">
      <h3>{title}</h3>
      <a className="ms-link" href="#/markets" onClick={()=>go("#/markets")}>All markets →</a>
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
  const delegators = useClusterDelegators(liveClusterId);
  const delegationCap = useDelegationCap();
  const clusterEntity = useClusterEntity(liveClusterId);
  const entityRatchet = useEntityRatchet();
  const apy = clusterApy(cl);
  const liveRingMembers = liveStatus?.members?.length
    ? liveStatus.members.map((m, i) => ({
        id: m.operatorId,
        handle: shortHex(m.operatorId, 10, 6),
        addrShort: m.operatorId,
        role: m.state,
        rep: 0,
        vertexRate: 0,
        state: m.state === "active" ? "live" : m.state === "lagging" ? "lag" : m.state === "standby" ? "standby" : "down",
      }))
    : null;
  const ringMembers = liveRingMembers ?? cl.opMembers.map((m,i)=>({ ...m, id: m.handle+i }));
  const liveOperators = liveStatus?.live ?? cl.members;
  const totalOperators = liveStatus?.size ?? cl.size;
  const threshold = liveStatus?.threshold ?? 5;
  const quorum = liveStatus?.quorum ?? null;
  const healthy = quorum ? quorum === "ok" : cl.state==="nominal";
  const summary = quorum === "ok"
    ? `Operating nominally. ${liveOperators} of ${totalOperators} operators are live, above the ${threshold}-of-${totalOperators} quorum threshold.`
    : quorum === "degraded"
      ? `Some operators are degraded or offline. ${liveOperators} of ${totalOperators} are live — still above quorum.`
      : quorum === "halted"
        ? `Below quorum. ${liveOperators} of ${totalOperators} operators are live — delegated stake is safe but not earning until quorum is restored.`
        : cl.state==="nominal"
          ? `Operating nominally. All ${cl.members} of ${cl.size} operators are signing vertices on time, well above the 5-of-7 quorum threshold.`
          : cl.state==="maintenance"
            ? `One operator is degraded or offline. ${cl.members} of ${cl.size} are signing — still safely above quorum.`
            : `Below quorum. ${cl.members} of ${cl.size} operators signing — delegated stake is safe but not earning until quorum is restored.`;
  const memberRows = liveStatus?.members?.length
    ? liveStatus.members.map((m) => ({
        handle: shortHex(m.operatorId, 10, 6),
        addrShort: m.operatorId,
        role: m.state,
        rep: null,
        vertexRate: null,
        state: m.state === "active" ? "live" : m.state === "lagging" ? "lag" : m.state,
      }))
    : cl.opMembers;

  return (
    <div className="ms-page">
      <div className="ms-crumb">
        <a href="#/clusters" onClick={()=>go("#/clusters")}>Clusters</a>
        <span>›</span>
        <b>{cl.name}</b>
      </div>

      {/* Ring hero — left: ring + standby tray, right: plain-language health + 4 key stats + stake CTA */}
      <section className="cl-hero">
        <div className="cl-hero__ring">
          <ClusterRing members={ringMembers} threshold={threshold} size={280}/>
          <div className="cl-bench">
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
          </div>
        </div>
        <div className="cl-hero__body">
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
            <span className="cl-rank-badge">#{cl.rank} of 100</span>
            <span className="cap">DVT cluster · {totalOperators} operators · {threshold}-of-{totalOperators} BFT · up to 3 standby</span>
          </div>
          <h1 className="ms-h1" style={{marginTop:4,marginBottom:4}}>{cl.name}</h1>
          <div className="mono" style={{fontSize:11,color:"var(--fg-500)",letterSpacing:"0.03em",marginBottom:8}}>
            C-{String(cl.slot).padStart(3,"0")} · operator-named cluster
          </div>
          <div className="cl-hero__summary">
            <span className="cl-health-dot" style={{background: healthy ? "var(--ok)" : cl.state==="maintenance" ? "var(--warn)" : "var(--err)"}}/>
            <p>{summary}</p>
          </div>

          {/* Recruitment notice */}
          {cl.recruiting ? (
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
              <div className="cl-bigstat__num mono num">{apy.toFixed(2)}%</div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>paid in LYTH · per delegated stake</div>
            </div>
            <div className="cl-bigstat">
              <div className="cap">TVS</div>
              <div className="cl-bigstat__num mono num">{cl.tvs}M</div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>MONO delegated</div>
            </div>
            <div className="cl-bigstat">
              <div className="cap">Reward · 30d</div>
              <div className="cl-bigstat__num mono num" style={{color:"var(--gold)"}}>+{fmt(cl.reward30d)}</div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>MONO distributed</div>
            </div>
            <div className="cl-bigstat">
              <div className="cap">Vertex inclusion</div>
              <div className="cl-bigstat__num mono num" style={{color: cl.vertexInclude>0.98 ? "var(--ok)" : "var(--warn)"}}>{pct(cl.vertexInclude,1)}</div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>clusters tracked</div>
            </div>
          </div>

          <div className="cl-hero__ctas">
            <button className="ov-cta ov-cta--primary" onClick={()=>openWalletStakeIntent(cl)}>Stake with {cl.name}</button>
            <button className="ov-cta" onClick={()=>{ navigator.clipboard?.writeText(cl.aggKey); window.__msToast?.("Cluster aggregate key copied"); }}>Copy cluster key</button>
            <span className="mono" style={{fontSize:10,color:"var(--fg-500)",marginLeft:"auto"}}>
              {cl.aggKey}
            </span>
          </div>
        </div>
      </section>

      <section className="ms-grid-2">
        <Card title="Live protocol descriptor">
          <div className="tx-kv">
            <KVRow label="Cluster id" value={`${liveClusterId}`}/>
            <KVRow label="Quorum" value={liveStatus?.quorum ?? liveCluster?.aggregateHealth ?? "not reported"}/>
            <KVRow label="Live operators" value={liveStatus ? `${liveStatus.live}/${liveStatus.size}` : "—"}/>
            <KVRow label="Active" value={liveStatus ? (liveStatus.live > 0 ? "yes" : "no") : liveCluster ? (liveCluster.active ? "yes" : "no") : "not reported"}/>
            <KVRow label="Stake weight" value={liveCluster?.stake ?? "—"}/>
            <KVRow label="First BLS key" value={liveStatus?.members?.[0]?.blsPubkey ?? liveCluster?.pubkey ?? "—"} mono/>
            <KVRow label="Last update" value={liveStatus ? `${liveStatus.lastUpdateHeight}` : "—"}/>
            <KVRow label="Delegators" value={delegators.data ? `${delegators.data.count}` : "—"}/>
            <KVRow label="Delegation cap" value={delegationCap.data ? (delegationCap.data.capBps === 4294967295 ? "disabled" : `${delegationCap.data.capBps} bps`) : "—"}/>
            <KVRow label="Entity" value={clusterEntity.data?.entity ?? "—"}/>
            <KVRow label="Entity ratchet" value={entityRatchet.data ? `${entityRatchet.data.active}/${entityRatchet.data.threshold === 4294967295 ? "unset" : entityRatchet.data.threshold}` : "—"}/>
          </div>
          <div className="mono" style={{fontSize:10,color:"var(--fg-500)",lineHeight:1.5,marginTop:10}}>
            Cluster status, quorum, and member BLS keys come from public RPC. Rich APY, rewards, and vertex inclusion remain indexer-backed mock data.
          </div>
        </Card>
        <Card title="Members · 7 operators">
          <table className="ms-table">
            <thead><tr><th>Operator</th><th>Role</th><th style={{textAlign:"right"}}>Reputation</th><th style={{textAlign:"right"}}>Vertex rate</th><th></th></tr></thead>
            <tbody>
              {memberRows.map(m=>(
                <tr key={m.addrShort} onClick={()=>go(`#/operator/${encodeURIComponent(m.addrShort)}`)}>
                  <td>
                    <div style={{display:"flex",gap:10,alignItems:"center"}}>
                      <span className="ms-avatar" style={{background:`oklch(0.62 0.16 ${m.handle.charCodeAt(0)*7%360})`}}/>
                      <div>
                        <div style={{fontWeight:500,fontSize:13}}>{m.handle}</div>
                        <div className="mono" style={{fontSize:10,color:"var(--fg-400)"}}>{m.addrShort}</div>
                      </div>
                    </div>
                  </td>
                  <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>{m.role}</td>
                  <td className="mono num" style={{textAlign:"right"}}>{m.rep == null ? "—" : m.rep.toFixed(2)}</td>
                  <td className="mono num" style={{textAlign:"right"}}>{m.vertexRate == null ? "—" : pct(m.vertexRate,1)}</td>
                  <td>
                    <span className="dot" style={{
                      color: m.state==="live"?"var(--ok)":m.state==="lag"?"var(--warn)":"var(--err)"
                    }}/>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

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
      </section>

      <section className="ms-grid-2">
        <Card title="Recent vertices">
          {cl.recentVertices.map((v,i)=>(
            <div key={i} className="ms-vrow">
              <div className="mono" style={{color:"var(--gold)",fontSize:13,minWidth:90}}>r·{fmt(v.round)}</div>
              <div className="mono" style={{flex:1,fontSize:11,color:"var(--fg-300)"}}>
                {v.txCount} txs · DAC {v.dac?"✓":"✗"} · agg {v.blsAggMs.toFixed(1)}ms
              </div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>{v.hashShort}</div>
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
      </section>
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

/* ============== OPERATOR PROFILE ============== */
const OperatorPage = ({ addr, go }: any) => {
  const op = SCAN.operators.find(o => o.addrShort===addr) || SCAN.operators[0];
  const liveOperatorId = /^0x[0-9a-fA-F]{64}$/.test(addr) ? addr : undefined;
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
  const keyRotationLabel = keyRotation
    ? "nextRound" in keyRotation
      ? `round ${keyRotation.nextRound}`
      : keyRotation.reason
    : "—";
  return (
    <div className="ms-page">
      <div className="ms-crumb">
        <a href="#/operators" onClick={()=>go("#/operators")}>Operators</a>
        <span>›</span>
        <b>{op.handle}</b>
      </div>
      <section className="ms-op-hero">
        <span className="ms-avatar ms-avatar--lg" style={{background:`oklch(0.62 0.16 ${op.handle.charCodeAt(0)*9%360})`}}/>
        <div style={{flex:1}}>
          <div className="cap">Operator · stable across clusters</div>
          <h1 className="ms-h1">{op.handle}</h1>
          <div className="mono" style={{color:"var(--fg-300)",marginTop:4}}>
            {op.addrShort} · {op.region} · active since {op.activeSince}
          </div>
        </div>
        <div className="ms-cluster-stats">
          <Stat label="Reputation" value={op.reputation.toFixed(3)}/>
          <Stat label="Uptime · 90d" value={pct(op.uptime,2)} tone="ok"/>
          <Stat label="Bonded" value={`${fmt(op.bonded)} LYTH`}/>
          <Stat label="Slash" value={op.slashes===0 ? "0 · clean" : `${op.slashes}`} tone={op.slashes===0?"ok":"warn"}/>
        </div>
      </section>

      <section className="ms-grid-2">
        <Card title="Cluster memberships">
          <table className="ms-table">
            <thead><tr><th>Cluster</th><th>Role</th><th style={{textAlign:"right"}}>Joined</th><th style={{textAlign:"right"}}>Reward 30d</th></tr></thead>
            <tbody>
              {op.memberships.map(m=>(
                <tr key={m.slot} onClick={()=>go(`#/cluster/${m.slot}`)}>
                  <td className="mono" style={{fontWeight:500}}>C-{String(m.slot).padStart(3,"0")}</td>
                  <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>{m.role}</td>
                  <td className="mono num" style={{textAlign:"right"}}>{m.joined}</td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--gold)"}}>+{fmt(m.reward30d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Live operator telemetry">
          <div className="tx-kv">
            <KVRow label="Operator id" value={liveOperatorId ?? op.addrShort} mono/>
            <KVRow label="Authority index" value={authorityIndex ?? "—"}/>
            <KVRow label="Lifecycle" value={operatorInfo.data?.lifecycleState ?? "—"}/>
            <KVRow label="Bonded amount" value={operatorInfo.data?.bondedAmount ?? "—"} mono/>
            <KVRow label="BLS key" value={authority.data?.blsPubkey ?? operatorInfo.data?.blsKeyFingerprint ?? "—"} mono/>
            <KVRow label="Recent signed/missed" value={signedCount === null ? "—" : `${signedCount}/${missedCount ?? 0}`}/>
            <KVRow label="Miss rate" value={risk.data ? `${(risk.data.missRateBps / 100).toFixed(2)}%` : "—"}/>
            <KVRow label="Jail status" value={jailStatus ?? "—"}/>
            <KVRow label="Next key rotation" value={keyRotationLabel}/>
          </div>
          <div className="mono" style={{fontSize:10,color:"var(--fg-500)",lineHeight:1.5,marginTop:10}}>
            Live telemetry appears when this page is opened from a live cluster member id. Mock operator profiles keep their fixture metrics until the indexer exposes reputation and membership aggregates.
          </div>
        </Card>
        <Card title="Reputation timeline · 12 months">
          <Sparkline data={op.repHist} width={520} height={140} color="var(--ok)"/>
          <div className="mono" style={{fontSize:11,color:"var(--fg-400)",marginTop:10,lineHeight:1.6}}>
            Reputation is a global, slowly-decaying metric — not cluster-bound.
            It moves with vertex inclusion rate, peer RTT, and committed duty completion.
          </div>
        </Card>
      </section>

      <Card title="Service capabilities advertised">
        <div className="ms-caps">
          {Object.entries(op.caps).map(([k,v])=>(
            <div key={k} className={`ms-cap ${v?"is-on":""}`}>
              <span className="ms-cap__check">{v?"✓":"—"}</span>
              <span>{k}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

/* ============== CLUSTERS LIST (rebuilt — human-first) ============== */
/* APY derived from 30d reward / TVS, annualized. */
const clusterApy = (cl) => {
  const tvsMono = parseFloat(cl.tvs) * 1_000_000;
  return (cl.reward30d * 12 / tvsMono) * 100;
};

const ClustersPage = ({go}: any) => {
  const liveClusters = useClusterSet();
  const activeClustersLive = useActiveClusters();
  const healthyClustersLive = useHealthyClusters();
  const delegationCap = useDelegationCap();
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
  const liveDescriptorCount = liveClusters.data?.length ?? null;
  const liveActiveCount = activeClustersLive.data?.length ?? null;
  const liveHealthyCount = healthyClustersLive.data?.length ?? null;
  const totalTvs   = active.reduce((a,c)=>a+parseFloat(c.tvs),0);
  const avgApy     = active.reduce((a,c)=>a+clusterApy(c),0)/active.length;
  const topApy     = Math.max(...active.map(clusterApy));
  const minToEnter = parseFloat(active[active.length-1].tvs);

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
    <div className="ms-page ms-overview">
      {/* ---------- INTRO HERO ---------- */}
      <section className="ov-hero">
        <div className="ov-hero__left">
          <div className="ov-hero__tag">
            <span className="ov-livedot"/>
            <span className="mono" style={{fontSize:11,letterSpacing:"0.14em",textTransform:"uppercase",color:"var(--fg-300)"}}>
              {liveActiveCount ?? active.length} active descriptors · {liveHealthyCount ?? nominal} healthy · 5-of-7 BFT
            </span>
          </div>
          <h1 className="ov-hero__title">
            Pick <span style={{color:"var(--gold)"}}>who secures</span><br/>
            <span style={{color:"var(--fg-300)"}}>your stake.</span>
          </h1>
          <p className="ov-hero__desc">
            Every cluster is a 7-operator DVT set. The protocol elects the top 100 by TVS into the active
            cluster set — others wait in the wings until their stake grows. Stake with any active cluster; your
            delegation will roll over automatically if rankings shift.
          </p>
          <div className="ov-hero__ctas">
            <button onClick={()=>go(`#/cluster/${featured[0]?.slot||1}`)} className="ov-cta ov-cta--primary">Top-yield cluster →</button>
            <button onClick={()=>setFilter("open")} className="ov-cta">● {openCount} open for ops</button>
          </div>
        </div>
        <div className="ov-hero__stats">
          <HeadlineStat label="Active clusters" value={liveActiveCount !== null ? `${liveActiveCount}` : `${active.length}/100`}
            sub={liveDescriptorCount !== null ? `${liveDescriptorCount} descriptors from RPC` : `${inactive.length} inactive · ${jailed.length} jailed`} delta={liveHealthyCount !== null ? `${liveHealthyCount} healthy` : jailed.length===0?"all healthy":`${jailed.length} cooling down`} tone={jailed.length===0?"ok":"err"}/>
          <HeadlineStat label="Total value staked" value={`${totalTvs.toFixed(0)}M LYTH`}
            sub="across active clusters" delta="+0.4M · 24h" tone="gold" accent/>
          <HeadlineStat label="Average APY" value={`${avgApy.toFixed(2)}%`}
            sub={`top cluster · ${topApy.toFixed(2)}%`} delta="paid in LYTH" tone="ok"/>
          <HeadlineStat label="Min TVS to enter top 100" value={`${minToEnter.toFixed(2)}M`}
            sub="ranking updates every epoch" delta={`${openCount} accepting ops`} tone="neutral"/>
          <HeadlineStat label="Delegation cap" value={delegationCap.data ? (delegationCap.data.capBps === 4294967295 ? "off" : `${delegationCap.data.capBps} bps`) : "—"}
            sub={delegationCap.data ? `sampled at block ${Number(delegationCap.data.blockNumber).toLocaleString()}` : "live RPC"} delta="protocol control" tone="neutral"/>
        </div>
      </section>

      {/* ---------- FEATURED CLUSTERS ---------- */}
      <section>
        <div className="ov-feed__head" style={{marginBottom:14}}>
          <div>
            <h3 className="ov-section-title">Featured · top yield among healthy clusters</h3>
            <p className="ov-section-desc">Click any cluster card to see its operator ring, reward streams, and recent vertices.</p>
          </div>
        </div>
        <div className="cl-featured">
          {featured.map(cl=>{
            const apy = clusterApy(cl);
            return (
              <div key={cl.slot} className="cl-card" onClick={()=>go(`#/cluster/${cl.slot}`)}>
                <div className="cl-card__head">
                  <div style={{minWidth:0,flex:1}}>
                    <div style={{display:"flex",alignItems:"baseline",gap:8}}>
                      <div style={{fontSize:15,fontWeight:500,color:"var(--fg-100)",letterSpacing:"-0.005em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{cl.name}</div>
                    </div>
                    <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:2,letterSpacing:"0.03em"}}>
                      <span className="cl-rank">#{cl.rank}</span>
                      <span style={{margin:"0 6px",color:"var(--fg-700)"}}>·</span>
                      C-{String(cl.slot).padStart(3,"0")}
                      <span style={{margin:"0 6px",color:"var(--fg-700)"}}>·</span>
                      {cl.members}/{cl.size} live
                    </div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div className="mono num" style={{fontSize:20,color:"var(--gold)",letterSpacing:"-0.01em"}}>{apy.toFixed(2)}%</div>
                    <div className="mono" style={{fontSize:9.5,color:"var(--fg-500)",letterSpacing:"0.08em"}}>APY</div>
                  </div>
                </div>
                <MiniRing members={cl.opMembers} size={112}/>
                <div className="cl-card__bench mono">
                  <span style={{color:"var(--fg-500)",fontSize:10,letterSpacing:"0.08em"}}>STANDBY</span>
                  {Array.from({length:3}).map((_,b)=>(
                    <span key={b} className={`cl-bench-pip ${b<cl.backupCount?"is-filled":"is-empty"}`}/>
                  ))}
                  <span style={{color:"var(--fg-400)",fontSize:10.5}}>{cl.backupCount}/3</span>
                  {cl.recruiting
                    ? <span className="cl-open-tag">● OPEN · {cl.recruitSeats} seat{cl.recruitSeats>1?"s":""}</span>
                    : <span className="cl-closed-tag">CLOSED</span>}
                </div>
                <div className="cl-card__foot">
                  <div><div className="cap">TVS</div><div className="mono num">{cl.tvs}M</div></div>
                  <div><div className="cap">Reward 30d</div><div className="mono num" style={{color:"var(--gold)"}}>+{fmt(cl.reward30d)}</div></div>
                  <div><div className="cap">Vertex incl.</div><div className="mono num">{pct(cl.vertexInclude,1)}</div></div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---------- ACTIVE / INACTIVE TABBED LIST ---------- */}
      <section>
        <div className="cl-tabs">
          <button className={`cl-tab ${tab==="active"?"is-active":""}`} onClick={()=>switchTab("active")}>
            <span className="cl-tab__label">Active</span>
            <span className="cl-tab__count mono">{active.length}</span>
            <span className="cl-tab__sub">earning rewards</span>
          </button>
          <button className={`cl-tab ${tab==="inactive"?"is-active":""}`} onClick={()=>switchTab("inactive")}>
            <span className="cl-tab__label">Inactive</span>
            <span className="cl-tab__count mono">{inactive.length}</span>
            <span className="cl-tab__sub">{jailed.length} jailed · {queued.length} queued</span>
          </button>
        </div>

        {tab==="active" ? (
          <>
            <p className="ov-section-desc" style={{marginBottom:14,maxWidth:720}}>
              Top 100 by TVS. These are the active clusters earning rewards this epoch. If a cluster is jailed, it drops into Inactive and must complete a 100-round cooldown before re-election.
            </p>
            <div className="cl-chips">
              <div className="cl-chipgroup">
                {[["all",`All · ${active.length}`],["nominal",`Live · ${nominal}`],["maintenance",`Degraded · ${maint}`],["open",`● Open for ops · ${openCount}`]].map(([k,l])=>(
                  <button key={k} className={`cl-chip ${filter===k?"is-active":""}`} onClick={()=>setFilter(k)}>{l}</button>
                ))}
              </div>
              <div className="cl-chipgroup">
                <span className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.1em",marginRight:8}}>SORT BY</span>
                {[["tvs","TVS"],["apy","APY"],["members","Members"],["diversity","Diversity"]].map(([k,l])=>(
                  <button key={k} className={`cl-chip cl-chip--sort ${sort===k?"is-active":""}`} onClick={()=>setSort(k)}>{l}</button>
                ))}
              </div>
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
                  {activeFiltered.map(cl=>(
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
                      <td className="mono num" style={{textAlign:"right",color:"var(--gold)"}}>{clusterApy(cl).toFixed(2)}%</td>
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
              Not earning this epoch. <span style={{color:"var(--state-jail, #ff6b6b)"}}>Jailed</span> clusters were demoted after a slashing event and must stay live for <span style={{color:"var(--fg-200)"}}>100 rounds</span> before they're eligible for re-election. <span style={{color:"var(--fg-300)"}}>Queued</span> clusters are fully formed but sit below the rank-100 threshold of <span style={{color:"var(--fg-200)"}}>{minToEnter.toFixed(2)}M LYTH</span>.
            </p>
            <div className="cl-chips">
              <div className="cl-chipgroup">
                {[["all",`All · ${inactive.length}`],["jailed",`Jailed · ${jailed.length}`],["queued",`Queued · ${queued.length}`]].map(([k,l])=>(
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
                  {inactiveFiltered.map(cl=>{
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
const MiniRing = ({ members, size=110, threshold=5 }: any) => {
  const cx = size/2, cy = size/2;
  const r  = size*0.34;
  const live = members.filter(m=>m.state==="live").length;
  const total = members.length;
  const circ = 2*Math.PI*(r+10);
  const filled = (live/total)*circ;
  const healthy = live>=threshold;
  const stroke = healthy ? "var(--state-nominal, #73d13d)" : "var(--state-jail, #ff6b6b)";
  return (
    <div style={{position:"relative",width:size,height:size,margin:"10px auto 0"}}>
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
          const c = m.state==="live"?"var(--state-nominal, #73d13d)":m.state==="lag"?"var(--state-maintenance, #f2b441)":"var(--state-jail, #ff6b6b)";
          return <circle key={i} cx={x} cy={y} r={6} fill="var(--ink-2, #161428)" stroke={c} strokeWidth="1.5" style={{filter:`drop-shadow(0 0 3px ${c}66)`}}/>;
        })}
      </svg>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
        <div className="mono num" style={{fontSize:14,color:"var(--fg-100)",letterSpacing:"-0.01em"}}>{live}/{total}</div>
        <div className="mono" style={{fontSize:8.5,color:"var(--fg-500)",letterSpacing:"0.12em"}}>LIVE</div>
      </div>
    </div>
  );
};

const OperatorsPage = ({go}: any) => {
  // Live cluster descriptors (id + pubkey + stake + active flag). It's a thin
  // shape compared to the mocked operator profiles below; once the indexer
  // surfaces operator reputation/region/uptime aggregates we can swap the mock
  // list entirely.
  // TODO(monolythium-vision): the SDK does not yet expose operator
  // memberships, region, reputation, or 90d uptime — see plans/monoscan.md
  // Stage 3 + mono-core OI-0070.
  const clusters = useClusterSet();
  const healthyClusters = useHealthyClusters();
  const liveCount = clusters.data?.length ?? null;
  const healthyCount = healthyClusters.data?.length ?? null;
  return (
    <div className="ms-page">
      <h1 className="ms-h1">Operators · {SCAN.operators.length}</h1>
      <div className="mono" style={{color:"var(--fg-400)",marginBottom:18,fontSize:13}}>
        Operators carry stable identity across clusters · reputation follows the address, not the seat.
      </div>
      {liveCount !== null && (
        <div className="mono" style={{color:"var(--fg-500)",marginBottom:14,fontSize:11,letterSpacing:"0.06em"}}>
          live cluster descriptors · {liveCount} descriptor{liveCount===1?"":"s"}
          {healthyCount !== null ? ` · ${healthyCount} healthy` : ""}
        </div>
      )}
      <Card title="">
        <table className="ms-table">
          <thead><tr><th>Operator</th><th>Region</th><th style={{textAlign:"right"}}>Reputation</th><th style={{textAlign:"right"}}>Uptime 90d</th><th style={{textAlign:"right"}}>Bonded</th><th style={{textAlign:"right"}}>Clusters</th><th style={{textAlign:"right"}}>Slash</th></tr></thead>
          <tbody>
            {SCAN.operators.map(op=>(
              <tr key={op.addrShort} onClick={()=>go(`#/operator/${op.addrShort}`)}>
                <td>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <span className="ms-avatar" style={{background:`oklch(0.62 0.16 ${op.handle.charCodeAt(0)*9%360})`}}/>
                    <div>
                      <div style={{fontWeight:500,fontSize:13}}>{op.handle}</div>
                      <div className="mono" style={{fontSize:10,color:"var(--fg-400)"}}>{op.addrShort}</div>
                    </div>
                  </div>
                </td>
                <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>{op.region}</td>
                <td className="mono num" style={{textAlign:"right"}}>{op.reputation.toFixed(3)}</td>
                <td className="mono num" style={{textAlign:"right"}}>{pct(op.uptime,2)}</td>
                <td className="mono num" style={{textAlign:"right"}}>{fmt(op.bonded)}</td>
                <td className="mono num" style={{textAlign:"right"}}>{op.memberships.length}</td>
                <td className="mono num" style={{textAlign:"right",color:op.slashes===0?"var(--ok)":"var(--err)"}}>{op.slashes===0?"0":op.slashes}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

  // Live chain head (2s poll per Stage 3) + chain-strip aggregate (round +
  // block + peers + version + mempool + indexer). Both fall back to a local
  // timer-based mock when the RPC endpoint is unreachable so the strip
  // never freezes during dev.
  // TODO(monolythium-vision): swap the 2s long-poll for `lyth_subscribe`
  // over WebSocket once mono-core OI-0069 lands. The seam lives in
  // `data/hooks.ts::readLatestHeadFromWebSocket` and is feature-flagged
  // behind `VITE_MONOSCAN_USE_WS` (see `sdk/client.ts::isWebSocketEnabled`).
  const head = useChainHead();
  const strip = useChainStrip();
  const [mockRound, setMockRound] = useState(SCAN.consensus.round);
  useEffect(()=>{
    const id = setInterval(()=>setMockRound(r=>r+1), 380);
    return ()=>clearInterval(id);
  },[]);
  const round = strip.data?.round ?? head.data?.round ?? mockRound;

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
  else if (parts[0]==="protocol")   page = <ProtocolPage go={go}/>;
  else if (parts[0]==="wallets")    page = <WalletsPage go={go}/>;
  else if (parts[0]==="wallet")     page = <WalletPage addr={decodeURIComponent(parts[1]||"")} go={go}/>;
  else if (parts[0]==="tx")         page = <TxPage hash={decodeURIComponent(parts[1]||"")} go={go}/>;
  else if (parts[0]==="round")      page = <RoundPage round={parts[1]} go={go}/>;
  else if (parts[0]==="search")     page = <SearchPage q={decodeURIComponent(parts[1]||"")} go={go}/>;
  else if (parts[0]==="ask")        page = <AskPage initialQuery={parts[1] ? decodeURIComponent(parts[1]) : undefined} go={go}/>;
  else page = <Landing go={go}/>;

  return (
    <div className="ms-app">
      <ChainStrip
        round={round}
        latencyMs={SCAN.consensus.commitLatencyP95Ms}
        ratePerSec={SCAN.consensus.ratePerSec}
        signers={SCAN.consensus.signers}
        strip={strip.data ?? null}
      />
      <Header go={go} route={route}/>
      <main className="ms-main">{page}</main>
      <footer className="ms-footer">
        <span>monoscan · public read-only explorer</span>
        <span style={{flex:1}}/>
        <span className="mono">node-pubkey verified · TLS · no tracking</span>
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
