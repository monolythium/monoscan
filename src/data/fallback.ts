/**
 * Local fallback rows for surfaces that require retained aggregate indexes.
 *
 * Live RPC and `/api/v1` values are preferred by the hooks in `./hooks.ts`.
 * These rows keep offline, local, and early-testnet views renderable when a
 * node does not expose the retained aggregate data for a surface yet.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// Fallback data is shape-driven only; strict types live in `./hooks.ts`.

import { addressToTypedBech32, type AddressKind } from "@monolythium/core-sdk";

const _hash = (n: number): string =>
  `0x${n.toString(16).padStart(8, "0")}…${(n * 7919).toString(16).slice(-4)}`;
const _typedAddress = (kind: AddressKind, n: number): string =>
  addressToTypedBech32(kind, `0x${n.toString(16).padStart(40, "0")}`);
const _spark = (n: number, base: number, v: number): number[] =>
  Array.from({ length: n }, (_, i) => base + Math.sin(i * 0.5) * v + (Math.random() - 0.5) * v * 0.6);

const REGIONS = [
  "EU-West · Amsterdam",
  "US-East · Ashburn",
  "APAC · Singapore",
  "EU-North · Stockholm",
  "US-West · Portland",
  "EU-Central · Frankfurt",
  "US-Central · Dallas",
  "EU-West · Dublin",
  "APAC · Tokyo",
  "US-East · NYC",
];
const HANDLES = [
  "volans", "sagitta", "antares", "phoenix", "draco", "lepus", "vega", "mira",
  "hydrus", "perseus", "eridanus", "cetus", "lyra", "carina", "monarch-a",
  "ara", "corvus", "pavo", "tucana", "grus", "octans", "hydra",
  "leo-minor", "cygnus", "cassiopeia",
];

const _makeOps = () =>
  HANDLES.map((h, i) => ({
    handle: h,
    addrShort: `0x${(i * 1097 + 13).toString(16).padStart(4, "0")}…${(i * 9311 + 71).toString(16).slice(-4)}`,
    region: REGIONS[i % REGIONS.length],
    reputation: 0.78 + Math.random() * 0.2,
    uptime: 0.992 + Math.random() * 0.008,
    bonded: 50000 + Math.floor(Math.random() * 100000),
    slashes: i === 4 ? 1 : 0,
    activeSince: `round 2,${(800 + i * 4).toString().padStart(3, "0")},${Math.floor(Math.random() * 900)
      .toString()
      .padStart(3, "0")}`,
    repHist: _spark(60, 0.92, 0.04),
    memberships: [
      { slot: 10 + i, role: "active", joined: `${30 + i}d ago`, reward30d: 3500 + Math.floor(Math.random() * 1500) },
      ...(i % 3 === 0
        ? [{ slot: 60 + i, role: "standby", joined: `${10 + i}d ago`, reward30d: 800 + Math.floor(Math.random() * 400) }]
        : []),
    ],
    caps: {
      rpc: i % 2 === 0,
      stateSync: true,
      snapshots: i % 3 !== 0,
      archival: i % 4 === 0,
      prover: i % 5 === 0,
      bridge: i % 2 === 1,
      oracle: i % 6 === 0,
    },
  }));

const CLUSTER_NAMES = [
  "Vega Nexus", "Orion Stake", "Cygnus Labs", "Polaris One", "Andromeda Collective", "Lyra Systems", "Perseus Guild", "Draco Node",
  "Phoenix Commons", "Serpens Works", "Carina Relay", "Hydra Signal", "Pegasus Yield", "Ursa DVT", "Centaurus Pool", "Aquila Gate",
  "Capella Labs", "Altair Collective", "Rigel Committee", "Sirius Operations", "Deneb Network", "Arcturus Guild", "Castor Nexus", "Pollux Relay",
  "Canopus Node", "Bellatrix Syndicate", "Procyon Forge", "Antares Collective", "Mira Works", "Atlas Commons", "Betelgeuse Pool", "Spica Stake",
  "Aldebaran Network", "Regulus Committee", "Hadar Relay", "Fomalhaut Labs", "Nihal Node", "Alnilam Guild", "Alnitak Ops", "Mintaka DVT",
  "Saiph Gate", "Wezen Pool", "Adhara Nexus", "Murzim Network", "Furud Works", "Naos Collective", "Alphard Node", "Zosma Relay",
  "Chara Guild", "Cor Caroli", "Alkaid Collective", "Mizar Ops", "Megrez Forge", "Phecda Commons", "Merak Stake", "Dubhe Network",
  "Thuban Labs", "Kochab Nexus", "Yildun Gate", "Pherkad Guild", "Edasich Pool", "Alrakis DVT", "Rastaban Node", "Eltanin Works",
  "Grumium Relay", "Giausar Committee", "Tyl Network", "Aldhibah Forge", "Zavijava Collective", "Denebola Nexus", "Mirach Labs", "Almach Pool",
  "Adhil Guild", "Alpheratz One", "Matar Stake", "Scheat Node", "Markab Relay", "Enif Committee", "Homam Forge", "Sadalmelik Works",
  "Sadalsuud Gate", "Sadachbia Network", "Skat Labs", "Deneb Algedi", "Nashira Nexus", "Dabih DVT", "Algedi Ops", "Sadr Commons",
  "Albireo Collective", "Prima Hyadum", "Alcyone Guild", "Maia Network", "Electra Pool", "Merope Stake", "Taygeta Node", "Asterope Relay",
  "Celaeno Works", "Atlas Prime", "Pleione One", "Sterope Ops", "Kaffaljidhma", "Menkar Forge", "Diphda Nexus", "Deneb Kaitos",
  "Gomeisa Labs", "Wasat Guild", "Mekbuda Pool", "Propus DVT", "Tejat Node", "Alhena Gate", "Alzirr Network", "Nihal Collective",
  "Subra Relay", "Al Minliar", "Ras Elased", "Algieba Commons", "Adhafera Ops", "Rasalas Forge", "Chertan Works", "Coxa Nexus",
];

const _makeClusters = () => {
  const N = 120;
  const clusters: any[] = Array.from({ length: N }, (_, i) => {
    const liveRoll = i < 100 ? (i % 9 === 3 ? 5 : i % 9 === 6 ? 6 : 7) : 7;
    const state = liveRoll === 7 ? "nominal" : liveRoll === 6 ? "maintenance" : "jail";
    const opIdx = (i * 3) % HANDLES.length;
    const backupCount = i % 5 === 0 ? 0 : i % 4 === 1 ? 1 : i % 3 === 2 ? 2 : 3;
    const recruiting = backupCount < 3 || i % 7 === 2;
    const recruitSeats = Math.max(0, 3 - backupCount) + (i % 7 === 2 ? 1 : 0);
    const tvsRaw =
      i < 100
        ? 12 - i * 0.11 + (Math.random() * 0.7 - 0.35)
        : 0.55 - (i - 100) * 0.025 + (Math.random() * 0.08 - 0.04);
    const tvs = Math.max(0.04, tvsRaw).toFixed(2);
    return {
      slot: i + 1,
      name: CLUSTER_NAMES[i % CLUSTER_NAMES.length],
      size: 7,
      members: liveRoll,
      state,
      backupCount,
      recruiting,
      recruitSeats,
      recruitReason: recruiting ? (backupCount < 3 ? "standby bench under-filled" : "rotating one operator out") : null,
      backups: Array.from({ length: backupCount }, (_, b) => ({
        handle: HANDLES[(opIdx + 7 + b) % HANDLES.length],
        addrShort: `0x${((opIdx + 7 + b) * 1097 + 13).toString(16).padStart(4, "0")}…${((opIdx + 7 + b) * 9311 + 71).toString(16).slice(-4)}`,
        rep: 0.8 + Math.random() * 0.15,
        queuePos: b + 1,
        joinedStandby: `${2 + b * 3}d ago`,
      })),
      aggKey: `bls1:agg:${((i + 1) * 9311).toString(16)}…${((i + 1) * 7919).toString(16).slice(-4)}`,
      tvs,
      diversity: (Math.random() - 0.4) * 0.3,
      reward30d: i < 100 ? 12000 + Math.floor(Math.random() * 8000) : 0,
      vertexInclude: i < 100 ? 0.965 + Math.random() * 0.034 : 0,
      streams: {
        consensus: 8000 + Math.floor(Math.random() * 2000),
        service: 3000 + Math.floor(Math.random() * 1500),
        builder: 400 + Math.floor(Math.random() * 300),
      },
      rewardHist: _spark(60, i < 100 ? 400 : 0, i < 100 ? 80 : 0),
      stateHist: Array.from({ length: 42 }, (_, j) => (j > 38 && state !== "nominal" ? state : "nominal")),
      slashHist: i === 3 ? ["round 2,920,118 · double-sign · 14,720 LYTH slashed · op-cetus"] : [],
      opMembers: HANDLES.slice(opIdx, opIdx + 7)
        .concat(HANDLES.slice(0, Math.max(0, opIdx + 7 - HANDLES.length)))
        .slice(0, 7)
        .map((h, k) => ({
          handle: h,
          addrShort: `0x${((opIdx + k) * 1097 + 13).toString(16).padStart(4, "0")}…${((opIdx + k) * 9311 + 71).toString(16).slice(-4)}`,
          role: k === 0 ? "proposer" : "committee",
          rep: 0.82 + Math.random() * 0.16,
          vertexRate: 0.96 + Math.random() * 0.038,
          state: liveRoll === 7 ? "live" : k === 6 && liveRoll === 6 ? "lag" : "live",
        })),
      recentVertices:
        i < 100
          ? Array.from({ length: 5 }, (_, j) => ({
              round: 2_938_441 - j * 7,
              txCount: 20 + Math.floor(Math.random() * 30),
              shards: 14000 + Math.floor(Math.random() * 400),
              dac: j !== 2,
              blsAggMs: 7 + Math.random() * 3,
              hashShort: _hash(2938441 - j * 7),
            }))
          : [],
    };
  });
  clusters.sort((a, b) => parseFloat(b.tvs) - parseFloat(a.tvs));
  clusters.forEach((c, i) => {
    c.rank = i + 1;
    const isJailed = c.state === "jail";
    c.active = i < 100 && !isJailed;
    c.inactiveReason = !c.active ? (isJailed ? "jailed" : "below-top-100") : null;
    c.cooldownRoundsLeft = isJailed ? 20 + ((i * 13) % 80) : 0;
    c.tvsToPromote = c.active ? null : (parseFloat(clusters[99].tvs) - parseFloat(c.tvs)).toFixed(2);
  });
  return clusters;
};

/**
 * Baseline explorer state used when live aggregate surfaces are unavailable.
 * Block head, cluster descriptors, and selected stats are replaced by live
 * hook data as soon as the node reports them.
 */
