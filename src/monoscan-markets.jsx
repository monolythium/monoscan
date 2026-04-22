/* =====================================================
   Monoscan · MARKETS
   Top 100 tokens by 24h volume, each with a trading detail
   page (chart + side panel + trades table, SuiVision-style).
   Settlement is on Monarch — every trade has a round +
   attestation quorum. Coinzen is the routing venue.
   ===================================================== */

const { useState, useEffect, useMemo } = React;

/* ----- formatters ----- */
const mkFmt = (n, dp) => {
  if (n == null) return "—";
  const d = dp != null ? dp : n < 1 ? 6 : n < 100 ? 3 : 2;
  return n.toLocaleString(undefined, { minimumFractionDigits:d, maximumFractionDigits:d });
};
const mkMoney = (n) => n < 1 ? `$${n.toFixed(4)}` : n < 100 ? `$${n.toFixed(3)}` : `$${n.toLocaleString(undefined,{maximumFractionDigits:2})}`;
const mkUsd   = (n) => n>=1e9 ? `$${(n/1e9).toFixed(2)}B` : n>=1e6 ? `$${(n/1e6).toFixed(2)}M` : n>=1e3 ? `$${(n/1e3).toFixed(2)}K` : `$${n.toFixed(0)}`;
const mkNum   = (n) => n>=1e9 ? `${(n/1e9).toFixed(2)}B` : n>=1e6 ? `${(n/1e6).toFixed(2)}M` : n>=1e3 ? `${(n/1e3).toFixed(2)}K` : `${n.toFixed(0)}`;
const mkAgo   = (ts) => { const s = (Date.now()-ts)/1000; if (s<60) return `${s|0}s ago`; if (s<3600) return `${(s/60)|0}m ago`; if (s<86400) return `${(s/3600)|0}h ago`; return `${(s/86400)|0}d ago`; };

/* Token glyph — seeded, visually stable */
const TokenMark = ({ sym, size=24 }) => {
  const hue = Math.abs(sym.split("").reduce((a,c)=>a*17+c.charCodeAt(0),7))%360;
  const letter = sym.replace(/[^A-Za-z]/g,"").slice(0,2) || sym.slice(0,2);
  return (
    <span style={{
      width:size, height:size, borderRadius:"50%",
      display:"inline-grid", placeItems:"center",
      background:`oklch(0.62 0.17 ${hue})`,
      color: "#fff", fontFamily:"var(--f-mono)", fontWeight:700,
      fontSize: size*0.42, letterSpacing:"-0.02em",
      boxShadow:`inset 0 1px 0 oklch(0.80 0.10 ${hue}), 0 0 0 1px oklch(0.35 0.10 ${hue})`,
      flexShrink:0,
    }}>{letter}</span>
  );
};

