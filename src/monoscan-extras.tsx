/* =====================================================
   Monoscan — Statistics, Wallets, Wallet detail, Tx detail
   Mounted by monoscan-app.tsx. Reads its demo data through
   `./data/mock` until the indexer surfaces (Stage 3, mono-core
   OI-0070) replace each block via `./data/hooks`.
===================================================== */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState as useStateX, useMemo as useMemoX, useEffect as useEffectX } from "react";
import { Card } from "./primitives";
import { MONOSCAN_DATA, MARKETS, NETWORK_STATS, WALLETS, TXS } from "./data/mock";
import { useTxByHashLive, useBlockByNumber, useNetworkStatus } from "./data/hooks";

/* Light helpers — keep local so this file is self-contained */
const _fmt  = (n: any) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const _fmtI = (n: any) => Math.round(n).toLocaleString();
const _abbr = (n: any) => n >= 1e9 ? `${(n/1e9).toFixed(2)}B` : n >= 1e6 ? `${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : _fmt(n);
const _short = (a: any, n=10) => a && a.length > n*2+3 ? `${a.slice(0, n)}…${a.slice(-4)}` : a;

/* Tiny sparkline for stat cards */
const MiniSpark = ({ data, w=120, h=32, stroke="var(--gold)", fill="rgba(242,180,65,0.12)" }: any) => {
  if (!data || !data.length) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const rng = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v,i) => `${(i*step).toFixed(1)},${(h - ((v-min)/rng)*h*0.9 - h*0.05).toFixed(1)}`);
  const d = `M${pts.join(" L")}`;
  const area = `${d} L${w},${h} L0,${h} Z`;
  return (
    <svg width={w} height={h} style={{display:"block"}}>
      <path d={area} fill={fill}/>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5"/>
    </svg>
  );
};

/* Bar sparkline — used for slashing history (mostly zeros with occasional spikes) */
const MiniBars = ({ data, w=120, h=32, fill="var(--err, #ff6b6b)" }: any) => {
  if (!data || !data.length) return null;
  const max = Math.max(...data, 1);
  const step = w / data.length;
  return (
    <svg width={w} height={h} style={{display:"block"}}>
      {data.map((v,i) => v > 0 && (
        <rect key={i} x={i*step} y={h - (v/max)*h*0.9} width={step*0.7} height={(v/max)*h*0.9} fill={fill}/>
      ))}
    </svg>
  );
};

/* =====================================================
   STATISTICS PAGE
===================================================== */
const StatsPage = ({ go }: any) => {
  const S = NETWORK_STATS;
  const t = S.totals;
  // Live counters — best-effort. When the node is reachable, the head round
  // and validator count come from the live RPC; the rest of the page is
  // still mocked aggregate counters (txTotal, walletsTotal, contracts) until
  // mono-core OI-0070 ships an indexer aggregate view.
  // TODO(monolythium-vision): swap mocked aggregate counters for indexer
  // aggregates the moment the indexer surface lands.
  const live = useNetworkStatus();
  const [round, setRound] = useStateX(t.vertices);
  const [txLast24, setTxLast24] = useStateX(t.txLast24);
  useEffectX(() => {
    const id = setInterval(() => {
      setRound(r => r + 1);
      setTxLast24(n => n + Math.floor(Math.random() * 3));
    }, 400);
    return () => clearInterval(id);
  }, []);

  const liveRound = live.data?.round ?? null;
  const liveValidators = live.data?.validatorCount ?? null;
  const livePeers = live.data?.peerCount ?? null;
  const liveMempoolReady = live.data?.mempoolReady ?? null;
  const headRound = liveRound ?? round;

  return (
    <div className="ms-page ms-stats">
      {/* Hero */}
      <section className="stats-hero">
        <div className="stats-hero__left">
          <div className="mono stats-hero__tag">
            <span className="ov-livedot"/> NETWORK · GENESIS {S.network.genesisDate} · {S.network.chainAge}
          </div>
          <h1 className="ov-hero__title">
            Monolythium<br/>
            <span style={{color:"var(--gold)"}}>in numbers.</span>
          </h1>
          <p className="ov-hero__desc">
            Network-wide counters, cumulative flows, and health vitals since genesis.
            Everything a researcher, auditor, or validator candidate needs before they commit capital.
          </p>
        </div>
        <div className="stats-hero__counter">
          <div className="stats-hero__round-label mono">CURRENT ROUND</div>
          <div className="stats-hero__round mono num">{headRound.toLocaleString()}</div>
          <div className="stats-hero__sub mono">
            {liveRound !== null
              ? `live · avg ${_fmtI(S.network.avgRoundsPerDay)} rounds/day`
              : `avg ${_fmtI(S.network.avgRoundsPerDay)} rounds/day`}
          </div>
        </div>
      </section>

      {/* Primary counters grid */}
      <section className="stats-counters">
        <StatCounter label="Transactions · all-time" value={_abbr(t.txTotal)} sub={`${_fmt(txLast24)} in the last 24h`} trend={S.series.tx30d} tone="gold" onClick={()=>{}}/>
        <StatCounter label="Active wallets" value={_fmt(t.walletsTotal)} sub={`${_fmt(t.walletsActive24h)} active in 24h`} tone="neutral" onClick={()=>go("#/wallets")} clickable/>
        <StatCounter
          label="Validators"
          value={liveValidators !== null ? `${liveValidators}` : `${t.clustersActive}/${t.clustersTotal}`}
          sub={
            livePeers !== null
              ? `${livePeers} peers · ${liveMempoolReady ?? 0} ready in mempool`
              : `${t.operators} unique operators`
          }
          tone="neutral"
          onClick={()=>go("#/clusters")}
          clickable
        />
        <StatCounter label="Smart contracts deployed" value={_fmt(t.contracts)} sub={`${t.tokensListed} listed tokens`} tone="neutral"/>
        <StatCounter label="Private vs public txs" value={`${((t.privateTxs/t.txTotal)*100).toFixed(1)}%`} sub={`${_abbr(t.privateTxs)} private · ${_abbr(t.publicTxs)} public`} tone="neutral"/>
        <StatCounter label="Chain age" value={S.network.chainAge} sub={`genesis ${S.network.genesisDate}`} tone="neutral"/>
      </section>

      {/* Economy row */}
      <section>
        <h3 className="ov-section-title">Economy · issuance, rewards, slashing</h3>
        <p className="ov-section-desc">MONO minted as staking rewards, burned via base fees, slashed for operator misbehavior, and still waiting to be claimed.</p>
        <div className="stats-econ-grid">
          <StatBig
            label="Net inflation · since genesis"
            value={_fmt(S.inflation.net)}
            unit="LYTH"
            tone="gold"
            annotation={`+${_fmt(S.inflation.sinceGenesis)} minted · −${_fmt(S.inflation.burn)} burned`}
            chart={<MiniSpark data={S.series.inflation365d} w={260} h={56} stroke="var(--gold)" fill="rgba(242,180,65,0.10)"/>}
            footer={`${(S.inflation.annualizedRate*100).toFixed(2)}% annualized`}
          />
          <StatBig
            label="Rewards · accrued to stakers"
            value={_fmt(S.rewards.accrued)}
            unit="LYTH"
            tone="gold"
            annotation={`${_fmt(S.rewards.claimed)} claimed · ${_fmt(S.rewards.unclaimed)} unclaimed`}
            chart={<MiniSpark data={S.series.rewards30d} w={260} h={56} stroke="var(--gold)" fill="rgba(242,180,65,0.10)"/>}
            footer={`${((S.rewards.unclaimed/S.rewards.accrued)*100).toFixed(1)}% unclaimed (sitting in reward accounts)`}
          />
          <StatBig
            label="Slashed · all-time"
            value={_fmt(S.slashing.totalMono)}
            unit="LYTH"
            tone="err"
            annotation={`${S.slashing.events} slashing events`}
            chart={<MiniBars data={S.series.slash30d} w={260} h={56}/>}
            footer={S.slashing.lastEvent}
          />
        </div>
      </section>

      {/* Secondary tables */}
      <section className="stats-split">
        <div>
          <h3 className="ov-section-title">Activity · last 30 days</h3>
          <Card title="">
            <table className="ms-table stats-table">
              <thead><tr><th>Metric</th><th style={{textAlign:"right"}}>30d total</th><th style={{textAlign:"right"}}>Daily avg</th><th style={{textAlign:"right"}}>Trend</th></tr></thead>
              <tbody>
                <tr>
                  <td>Transactions</td>
                  <td className="mono num" style={{textAlign:"right"}}>{_fmt(S.series.tx30d.reduce((a,v)=>a+v,0))}</td>
                  <td className="mono num" style={{textAlign:"right"}}>{_fmt(Math.floor(S.series.tx30d.reduce((a,v)=>a+v,0)/30))}</td>
                  <td style={{textAlign:"right"}}><MiniSpark data={S.series.tx30d} w={80} h={24}/></td>
                </tr>
                <tr>
                  <td>Staking rewards paid</td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--gold)"}}>{_fmt(S.series.rewards30d.reduce((a,v)=>a+v,0))} LYTH</td>
                  <td className="mono num" style={{textAlign:"right"}}>{_fmt(Math.floor(S.series.rewards30d.reduce((a,v)=>a+v,0)/30))}</td>
                  <td style={{textAlign:"right"}}><MiniSpark data={S.series.rewards30d} w={80} h={24}/></td>
                </tr>
                <tr>
                  <td>Slashing</td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--err)"}}>{_fmt(S.series.slash30d.reduce((a,v)=>a+v,0))} LYTH</td>
                  <td className="mono num" style={{textAlign:"right"}}>{S.series.slash30d.filter(v=>v>0).length} events</td>
                  <td style={{textAlign:"right"}}><MiniBars data={S.series.slash30d} w={80} h={24}/></td>
                </tr>
                <tr>
                  <td>New contracts</td>
                  <td className="mono num" style={{textAlign:"right"}}>43</td>
                  <td className="mono num" style={{textAlign:"right"}}>1.4</td>
                  <td className="mono" style={{textAlign:"right",color:"var(--fg-500)",fontSize:11}}>+3.5% vs prev 30d</td>
                </tr>
                <tr>
                  <td>New wallets</td>
                  <td className="mono num" style={{textAlign:"right"}}>8,142</td>
                  <td className="mono num" style={{textAlign:"right"}}>271</td>
                  <td className="mono" style={{textAlign:"right",color:"var(--fg-500)",fontSize:11}}>+12% vs prev 30d</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </div>
        <div>
          <h3 className="ov-section-title">Health · right now</h3>
          <Card title="">
            <div className="stats-health">
              <HealthRow label="Rounds produced / day" value={_fmtI(S.network.avgRoundsPerDay)} tone="ok"/>
              <HealthRow label="Clusters in jail cooldown" value={`${MONOSCAN_DATA.clusters.filter(c=>c.inactiveReason==="jailed").length}`} tone="warn"/>
              <HealthRow label="Clusters recruiting ops" value={`${MONOSCAN_DATA.clusters.filter(c=>c.recruiting && c.active).length}`} tone="neutral"/>
              <HealthRow label="Avg commit latency (p95)" value="342ms" tone="ok"/>
              <HealthRow label="Last slashing event" value="3 rounds ago" tone="warn"/>
              <HealthRow label="Last halted (emergency)" value="never" tone="ok"/>
              <HealthRow label="Private tx DAC coverage" value="91.4%" tone="ok"/>
              <HealthRow label="Bridge queue · Solana" value="41 pending" tone="neutral"/>
              <HealthRow label="Bridge queue · IBC" value="8 pending" tone="ok"/>
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
};

const StatCounter = ({ label, value, sub, trend, tone, onClick, clickable }: any) => (
  <div className={`stats-counter ${clickable?"is-clickable":""} stats-counter--${tone||"neutral"}`} onClick={onClick}>
    <div className="mono stats-counter__label">{label}</div>
    <div className="mono num stats-counter__value">{value}</div>
    <div className="mono stats-counter__sub">{sub}</div>
    {trend && <div className="stats-counter__spark"><MiniSpark data={trend} w={140} h={28}/></div>}
  </div>
);

const StatBig = ({ label, value, unit, tone, annotation, chart, footer }: any) => (
  <div className={`stats-big stats-big--${tone||"neutral"}`}>
    <div className="mono stats-big__label">{label}</div>
    <div className="stats-big__row">
      <div>
        <div className="mono num stats-big__value">{value} <span className="stats-big__unit">{unit}</span></div>
        <div className="mono stats-big__anno">{annotation}</div>
      </div>
      <div className="stats-big__chart">{chart}</div>
    </div>
    <div className="mono stats-big__foot">{footer}</div>
  </div>
);

const HealthRow = ({ label, value, tone }: any) => (
  <div className="stats-health__row">
    <span className={`stats-health__dot stats-health__dot--${tone}`}/>
    <span className="stats-health__label">{label}</span>
    <span className="mono num stats-health__value">{value}</span>
  </div>
);

/* =====================================================
   WALLETS PAGE — rich list + pie
===================================================== */
const WalletsPage = ({ go }: any) => {
  const wallets = WALLETS;
  const [hover, setHover] = useStateX(null);
  const topSum = wallets.slice(0, 30).reduce((a,w)=>a+w.bal, 0);

  return (
    <div className="ms-page ms-wallets">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"end",gap:24,marginBottom:24}}>
        <div style={{maxWidth:620}}>
          <h1 className="ms-h1">Wallets · rich list</h1>
          <p className="mono" style={{fontSize:12,color:"var(--fg-400)",lineHeight:1.6,marginTop:6}}>
            Top LYTH holders on the public chain. Private LYTH holdings are opaque by design and not shown here. Tagged addresses (exchanges, bridges, treasury) are labeled inline; anonymous whales are shown by address.
          </p>
        </div>
        <div className="mono" style={{fontSize:11,color:"var(--fg-500)",textAlign:"right"}}>
          <div>{_fmt(NETWORK_STATS.totals.walletsTotal)} total wallets</div>
          <div style={{color:"var(--fg-400)"}}>top 30 hold {_abbr(topSum)} LYTH</div>
        </div>
      </div>

      <section className="wl-grid">
        {/* LEFT: pie chart */}
        <Card title="Distribution · top 30 vs. the long tail">
          <div style={{padding:"10px 4px 4px"}}>
            <SupplyPie slices={wallets.pie} hover={hover} setHover={setHover}/>
            <div className="wl-legend">
              {wallets.pie.map((s,i)=>(
                <div key={i} className={`wl-legend__row ${hover===i?"is-hover":""}`} onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(null)}>
                  <span className="wl-legend__dot" style={{background: PIE_COLORS[i % PIE_COLORS.length]}}/>
                  <span className="wl-legend__label">{s.label}</span>
                  <span className="mono num wl-legend__pct">{s.pct.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* RIGHT: rich list */}
        <Card title="">
          <table className="ms-table wl-table">
            <thead><tr>
              <th style={{width:44}}>#</th>
              <th>Address</th>
              <th style={{textAlign:"right"}}>Balance</th>
              <th style={{textAlign:"right"}}>% of supply</th>
              <th style={{textAlign:"right"}}>Tx count</th>
            </tr></thead>
            <tbody>
              {wallets.map((w)=>(
                <tr key={w.addr} onClick={()=>go(`#/wallet/${encodeURIComponent(w.addr)}`)}>
                  <td className="mono" style={{color:w.rank<=3?"var(--gold)":"var(--fg-400)",fontWeight:w.rank<=3?600:400}}>#{w.rank}</td>
                  <td>
                    {w.tag
                      ? <div style={{fontWeight:500,fontSize:13,color:"var(--fg-100)"}}>{w.tag}</div>
                      : <div style={{fontWeight:500,fontSize:13,color:"var(--fg-200)",fontFamily:"var(--f-mono)"}}>{_short(w.addr,14)}</div>}
                    <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:1}}>{w.tag ? _short(w.addr,18) : (w.note || "unlabeled")}</div>
                  </td>
                  <td className="mono num" style={{textAlign:"right"}}>{_fmt(w.bal)} <span style={{color:"var(--fg-500)",fontSize:10}}>LYTH</span></td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--gold)"}}>{w.pct.toFixed(2)}%</td>
                  <td className="mono num" style={{textAlign:"right"}}>{_fmt(w.txCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
};

const PIE_COLORS = [
  "#f2b441", "#e79820", "#c47a0a", "#a66008",
  "#8a84c9", "#6f6ab3", "#544e97", "#3e3974",
  "#5a6b7a", "#414d57",
  "#2a2a3a", "#1a1a24",
];

const SupplyPie = ({ slices, hover, setHover }: any) => {
  const total = slices.reduce((a,s)=>a+s.pct, 0);
  const size = 240;
  const cx = size/2, cy = size/2;
  const r = size*0.42;
  const rInner = r*0.55;
  let acc = 0;
  const paths = slices.map((s,i) => {
    const startA = (acc/total) * Math.PI*2 - Math.PI/2;
    acc += s.pct;
    const endA = (acc/total) * Math.PI*2 - Math.PI/2;
    const large = (endA - startA) > Math.PI ? 1 : 0;
    const isHover = hover === i;
    const exp = isHover ? 6 : 0;
    const mid = (startA + endA) / 2;
    const dx = Math.cos(mid) * exp;
    const dy = Math.sin(mid) * exp;
    const x1 = cx + dx + Math.cos(startA)*r;
    const y1 = cy + dy + Math.sin(startA)*r;
    const x2 = cx + dx + Math.cos(endA)*r;
    const y2 = cy + dy + Math.sin(endA)*r;
    const xi2 = cx + dx + Math.cos(endA)*rInner;
    const yi2 = cy + dy + Math.sin(endA)*rInner;
    const xi1 = cx + dx + Math.cos(startA)*rInner;
    const yi1 = cy + dy + Math.sin(startA)*rInner;
    const d = `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${xi2},${yi2} A${rInner},${rInner} 0 ${large} 0 ${xi1},${yi1} Z`;
    return (
      <path key={i} d={d}
        fill={PIE_COLORS[i % PIE_COLORS.length]}
        opacity={hover===null || isHover ? 1 : 0.4}
        stroke="var(--bg-0, #0d0c18)" strokeWidth="1.5"
        style={{cursor:"pointer", transition:"opacity 180ms"}}
        onMouseEnter={()=>setHover(i)}
        onMouseLeave={()=>setHover(null)}
      />
    );
  });
  const hoverSlice = hover !== null ? slices[hover] : null;
  return (
    <div style={{position:"relative",width:size,height:size,margin:"0 auto"}}>
      <svg width={size} height={size}>{paths}</svg>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",pointerEvents:"none",textAlign:"center",padding:"0 24px"}}>
        {hoverSlice ? (
          <>
            <div className="mono" style={{fontSize:9.5,color:"var(--fg-500)",letterSpacing:"0.1em",textTransform:"uppercase"}}>{hoverSlice.label}</div>
            <div className="mono num" style={{fontSize:22,color:"var(--gold)",marginTop:4}}>{hoverSlice.pct.toFixed(2)}%</div>
          </>
        ) : (
          <>
            <div className="mono" style={{fontSize:9.5,color:"var(--fg-500)",letterSpacing:"0.1em"}}>TOTAL SUPPLY</div>
            <div className="mono num" style={{fontSize:22,color:"var(--fg-100)",marginTop:4}}>870M LYTH</div>
            <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:4}}>(public chain)</div>
          </>
        )}
      </div>
    </div>
  );
};