export const MONOSCAN_DATA = {
  consensus: {
    round: 2_938_441,
    ratePerSec: 2.9,
    commitLatencyP95Ms: 348,
    vertexInclude: 0.991,
    dacCoverage: 0.997,
    shards: 14200,
    blsAggMs: 8.4,
    mempool: 1284,
    tvs: "248",
    signers: { live: 100, total: 100 },
    signersHist: Array.from({ length: 100 }, (_, i) => (i === 43 ? 5 : i % 17 === 0 ? 6 : 7)),
  },
  clusters: _makeClusters(),
  operators: _makeOps().sort((a, b) => b.reputation - a.reputation),
  recentVertices: Array.from({ length: 12 }, (_, j) => ({
    round: 2_938_441 - j,
    clusterSlot: ((j * 5 + 1) % 100) + 1,
    txCount: 18 + Math.floor(Math.random() * 40),
    shards: 14000 + Math.floor(Math.random() * 500),
    dac: j !== 4,
    blsAggMs: 7 + Math.random() * 3,
    hashShort: _hash(2938441 - j),
  })),
  supply: { public: "182.4", publicPct: 73, privateTxs30d: 41822 },
  treasury: {
    multisig: "fnd1:treasury:5-of-9",
    balance: "12.4M LYTH",
    recent: [
      { kind: "Grant · Monoscan dev", amount: 120000, when: "2d ago", multiSigOk: "5/9" },
      { kind: "Payroll · core contributors", amount: 184000, when: "12d ago", multiSigOk: "6/9" },
      { kind: "Grant · DVT audit", amount: 75000, when: "20d ago", multiSigOk: "5/9" },
    ],
  },
};