/* Sparkline — positive/negative aware */
const Spark = ({ data, up, w=100, h=28 }) => {
  const min = Math.min(...data), max = Math.max(...data);
  const sx = w/(data.length-1);
  const sy = (v) => max===min ? h/2 : h-((v-min)/(max-min))*h;
  const d = data.map((v,i)=>`${i===0?"M":"L"}${(i*sx).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const color = up ? "var(--ok)" : "var(--err)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{display:"block"}}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
};

/* ---------- MARKETS LIST ---------- */
const MarketsPage = ({ go }) => {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("rank");
  const [dir, setDir] = useState(1);
  const [tab, setTab] = useState("all");

  const tabs = [
    { k:"all",    label:"All markets" },
    { k:"mono",   label:"MONO pairs" },
    { k:"stable", label:"Stables" },
    { k:"bridged",label:"Bridged" },
    { k:"native", label:"Native" },
  ];

  const filtered = useMemo(() => {
    let m = window.MARKETS.slice();
    if (q) {
      const qq = q.toLowerCase();
      m = m.filter(t => t.sym.toLowerCase().includes(qq) || t.name.toLowerCase().includes(qq));
    }
    if (tab==="mono")    m = m.filter(t => t.kind==="mono");
    if (tab==="stable")  m = m.filter(t => t.kind==="stable");
    if (tab==="bridged") m = m.filter(t => /^w[A-Z]/.test(t.sym));
    if (tab==="native")  m = m.filter(t => !/^w[A-Z]/.test(t.sym) && t.kind!=="stable");
    m.sort((a,b) => {
      const A = a[sort], B = b[sort];
      if (typeof A === "string") return dir*(A.localeCompare(B));
      return dir*((A||0) - (B||0));
    });
    return m;
  }, [q, sort, dir, tab]);

  const flip = (k) => { if (sort===k) setDir(-dir); else { setSort(k); setDir(k==="rank"||k==="sym"?1:-1); } };
  const arrow = (k) => sort!==k ? "" : (dir>0 ? " ↑" : " ↓");

  const totalMCAP = window.MARKETS.reduce((a,t)=>a+t.mcap,0);
  const totalVOL  = window.MARKETS.reduce((a,t)=>a+t.vol24h,0);
  const totalLIQ  = window.MARKETS.reduce((a,t)=>a+t.liquidity,0);

  return (
    <div className="ms-page ms-markets">
      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:20,flexWrap:"wrap"}}>
        <div>
          <div className="cap">Markets · settled on monarch-v2</div>
          <h1 className="ms-h1" style={{marginTop:4}}>Top 100 by 24h volume</h1>
          <div className="mono" style={{color:"var(--fg-400)",marginTop:8,fontSize:13,maxWidth:720,lineHeight:1.55}}>
            Orderbook matching happens on-chain. Every fill carries a DAG round and an attestation quorum —
            you can trade from this page and read the receipt in the same place.
          </div>
        </div>
        <div style={{display:"flex",gap:14,alignItems:"flex-end"}}>
          <div style={{textAlign:"right"}}>
            <div className="cap">Total MCAP</div>
            <div className="mono num" style={{fontSize:20,color:"var(--fg-100)",marginTop:2}}>{mkUsd(totalMCAP)}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div className="cap">24H volume</div>
            <div className="mono num" style={{fontSize:20,color:"var(--fg-100)",marginTop:2}}>{mkUsd(totalVOL)}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div className="cap">Total liquidity</div>
            <div className="mono num" style={{fontSize:20,color:"var(--fg-100)",marginTop:2}}>{mkUsd(totalLIQ)}</div>
          </div>
        </div>
      </div>

      {/* filter bar */}
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:2}}>
          {tabs.map(t=>(
            <button key={t.k} onClick={()=>setTab(t.k)}
              className="mono"
              style={{
                padding:"7px 14px",borderRadius:8,border:"1px solid var(--fg-700)",
                background: tab===t.k ? "rgba(242,180,65,0.10)" : "rgba(255,255,255,0.02)",
                color: tab===t.k ? "var(--gold)" : "var(--fg-300)",
                fontSize:11,letterSpacing:"0.06em",cursor:"pointer",textTransform:"uppercase",
              }}>{t.label}</button>
          ))}
        </div>
        <div style={{flex:1}}/>
        <div style={{
          display:"flex",alignItems:"center",gap:8,padding:"7px 12px",
          background:"rgba(255,255,255,0.03)",border:"1px solid var(--fg-700)",
          borderRadius:"var(--r-pill)",minWidth:280,
        }}>
          <span style={{color:"var(--fg-400)",fontSize:12}}>⌕</span>
          <input value={q} onChange={e=>setQ(e.target.value)}
            placeholder="Filter by symbol or name…"
            style={{fontSize:12.5,color:"var(--fg-200)"}}/>
          <span className="mono" style={{color:"var(--fg-500)",fontSize:10,letterSpacing:"0.08em"}}>{filtered.length} / 100</span>
        </div>
      </div>

      <div className="ms-card" style={{padding:0,overflow:"hidden"}}>
        <table className="ms-table ms-table--tight">
          <thead>
            <tr>
              <th onClick={()=>flip("rank")} style={{cursor:"pointer",width:46}}>#{arrow("rank")}</th>
              <th onClick={()=>flip("sym")}  style={{cursor:"pointer"}}>Asset{arrow("sym")}</th>
              <th onClick={()=>flip("price")} style={{cursor:"pointer",textAlign:"right"}}>Price{arrow("price")}</th>
              <th onClick={()=>flip("chg24h")} style={{cursor:"pointer",textAlign:"right",width:92}}>24h{arrow("chg24h")}</th>
              <th style={{textAlign:"center",width:112}}>7d</th>
              <th onClick={()=>flip("vol24h")} style={{cursor:"pointer",textAlign:"right"}}>24h vol{arrow("vol24h")}</th>
              <th onClick={()=>flip("liquidity")} style={{cursor:"pointer",textAlign:"right"}}>Liquidity{arrow("liquidity")}</th>
              <th onClick={()=>flip("mcap")} style={{cursor:"pointer",textAlign:"right"}}>MCAP{arrow("mcap")}</th>
              <th onClick={()=>flip("holders")} style={{cursor:"pointer",textAlign:"right"}}>Holders{arrow("holders")}</th>
              <th style={{textAlign:"right",width:120}}>Settled</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(t => (
              <tr key={t.sym} onClick={()=>go(`#/market/${t.sym}`)}>
                <td className="mono num" style={{color:"var(--fg-500)",fontSize:11.5}}>{t.rank}</td>
                <td>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <TokenMark sym={t.sym} size={26}/>
                    <div style={{minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontWeight:500,color:"var(--fg-100)",fontSize:13}}>{t.sym}</span>
                        {t.verified && <span title="verified" style={{color:"var(--gold)",fontSize:11,lineHeight:1}}>✓</span>}
                      </div>
                      <div className="mono" style={{fontSize:10.5,color:"var(--fg-500)",marginTop:1,letterSpacing:"0.02em"}}>{t.name}</div>
                    </div>
                  </div>
                </td>
                <td className="mono num" style={{textAlign:"right",color:"var(--fg-100)",fontSize:12.5}}>{mkMoney(t.price)}</td>
                <td className="mono num" style={{textAlign:"right",color: t.chg24h>=0?"var(--ok)":"var(--err)", fontSize:12}}>{t.chg24h>=0?"+":""}{t.chg24h.toFixed(2)}%</td>
                <td style={{textAlign:"center"}}>
                  <span style={{display:"inline-block"}}><Spark data={t.sparkline} up={t.chg24h>=0} w={96} h={24}/></span>
                </td>
                <td className="mono num" style={{textAlign:"right",color:"var(--fg-200)",fontSize:12}}>{mkUsd(t.vol24h)}</td>
                <td className="mono num" style={{textAlign:"right",color:"var(--fg-300)",fontSize:12}}>{mkUsd(t.liquidity)}</td>
                <td className="mono num" style={{textAlign:"right",color:"var(--fg-300)",fontSize:12}}>{mkUsd(t.mcap)}</td>
                <td className="mono num" style={{textAlign:"right",color:"var(--fg-400)",fontSize:12}}>{mkNum(t.holders)}</td>
                <td className="mono" style={{textAlign:"right",fontSize:11,color:"var(--fg-400)"}}>
                  <span style={{display:"inline-flex",alignItems:"center",gap:5}}>
                    <span className="dot" style={{color:"var(--ok)",width:5,height:5}}/>
                    round {t.trades[0].round.toLocaleString()}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mono" style={{color:"var(--fg-500)",fontSize:11,textAlign:"center",letterSpacing:"0.04em",padding:"6px 0"}}>
        Listing policy: top 100 markets by rolling 24h volume · re-ranked every 240 rounds · full list on the Monoscan API
      </div>
    </div>
  );
};