/* =====================================================
   WALLET DETAIL PAGE
===================================================== */
const WalletPage = ({ addr, go }: any) => {
  const w = WALLETS.find(w => w.addr === addr);
  if (!w) return (
    <div className="ms-page">
      <h1 className="ms-h1">Wallet not found</h1>
      <p className="mono" style={{color:"var(--fg-400)"}}>No such address: <code>{addr}</code></p>
      <button className="ov-cta" onClick={()=>go("#/wallets")}>← Back to rich list</button>
    </div>
  );
  const totalIn  = w.flow30d.reduce((a,d)=>a+d.in, 0);
  const totalOut = w.flow30d.reduce((a,d)=>a+d.out, 0);
  const totalRw  = w.flow30d.reduce((a,d)=>a+d.reward, 0);
  const net      = totalIn - totalOut;

  return (
    <div className="ms-page ms-wallet-detail">
      {/* Hero */}
      <section className="wd-hero">
        <div className="wd-hero__meta">
          <div className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.1em"}}>WALLET · #{w.rank} OF {WALLETS.length}</div>
          <h1 className="wd-hero__title">{w.tag || "Unlabeled wallet"}</h1>
          <div className="mono wd-hero__addr">{w.addr}</div>
          <div className="wd-hero__facts mono">
            <span>First seen · {w.firstSeenAgo}</span>
            <span className="sep"/>
            <span>{_fmt(w.txCount)} transactions</span>
            {w.stakedTo && <><span className="sep"/><span>Delegating to <a onClick={()=>go(`#/cluster/${w.stakedTo.replace("C-","").replace(/^0+/,"")}`)} style={{color:"var(--gold)",cursor:"pointer"}}>{w.stakedTo}</a></span></>}
          </div>
        </div>
        <div className="wd-hero__balances">
          <div className="wd-bal wd-bal--primary">
            <div className="mono wd-bal__label">MONO · public</div>
            <div className="mono num wd-bal__value">{_fmt(w.bal)}</div>
            <div className="mono wd-bal__sub">{w.pct.toFixed(3)}% of supply</div>
          </div>
          {w.extras.map((e,i)=>(
            <div key={i} className="wd-bal">
              <div className="mono wd-bal__label">{e.denom}</div>
              <div className="mono num wd-bal__value">{typeof e.bal === "number" ? _fmt(e.bal) : e.bal}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Flow diagram */}
      <section>
        <h3 className="ov-section-title">30-day flow</h3>
        <p className="ov-section-desc">Inflow, outflow, staking delegations, and rewards earned. Net position {net >= 0 ? "grew" : "shrank"} by {_fmt(Math.abs(net))} LYTH over the period.</p>
        <div className="wd-flow-grid">
          <FlowCard label="In" value={totalIn} unit="LYTH" tone="ok" series={w.flow30d.map(d=>d.in)}/>
          <FlowCard label="Out" value={totalOut} unit="LYTH" tone="err" series={w.flow30d.map(d=>d.out)}/>
          <FlowCard label="Staked" value={w.flow30d.reduce((a,d)=>a+d.stake,0)} unit="LYTH" tone="neutral" series={w.flow30d.map(d=>d.stake)}/>
          <FlowCard label="Rewards" value={totalRw} unit="LYTH" tone="gold" series={w.flow30d.map(d=>d.reward)}/>
        </div>
        <FlowDiagram wallet={w} totalIn={totalIn} totalOut={totalOut} totalRw={totalRw}/>
      </section>

      {/* Recent transactions */}
      <section>
        <h3 className="ov-section-title">Recent transactions</h3>
        <Card title="">
          <table className="ms-table wd-tx-table">
            <thead><tr>
              <th style={{width:40}}></th>
              <th>Hash · kind</th>
              <th>Counterparty</th>
              <th style={{textAlign:"right"}}>Amount</th>
              <th style={{textAlign:"right"}}>Fee</th>
              <th style={{textAlign:"right"}}>When</th>
            </tr></thead>
            <tbody>
              {w.txs.map(t=>(
                <tr key={t.hash} onClick={()=>go(`#/tx/${encodeURIComponent(t.hash)}`)} className={t.status==="failed"?"wd-tx-failed":""}>
                  <td>
                    <span className={`wd-dir wd-dir--${t.direction}`}>
                      {t.direction === "out" ? "↗" : "↙"}
                    </span>
                  </td>
                  <td>
                    <div className="mono" style={{fontSize:12,color:"var(--fg-100)"}}>{_short(t.hash, 12)}</div>
                    <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:1}}>
                      {t.kind}
                      {t.status === "failed" && <span style={{color:"var(--err)",marginLeft:6}}>· failed</span>}
                    </div>
                  </td>
                  <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>{_short(t.counterparty, 14)}</td>
                  <td className="mono num" style={{textAlign:"right",color: t.direction==="out" ? "var(--err, #ff6b6b)" : "var(--ok, #73d13d)"}}>
                    {t.direction==="out" ? "−" : "+"}{_fmt(t.amount)} <span style={{color:"var(--fg-500)",fontSize:10}}>{t.denom}</span>
                  </td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-400)",fontSize:11}}>{t.fee.toFixed(4)}</td>
                  <td className="mono" style={{textAlign:"right",fontSize:11,color:"var(--fg-400)"}}>{t.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
};

const FlowCard = ({ label, value, unit, tone, series }: any) => (
  <div className={`wd-flow-card wd-flow-card--${tone}`}>
    <div className="mono wd-flow-card__label">{label}</div>
    <div className="mono num wd-flow-card__value">{_fmt(value)} <span>{unit}</span></div>
    <MiniSpark
      data={series}
      w={180} h={30}
      stroke={tone==="ok" ? "var(--ok, #73d13d)" : tone==="err" ? "var(--err, #ff6b6b)" : tone==="gold" ? "var(--gold)" : "var(--fg-400)"}
      fill={tone==="ok" ? "rgba(115,209,61,0.10)" : tone==="err" ? "rgba(255,107,107,0.10)" : tone==="gold" ? "rgba(242,180,65,0.10)" : "rgba(255,255,255,0.04)"}
    />
  </div>
);

/* A simple Sankey-ish diagram: inflows → wallet → outflows + stake/reward */
const FlowDiagram = ({ wallet, totalIn, totalOut, totalRw }: any) => {
  // Aggregate top 4 counterparties by volume per direction
  const inParties: Record<string, number> = {};
  const outParties: Record<string, number> = {};
  wallet.txs.forEach((t: any) => {
    const bucket = t.direction === "out" ? outParties : inParties;
    bucket[t.counterparty] = (bucket[t.counterparty] || 0) + t.amount;
  });
  const topIn  = Object.entries(inParties).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const topOut = Object.entries(outParties).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const stake = wallet.flow30d.reduce((a: number, d: any) => a + d.stake, 0);
  const maxIn  = Math.max(...topIn.map(r=>r[1]), 1);
  const maxOut = Math.max(...topOut.map(r=>r[1]), 1);

  return (
    <div className="wd-flow-diagram">
      <div className="wd-flow-col wd-flow-col--in">
        <div className="mono wd-flow-col__title">Top inflows</div>
        {topIn.map(([addr, amt])=>(
          <div key={addr} className="wd-flow-node">
            <div className="wd-flow-node__bar" style={{width:`${(amt/maxIn)*100}%`, background:"var(--ok, #73d13d)"}}/>
            <div className="mono wd-flow-node__addr">{_short(addr, 12)}</div>
            <div className="mono num wd-flow-node__amt">+{_fmt(amt)}</div>
          </div>
        ))}
      </div>

      <div className="wd-flow-center">
        <div className="wd-flow-center__arrows">
          <svg width="100%" height="120" viewBox="0 0 200 120" preserveAspectRatio="none">
            {/* in arrow */}
            <path d="M0,60 Q60,60 100,60" stroke="var(--ok, #73d13d)" strokeWidth="2" fill="none" opacity="0.6"/>
            <path d="M100,60 L200,60" stroke="var(--err, #ff6b6b)" strokeWidth="2" fill="none" opacity="0.6"/>
            {/* stake/reward branches */}
            <path d="M100,60 Q130,20 180,20" stroke="var(--fg-400)" strokeWidth="1.5" fill="none" strokeDasharray="3,3" opacity="0.5"/>
            <path d="M100,60 Q130,100 180,100" stroke="var(--gold)" strokeWidth="1.5" fill="none" strokeDasharray="3,3" opacity="0.6"/>
          </svg>
        </div>
        <div className="wd-flow-center__hub">
          <div className="mono wd-flow-center__label">WALLET</div>
          <div className="mono num wd-flow-center__value">{_abbr(wallet.bal)}</div>
          <div className="mono wd-flow-center__sub">LYTH</div>
        </div>
        <div className="wd-flow-center__badge mono">
          Net · {(totalIn-totalOut) >= 0 ? "+" : "−"}{_fmt(Math.abs(totalIn-totalOut))} LYTH
        </div>
      </div>

      <div className="wd-flow-col wd-flow-col--out">
        <div className="mono wd-flow-col__title">Top outflows</div>
        {topOut.map(([addr, amt])=>(
          <div key={addr} className="wd-flow-node">
            <div className="wd-flow-node__bar" style={{width:`${(amt/maxOut)*100}%`, background:"var(--err, #ff6b6b)"}}/>
            <div className="mono wd-flow-node__addr">{_short(addr, 12)}</div>
            <div className="mono num wd-flow-node__amt">−{_fmt(amt)}</div>
          </div>
        ))}
        {stake > 0 && (
          <div className="wd-flow-node" style={{marginTop:12,borderTop:"1px solid var(--fg-700)",paddingTop:10}}>
            <div className="wd-flow-node__bar" style={{width:`60%`, background:"var(--gold)", opacity:0.6}}/>
            <div className="mono wd-flow-node__addr" style={{color:"var(--gold)"}}>→ staking</div>
            <div className="mono num wd-flow-node__amt">{_fmt(stake)}</div>
          </div>
        )}
        {totalRw > 0 && (
          <div className="wd-flow-node">
            <div className="wd-flow-node__bar" style={{width:`40%`, background:"var(--gold)"}}/>
            <div className="mono wd-flow-node__addr" style={{color:"var(--gold)"}}>← rewards</div>
            <div className="mono num wd-flow-node__amt">+{_fmt(totalRw)}</div>
          </div>
        )}
      </div>
    </div>
  );
};

/* =====================================================
   TRANSACTION DETAIL PAGE
   Tries `eth_getTransactionReceipt` for live status + block + gas first;
   falls back to the mock fixture (full attestation panel) for everything
   the live receipt does not yet expose. The rich indexer trace (logs,
   decoded calldata, sig timeline) lands with mono-core OI-0070.
===================================================== */
const TxPage = ({ hash, go }: any) => {
  const live = useTxByHashLive(hash);
  const liveReceipt = live.data ?? null;
  const fixture = TXS[hash];

  // Merge live receipt over the fixture so the UI always renders a complete
  // shape. When the live node is reachable and returns a real receipt the
  // status / block / gas fields are authoritative; the rest comes from the
  // mocked fixture until OI-0070 ships indexer-side enrichment.
  const tx = liveReceipt
    ? {
        ...(fixture ?? {
          // Bare minimum so the page has something to render when there's
          // no fixture for the hash but the chain has confirmed it.
          hash,
          round: 0,
          roundLabel: "round —",
          when: "live",
          kind: "transfer",
          kindLabel: "Transfer",
          from: "—",
          to: "—",
          amount: 0,
          denom: "LYTH",
          fee: 0,
          feeDenom: "LYTH",
          cluster: "C-001",
          clusterName: "—",
          memo: "",
          nonce: 0,
          quorumSigners: 7,
          quorumRequired: 5,
          dacCoverage: 1,
          signatures: [],
          contractInput: null,
          logs: [],
          gasLimit: 0,
        }),
        // Live overrides — keep the receipt's fields as the source of truth.
        status:
          (typeof (liveReceipt as any).status === "number"
            ? ((liveReceipt as any).status === 1 ? "ok" : "failed")
            : (fixture?.status ?? "ok")),
        gasUsed: Number(
          (liveReceipt as any).gas_used ?? (liveReceipt as any).gasUsed ?? fixture?.gasUsed ?? 0,
        ),
        round: Number(
          (liveReceipt as any).block_number ?? (liveReceipt as any).blockNumber ?? fixture?.round ?? 0,
        ),
        roundLabel:
          (liveReceipt as any).block_number !== undefined ||
          (liveReceipt as any).blockNumber !== undefined
            ? `block ${Number(
                (liveReceipt as any).block_number ?? (liveReceipt as any).blockNumber,
              ).toLocaleString()}`
            : (fixture?.roundLabel ?? "round —"),
      }
    : fixture;

  if (!tx) return (
    <div className="ms-page">
      <h1 className="ms-h1">Transaction not found</h1>
      <p className="mono" style={{color:"var(--fg-400)"}}>No tx with hash: <code>{hash}</code></p>
      {live.isLoading && (
        <p className="mono" style={{color:"var(--fg-500)",fontSize:11,marginTop:6}}>
          checking live receipt…
        </p>
      )}
      <button className="ov-cta" onClick={()=>go("#/")}>← Back to overview</button>
    </div>
  );

  return (
    <div className="ms-page ms-tx-detail">
      {/* Hero */}
      <section className="tx-hero">
        <div className="tx-hero__top">
          <div>
            <div className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.1em"}}>TRANSACTION</div>
            <div className="mono tx-hero__hash">{tx.hash}</div>
          </div>
          <div className="tx-hero__status">
            <span className={`tx-status tx-status--${tx.status}`}>
              {tx.status === "ok" ? "✓ Confirmed" : "✗ Failed"}
            </span>
          </div>
        </div>
        <div className="tx-hero__amount">
          <div className="mono" style={{fontSize:11,color:"var(--fg-500)",letterSpacing:"0.08em",textTransform:"uppercase"}}>{tx.kindLabel}</div>
          <div className="mono num tx-hero__big">{_fmt(tx.amount)} <span>{tx.denom}</span></div>
          <div className="mono" style={{fontSize:12,color:"var(--fg-400)"}}>
            {tx.roundLabel} · {tx.when} · in cluster <a onClick={()=>go(`#/cluster/${tx.cluster.replace("C-","").replace(/^0+/,"")}`)} style={{color:"var(--gold)",cursor:"pointer"}}>{tx.clusterName} ({tx.cluster})</a>
          </div>
        </div>
      </section>

      {/* From → To */}
      <section>
        <div className="tx-flow">
          <div className="tx-flow__end" onClick={()=>go(`#/wallet/${encodeURIComponent(tx.from)}`)}>
            <div className="mono tx-flow__label">FROM</div>
            <div className="mono tx-flow__addr">{_short(tx.from, 16)}</div>
            <div className="mono tx-flow__note">{tagFor(tx.from) || "unlabeled"}</div>
          </div>
          <div className="tx-flow__arrow">
            <svg width="100%" height="24" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0,12 L92,12" stroke="var(--gold)" strokeWidth="2" fill="none"/>
              <path d="M86,6 L92,12 L86,18" stroke="var(--gold)" strokeWidth="2" fill="none"/>
            </svg>
            <div className="mono tx-flow__arrow-label">{_fmt(tx.amount)} {tx.denom}</div>
          </div>
          <div className="tx-flow__end" onClick={()=>go(`#/wallet/${encodeURIComponent(tx.to)}`)}>
            <div className="mono tx-flow__label">TO</div>
            <div className="mono tx-flow__addr">{_short(tx.to, 16)}</div>
            <div className="mono tx-flow__note">{tagFor(tx.to) || "unlabeled"}</div>
          </div>
        </div>
      </section>

      {/* Details grid */}
      <section className="tx-split">
        <Card title="Transaction">
          <div className="tx-kv">
            <KV label="Hash" value={tx.hash} mono/>
            <KV label="Status" value={tx.status === "ok" ? "Confirmed" : "Failed"}/>
            <KV label="Kind" value={tx.kindLabel}/>
            <KV label="Round" value={tx.roundLabel} link={()=>{}} linkLabel="view round →"/>
            <KV label="Timestamp" value={tx.when}/>
            <KV label="Cluster" value={`${tx.clusterName} (${tx.cluster})`} link={()=>go(`#/cluster/${tx.cluster.replace("C-","").replace(/^0+/,"")}`)}/>
            <KV label="Nonce" value={tx.nonce.toString()}/>
            {tx.memo && <KV label="Memo" value={tx.memo}/>}
          </div>
        </Card>
        <Card title="Fees & execution">
          <div className="tx-kv">
            <KV label="Fee" value={`${tx.fee.toFixed(4)} ${tx.feeDenom}`} mono/>
            <KV label="Gas used" value={`${_fmt(tx.gasUsed)} / ${_fmt(tx.gasLimit)}`}/>
            <KV label="Gas efficiency" value={`${((tx.gasUsed/tx.gasLimit)*100).toFixed(1)}%`}/>
            <KV label="Effective rate" value={`${((tx.fee/tx.amount)*10000).toFixed(2)} bp`} />
          </div>
        </Card>
      </section>

      {/* Attestation */}
      <section>
        <h3 className="ov-section-title">Attestation · who signed what</h3>
        <Card title="">
          <div className="tx-attest">
            <div className="tx-attest__summary">
              <div className="tx-attest__badge">
                <div className="mono" style={{fontSize:9.5,color:"var(--fg-500)",letterSpacing:"0.1em"}}>BFT QUORUM</div>
                <div className="mono num" style={{fontSize:22,color:"var(--gold)"}}>{tx.signatures.length}/{tx.quorumSigners}</div>
                <div className="mono" style={{fontSize:10,color:"var(--fg-400)"}}>threshold {tx.quorumRequired}-of-{tx.quorumSigners}</div>
              </div>
              <div className="tx-attest__badge">
                <div className="mono" style={{fontSize:9.5,color:"var(--fg-500)",letterSpacing:"0.1em"}}>DAC COVERAGE</div>
                <div className="mono num" style={{fontSize:22,color:"var(--gold)"}}>{(tx.dacCoverage*100).toFixed(1)}%</div>
                <div className="mono" style={{fontSize:10,color:"var(--fg-400)"}}>erasure-coded shards</div>
              </div>
            </div>
            <div className="tx-attest__sigs">
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.1em",marginBottom:8}}>SIGNATURE TIMELINE · ms after block proposal</div>
              {tx.signatures.map((s,i)=>(
                <div key={i} className="tx-sig-row">
                  <span className="tx-sig-row__dot"/>
                  <span className="mono tx-sig-row__op">{s.op}</span>
                  <div className="tx-sig-row__bar">
                    <div className="tx-sig-row__fill" style={{width:`${(s.ms/30)*100}%`}}/>
                  </div>
                  <span className="mono num tx-sig-row__ms">+{s.ms}ms</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </section>

      {/* Logs + input */}
      {(tx.logs.length > 0 || tx.contractInput) && (
        <section className="tx-split">
          {tx.contractInput && (
            <Card title="Input data">
              <div className="tx-input mono">{tx.contractInput}</div>
            </Card>
          )}
          {tx.logs.length > 0 && (
            <Card title="Events">
              {tx.logs.map((log,i)=>(
                <div key={i} className="tx-log">
                  <div className="mono tx-log__topic">{log.topic}</div>
                  <div className="tx-kv" style={{marginTop:8}}>
                    {Object.entries(log.args).map(([k,v])=>(
                      <KV key={k} label={k} value={typeof v === "number" ? _fmt(v) : String(v)} mono={typeof v === "string"}/>
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </section>
      )}
    </div>
  );
};

const KV = ({ label, value, mono, link, linkLabel }: any) => (
  <div className="tx-kv__row">
    <span className="mono tx-kv__k">{label}</span>
    <span className={`${mono?"mono":""} tx-kv__v`}>
      {value}
      {link && <a onClick={link} style={{marginLeft:10,color:"var(--gold)",cursor:"pointer",fontSize:11}}>{linkLabel || "→"}</a>}
    </span>
  </div>
);

/* =====================================================
   ROUND DETAIL — search-entered round number lands here.
   Looks up the vertex list for that round across all clusters.
===================================================== */
const RoundPage = ({ round, go }: any) => {
  const r = parseInt(round, 10);
  const liveBlock = useBlockByNumber(Number.isFinite(r) ? r : undefined);
  const cur = MONOSCAN_DATA?.consensus?.round || 0;
  const verts = (MONOSCAN_DATA?.recentVertices || []).filter(v => v.round === r);
  const liveHeader: any = liveBlock.data ?? null;
  const found = liveHeader || verts.length > 0 || (r > 0 && r <= cur);
  return (
    <div className="ms-page">
      <button className="ov-cta ov-cta--ghost" onClick={()=>go("#/")} style={{marginBottom:16}}>← Overview</button>
      <h1 className="ms-h1" style={{marginBottom:6}}>Round <span style={{color:"var(--gold)"}}>#{isNaN(r)?round:r.toLocaleString()}</span></h1>
      {!found ? (
        <p className="mono" style={{color:"var(--fg-400)"}}>
          {liveBlock.isLoading
            ? "Checking live block…"
            : `Round not found. Current head is ${cur.toLocaleString()}.`}
        </p>
      ) : (
        <>
          {liveHeader ? (
            <div className="ms-card" style={{padding:"14px 18px",marginBottom:14}}>
              <div className="cap" style={{marginBottom:10,color:"var(--gold)"}}>Live block · eth_getBlockByNumber</div>
              <div className="tx-kv">
                <div className="tx-kv__row">
                  <span className="mono tx-kv__k">Hash</span>
                  <span className="mono tx-kv__v">{liveHeader.hash}</span>
                </div>
                <div className="tx-kv__row">
                  <span className="mono tx-kv__k">Parent</span>
                  <span className="mono tx-kv__v">{liveHeader.parent_hash ?? liveHeader.parentHash ?? "—"}</span>
                </div>
                <div className="tx-kv__row">
                  <span className="mono tx-kv__k">State root</span>
                  <span className="mono tx-kv__v">{liveHeader.state_root ?? liveHeader.stateRoot ?? "—"}</span>
                </div>
                <div className="tx-kv__row">
                  <span className="mono tx-kv__k">Gas used / limit</span>
                  <span className="mono tx-kv__v">
                    {Number(liveHeader.gas_used ?? liveHeader.gasUsed ?? 0).toLocaleString()}
                    {" / "}
                    {Number(liveHeader.gas_limit ?? liveHeader.gasLimit ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="tx-kv__row">
                  <span className="mono tx-kv__k">Timestamp</span>
                  <span className="mono tx-kv__v">{liveHeader.timestamp}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="mono" style={{color:"var(--fg-400)",marginBottom:20}}>
              {verts.length > 0
                ? `${verts.length} cluster vertex${verts.length===1?"":"es"} committed at this round.`
                : `Round committed ~${Math.max(0, (cur - r)).toLocaleString()} rounds ago.`}
            </p>
          )}
          {/*
            Per-vertex breakdown (memos, BLS agg, DAC) is still mock — the
            indexer view that maps round → cluster vertices ships with
            mono-core OI-0070.
            TODO(monolythium-vision): replace this table with the indexer's
            cluster-vertex feed for the requested round.
          */}
          <div className="ms-card" style={{padding:0}}>
            <table className="ms-table">
              <thead><tr><th>Cluster</th><th>Memos</th><th>BLS agg</th><th>DAC</th><th></th></tr></thead>
              <tbody>
                {(verts.length ? verts : (MONOSCAN_DATA?.recentVertices || []).slice(0,6)).map((v,i)=>(
                  <tr key={i} onClick={()=>go(`#/cluster/${v.clusterSlot}`)} style={{cursor:"pointer"}}>
                    <td className="mono">C-{String(v.clusterSlot).padStart(3,"0")}</td>
                    <td className="mono">{v.txCount} settled</td>
                    <td className="mono">{v.blsAggMs.toFixed(1)}ms</td>
                    <td><span className={`pill ${v.dac?"ok":"warn"}`}>{v.dac?"committed":"pending"}</span></td>
                    <td className="mono" style={{color:"var(--fg-500)"}}>→</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

/* =====================================================
   SEARCH RESULTS — freeform query, groups matching clusters,
   operators, wallets, and markets.
===================================================== */
const SearchPage = ({ q, go }: any) => {
  const ql = (q || "").toLowerCase();
  const D: any = MONOSCAN_DATA || {};
  const markets = (MARKETS || []).filter(m =>
    m.sym.toLowerCase().includes(ql) || (m.name||"").toLowerCase().includes(ql)
  );
  const clusters = (D.clusters || []).filter(c =>
    (`C-${String(c.slot).padStart(3,"0")}`).toLowerCase().includes(ql) ||
    (c.name||"").toLowerCase().includes(ql)
  );
  const operators = (D.topOperators || D.operators || []).filter(o =>
    (o.handle||"").toLowerCase().includes(ql) || (o.addrShort||"").toLowerCase().includes(ql)
  );
  const wallets = (D.richList || []).filter(w =>
    (w.addr||"").toLowerCase().includes(ql) || (w.tag||"").toLowerCase().includes(ql)
  );
  const total = markets.length + clusters.length + operators.length + wallets.length;

  const Section = ({ title, items, render }: any) =>
    items.length === 0 ? null : (
      <div className="ms-card" style={{padding:"14px 18px",marginBottom:14}}>
        <div className="cap" style={{marginBottom:10,color:"var(--gold)"}}>{title} · {items.length}</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {items.slice(0,8).map(render)}
        </div>
      </div>
    );

  return (
    <div className="ms-page">
      <button className="ov-cta ov-cta--ghost" onClick={()=>go("#/")} style={{marginBottom:16}}>← Overview</button>
      <h1 className="ms-h1" style={{marginBottom:6}}>Search · <span style={{color:"var(--gold)"}}>"{q}"</span></h1>
      <p className="mono" style={{color:"var(--fg-400)",marginBottom:20}}>
        {total === 0 ? "No matches. Try a round number, C-NNN cluster id, 0x… operator address, or ticker." : `${total} result${total===1?"":"s"}`}
      </p>

      <Section title="Markets" items={markets} render={(m)=>(
        <div key={m.sym} className="ov-moverow" onClick={()=>go(`#/market/${m.sym}`)}>
          <span className="mono" style={{color:"var(--gold)",minWidth:70}}>{m.sym}</span>
          <span style={{flex:1}}>{m.name}</span>
          <span className="mono" style={{color:"var(--fg-400)"}}>${m.price?.toFixed?.(3)}</span>
        </div>
      )}/>

      <Section title="Clusters" items={clusters} render={(c)=>(
        <div key={c.slot} className="ov-moverow" onClick={()=>go(`#/cluster/${c.slot}`)}>
          <span className="mono" style={{color:"var(--gold)",minWidth:70}}>C-{String(c.slot).padStart(3,"0")}</span>
          <span style={{flex:1}}>{c.name}</span>
          <span className="mono" style={{color:"var(--fg-400)"}}>{c.members}/{c.size} live</span>
        </div>
      )}/>

      <Section title="Operators" items={operators} render={(o)=>(
        <div key={o.addrShort} className="ov-moverow" onClick={()=>go(`#/operator/${o.addrShort}`)}>
          <span className="mono" style={{color:"var(--gold)",minWidth:120}}>{o.addrShort}</span>
          <span style={{flex:1}}>{o.handle}</span>
        </div>
      )}/>

      <Section title="Wallets" items={wallets} render={(w)=>(
        <div key={w.addr} className="ov-moverow" onClick={()=>go(`#/wallet/${encodeURIComponent(w.addr)}`)}>
          <span className="mono" style={{color:"var(--gold)",minWidth:200,fontSize:11}}>{w.addr}</span>
          <span style={{flex:1}}>{w.tag || "—"}</span>
        </div>
      )}/>
    </div>
  );
};

const tagFor = (addr) => {
  const w = WALLETS && WALLETS.find(w => w.addr === addr);
  return w?.tag || null;
};

/* Named exports — replaces the legacy window-attach pattern. */
export { StatsPage, WalletsPage, WalletPage, TxPage, RoundPage, SearchPage };