/* ================= MARKETS ================= */
const _seed = (n: number) => {
  let s = Math.abs(n) * 9301 + 49297;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
};

const _mkToken = (sym: string, name: string, rank: number, kind: string, tier: string) => {
  const r = _seed(sym.split("").reduce((a, c) => a + c.charCodeAt(0), 0));
  const volMin = ({ mega: 50_000_000, big: 5_000_000, mid: 500_000, small: 40_000 } as any)[tier];
  const volRange = ({ mega: 120_000_000, big: 45_000_000, mid: 4_500_000, small: 460_000 } as any)[tier];
  const vol = volMin + r() * volRange;
  const priceRaw =
    kind === "stable"
      ? 0.998 + (r() - 0.5) * 0.004
      : kind === "btc"
      ? 62000 + r() * 8000
      : kind === "eth"
      ? 3100 + r() * 400
      : kind === "major"
      ? 2 + r() * 400
      : kind === "mono"
      ? 0.9 + r() * 18
      : 0.0001 + r() * 3;
  const chg = kind === "stable" ? (r() - 0.5) * 0.12 : (r() - 0.45) * 18;
  const liq = vol * (0.4 + r() * 1.4);
  const supply =
    kind === "stable"
      ? vol * 50
      : kind === "btc"
      ? 19_600_000
      : kind === "eth"
      ? 120_000_000
      : 100_000_000 + r() * 900_000_000;
  const mcap = priceRaw * supply;
  const holders = Math.floor(1200 + r() * 380_000);
  const sparkBase = priceRaw;
  const spark = Array.from({ length: 48 }, (_, i) => {
    const n = _seed(rank * 1000 + i);
    return sparkBase * (1 + (n() - 0.5) * 0.04 + Math.sin(i * 0.4 + rank) * 0.02);
  });
  return {
    sym,
    name,
    rank,
    kind,
    verified: tier !== "small" || r() > 0.5,
    price: priceRaw,
    chg24h: chg,
    vol24h: vol,
    liquidity: liq,
    mcap,
    supply,
    holders,
    age: { days: Math.floor(30 + r() * 1800) },
    sparkline: spark,
    contract: _typedAddress("contract", 0x200000 + rank),
    tick: tier === "mega" ? 0.001 : tier === "big" ? 0.001 : tier === "mid" ? 0.002 : 0.005,
    venues: [
      { name: "coinzen", share: 0.55 + r() * 0.25 },
      { name: "orbital", share: 0.15 + r() * 0.15 },
      { name: "mira-p2p", share: 0.05 + r() * 0.1 },
      { name: "direct", share: 0.02 + r() * 0.08 },
    ],
  } as any;
};

