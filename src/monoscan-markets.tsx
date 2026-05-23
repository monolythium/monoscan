/* =====================================================
   Monoscan · MARKETS
   Top 100 tokens by 24h volume, each with a trading detail
   page (chart + side panel + trades table, SuiVision-style).
   Settlement is on Monarch — every trade has a round +
   attestation quorum. Coinzen is the routing venue.
   ===================================================== */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useMemo } from "react";
import {
  buildNativeSpotLimitOrderForwarderInput,
  type SpotLimitOrderSide,
} from "@monolythium/core-sdk";
import { MARKETS } from "./data/mock";
import {
  nativeMarketEventRows,
  nativeMarketStateRows,
  useChainHead,
  useClobMarket,
  useClobMarkets,
  useClobOhlc,
  useClobOrderBook,
  useClobTrades,
  useNativeMarketEvents,
  useNativeMarketState,
} from "./data/hooks";
import { getMarketIdForSymbol, getNativeMarketForwarderAddress } from "./sdk/client";

/* ----- formatters ----- */
const mkFmt = (n: any, dp?: any) => {
  if (n == null) return "—";
  const d = dp != null ? dp : n < 1 ? 6 : n < 100 ? 3 : 2;
  return n.toLocaleString(undefined, { minimumFractionDigits:d, maximumFractionDigits:d });
};
const mkMoney = (n: any) => n < 1 ? `$${n.toFixed(4)}` : n < 100 ? `$${n.toFixed(3)}` : `$${n.toLocaleString(undefined,{maximumFractionDigits:2})}`;
const mkUsd   = (n: any) => n>=1e9 ? `$${(n/1e9).toFixed(2)}B` : n>=1e6 ? `$${(n/1e6).toFixed(2)}M` : n>=1e3 ? `$${(n/1e3).toFixed(2)}K` : `$${n.toFixed(0)}`;
const mkNum   = (n: any) => n>=1e9 ? `${(n/1e9).toFixed(2)}B` : n>=1e6 ? `${(n/1e6).toFixed(2)}M` : n>=1e3 ? `${(n/1e3).toFixed(2)}K` : `${n.toFixed(0)}`;
const mkAgo   = (ts: any) => { const s = (Date.now()-ts)/1000; if (s<60) return `${s|0}s ago`; if (s<3600) return `${(s/60)|0}m ago`; if (s<86400) return `${(s/3600)|0}h ago`; return `${(s/86400)|0}d ago`; };
const mkDec = (value: any, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const _shortMarketId = (id: string) => `${id.slice(0, 10)}…${id.slice(-6)}`;
const _shortAddr = (id: string, head = 8, tail = 4) =>
  id && id.length > head + tail + 3 ? `${id.slice(0, head)}…${id.slice(-tail)}` : id;
const _shortHash = (id: string | null | undefined, head = 10, tail = 6) =>
  id ? _shortAddr(id, head, tail) : "—";
const _positiveIntegerText = (value: unknown, fallback: string): string => {
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return String(Math.trunc(value));
  if (typeof value === "bigint" && value > 0n) return value.toString(10);
  return fallback;
};
const NATIVE_MARKET_FORWARDER_MAX_CYCLES = "22000";
const NATIVE_MARKET_MRV_EXECUTION_UNIT_LIMIT_HEX = "0x200000";
const _cumLevels = (rows: Array<{ price: string; size: string }>) => {
  let total = 0;
  return rows.map((row) => {
    const px = mkDec(row.price);
    const sz = mkDec(row.size);
    total += sz;
    return { px, sz, total };
  });
};

export interface MarketOrderWalletRequestArgs {
  marketId: string | null | undefined;
  baseTokenId: string | null | undefined;
  quoteTokenId: string | null | undefined;
  ownerAddress: string | null | undefined;
  orderNonce: string | number | bigint;
  forwarderContractAddress: string | null | undefined;
  side: SpotLimitOrderSide;
  price: string;
  quantity: string;
  expiryBlock?: string | number | bigint;
  maxCycles?: string | number | bigint;
  executionUnitLimitHex?: string;
}

export interface MarketOrderWalletRequest {
  method: "monolythium_submitMrvNativeCall";
  params: [{
    contractAddress: string;
    input: string;
    executionUnitLimitHex: string;
    valueWeiHex: "0x0";
  }];
}

export function buildMarketOrderWalletRequest(args: MarketOrderWalletRequestArgs): MarketOrderWalletRequest {
  if (!args.marketId) {
    throw new Error("Live native market id is required before placing an order.");
  }
  const owner = args.ownerAddress?.trim();
  if (!owner) {
    throw new Error("Wallet account is required before placing an order.");
  }
  const forwarder = args.forwarderContractAddress?.trim();
  if (!forwarder) {
    throw new Error("MRV native market forwarder address is not configured.");
  }
  const forwarderInput = buildNativeSpotLimitOrderForwarderInput({
    marketId: args.marketId,
    owner,
    nonce: args.orderNonce,
    side: args.side,
    price: args.price.trim(),
    quantity: args.quantity.trim(),
    expiresAtBlock: args.expiryBlock ?? 0,
  }, args.maxCycles ?? NATIVE_MARKET_FORWARDER_MAX_CYCLES);
  return {
    method: "monolythium_submitMrvNativeCall",
    params: [{
      contractAddress: forwarder,
      input: forwarderInput.input,
      executionUnitLimitHex:
        args.executionUnitLimitHex ?? NATIVE_MARKET_MRV_EXECUTION_UNIT_LIMIT_HEX,
      valueWeiHex: "0x0",
    }],
  };
}

function _walletAccount(result: unknown): string {
  if (Array.isArray(result) && typeof result[0] === "string" && result[0].length > 0) {
    return result[0];
  }
  throw new Error("Monolythium wallet did not return an account.");
}

function _walletTxHash(result: unknown): string | null {
  if (typeof result === "string" && result.length > 0) return result;
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.txHash === "string" && record.txHash.length > 0) return record.txHash;
    if (typeof record.hash === "string" && record.hash.length > 0) return record.hash;
  }
  return null;
}