/* ---------- MARKET DETAIL ---------- */
const MarketPage = ({ sym, go }) => {
  const tkn = window.MARKETS.find(m => m.sym === sym) || window.MARKETS[0];
  const [range, setRange] = useState("1D");
  const [orderSide, setOrderSide] = useState("buy");
  const [orderType, setOrderType] = useState("limit");

  const ranges = ["1H","4H","1D","7D","1M","1Y","All"];
  const chg = tkn.chg24h;
  const up = chg >= 0;

  // chart
  const ohlc = tkn.ohlc;
  const closes = ohlc.map(c=>c.c);
  const chartLo = Math.min(...closes)*0.996;
  const chartHi = Math.max(...closes)*1.004;
  const W = 900, H = 320;
  const sx = (i) => (i / (closes.length - 1)) * (W - 48);
  const sy = (v) => H - ((v - chartLo) / (chartHi - chartLo)) * (H - 20) - 10;
  const linePath = closes.map((v,i)=>`${i===0?"M":"L"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${sx(closes.length-1).toFixed(1)},${H} L0,${H} Z`;
  const mid = tkn.price;
  const midY = sy(mid);

  // orderbook derived from trades — make plausible levels
  const bookLevels = 9;
  const asks = Array.from({length:bookLevels},(_,i)=>{
    const px = +(mid + tkn.tick*(i+1)).toFixed(mid<1?6:mid<100?3:2);
    const sz = 40 + ((i*37 + sym.length*11) % 7) * 60 + i*25;
    return { px, sz, total:0 };
  });
  const bids = Array.from({length:bookLevels},(_,i)=>{
    const px = +(mid - tkn.tick*(i+1)).toFixed(mid<1?6:mid<100?3:2);
    const sz = 40 + ((i*29 + sym.length*7) % 7) * 65 + i*22;
    return { px, sz, total:0 };
  });
  let aT=0, bT=0;
  asks.forEach(a=>{ aT+=a.sz; a.total=aT; });
  bids.forEach(b=>{ bT+=b.sz; b.total=bT; });
  const maxT = Math.max(aT, bT);

  const buyVol  = tkn.trades.filter(t=>t.side==="buy").reduce((a,t)=>a+t.value,0);
  const sellVol = tkn.trades.filter(t=>t.side==="sell").reduce((a,t)=>a+t.value,0);

  return (
    <div className="ms-page ms-market">
      <div className="ms-crumb">
        <a href="#/markets" onClick={()=>go("#/markets")}>Markets</a>
        <span>›</span>
        <b>{tkn.sym}</b>
      </div>

      {/* HEADER */}
      <section style={{display:"flex",alignItems:"center",gap:18,flexWrap:"wrap",padding:"14px 0 10px"}}>
        <TokenMark sym={tkn.sym} size={56}/>
        <div style={{minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <h1 className="ms-h1" style={{fontSize:30,margin:0,letterSpacing:"-0.02em"}}>{tkn.name}</h1>
            <span className="mono" style={{color:"var(--fg-400)",fontSize:18,letterSpacing:"0.02em"}}>({tkn.sym})</span>
            {tkn.verified && <span className="pill ok" style={{fontSize:10.5}}>✓ verified</span>}
          </div>
          <div className="mono" style={{display:"flex",alignItems:"center",gap:10,marginTop:6,color:"var(--fg-400)",fontSize:11.5,letterSpacing:"0.02em"}}>
            <span style={{padding:"3px 8px",background:"rgba(255,255,255,0.04)",border:"1px solid var(--fg-700)",borderRadius:4}}>{tkn.contract}</span>
            <span style={{cursor:"pointer",color:"var(--fg-300)"}} title="copy">⎘</span>
            <span style={{cursor:"pointer",color:"var(--fg-300)"}}>Try API ↗</span>
            <span>·</span>
            <span>listed {tkn.age.days}d ago</span>
          </div>
        </div>
        <div style={{flex:1}}/>
        <div style={{textAlign:"right"}}>
          <div className="mono num" style={{fontSize:28,color:"var(--fg-100)",letterSpacing:"-0.02em",fontWeight:300}}>{mkMoney(tkn.price)}</div>
          <div className="mono" style={{fontSize:12,marginTop:2,color: up?"var(--ok)":"var(--err)"}}>{up?"▲":"▼"} {Math.abs(chg).toFixed(3)}% · 24h</div>
        </div>
      </section>

      {/* QUICK STATS STRIP */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,minmax(0,1fr))",gap:10,padding:"10px 0"}}>
        {[
          ["Price", mkMoney(tkn.price), up?"var(--ok)":"var(--err)", `${chg>=0?"+":""}${chg.toFixed(2)}%`],
          ["Liquidity", mkUsd(tkn.liquidity)],
          ["24h volume", mkUsd(tkn.vol24h)],
          ["MCAP", mkUsd(tkn.mcap)],
          ["Holders", mkNum(tkn.holders)],
          ["Age", `${tkn.age.days}d`],
        ].map(([k,v,col,sub])=>(
          <div key={k} style={{padding:"10px 14px",borderRadius:8,border:"1px solid var(--fg-700)",background:"rgba(255,255,255,0.02)"}}>
            <div className="cap" style={{fontSize:9.5}}>{k}</div>
            <div className="mono num" style={{fontSize:15,color:"var(--fg-100)",marginTop:3}}>{v}</div>
            {sub && <div className="mono num" style={{fontSize:10.5,color:col,marginTop:2}}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* MAIN : chart + swap */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 340px",gap:16}}>
        {/* Chart */}
        <div className="ms-card" style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <div style={{display:"flex",gap:2,padding:2,background:"rgba(255,255,255,0.03)",borderRadius:8,border:"1px solid var(--fg-700)"}}>
              {["Line","Candle"].map((t,i)=>(
                <span key={t} className="mono"
                  style={{padding:"4px 10px",fontSize:10.5,letterSpacing:"0.04em",borderRadius:6,
                    background: i===0 ? "rgba(242,180,65,0.12)" : "transparent",
                    color: i===0 ? "var(--gold)" : "var(--fg-400)",cursor:"pointer"}}>{t}</span>
              ))}
            </div>
            <div style={{flex:1}}/>
            <div style={{display:"flex",gap:2,padding:2,background:"rgba(255,255,255,0.03)",borderRadius:8,border:"1px solid var(--fg-700)"}}>
              {ranges.map(r=>(
                <button key={r} onClick={()=>setRange(r)} className="mono"
                  style={{padding:"4px 10px",fontSize:10.5,letterSpacing:"0.04em",borderRadius:6,
                    background: range===r ? "rgba(242,180,65,0.12)" : "transparent",
                    color: range===r ? "var(--gold)" : "var(--fg-400)",cursor:"pointer",border:0}}>{r}</button>
              ))}
            </div>
          </div>

          <div style={{position:"relative",height:320,borderRadius:8,background:"linear-gradient(180deg, rgba(0,0,0,0.35), rgba(0,0,0,0.1))",overflow:"hidden"}}>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{position:"absolute",inset:0,width:"100%",height:"100%"}}>
              <defs>
                <linearGradient id="mkArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={up ? "oklch(0.78 0.14 155)" : "oklch(0.70 0.20 22)"} stopOpacity="0.28"/>
                  <stop offset="100%" stopColor={up ? "oklch(0.78 0.14 155)" : "oklch(0.70 0.20 22)"} stopOpacity="0"/>
                </linearGradient>
              </defs>
              {/* gridlines */}
              {[0.2,0.4,0.6,0.8].map((f,i)=>(
                <line key={i} x1="0" y1={H*f} x2={W-48} y2={H*f} stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4"/>
              ))}
              <path d={areaPath} fill="url(#mkArea)"/>
              <path d={linePath} fill="none" stroke={up ? "oklch(0.78 0.14 155)" : "oklch(0.70 0.20 22)"} strokeWidth="1.4"/>
              {/* current price marker */}
              <line x1="0" y1={midY} x2={W-48} y2={midY} stroke={up ? "oklch(0.78 0.14 155)" : "oklch(0.70 0.20 22)"} strokeDasharray="3 3" strokeOpacity="0.6"/>
              <rect x={W-48} y={midY-9} width="46" height="18" rx="3" fill={up ? "oklch(0.78 0.14 155)" : "oklch(0.70 0.20 22)"}/>
              <text x={W-25} y={midY+4} fontFamily="var(--f-mono)" fontSize="10" textAnchor="middle" fill="#0a0a14" fontWeight="600">{mkFmt(mid)}</text>
              {/* Y-axis ticks on right */}
              {[0.15,0.35,0.55,0.75,0.92].map((f,i)=>{
                const v = chartHi - f*(chartHi-chartLo);
                return <text key={i} x={W-4} y={H*f+3} fontFamily="var(--f-mono)" fontSize="9.5" textAnchor="end" fill="var(--fg-500)">{mkFmt(v)}</text>;
              })}
              {/* time axis */}
              {["13:00","16:00","19:00","22:00","01:00","04:00","07:00","10:00"].map((t,i)=>(
                <text key={t} x={20 + i*((W-68)/7)} y={H-3} fontFamily="var(--f-mono)" fontSize="9" fill="var(--fg-500)">{t}</text>
              ))}
            </svg>
            <div className="mono" style={{position:"absolute",left:12,top:10,fontSize:10.5,color:"var(--fg-400)",letterSpacing:"0.06em",display:"flex",alignItems:"center",gap:10}}>
              <span><span className="dot" style={{color:"var(--ok)",width:5,height:5,marginRight:6}}/>live · round {tkn.trades[0].round.toLocaleString()}</span>
              <span>commit {tkn.trades[0].round%1000}ms ago</span>
            </div>
          </div>

          {/* volume strip */}
          <div style={{height:60,position:"relative",borderRadius:8,background:"rgba(0,0,0,0.25)",border:"1px solid var(--fg-700)",overflow:"hidden"}}>
            <svg viewBox={`0 0 ${W} 60`} preserveAspectRatio="none" style={{position:"absolute",inset:0,width:"100%",height:"100%"}}>
              {ohlc.map((c,i)=>{
                const x = sx(i);
                const bw = (W-48)/ohlc.length*0.8;
                const up2 = c.c >= c.o;
                const vol = (c.h - c.l) * 240 + 12;
                const vh = Math.min(56, vol);
                return <rect key={i} x={x} y={60-vh} width={bw} height={vh} fill={up2?"oklch(0.78 0.14 155)":"oklch(0.70 0.20 22)"} opacity="0.35"/>;
              })}
            </svg>
            <div className="cap" style={{position:"absolute",left:10,top:6,fontSize:9}}>VOL · {tkn.sym}</div>
          </div>
        </div>

        {/* Swap / order panel */}
        <div className="ms-card" style={{padding:14,display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{display:"flex",gap:2,padding:2,background:"rgba(255,255,255,0.03)",borderRadius:8,border:"1px solid var(--fg-700)"}}>
              {["swap","limit","market"].map(t=>(
                <button key={t} onClick={()=>setOrderType(t)} className="mono"
                  style={{padding:"5px 10px",fontSize:10.5,letterSpacing:"0.06em",textTransform:"uppercase",borderRadius:6,
                    background: orderType===t ? "rgba(242,180,65,0.12)" : "transparent",
                    color: orderType===t ? "var(--gold)" : "var(--fg-400)",cursor:"pointer",border:0}}>{t}</button>
              ))}
            </div>
            <span className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.06em"}}>slippage 0.50%</span>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            <button onClick={()=>setOrderSide("buy")} className="mono"
              style={{padding:"8px 0",fontSize:11,letterSpacing:"0.08em",borderRadius:6,cursor:"pointer",border:0,
                background: orderSide==="buy" ? "oklch(0.78 0.14 155)" : "rgba(255,255,255,0.04)",
                color: orderSide==="buy" ? "#052014" : "var(--fg-300)",fontWeight:600}}>BUY · LONG</button>
            <button onClick={()=>setOrderSide("sell")} className="mono"
              style={{padding:"8px 0",fontSize:11,letterSpacing:"0.08em",borderRadius:6,cursor:"pointer",border:0,
                background: orderSide==="sell" ? "oklch(0.70 0.20 22)" : "rgba(255,255,255,0.04)",
                color: orderSide==="sell" ? "#220a0a" : "var(--fg-300)",fontWeight:600}}>SELL · SHORT</button>
          </div>

          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:"rgba(255,255,255,0.03)",borderRadius:8,border:"1px solid var(--fg-700)"}}>
            <div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.08em",textTransform:"uppercase"}}>You pay</div>
              <input readOnly value="0" className="mono num" style={{fontSize:20,color:"var(--fg-100)",fontWeight:300,marginTop:2,width:"100%"}}/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"rgba(255,255,255,0.03)",borderRadius:6,border:"1px solid var(--fg-700)"}}>
              <TokenMark sym="USDC" size={22}/>
              <span className="mono" style={{fontSize:12,fontWeight:500}}>USDC</span>
              <span style={{color:"var(--fg-400)",fontSize:11}}>▾</span>
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",padding:"0 4px",fontSize:10,color:"var(--fg-500)"}}>
            <span className="mono">Balance 0 · <span style={{color:"var(--gold)",cursor:"pointer"}}>half</span> · <span style={{color:"var(--gold)",cursor:"pointer"}}>max</span></span>
            <span className="mono">≈ $0</span>
          </div>

          <div style={{textAlign:"center",color:"var(--fg-500)",margin:"-2px 0"}}>
            <span style={{display:"inline-block",width:30,height:30,borderRadius:"50%",background:"rgba(255,255,255,0.04)",border:"1px solid var(--fg-700)",lineHeight:"28px"}}>↓</span>
          </div>

          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:"rgba(255,255,255,0.03)",borderRadius:8,border:"1px solid var(--fg-700)"}}>
            <div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.08em",textTransform:"uppercase"}}>You receive</div>
              <input readOnly value="0" className="mono num" style={{fontSize:20,color:"var(--fg-100)",fontWeight:300,marginTop:2,width:"100%"}}/>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"rgba(255,255,255,0.03)",borderRadius:6,border:"1px solid var(--fg-700)"}}>
              <TokenMark sym={tkn.sym} size={22}/>
              <span className="mono" style={{fontSize:12,fontWeight:500}}>{tkn.sym}</span>
              <span style={{color:"var(--fg-400)",fontSize:11}}>▾</span>
            </div>
          </div>

          <button className="mono" onClick={()=>window.__msToast?.("Opens Monarch wallet extension — not part of this preview")} style={{
            marginTop:6,padding:"12px 0",background:"linear-gradient(180deg, var(--gold), #c98e22)",
            color:"#1a0f00",fontWeight:600,borderRadius:8,cursor:"pointer",border:0,
            fontSize:12,letterSpacing:"0.08em",textTransform:"uppercase",
          }}>Connect wallet</button>

          <div className="mono" style={{fontSize:10,color:"var(--fg-500)",paddingTop:8,borderTop:"1px solid var(--fg-700)",display:"grid",gridTemplateColumns:"1fr auto",rowGap:3}}>
            <span>Rate</span><span style={{color:"var(--fg-300)"}}>1 {tkn.sym} ≈ {mkMoney(tkn.price)}</span>
            <span>Route</span><span style={{color:"var(--fg-300)"}}>coinzen · pool #14</span>
            <span>Maker · taker</span><span style={{color:"var(--fg-300)"}}>0.02% · 0.05%</span>
            <span>Settles</span><span style={{color:"var(--ok)"}}>~1 round · 340ms</span>
            <span>Attestation</span><span style={{color:"var(--ok)"}}>quorum 11/11 · SLH-DSA</span>
          </div>
        </div>
      </div>

      {/* TRADES + ORDERBOOK + INFO */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:16}}>
        {/* LEFT: trade activity tabs */}
        <div className="ms-card" style={{padding:0,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",gap:18,padding:"10px 14px",borderBottom:"1px solid var(--fg-700)"}}>
            {["Trades","Traders","Holders","Pools","Makers"].map((t,i)=>(
              <span key={t} className="mono" style={{
                fontSize:11.5,letterSpacing:"0.04em",cursor:"pointer",position:"relative",padding:"4px 0",
                color: i===0 ? "var(--fg-100)" : "var(--fg-400)",fontWeight: i===0 ? 600:400,
              }}>{t}
                {i===0 && <span style={{position:"absolute",left:0,right:0,bottom:-11,height:2,background:"var(--gold)",boxShadow:"0 0 8px var(--gold-bg)",borderRadius:2}}/>}
              </span>
            ))}
            <div style={{flex:1}}/>
            <label className="mono" style={{display:"flex",alignItems:"center",gap:6,fontSize:10.5,color:"var(--fg-400)",letterSpacing:"0.04em"}}>
              <span style={{width:10,height:10,borderRadius:3,border:"1px solid var(--fg-500)",background:"var(--ok)",boxShadow:"0 0 6px var(--ok)"}}/>
              Realtime activity
            </label>
          </div>

          {/* Buy/sell summary bar — SuiVision-esque */}
          <div style={{display:"flex",gap:20,padding:"10px 14px",borderBottom:"1px solid var(--fg-700)",background:"rgba(0,0,0,0.1)"}}>
            {[
              ["30m", -0.03, 82, 94],
              ["1h",  +0.12, 118, 103],
              ["4h",  +0.41, 412, 388],
              ["24h", tkn.chg24h, 68460, 71220],
            ].map(([p,c,b,s],i)=>(
              <div key={i} style={{flex:1}}>
                <div className="cap" style={{fontSize:9}}>{p}</div>
                <div className="mono num" style={{fontSize:13,color: c>=0?"var(--ok)":"var(--err)",marginTop:3}}>{c>=0?"+":""}{c.toFixed(2)}%</div>
                <div style={{display:"flex",gap:2,height:4,marginTop:5,borderRadius:2,overflow:"hidden"}}>
                  <div style={{flex:b,background:"oklch(0.78 0.14 155)"}}/>
                  <div style={{flex:s,background:"oklch(0.70 0.20 22)"}}/>
                </div>
                <div className="mono" style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--fg-500)",marginTop:3}}>
                  <span style={{color:"var(--ok)"}}>{mkNum(b)}</span>
                  <span style={{color:"var(--err)"}}>{mkNum(s)}</span>
                </div>
              </div>
            ))}
          </div>

          <div style={{maxHeight:520,overflow:"auto"}}>
            <table className="ms-table ms-table--tight">
              <thead>
                <tr>
                  <th style={{width:90}}>Time</th>
                  <th style={{width:60}}>Type</th>
                  <th style={{textAlign:"right"}}>Price</th>
                  <th style={{textAlign:"right"}}>Value</th>
                  <th style={{textAlign:"right"}}>Amount</th>
                  <th>Maker / Taker</th>
                  <th style={{width:98}}>Round · attest</th>
                  <th style={{textAlign:"right",width:70}}>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {tkn.trades.map((t,i)=>(
                  <tr key={i} onClick={()=>go(`#/round/${t.round}`)}>
                    <td className="mono" style={{color:"var(--fg-400)",fontSize:11}}>{mkAgo(t.t)}</td>
                    <td>
                      <span className="mono" style={{
                        padding:"2px 7px",borderRadius:3,fontSize:10,letterSpacing:"0.06em",fontWeight:500,
                        background: t.side==="buy" ? "oklch(0.78 0.14 155 / 0.14)" : "oklch(0.70 0.20 22 / 0.14)",
                        color: t.side==="buy" ? "var(--ok)" : "var(--err)",
                        border: `1px solid ${t.side==="buy" ? "oklch(0.78 0.14 155 / 0.3)" : "oklch(0.70 0.20 22 / 0.3)"}`,
                      }}>{t.side.toUpperCase()}</span>
                    </td>
                    <td className="mono num" style={{textAlign:"right",color: t.side==="buy"?"var(--ok)":"var(--err)",fontSize:12}}>{mkMoney(t.px)}</td>
                    <td className="mono num" style={{textAlign:"right",color:"var(--fg-200)",fontSize:11.5}}>${t.value.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
                    <td className="mono num" style={{textAlign:"right",color:"var(--fg-300)",fontSize:11.5}}>{mkNum(t.sz)} {tkn.sym}</td>
                    <td>
                      <div style={{display:"flex",alignItems:"center",gap:8,fontSize:10.5}}>
                        <span className="mono" style={{color:"var(--fg-300)",padding:"2px 6px",background:"rgba(255,255,255,0.03)",borderRadius:3}}>{t.maker}</span>
                        <span style={{color:"var(--fg-500)"}}>→</span>
                        <span className="mono" style={{color:"var(--fg-300)",padding:"2px 6px",background:"rgba(255,255,255,0.03)",borderRadius:3}}>{t.taker}</span>
                        <span className="mono" style={{color:"var(--fg-500)",fontSize:10,letterSpacing:"0.06em"}}>via {t.venue}</span>
                      </div>
                    </td>
                    <td>
                      <div className="mono" style={{display:"flex",flexDirection:"column",gap:2,fontSize:10}}>
                        <span style={{color:"var(--fg-200)"}}>#{t.round.toLocaleString()}</span>
                        <span style={{color: t.attest==="attested"?"var(--ok)":"var(--warn)",letterSpacing:"0.06em"}}>
                          {t.attest==="attested" ? "● attested · 11/11" : `◐ ${t.attest}`}
                        </span>
                      </div>
                    </td>
                    <td className="mono" style={{textAlign:"right",color:"var(--gold)",fontSize:10.5}}>↗</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: orderbook + meta */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div className="ms-card" style={{padding:"12px 14px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <h3 style={{margin:0,fontSize:13,fontWeight:500}}>Order book</h3>
              <span className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.06em"}}>tick {tkn.tick}</span>
            </div>
            <div className="mono" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",fontSize:9.5,color:"var(--fg-500)",letterSpacing:"0.08em",textTransform:"uppercase",paddingBottom:6,borderBottom:"1px solid var(--fg-700)"}}>
              <span>Price</span><span style={{textAlign:"right"}}>Size</span><span style={{textAlign:"right"}}>Total</span>
            </div>
            {/* asks */}
            <div style={{display:"flex",flexDirection:"column-reverse"}}>
              {asks.map((a,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",padding:"3px 0",fontSize:11,position:"relative"}}>
                  <span style={{position:"absolute",right:0,top:0,bottom:0,width:`${(a.total/maxT)*100}%`,background:"oklch(0.70 0.20 22 / 0.10)"}}/>
                  <span className="mono num" style={{color:"var(--err)",position:"relative"}}>{mkFmt(a.px)}</span>
                  <span className="mono num" style={{textAlign:"right",color:"var(--fg-300)",position:"relative"}}>{mkNum(a.sz)}</span>
                  <span className="mono num" style={{textAlign:"right",color:"var(--fg-500)",position:"relative"}}>{mkNum(a.total)}</span>
                </div>
              ))}
            </div>
            <div style={{padding:"7px 0",margin:"4px 0",borderTop:"1px solid var(--fg-700)",borderBottom:"1px solid var(--fg-700)",display:"flex",alignItems:"center",gap:8}}>
              <span className="mono num" style={{fontSize:14,color: up?"var(--ok)":"var(--err)",fontWeight:500}}>{mkFmt(mid)}</span>
              <span className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.06em"}}>{up?"↑":"↓"} {Math.abs(chg).toFixed(2)}%</span>
              <span style={{flex:1}}/>
              <span className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>spread {(tkn.tick*2).toFixed(3)}</span>
            </div>
            {/* bids */}
            {bids.map((b,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",padding:"3px 0",fontSize:11,position:"relative"}}>
                <span style={{position:"absolute",right:0,top:0,bottom:0,width:`${(b.total/maxT)*100}%`,background:"oklch(0.78 0.14 155 / 0.10)"}}/>
                <span className="mono num" style={{color:"var(--ok)",position:"relative"}}>{mkFmt(b.px)}</span>
                <span className="mono num" style={{textAlign:"right",color:"var(--fg-300)",position:"relative"}}>{mkNum(b.sz)}</span>
                <span className="mono num" style={{textAlign:"right",color:"var(--fg-500)",position:"relative"}}>{mkNum(b.total)}</span>
              </div>
            ))}
            <div className="mono" style={{marginTop:10,paddingTop:8,borderTop:"1px solid var(--fg-700)",fontSize:10,color:"var(--fg-500)"}}>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>Buy depth</span><span style={{color:"var(--ok)"}}>{mkUsd(buyVol)}</span></div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}><span>Sell depth</span><span style={{color:"var(--err)"}}>{mkUsd(sellVol)}</span></div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}><span>Venues</span><span style={{color:"var(--fg-300)"}}>{tkn.venues.slice(0,3).map(v=>v.name).join(" · ")}</span></div>
            </div>
          </div>

          <div className="ms-card" style={{padding:"12px 14px"}}>
            <h3 style={{margin:"0 0 10px",fontSize:13,fontWeight:500}}>Contract & supply</h3>
            <div className="mono" style={{fontSize:11,color:"var(--fg-400)",display:"grid",gridTemplateColumns:"auto 1fr",gap:"6px 12px"}}>
              <span>Contract</span><span style={{color:"var(--fg-200)",wordBreak:"break-all"}}>{tkn.contract}</span>
              <span>Supply</span><span style={{color:"var(--fg-200)"}}>{mkNum(tkn.supply)}</span>
              <span>MCAP</span><span style={{color:"var(--fg-200)"}}>{mkUsd(tkn.mcap)}</span>
              <span>Holders</span><span style={{color:"var(--fg-200)"}}>{mkNum(tkn.holders)}</span>
              <span>Rank</span><span style={{color:"var(--gold)"}}>#{tkn.rank}</span>
              <span>Listed</span><span style={{color:"var(--fg-200)"}}>{tkn.age.days}d ago</span>
            </div>
            <div style={{marginTop:12,paddingTop:10,borderTop:"1px solid var(--fg-700)"}}>
              <div className="cap" style={{fontSize:9,marginBottom:8}}>Venue share · 24h</div>
              {tkn.venues.map(v=>(
                <div key={v.name} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                  <span className="mono" style={{fontSize:10.5,color:"var(--fg-300)",width:60}}>{v.name}</span>
                  <div style={{flex:1,height:5,background:"rgba(255,255,255,0.04)",borderRadius:2,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${v.share*100}%`,background: v.name==="coinzen" ? "var(--gold)" : "var(--fg-500)"}}/>
                  </div>
                  <span className="mono num" style={{fontSize:10,color:"var(--fg-400)",width:38,textAlign:"right"}}>{(v.share*100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

Object.assign(window, { MarketsPage, MarketPage });