const MARKET_DEFS: Array<[number, string, string, string, string]> = [
  [1, "LYTH", "Monolythium", "mono", "mega"],
  [2, "wBTC", "Wrapped Bitcoin", "btc", "mega"],
  [3, "USDC", "USD Coin (bridged)", "stable", "mega"],
  [4, "wETH", "Wrapped Ether", "eth", "mega"],
  [5, "USDT", "Tether (bridged)", "stable", "mega"],
  [6, "LYTH-p", "Private LYTH", "mono", "big"],
  [7, "tBTC", "Threshold Bitcoin", "btc", "big"],
  [8, "ATT", "Attest token", "major", "big"],
  [9, "DAG", "DAG execution", "major", "big"],
  [10, "stMONO", "Staked LYTH LST", "mono", "big"],
  [11, "wMATIC", "Wrapped Polygon", "major", "big"],
  [12, "CSTR", "Cluster-share", "major", "big"],
  [13, "wAVAX", "Wrapped Avalanche", "major", "big"],
  [14, "wBNB", "Wrapped BNB", "major", "big"],
  [15, "REED", "Reed-Solomon credit", "major", "mid"],
  [16, "DAC", "Data-availability crd", "major", "mid"],
  [17, "SHARD", "Shard-routing token", "major", "mid"],
  [18, "VRTX", "Vertex priority", "major", "mid"],
  [19, "RELAY", "Bridge-relayer token", "major", "mid"],
  [20, "PROV", "Prover time", "major", "mid"],
  [21, "wDOGE", "Wrapped Doge", "major", "mid"],
  [22, "wARB", "Wrapped Arbitrum", "major", "mid"],
  [23, "wOP", "Wrapped Optimism", "major", "mid"],
  [24, "wLINK", "Wrapped Chainlink", "major", "mid"],
  [25, "wUNI", "Wrapped Uniswap", "major", "mid"],
  [26, "wAAVE", "Wrapped Aave", "major", "mid"],
  [27, "BLS", "BLS-agg rewards", "major", "mid"],
  [28, "SLH", "SLH-DSA credit", "major", "mid"],
  [29, "wDAI", "Wrapped DAI", "stable", "mid"],
  [30, "wTON", "Wrapped TON", "major", "mid"],
];
for (let i = 31; i <= 100; i++) {
  const tier = i <= 45 ? "mid" : "small";
  const names = [
    "Aurora", "Photon", "Gradient", "Cypher", "Halcyon", "Veridian", "Orbit", "Plume", "Arcus", "Nebula",
    "Flux", "Forge", "Kinetic", "Lumen", "Loom", "Pylon", "Quanta", "Rhea", "Sylph", "Terra",
    "Umbra", "Vela", "Yonder", "Zephyr", "Cosmo", "Drift", "Echo", "Fable", "Glyph", "Helix",
    "Ion", "Jade", "Koda", "Lyre", "Muon", "Nova", "Opal", "Prism", "Quark", "Radon",
    "Sable", "Tilde", "Ursa", "Valor", "Wane", "Xeno", "Yield", "Zen", "Arrow", "Blaze",
    "Clade", "Delve", "Ember", "Fern", "Gild", "Hymn", "Inkle", "Juno", "Krait", "Lith",
    "Mote", "Nell", "Onyx", "Peak", "Quill", "Ruse", "Spire", "Taran", "Urge", "Vant",
  ];
  const sym = names[i - 31].slice(0, 4).toUpperCase();
  MARKET_DEFS.push([i, sym, names[i - 31], "major", tier]);
}