const _nativeStateSource = (state: any) => {
  const source = state?.source;
  if (!source || typeof source !== "object") return "/api/v1/native-market-state";
  return Object.entries(source).map(([k, v]) => `${k}=${String(v)}`).join(" · ") || "/api/v1/native-market-state";
};

const NativeMarketEventsCard = ({ rows, latestBlock, loading, scope }: any) => (
  <div className="ms-card" style={{padding:0,overflow:"hidden"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"center",padding:"14px 16px",borderBottom:"1px solid var(--fg-700)"}}>
      <div>
        <div className="cap">Native market events</div>
        <h3 style={{margin:"3px 0 0",fontSize:14,fontWeight:500}}>Recent indexed events</h3>
      </div>
      <div className="mono" style={{fontSize:10,color:"var(--fg-500)",textAlign:"right"}}>
        {latestBlock === null ? "waiting for head" : `last 2,048 blocks · to ${latestBlock.toLocaleString()}`}
        {scope && <div style={{marginTop:3}}>{scope}</div>}
      </div>
    </div>
    {rows.length === 0 ? (
      <div className="mono" style={{padding:"16px",fontSize:12.5,color:"var(--fg-400)",lineHeight:1.55}}>
        {loading
          ? "Reading /api/v1/native-market-events…"
          : "No indexed native market events returned for this bounded block window."}
      </div>
    ) : (
      <div style={{overflowX:"auto"}}>
        <table className="ms-table ms-table--tight">
          <thead>
            <tr>
              <th>Block</th>
              <th>Event</th>
              <th>Primary id</th>
              <th>Emitter</th>
              <th>Fields</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((event: any, i: number)=>(
              <tr key={`${event.blockHeight ?? "x"}-${event.txIndex ?? "x"}-${event.logIndex}-${event.eventTopic}-${i}`}>
                <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>
                  {event.blockHeight === null ? "—" : event.blockHeight.toLocaleString()}
                  <div style={{fontSize:10,color:"var(--fg-500)",marginTop:2}}>tx {event.txIndex ?? "—"} · log {event.logIndex}</div>
                </td>
                <td className="mono" style={{fontSize:11,color:"var(--fg-200)"}}>
                  {event.eventName ?? _shortHash(event.eventTopic)}
                  <div style={{fontSize:10,color:"var(--fg-500)",marginTop:2}}>{event.family ?? "market"}</div>
                </td>
                <td className="mono" title={event.primaryId ?? undefined} style={{fontSize:11,color:"var(--fg-300)"}}>
                  {_shortHash(event.primaryId)}
                  {event.relatedId && <div title={event.relatedId} style={{fontSize:10,color:"var(--fg-500)",marginTop:2}}>rel {_shortHash(event.relatedId, 8, 4)}</div>}
                </td>
                <td className="mono" title={event.address} style={{fontSize:11,color:"var(--fg-300)"}}>{_shortHash(event.address, 9, 5)}</td>
                <td className="mono" style={{fontSize:10.5,color:"var(--fg-400)",maxWidth:360}}>
                  {event.decodedFields.slice(0, 4).map(([k, v]: [string, string])=>`${k}=${v}`).join(" · ") || "decoded payload unavailable"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

const NativeMarketStateTable = ({ title, rows, empty }: any) => (
  <div style={{overflowX:"auto"}}>
    <div className="cap" style={{padding:"12px 16px 6px"}}>{title}</div>
    {rows.length === 0 ? (
      <div className="mono" style={{padding:"0 16px 14px",fontSize:12,color:"var(--fg-500)"}}>{empty}</div>
    ) : (
      <table className="ms-table ms-table--tight">
        <thead>
          <tr>
            <th>Id</th>
            <th>Market / collection</th>
            <th>Account</th>
            <th>Side</th>
            <th style={{textAlign:"right"}}>Price</th>
            <th style={{textAlign:"right"}}>Amount</th>
            <th>Status</th>
            <th>Fields</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any, i: number)=>(
            <tr key={`${row.kind}-${row.primaryId ?? row.marketId ?? row.collectionId ?? i}`}>
              <td className="mono" title={row.primaryId ?? undefined} style={{fontSize:11,color:"var(--fg-300)"}}>{_shortHash(row.primaryId, 8, 5)}</td>
              <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>
                {row.marketId ? <span title={row.marketId}>{_shortHash(row.marketId, 8, 5)}</span> : row.collectionId ? <span title={row.collectionId}>{_shortHash(row.collectionId, 8, 5)}</span> : "—"}
                {row.tokenId && <div title={row.tokenId} style={{fontSize:10,color:"var(--fg-500)",marginTop:2}}>token {_shortHash(row.tokenId, 7, 4)}</div>}
              </td>
              <td className="mono" title={row.account ?? undefined} style={{fontSize:11,color:"var(--fg-300)"}}>{_shortHash(row.account, 8, 5)}</td>
              <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>{row.side ?? "—"}</td>
              <td className="mono num" style={{textAlign:"right",fontSize:11,color:"var(--fg-200)"}}>{row.price ?? "—"}</td>
              <td className="mono num" style={{textAlign:"right",fontSize:11,color:"var(--fg-300)"}}>{row.amount ?? "—"}</td>
              <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>{row.status ?? "—"}</td>
              <td className="mono" style={{fontSize:10.5,color:"var(--fg-500)",maxWidth:300}}>
                {row.fields.slice(0, 3).map(([k, v]: [string, string])=>`${k}=${v}`).join(" · ") || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

const NativeMarketStateCard = ({ state, rows, loading, scope }: any) => {
  const total = rows.spotMarkets.length + rows.spotOrders.length + rows.nftListings.length + rows.collectionRoyalties.length;
  return (
    <div className="ms-card" style={{padding:0,overflow:"hidden"}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"center",padding:"14px 16px",borderBottom:"1px solid var(--fg-700)"}}>
        <div>
          <div className="cap">Native market current state</div>
          <h3 style={{margin:"3px 0 0",fontSize:14,fontWeight:500}}>Spot, NFT, and royalty rows</h3>
        </div>
        <div className="mono" style={{fontSize:10,color:"var(--fg-500)",textAlign:"right"}}>
          {state ? _nativeStateSource(state) : loading ? "reading /api/v1/native-market-state" : "no current-state response"}
          {scope && <div style={{marginTop:3}}>{scope}</div>}
        </div>
      </div>
      {state && total === 0 ? (
        <div className="mono" style={{padding:"16px",fontSize:12.5,color:"var(--fg-400)",lineHeight:1.55}}>
          The native market state endpoint returned successfully, but it did not return spot markets, spot orders, NFT listings, or collection royalties for this scope.
        </div>
      ) : !state ? (
        <div className="mono" style={{padding:"16px",fontSize:12.5,color:"var(--fg-400)",lineHeight:1.55}}>
          {loading ? "Reading /api/v1/native-market-state…" : "Native market current state is unavailable from this node."}
        </div>
      ) : (
        <>
          <NativeMarketStateTable title="Spot markets" rows={rows.spotMarkets} empty="No spot markets returned."/>
          <NativeMarketStateTable title="Spot orders" rows={rows.spotOrders} empty="No spot orders returned."/>
          <NativeMarketStateTable title="NFT listings" rows={rows.nftListings} empty="No NFT listings returned."/>
          <NativeMarketStateTable title="Collection royalties" rows={rows.collectionRoyalties} empty="No collection royalties returned."/>
        </>
      )}
    </div>
  );
};

/* Token glyph — seeded, visually stable */
const TokenMark = ({ sym, size=24 }: any) => {
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
const Spark = ({ data, up, w=100, h=28 }: any) => {
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
const MarketsPage = ({ go }: any) => {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("rank");
  const [dir, setDir] = useState(1);
  const [tab, setTab] = useState("all");
  const head = useChainHead();
  const liveMarkets = useClobMarkets(100);
  const nativeMarketState = useNativeMarketState();
  const nativeStateRows = useMemo(() => nativeMarketStateRows(nativeMarketState.data), [nativeMarketState.data]);
  const nativeMarketEvents = useNativeMarketEvents({ latestBlock: head.data?.blockNumber ?? null, limit: 25 });
  const nativeMarketRows = useMemo(() => nativeMarketEventRows(nativeMarketEvents.data), [nativeMarketEvents.data]);

  const liveRows = useMemo(() => {
    return (liveMarkets.data?.markets ?? []).map((row: any, i: number) => {
      const fixture = MARKETS.find((m: any) => getMarketIdForSymbol(m.sym) === row.marketId);
      const price = mkDec(row.lastPrice, fixture?.price ?? 0);
      const baseVolume = mkDec(row.totalVolumeBase, 0);
      const fallbackSpark = fixture?.sparkline ?? [price || 0, price || 0];
      return {
        ...(fixture ?? {}),
        rank: i + 1,
        sym: fixture?.sym ?? `MKT-${i + 1}`,
        name: fixture?.name ?? `CLOB ${_shortMarketId(row.marketId)}`,
        kind: fixture?.kind ?? "native",
        price,
        chg24h: fixture?.chg24h ?? 0,
        sparkline: fallbackSpark,
        vol24h: price > 0 ? baseVolume * price : baseVolume,
        liquidity: fixture?.liquidity ?? 0,
        mcap: fixture?.mcap ?? 0,
        holders: fixture?.holders ?? 0,
        verified: fixture?.verified ?? true,
        trades: fixture?.trades?.length ? fixture.trades : [{ round: row.lastBlockHeight }],
        marketId: row.marketId,
        tradeCount: row.tradeCount,
        totalVolumeBase: baseVolume,
        hasFixture: Boolean(fixture),
        live: true,
      };
    });
  }, [liveMarkets.data]);

  const hasLiveMarketResponse = liveMarkets.data !== undefined && liveMarkets.data !== null;
  const marketRows = hasLiveMarketResponse ? liveRows : MARKETS;

  const tabs = [
    { k:"all",    label:"All markets" },
    { k:"mono",   label:"MONO pairs" },
    { k:"stable", label:"Stables" },
    { k:"bridged",label:"Bridged" },
    { k:"native", label:"Native" },
  ];

  const filtered = useMemo(() => {
    let m = marketRows.slice();
    if (q) {
      const qq = q.toLowerCase();
      m = m.filter(t =>
        t.sym.toLowerCase().includes(qq) ||
        t.name.toLowerCase().includes(qq) ||
        (t.marketId ?? "").toLowerCase().includes(qq),
      );
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
  }, [marketRows, q, sort, dir, tab]);

  const flip = (k) => { if (sort===k) setDir(-dir); else { setSort(k); setDir(k==="rank"||k==="sym"?1:-1); } };
  const arrow = (k) => sort!==k ? "" : (dir>0 ? " ↑" : " ↓");

  const totalMCAP = marketRows.reduce((a,t)=>a+(t.mcap || 0),0);
  const totalVOL  = marketRows.reduce((a,t)=>a+(t.vol24h || 0),0);
  const totalLIQ  = marketRows.reduce((a,t)=>a+(t.liquidity || 0),0);
  const usingLiveMarkets = hasLiveMarketResponse;

  return (
    <div className="ms-page ms-markets">
      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:20,flexWrap:"wrap"}}>
        <div>
          <div className="cap">Markets · settled on Monolythium</div>
          <h1 className="ms-h1" style={{marginTop:4}}>Top 100 by 24h volume</h1>
          <div className="mono" style={{color:"var(--fg-400)",marginTop:8,fontSize:13,maxWidth:720,lineHeight:1.55}}>
            Orderbook matching happens on-chain. Every fill carries a DAG round and an attestation quorum —
            you can trade from this page and read the receipt in the same place.
          </div>
        </div>
        <div style={{display:"flex",gap:14,alignItems:"flex-end"}}>
          <div style={{textAlign:"right"}}>
            <div className="cap">{usingLiveMarkets ? "Live markets" : "Total MCAP"}</div>
            <div className="mono num" style={{fontSize:20,color:"var(--fg-100)",marginTop:2}}>
              {usingLiveMarkets ? liveRows.length.toLocaleString() : mkUsd(totalMCAP)}
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div className="cap">{usingLiveMarkets ? "Indexed volume" : "24H volume"}</div>
            <div className="mono num" style={{fontSize:20,color:"var(--fg-100)",marginTop:2}}>{mkUsd(totalVOL)}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div className="cap">{usingLiveMarkets ? "Trades indexed" : "Total liquidity"}</div>
            <div className="mono num" style={{fontSize:20,color:"var(--fg-100)",marginTop:2}}>
              {usingLiveMarkets ? liveRows.reduce((a,t)=>a+(t.tradeCount || 0),0).toLocaleString() : mkUsd(totalLIQ)}
            </div>
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
          <span className="mono" style={{color:"var(--fg-500)",fontSize:10,letterSpacing:"0.08em"}}>
            {filtered.length} / {usingLiveMarkets ? liveRows.length : 100}
          </span>
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
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10}>
                  <div className="mono" style={{color:"var(--fg-400)",fontSize:12,lineHeight:1.55,padding:"14px 8px"}}>
                    {usingLiveMarkets
                      ? "The live CLOB index responded, but it has no indexed markets matching this view yet."
                      : "No fixture markets matched this filter."}
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map(t => (
                <tr key={t.marketId ?? t.sym} onClick={()=>go(`#/market/${encodeURIComponent(t.live && !t.hasFixture ? t.marketId : t.sym)}`)}>
                  <td className="mono num" style={{color:"var(--fg-500)",fontSize:11.5}}>{t.rank}</td>
                  <td>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      <TokenMark sym={t.sym} size={26}/>
                      <div style={{minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontWeight:500,color:"var(--fg-100)",fontSize:13}}>{t.sym}</span>
                          {t.verified && <span title="verified" style={{color:"var(--gold)",fontSize:11,lineHeight:1}}>✓</span>}
                        </div>
                        <div className="mono" style={{fontSize:10.5,color:"var(--fg-500)",marginTop:1,letterSpacing:"0.02em"}}>
                          {t.live && !t.hasFixture ? `market ${_shortMarketId(t.marketId)}` : t.name}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-100)",fontSize:12.5}}>{mkMoney(t.price)}</td>
                  <td className="mono num" style={{textAlign:"right",color: t.chg24h>=0?"var(--ok)":"var(--err)", fontSize:12}}>{t.chg24h>=0?"+":""}{t.chg24h.toFixed(2)}%</td>
                  <td style={{textAlign:"center"}}>
                    <span style={{display:"inline-block"}}><Spark data={t.sparkline} up={t.chg24h>=0} w={96} h={24}/></span>
                  </td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-200)",fontSize:12}}>{mkUsd(t.vol24h)}</td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-300)",fontSize:12}}>{t.live && !t.hasFixture ? "—" : mkUsd(t.liquidity)}</td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-300)",fontSize:12}}>{t.live && !t.hasFixture ? "—" : mkUsd(t.mcap)}</td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-400)",fontSize:12}}>{t.live && !t.hasFixture ? "—" : mkNum(t.holders)}</td>
                  <td className="mono" style={{textAlign:"right",fontSize:11,color:"var(--fg-400)"}}>
                    <span style={{display:"inline-flex",alignItems:"center",gap:5}}>
                      <span className="dot" style={{color:"var(--ok)",width:5,height:5}}/>
                      round {Number(t.trades[0]?.round ?? t.lastBlockHeight ?? 0).toLocaleString()}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <NativeMarketEventsCard
        rows={nativeMarketRows}
        latestBlock={head.data?.blockNumber ?? null}
        loading={nativeMarketEvents.isLoading || head.isLoading}
      />

      <NativeMarketStateCard
        state={nativeMarketState.data}
        rows={nativeStateRows}
        loading={nativeMarketState.isLoading}
      />

      <div className="mono" style={{color:"var(--fg-500)",fontSize:11,textAlign:"center",letterSpacing:"0.04em",padding:"6px 0"}}>
        {usingLiveMarkets
          ? "Live CLOB index. Empty rows mean the node has no indexed markets yet, not that demo fixtures are hidden by filters."
          : "Listing policy: top 100 markets by rolling 24h volume · re-ranked every 240 rounds · full list on the Monoscan API"}
      </div>
    </div>
  );
};

/* ---------- MARKET DETAIL ---------- */
const MarketPage = ({ sym, go }: any) => {
  const routeKey = decodeURIComponent(sym ?? "");
  const configuredMarketId = getMarketIdForSymbol(routeKey);
  const head = useChainHead();
  const liveMarkets = useClobMarkets(100);
  const matchedLiveSummary = liveMarkets.data?.markets.find((row: any) =>
    row.marketId === configuredMarketId || row.marketId === routeKey,
  ) ?? null;
  const marketId = configuredMarketId ?? (/^0x[0-9a-fA-F]{64}$/.test(routeKey) ? routeKey : matchedLiveSummary?.marketId);
  const clob = useClobMarket(marketId);
  const liveTrades = useClobTrades(marketId, 50);
  const liveOhlc = useClobOhlc(marketId);
  const liveBook = useClobOrderBook(marketId, 9);
  const nativeMarketState = useNativeMarketState({ primaryId: marketId ?? null });
  const nativeStateRows = useMemo(() => nativeMarketStateRows(nativeMarketState.data), [nativeMarketState.data]);
  const nativeMarketEvents = useNativeMarketEvents({ latestBlock: head.data?.blockNumber ?? null, limit: 25, primaryId: marketId ?? null });
  const nativeMarketRows = useMemo(() => nativeMarketEventRows(nativeMarketEvents.data), [nativeMarketEvents.data]);
  const liveMarket = clob.data?.market ?? null;
  const matchedLiveIndex = matchedLiveSummary ? liveMarkets.data?.markets.indexOf(matchedLiveSummary) ?? -1 : -1;
  const tkn = MARKETS.find((m: any) => m.sym === routeKey || getMarketIdForSymbol(m.sym) === marketId) || {
    ...MARKETS[0],
    rank: matchedLiveSummary ? matchedLiveIndex + 1 : MARKETS[0].rank,
    sym: matchedLiveSummary ? `MKT-${matchedLiveIndex + 1}` : MARKETS[0].sym,
    name: matchedLiveSummary ? `CLOB ${_shortMarketId(matchedLiveSummary.marketId)}` : MARKETS[0].name,
    contract: marketId ?? MARKETS[0].contract,
    price: matchedLiveSummary ? mkDec(matchedLiveSummary.lastPrice, MARKETS[0].price) : MARKETS[0].price,
    vol24h: matchedLiveSummary ? mkDec(matchedLiveSummary.totalVolumeBase, 0) : MARKETS[0].vol24h,
    liquidity: 0,
    mcap: 0,
    holders: 0,
    verified: Boolean(matchedLiveSummary),
  };
  const [range, setRange] = useState("1D");
  const [orderSide, setOrderSide] = useState<SpotLimitOrderSide>("buy");
  const [orderType, setOrderType] = useState<"swap" | "limit" | "market">("limit");
  const [orderPrice, setOrderPrice] = useState("1");
  const [orderQuantity, setOrderQuantity] = useState("1");
  const [orderNonce, setOrderNonce] = useState("0");
  const [orderExpiryBlock, setOrderExpiryBlock] = useState("0");
  const [orderMarketSeed, setOrderMarketSeed] = useState<string | null>(null);
  const [orderSubmit, setOrderSubmit] = useState<{
    state: "idle" | "submitting" | "success" | "error";
    message?: string;
    txHash?: string | null;
  }>({ state: "idle" });

  const ranges = ["1H","4H","1D","7D","1M","1Y","All"];
  const chg = tkn.chg24h;
  const up = chg >= 0;
  const bestBid = liveMarket ? mkDec(liveMarket.bestBidPrice, tkn.price - tkn.tick) : null;
  const bestAsk = liveMarket ? mkDec(liveMarket.bestAskPrice, tkn.price + tkn.tick) : null;
  const lastTrade = liveMarket ? mkDec(liveMarket.lastTradePrice, 0) : null;
  const livePrice = lastTrade && lastTrade > 0
    ? lastTrade
    : bestBid !== null && bestAsk !== null && bestBid > 0 && bestAsk > 0
      ? (bestBid + bestAsk) / 2
      : null;
  const tick = liveMarket ? mkDec(liveMarket.tickSize, tkn.tick) : tkn.tick;
  const totalVolumeBase = liveMarket ? mkDec(liveMarket.totalVolumeBase, tkn.vol24h) : tkn.vol24h;
  const takerFeeBps = liveMarket?.takerFeeBps ?? 5;
  const orderBaseTokenId = liveMarket?.baseToken ?? null;
  const orderQuoteTokenId = liveMarket?.quoteToken ?? null;
  const nativeMarketForwarderAddress = getNativeMarketForwarderAddress();
  const suggestedOrderPrice = _positiveIntegerText(
    orderSide === "buy" ? liveMarket?.bestBidPrice : liveMarket?.bestAskPrice,
    _positiveIntegerText(liveMarket?.lastTradePrice, _positiveIntegerText(liveMarket?.tickSize, "1")),
  );
  const suggestedOrderQuantity = _positiveIntegerText(liveMarket?.lotSize, "1");

  useEffect(() => {
    if (!marketId || !liveMarket || orderMarketSeed === marketId) return;
    setOrderPrice(suggestedOrderPrice);
    setOrderQuantity(suggestedOrderQuantity);
    setOrderNonce("0");
    setOrderExpiryBlock("0");
    setOrderMarketSeed(marketId);
    setOrderSubmit({ state: "idle" });
  }, [liveMarket, marketId, orderMarketSeed, suggestedOrderPrice, suggestedOrderQuantity]);

  const orderCanSubmit = orderType === "limit"
    && orderSubmit.state !== "submitting"
    && orderPrice.trim().length > 0
    && orderQuantity.trim().length > 0
    && orderNonce.trim().length > 0
    && Boolean(marketId && nativeMarketForwarderAddress);
  const submitMarketOrder = async () => {
    try {
      if (orderType !== "limit") {
        throw new Error("Only limit orders are wired for native market submission.");
      }
      const provider = typeof window !== "undefined" ? window.monolythium : undefined;
      if (!provider?.request) {
        throw new Error("Monolythium wallet provider not detected.");
      }
      setOrderSubmit({ state: "submitting", message: "awaiting wallet" });
      const accounts = await provider.request({ method: "eth_requestAccounts", params: [] });
      const request = buildMarketOrderWalletRequest({
        marketId,
        baseTokenId: orderBaseTokenId,
        quoteTokenId: orderQuoteTokenId,
        ownerAddress: _walletAccount(accounts),
        orderNonce: orderNonce.trim() || "0",
        forwarderContractAddress: nativeMarketForwarderAddress,
        side: orderSide,
        price: orderPrice,
        quantity: orderQuantity,
        expiryBlock: orderExpiryBlock.trim() || "0",
      });
      const result = await provider.request(request);
      const txHash = _walletTxHash(result);
      setOrderSubmit({
        state: "success",
        txHash,
        message: txHash ? `submitted ${_shortHash(txHash, 10, 6)}` : "submitted",
      });
      window.__msToast?.(txHash ? `Limit order submitted ${_shortHash(txHash, 10, 6)}` : "Limit order submitted");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Limit order submission failed.";
      setOrderSubmit({ state: "error", message });
      if (typeof window !== "undefined") window.__msToast?.(message);
    }
  };

  // chart
  const liveCandles = (liveOhlc.data?.candles ?? [])
    .map((c: any) => ({
      o: mkDec(c.open),
      h: mkDec(c.high),
      l: mkDec(c.low),
      c: mkDec(c.close),
      v: mkDec(c.volumeBase),
      startBlock: c.startBlock,
      endBlock: c.endBlock,
    }))
    .filter((c: any) => c.o > 0 || c.h > 0 || c.l > 0 || c.c > 0);
  const ohlc = liveCandles.length > 1 ? liveCandles : tkn.ohlc;
  const closes = ohlc.map(c=>c.c);
  const chartLo = Math.min(...closes)*0.996;
  const chartHi = Math.max(...closes)*1.004;
  const chartSpan = chartHi - chartLo || 1;
  const W = 900, H = 320;
  const sx = (i) => (i / (closes.length - 1)) * (W - 48);
  const sy = (v) => H - ((v - chartLo) / chartSpan) * (H - 20) - 10;
  const linePath = closes.map((v,i)=>`${i===0?"M":"L"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${sx(closes.length-1).toFixed(1)},${H} L0,${H} Z`;
  const mid = livePrice ?? tkn.price;
  const midY = sy(mid);

  // orderbook derived from trades — make plausible levels
  const bookLevels = 9;
  const syntheticAsks = Array.from({length:bookLevels},(_,i)=>{
    const px = +(mid + tick*(i+1)).toFixed(mid<1?6:mid<100?3:2);
    const sz = 40 + ((i*37 + tkn.sym.length*11) % 7) * 60 + i*25;
    return { px, sz, total:0 };
  });
  const syntheticBids = Array.from({length:bookLevels},(_,i)=>{
    const px = +(mid - tick*(i+1)).toFixed(mid<1?6:mid<100?3:2);
    const sz = 40 + ((i*29 + tkn.sym.length*7) % 7) * 65 + i*22;
    return { px, sz, total:0 };
  });
  let aT=0, bT=0;
  syntheticAsks.forEach(a=>{ aT+=a.sz; a.total=aT; });
  syntheticBids.forEach(b=>{ bT+=b.sz; b.total=bT; });
  const liveBookResponded = liveBook.data !== undefined && liveBook.data !== null;
  const liveAsks = _cumLevels(liveBook.data?.asks ?? []);
  const liveBids = _cumLevels(liveBook.data?.bids ?? []);
  const asks = liveBookResponded ? liveAsks : syntheticAsks;
  const bids = liveBookResponded ? liveBids : syntheticBids;
  const maxT = Math.max(
    1,
    asks[asks.length - 1]?.total ?? 0,
    bids[bids.length - 1]?.total ?? 0,
  );

  const liveTradeRows = (liveTrades.data?.trades ?? []).map((row: any, i: number) => {
    const px = mkDec(row.price);
    const sz = mkDec(row.amount);
    return {
      t: 0,
      live: true,
      side: "fill",
      px,
      sz,
      value: px * sz,
      maker: _shortAddr(row.maker, 7, 4),
      taker: _shortAddr(row.taker, 7, 4),
      venue: "clob",
      round: row.blockHeight,
      attest: "indexed",
      txIndex: row.txIndex,
      logIndex: row.logIndex,
      key: `${row.blockHeight}-${row.txIndex}-${row.logIndex}-${i}`,
    };
  });
  const tradeRows = liveTradeRows.length ? liveTradeRows : tkn.trades;
  const buyVol  = liveBids.length ? (bids[bids.length - 1]?.total ?? 0) * mid : liveBookResponded ? null : tkn.trades.filter(t=>t.side==="buy").reduce((a,t)=>a+t.value,0);
  const sellVol = liveAsks.length ? (asks[asks.length - 1]?.total ?? 0) * mid : liveBookResponded ? null : tkn.trades.filter(t=>t.side==="sell").reduce((a,t)=>a+t.value,0);

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
            {liveMarket && <span className="pill ok" style={{fontSize:10.5}}>live CLOB</span>}
          </div>
          <div className="mono" style={{display:"flex",alignItems:"center",gap:10,marginTop:6,color:"var(--fg-400)",fontSize:11.5,letterSpacing:"0.02em"}}>
            <span style={{padding:"3px 8px",background:"rgba(255,255,255,0.04)",border:"1px solid var(--fg-700)",borderRadius:4}}>{tkn.contract}</span>
            {marketId && <span title={marketId}>market {_shortMarketId(marketId)}</span>}
            <span style={{cursor:"pointer",color:"var(--fg-300)"}} title="copy">⎘</span>
            <span style={{cursor:"pointer",color:"var(--fg-300)"}}>Try API ↗</span>
            <span>·</span>
            <span>listed {tkn.age.days}d ago</span>
          </div>
        </div>
        <div style={{flex:1}}/>
        <div style={{textAlign:"right"}}>
          <div className="mono num" style={{fontSize:28,color:"var(--fg-100)",letterSpacing:"-0.02em",fontWeight:300}}>{mkMoney(mid)}</div>
          <div className="mono" style={{fontSize:12,marginTop:2,color: up?"var(--ok)":"var(--err)"}}>
            {liveMarket ? "live CLOB midpoint" : `${up?"▲":"▼"} ${Math.abs(chg).toFixed(3)}% · 24h`}
          </div>
        </div>
      </section>

      {/* QUICK STATS STRIP */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,minmax(0,1fr))",gap:10,padding:"10px 0"}}>
        {[
          ["Price", mkMoney(mid), up?"var(--ok)":"var(--err)", liveMarket ? "lyth_clobMarket" : `${chg>=0?"+":""}${chg.toFixed(2)}%`],
          ["Liquidity", mkUsd(tkn.liquidity)],
          [liveMarket ? "Base volume" : "24h volume", liveMarket ? mkNum(totalVolumeBase) : mkUsd(tkn.vol24h)],
          ["MCAP", mkUsd(tkn.mcap)],
          ["Holders", mkNum(tkn.holders)],
          [liveMarket ? "Taker fee" : "Age", liveMarket ? `${takerFeeBps} bps` : `${tkn.age.days}d`],
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
              <span><span className="dot" style={{color:"var(--ok)",width:5,height:5,marginRight:6}}/>{liveCandles.length > 1 ? "indexed OHLC" : "live"} · round {Number(tradeRows[0]?.round ?? tkn.trades[0].round).toLocaleString()}</span>
              <span>{liveCandles.length > 1 ? `${liveCandles.length} buckets` : `commit ${tkn.trades[0].round%1000}ms ago`}</span>
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
              {(["swap","limit","market"] as const).map(t=>(
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
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.08em",textTransform:"uppercase"}}>Limit price</div>
              <input
                value={orderPrice}
                onChange={(event)=>setOrderPrice(event.currentTarget.value)}
                inputMode="numeric"
                className="mono num"
                style={{fontSize:20,color:"var(--fg-100)",fontWeight:300,marginTop:2,width:"100%"}}
              />
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
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.08em",textTransform:"uppercase"}}>Quantity</div>
              <input
                value={orderQuantity}
                onChange={(event)=>setOrderQuantity(event.currentTarget.value)}
                inputMode="numeric"
                className="mono num"
                style={{fontSize:20,color:"var(--fg-100)",fontWeight:300,marginTop:2,width:"100%"}}
              />
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"rgba(255,255,255,0.03)",borderRadius:6,border:"1px solid var(--fg-700)"}}>
              <TokenMark sym={tkn.sym} size={22}/>
              <span className="mono" style={{fontSize:12,fontWeight:500}}>{tkn.sym}</span>
              <span style={{color:"var(--fg-400)",fontSize:11}}>▾</span>
            </div>
          </div>

          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",background:"rgba(255,255,255,0.025)",borderRadius:8,border:"1px solid var(--fg-700)"}}>
            <span className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.08em",textTransform:"uppercase"}}>Order nonce</span>
            <input
              value={orderNonce}
              onChange={(event)=>setOrderNonce(event.currentTarget.value)}
              inputMode="numeric"
              className="mono num"
              style={{fontSize:12,color:"var(--fg-200)",textAlign:"right",width:120}}
            />
          </div>

          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",background:"rgba(255,255,255,0.025)",borderRadius:8,border:"1px solid var(--fg-700)"}}>
            <span className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.08em",textTransform:"uppercase"}}>Expiry block</span>
            <input
              value={orderExpiryBlock}
              onChange={(event)=>setOrderExpiryBlock(event.currentTarget.value)}
              inputMode="numeric"
              className="mono num"
              style={{fontSize:12,color:"var(--fg-200)",textAlign:"right",width:120}}
            />
          </div>

          <button className="mono" disabled={!orderCanSubmit} onClick={submitMarketOrder} style={{
            marginTop:6,padding:"12px 0",background:"linear-gradient(180deg, var(--gold), #c98e22)",
            color:"#1a0f00",fontWeight:600,borderRadius:8,cursor:orderCanSubmit?"pointer":"not-allowed",border:0,opacity:orderCanSubmit?1:0.5,
            fontSize:12,letterSpacing:"0.08em",textTransform:"uppercase",
          }}>
            {orderSubmit.state === "submitting"
              ? "Submitting"
              : orderType !== "limit"
                ? "Limit only"
                : !marketId
                  ? "Live market required"
                  : !nativeMarketForwarderAddress
                    ? "Forwarder required"
                  : `Place ${orderSide} limit`}
          </button>

          {orderSubmit.state !== "idle" && (
            <div className="mono" style={{
              fontSize:10.5,
              color: orderSubmit.state === "error" ? "var(--err)" : orderSubmit.state === "success" ? "var(--ok)" : "var(--fg-400)",
              lineHeight:1.45,
              wordBreak:"break-word",
            }}>
              {orderSubmit.message}
              {orderSubmit.txHash && (
                <a href={`#/tx/${orderSubmit.txHash}`} onClick={()=>go(`#/tx/${orderSubmit.txHash}`)} style={{color:"var(--gold)",marginLeft:8}}>View tx</a>
              )}
            </div>
          )}

          <div className="mono" style={{fontSize:10,color:"var(--fg-500)",paddingTop:8,borderTop:"1px solid var(--fg-700)",display:"grid",gridTemplateColumns:"1fr auto",rowGap:3}}>
            <span>Rate</span><span style={{color:"var(--fg-300)"}}>1 {tkn.sym} ≈ {mkMoney(mid)}</span>
            <span>Route</span><span style={{color:"var(--fg-300)"}}>coinzen · pool #14</span>
            <span>Maker · taker</span><span style={{color:"var(--fg-300)"}}>0.02% · {(takerFeeBps / 100).toFixed(2)}%</span>
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
                {tradeRows.map((t:any,i:number)=>(
                  <tr key={t.key ?? i} onClick={()=>go(`#/round/${t.round}`)}>
                    <td className="mono" style={{color:"var(--fg-400)",fontSize:11}}>{t.live ? `block ${Number(t.round).toLocaleString()}` : mkAgo(t.t)}</td>
                    <td>
                      {(() => {
                        const isBuy = t.side === "buy";
                        const isSell = t.side === "sell";
                        const bg = isBuy ? "oklch(0.78 0.14 155 / 0.14)" : isSell ? "oklch(0.70 0.20 22 / 0.14)" : "rgba(242,180,65,0.10)";
                        const color = isBuy ? "var(--ok)" : isSell ? "var(--err)" : "var(--gold)";
                        const border = isBuy ? "oklch(0.78 0.14 155 / 0.3)" : isSell ? "oklch(0.70 0.20 22 / 0.3)" : "rgba(242,180,65,0.25)";
                        return (
                      <span className="mono" style={{
                        padding:"2px 7px",borderRadius:3,fontSize:10,letterSpacing:"0.06em",fontWeight:500,
                        background: bg,
                        color,
                        border: `1px solid ${border}`,
                      }}>{t.side.toUpperCase()}</span>
                        );
                      })()}
                    </td>
                    <td className="mono num" style={{textAlign:"right",color: t.side==="buy"?"var(--ok)":t.side==="sell"?"var(--err)":"var(--gold)",fontSize:12}}>{mkMoney(t.px)}</td>
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
                          {t.attest==="attested" ? "● attested · 11/11" : t.attest === "indexed" ? "● indexed" : `◐ ${t.attest}`}
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
              <span className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.06em"}}>tick {tick}</span>
            </div>
            <div className="mono" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",fontSize:9.5,color:"var(--fg-500)",letterSpacing:"0.08em",textTransform:"uppercase",paddingBottom:6,borderBottom:"1px solid var(--fg-700)"}}>
              <span>Price</span><span style={{textAlign:"right"}}>Size</span><span style={{textAlign:"right"}}>Total</span>
            </div>
            {/* asks */}
            {asks.length === 0 ? (
              <div className="mono" style={{padding:"14px 0",fontSize:11,color:"var(--fg-500)",lineHeight:1.45}}>
                No ask levels returned by the current order-book read.
              </div>
            ) : (
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
            )}
            <div style={{padding:"7px 0",margin:"4px 0",borderTop:"1px solid var(--fg-700)",borderBottom:"1px solid var(--fg-700)",display:"flex",alignItems:"center",gap:8}}>
              <span className="mono num" style={{fontSize:14,color: up?"var(--ok)":"var(--err)",fontWeight:500}}>{mkFmt(mid)}</span>
              <span className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.06em"}}>{up?"↑":"↓"} {Math.abs(chg).toFixed(2)}%</span>
              <span style={{flex:1}}/>
              <span className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>
                spread {liveMarket && bestBid !== null && bestAsk !== null ? mkFmt(Math.max(0, bestAsk - bestBid)) : (tick*2).toFixed(3)}
              </span>
            </div>
            {/* bids */}
            {bids.length === 0 ? (
              <div className="mono" style={{padding:"14px 0",fontSize:11,color:"var(--fg-500)",lineHeight:1.45}}>
                No bid levels returned by the current order-book read.
              </div>
            ) : bids.map((b,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",padding:"3px 0",fontSize:11,position:"relative"}}>
                <span style={{position:"absolute",right:0,top:0,bottom:0,width:`${(b.total/maxT)*100}%`,background:"oklch(0.78 0.14 155 / 0.10)"}}/>
                <span className="mono num" style={{color:"var(--ok)",position:"relative"}}>{mkFmt(b.px)}</span>
                <span className="mono num" style={{textAlign:"right",color:"var(--fg-300)",position:"relative"}}>{mkNum(b.sz)}</span>
                <span className="mono num" style={{textAlign:"right",color:"var(--fg-500)",position:"relative"}}>{mkNum(b.total)}</span>
              </div>
            ))}
            <div className="mono" style={{marginTop:10,paddingTop:8,borderTop:"1px solid var(--fg-700)",fontSize:10,color:"var(--fg-500)"}}>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>Buy depth</span><span style={{color:"var(--ok)"}}>{buyVol === null ? "—" : mkUsd(buyVol)}</span></div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}><span>Sell depth</span><span style={{color:"var(--err)"}}>{sellVol === null ? "—" : mkUsd(sellVol)}</span></div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}><span>Venues</span><span style={{color:"var(--fg-300)"}}>{tkn.venues.slice(0,3).map(v=>v.name).join(" · ")}</span></div>
            </div>
          </div>

          <div className="ms-card" style={{padding:"12px 14px"}}>
            <h3 style={{margin:"0 0 10px",fontSize:13,fontWeight:500}}>Contract & supply</h3>
            <div className="mono" style={{fontSize:11,color:"var(--fg-400)",display:"grid",gridTemplateColumns:"auto 1fr",gap:"6px 12px"}}>
              <span>Contract</span><span style={{color:"var(--fg-200)",wordBreak:"break-all"}}>{tkn.contract}</span>
              {marketId && <><span>Market id</span><span style={{color:"var(--fg-200)",wordBreak:"break-all"}}>{marketId}</span></>}
              {liveMarket && <><span>Registered</span><span style={{color:"var(--fg-200)"}}>block {Number(liveMarket.registeredAtBlock).toLocaleString()}</span></>}
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

      <NativeMarketStateCard
        state={nativeMarketState.data}
        rows={nativeStateRows}
        loading={nativeMarketState.isLoading}
        scope={marketId ? `primaryId ${_shortHash(marketId)}` : "unscoped until a live market id is known"}
      />

      <NativeMarketEventsCard
        rows={nativeMarketRows}
        latestBlock={head.data?.blockNumber ?? null}
        loading={nativeMarketEvents.isLoading || head.isLoading}
        scope={marketId ? `primaryId ${_shortHash(marketId)}` : "unscoped until a live market id is known"}
      />
    </div>
  );
};

/* Named exports — replaces the legacy window-attach pattern. */
export { MarketsPage, MarketPage };