const _mkTrades = (mid: number, count: number, seedN: number) => {
  const r = _seed(seedN);
  const out: any[] = [];
  let t = Date.now();
  for (let i = 0; i < count; i++) {
    const jitter = (r() - 0.5) * mid * 0.001;
    const px = +(mid + jitter).toFixed(mid < 1 ? 6 : mid < 100 ? 3 : 2);
    const sz = +(20 + r() * 900).toFixed(2);
    const side = r() > 0.5 ? "buy" : "sell";
    t -= Math.floor(400 + r() * 8000);
    out.push({
      px,
      sz,
      side,
      value: +(px * sz).toFixed(2),
      round: 2_938_441 - Math.floor(i * 1.2 + r() * 2),
      t,
      maker: `0x${(seedN * 7 + i * 13).toString(16).padStart(4, "0")}…${(seedN * 11 + i * 17).toString(16).slice(-4)}`,
      taker: `0x${(seedN * 5 + i * 19).toString(16).padStart(4, "0")}…${(seedN * 3 + i * 23).toString(16).slice(-4)}`,
      venue: r() > 0.82 ? "orbital" : "coinzen",
      attest: i === 7 ? "quorum-8/11" : "attested",
      dac: i === 7 ? 0.73 : 1.0,
      hash: `0x${(seedN * 1009 + i * 101).toString(16).padStart(6, "0")}…${(seedN * 103 + i * 37).toString(16).slice(-6)}`,
    });
  }
  return out;
};

/**
 * Local market rows used for list rendering and unconfigured-detail fallback.
 * Market pages probe live CLOB surfaces when market IDs are configured.
 */
export const MARKETS: any[] = MARKET_DEFS.map(([rank, sym, name, kind, tier]) => {
  const t = _mkToken(sym, name, rank, kind, tier);
  t.trades = _mkTrades(t.price, 50, rank);
  return t;
});

const _mkOHLC = (mid: number, count: number, seedN: number) => {
  const r = _seed(seedN);
  const out: any[] = [];
  let px = mid * 0.985;
  for (let i = 0; i < count; i++) {
    const drift = (r() - 0.48) * mid * 0.004;
    const hi = px + Math.abs(drift) + r() * mid * 0.002;
    const lo = px - Math.abs(drift) - r() * mid * 0.002;
    const cl = px + drift;
    out.push({ t: i, o: px, h: hi, l: lo, c: cl });
    px = cl;
  }
  const adj = mid - out[out.length - 1].c;
  out.forEach((c) => {
    c.o += adj;
    c.h += adj;
    c.l += adj;
    c.c += adj;
  });
  return out;
};
MARKETS.forEach((m: any) => {
  m.ohlc = _mkOHLC(m.price, 120, m.rank);
});

/* ================= NETWORK STATS ================= */
/**
 * Aggregate fallback counters. StatsPage replaces round, cluster count, peer
 * count, and mempool depth with live node data when available.
 */
export const NETWORK_STATS = (() => {
  const now = MONOSCAN_DATA.consensus.round;
  const clusters = MONOSCAN_DATA.clusters;
  const ops = MONOSCAN_DATA.operators;
  const txTotal = 48_714_229;
  const txLast24 = 312_884;
  const vertices = now;
  const contracts = 1_284;
  const tokensListed = MARKETS.length;
  const rewardsAccrued = clusters.filter((c: any) => c.active).reduce((a: number, c: any) => a + c.reward30d, 0) * 48;
  const rewardsUnclaimed = Math.floor(rewardsAccrued * 0.036);
  const slashTotal = 248_716;
  const slashEvents = 14;
  const inflationSinceGenesis = 24_400_000;
  const burnSinceGenesis = 6_120_000;
  const netInflation = inflationSinceGenesis - burnSinceGenesis;
  const daysSinceGenesis = 1_384;
  const avgRoundsPerDay = Math.floor(now / daysSinceGenesis);
  const txSeries30d = Array.from({ length: 30 }, (_, i) =>
    280_000 + Math.floor(Math.sin(i * 0.3) * 35_000 + Math.random() * 30_000),
  );
  const rewardsSeries30d = Array.from({ length: 30 }, (_, i) =>
    42_000 + Math.floor(Math.sin(i * 0.5) * 4_000 + Math.random() * 3_000),
  );
  const slashSeries30d = Array.from({ length: 30 }, (_, i) =>
    i === 14 || i === 22 ? 14_720 + Math.floor(Math.random() * 2_000) : 0,
  );
  const inflationSeries365d = Array.from({ length: 365 }, (_, i) =>
    8_000 + Math.floor(Math.sin(i * 0.02) * 1_200 + Math.random() * 800),
  );
  return {
    network: {
      genesisDate: "2022-06-14",
      daysSinceGenesis,
      avgRoundsPerDay,
      currentRound: now,
      chainAge: `${daysSinceGenesis}d · ~${(daysSinceGenesis / 365).toFixed(1)}y`,
    },
    totals: {
      txTotal,
      txLast24,
      vertices,
      contracts,
      tokensListed,
      walletsTotal: 184_229,
      walletsActive24h: 18_411,
      clustersActive: clusters.filter((c: any) => c.active).length,
      clustersTotal: clusters.length,
      operators: ops.length,
      privateTxs: 4_922_114,
      publicTxs: txTotal - 4_922_114,
    },
    rewards: { accrued: rewardsAccrued, unclaimed: rewardsUnclaimed, claimed: rewardsAccrued - rewardsUnclaimed },
    slashing: { totalMono: slashTotal, events: slashEvents, lastEvent: "14,720 LYTH · double-sign · 3 rounds ago in Draco Node" },
    inflation: { sinceGenesis: inflationSinceGenesis, burn: burnSinceGenesis, net: netInflation, annualizedRate: 0.042 },
    series: { tx30d: txSeries30d, rewards30d: rewardsSeries30d, slash30d: slashSeries30d, inflation365d: inflationSeries365d },
  };
})();

/* ================= WALLETS ================= */
const WALLET_TAGS: any[] = [
  { tag: "Foundation treasury", addr: _typedAddress("user", 0x300001), bal: 12_400_000, pct: 1.42 },
  { tag: "Coinzen · hot wallet", addr: _typedAddress("user", 0x300002), bal: 9_844_120, pct: 1.13 },
  { tag: "Coinzen · cold storage", addr: _typedAddress("user", 0x300003), bal: 28_112_500, pct: 3.22 },
  { tag: "Orbital DEX · LP treasury", addr: _typedAddress("user", 0x300004), bal: 6_291_700, pct: 0.72 },
  { tag: "Bridge · CCIP lane", addr: _typedAddress("user", 0x300005), bal: 4_188_200, pct: 0.48 },
  { tag: "Bridge · LINK fee reserve", addr: _typedAddress("user", 0x300006), bal: 3_712_840, pct: 0.43 },
  { tag: "Staking pool · Stakewise", addr: _typedAddress("user", 0x300007), bal: 3_244_000, pct: 0.37 },
  { tag: "Staking pool · Pocket", addr: _typedAddress("user", 0x300008), bal: 2_810_500, pct: 0.32 },
  { tag: null, addr: _typedAddress("user", 0x300009), bal: 2_490_000, pct: 0.28, note: "early genesis · OG" },
  { tag: null, addr: _typedAddress("user", 0x30000a), bal: 2_188_400, pct: 0.25 },
  { tag: "Mira Protocol · contract", addr: _typedAddress("contract", 0x30000b), bal: 1_944_220, pct: 0.22 },
  { tag: null, addr: _typedAddress("user", 0x30000c), bal: 1_822_100, pct: 0.21 },
  { tag: null, addr: _typedAddress("user", 0x30000d), bal: 1_705_300, pct: 0.20 },
  { tag: "Coinzen · fee collector", addr: _typedAddress("user", 0x30000e), bal: 1_520_800, pct: 0.17 },
  { tag: null, addr: _typedAddress("user", 0x30000f), bal: 1_414_900, pct: 0.16 },
  { tag: null, addr: _typedAddress("user", 0x300010), bal: 1_312_400, pct: 0.15 },
  { tag: null, addr: _typedAddress("user", 0x300011), bal: 1_211_060, pct: 0.14 },
  { tag: "Orbital DEX · router", addr: _typedAddress("contract", 0x300012), bal: 1_155_900, pct: 0.13 },
  { tag: null, addr: _typedAddress("user", 0x300013), bal: 1_098_700, pct: 0.13 },
  { tag: null, addr: _typedAddress("user", 0x300014), bal: 988_200, pct: 0.11 },
  { tag: null, addr: _typedAddress("user", 0x300015), bal: 912_500, pct: 0.10 },
  { tag: null, addr: _typedAddress("user", 0x300016), bal: 844_300, pct: 0.10 },
  { tag: null, addr: _typedAddress("user", 0x300017), bal: 802_100, pct: 0.09 },
  { tag: null, addr: _typedAddress("user", 0x300018), bal: 741_500, pct: 0.08 },
  { tag: null, addr: _typedAddress("user", 0x300019), bal: 688_200, pct: 0.08 },
  { tag: "Mira · staking vault", addr: _typedAddress("contract", 0x30001a), bal: 644_800, pct: 0.07 },
  { tag: null, addr: _typedAddress("user", 0x30001b), bal: 611_700, pct: 0.07 },
  { tag: null, addr: _typedAddress("user", 0x30001c), bal: 577_400, pct: 0.07 },
  { tag: null, addr: _typedAddress("user", 0x30001d), bal: 544_900, pct: 0.06 },
  { tag: null, addr: _typedAddress("user", 0x30001e), bal: 512_100, pct: 0.06 },
];

const _mkWalletTxs = (addr: string, seed: number) => {
  const r = _seed(seed);
  const kinds = ["transfer", "stake", "unstake", "reward", "swap", "bridge-out", "bridge-in", "contract"];
  const counterparties = WALLET_TAGS.slice(0, 8).map((w) => w.addr);
  const denoms = ["LYTH", "LYTH", "LYTH", "USDC", "wETH", "LYTH-p"];
  return Array.from({ length: 18 }, (_, i) => {
    const kind = kinds[Math.floor(r() * kinds.length)];
    const outgoing =
      kind === "transfer" || kind === "stake" || kind === "bridge-out"
        ? true
        : kind === "reward" || kind === "unstake" || kind === "bridge-in"
        ? false
        : r() > 0.5;
    const amount = Math.floor(50 + r() * (kind === "reward" ? 4000 : 80_000));
    const denom = denoms[Math.floor(r() * denoms.length)];
    return {
      hash: `0x${(seed * 977 + i * 191).toString(16).padStart(8, "0")}…${(seed * 311 + i * 89).toString(16).slice(-4)}`,
      kind,
      direction: outgoing ? "out" : "in",
      amount,
      denom,
      counterparty: counterparties[Math.floor(r() * counterparties.length)],
      round: 2_938_441 - Math.floor(i * 32 + r() * 120),
      when: i === 0 ? "3m ago" : i === 1 ? "18m ago" : i < 4 ? `${Math.floor(1 + r() * 6)}h ago` : `${Math.floor(1 + r() * 25)}d ago`,
      fee: +(0.0008 + r() * 0.004).toFixed(4),
      status: i === 2 && r() > 0.8 ? "failed" : "ok",
    };
  });
};

const _mkFlow = (seed: number) => {
  const r = _seed(seed);
  return Array.from({ length: 30 }, (_, i) => ({
    day: i,
    in: Math.floor(r() * 22_000),
    out: Math.floor(r() * 18_000),
    stake: i % 5 === 0 ? Math.floor(r() * 12_000) : 0,
    reward: Math.floor(200 + r() * 900),
  }));
};

/**
 * Wallet distribution fallback rows. WalletsPage probes `lyth_richList` for
 * the configured LYTH token id when the node exposes it.
 */
const _wallets: any = WALLET_TAGS.map((w: any, i: number) => {
  const seed = parseInt(w.addr.replace(/[^0-9a-f]/gi, "").slice(-4) || (i + 1).toString(), 16) || i + 1;
  return {
    ...w,
    rank: i + 1,
    balMono: w.bal,
    extras:
      w.tag && w.tag.includes("Coinzen")
        ? [
            { denom: "USDC", bal: Math.floor(w.bal * 0.28) },
            { denom: "wETH", bal: +(w.bal * 0.00012).toFixed(2) },
            { denom: "wBTC", bal: +(w.bal * 0.0000028).toFixed(4) },
          ]
        : w.tag && w.tag.includes("Bridge")
        ? [
            { denom: "USDC", bal: Math.floor(w.bal * 0.14) },
            { denom: "wETH", bal: +(w.bal * 0.00008).toFixed(2) },
          ]
        : i < 20
        ? [{ denom: "USDC", bal: Math.floor(w.bal * 0.05) }]
        : [],
    txs: _mkWalletTxs(w.addr, seed),
    flow30d: _mkFlow(seed),
    firstSeen: i < 10 ? "genesis" : `round ${(2_938_441 - Math.floor(1000 + i * 84_000)).toLocaleString()}`,
    firstSeenAgo: i < 10 ? "3.8y ago" : `${Math.floor(20 + i * 12)}d ago`,
    txCount: Math.floor(60 + Math.random() * (w.tag ? 8000 : 400)),
    stakedTo: i < 14 ? `C-${String((i * 7) % 100 + 1).padStart(3, "0")}` : null,
    stakedAmount: i < 14 ? Math.floor(w.bal * (0.3 + Math.random() * 0.5)) : 0,
  };
});

const topPct = _wallets.slice(0, 20).reduce((a: number, w: any) => a + w.pct, 0);
const othersPct = 100 - topPct - 28;
_wallets.pie = [
  ..._wallets.slice(0, 10).map((w: any) => ({ label: w.tag || `${w.addr.slice(0, 12)}…`, pct: w.pct, addr: w.addr })),
  { label: "Top 11–30 holders", pct: _wallets.slice(10, 30).reduce((a: number, w: any) => a + w.pct, 0), addr: null },
  { label: "Other 10k+ wallets", pct: othersPct, addr: null },
  { label: "Retail (<50k LYTH)", pct: 28, addr: null },
];

export const WALLETS: any = _wallets;

/* ================= TRANSACTIONS ================= */
const TX_KINDS: Record<string, { label: string; icon: string }> = {
  transfer: { label: "Transfer", icon: "arrow" },
  stake: { label: "Stake", icon: "lock" },
  unstake: { label: "Unstake", icon: "unlock" },
  reward: { label: "Reward claim", icon: "gift" },
  swap: { label: "DEX swap", icon: "swap" },
  "bridge-out": { label: "Bridge out", icon: "bridge" },
  "bridge-in": { label: "Bridge in", icon: "bridge" },
  contract: { label: "Contract call", icon: "code" },
};

/**
 * Transaction fallback rows. TxPage overlays live decoded transaction, receipt,
 * native receipt, fee, and proof fields when available.
 */
export const TXS: Record<string, any> = {};
WALLETS.forEach((w: any) => {
  w.txs.forEach((t: any) => {
    if (TXS[t.hash]) return;
    const r = _seed(parseInt(t.hash.slice(2, 8), 16) || 1);
    const from = t.direction === "out" ? w.addr : t.counterparty;
    const to = t.direction === "out" ? t.counterparty : w.addr;
    TXS[t.hash] = {
      hash: t.hash,
      round: t.round,
      roundLabel: `round ${t.round.toLocaleString()}`,
      when: t.when,
      kind: t.kind,
      kindLabel: TX_KINDS[t.kind]?.label || t.kind,
      status: t.status,
      from,
      to,
      amount: t.amount,
      denom: t.denom,
      fee: t.fee,
      feeDenom: "LYTH",
      cluster: `C-${String((t.round % 100) + 1).padStart(3, "0")}`,
      clusterName: MONOSCAN_DATA.clusters.find((c: any) => c.slot === (t.round % 100) + 1)?.name || "—",
      gasUsed: Math.floor(21_000 + r() * 80_000),
      gasLimit: Math.floor(120_000 + r() * 80_000),
      inputNote:
        t.kind === "transfer" && r() > 0.7
          ? "payroll · cycle 42"
          : t.kind === "swap"
          ? "orbital:MONO→USDC"
          : "",
      nonce: Math.floor(r() * 50_000),
      quorumSigners: 7,
      quorumRequired: 5,
      dacCoverage: 0.78 + r() * 0.22,
      signatures: [
        { op: "volans", ms: 12 + Math.floor(r() * 8) },
        { op: "sagitta", ms: 14 + Math.floor(r() * 10) },
        { op: "antares", ms: 13 + Math.floor(r() * 9) },
        { op: "phoenix", ms: 15 + Math.floor(r() * 11) },
        { op: "draco", ms: 14 + Math.floor(r() * 8) },
      ],
      contractInput:
        t.kind === "contract" || t.kind === "swap" ? "0xa9059cbb000000…<abridged>" : null,
      logs:
        t.kind === "swap"
          ? [
              {
                topic: "Swap",
                args: { pool: "MONO-USDC", amountIn: t.amount, amountOut: Math.floor(t.amount * 0.98), fee: 0.003 },
              },
            ]
          : t.kind === "stake"
          ? [
              {
                topic: "Delegate",
                args: { cluster: `C-${String((t.round % 100) + 1).padStart(3, "0")}`, amount: t.amount },
              },
            ]
          : [],
    };
  });
});
