/**
 * Typed tool implementations the (mock) LLM can invoke.
 *
 * Each tool here is **pure mockup** — it returns a deterministic fixture
 * keyed off the input. No live RPC, no SDK calls. The shapes match what
 * the real `@monolythium/core-sdk` + indexer API will return so the
 * renderer + tool-call signatures don't change when we swap to live data.
 *
 * TODO(monolythium-vision): swap each fixture function for the live SDK +
 * indexer call once mono-core OI-0070 (indexer aggregate) lands. The
 * Anthropic tool definitions consume these signatures verbatim, so the
 * swap is one body-change per function.
 *
 * The fixtures are intentionally tiny — the goal is a coherent demo, not
 * exhaustive testnet replay.
 */

import { MARKETS, MONOSCAN_DATA } from "../data/mock";
import type { ToolName } from "./types";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const _hex = (n: number, w = 8): string =>
  n.toString(16).padStart(w, "0");

const _shortHash = (n: number): string =>
  `0x${_hex(n)}…${_hex(n * 7919, 4)}`;

/** Deterministic pseudo-random in [0, 1) — keyed off an integer. */
const _rand = (seed: number): number => {
  // Mulberry32 — small + deterministic + good enough for fixtures.
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/* -------------------------------------------------------------------------- */
/* Tool: get_block                                                            */
/* -------------------------------------------------------------------------- */

export interface GetBlockInput {
  /** Block number or hex hash. */
  number_or_hash: string | number;
}

export interface GetBlockResult {
  number: number;
  hash: string;
  parent_hash: string;
  proposer_cluster: string;
  round: number;
  timestamp_iso: string;
  tx_count: number;
  gas_used: number;
  gas_limit: number;
  memo_count: number;
  bls_agg_ms: number;
  dac_coverage: number;
  status: "committed" | "pending";
}

/**
 * Look up a block by number or hash.
 *
 * TODO(monolythium-vision): swap fixture for live SDK call
 * (`getRpcClient().ethGetBlockByNumber(...)`) once OI-0070 lands.
 */
export function get_block(input: GetBlockInput): GetBlockResult {
  const raw = String(input.number_or_hash).toLowerCase();
  const n = /^\d+$/.test(raw)
    ? parseInt(raw, 10)
    : 12_345; // fallback for hash queries — fixture key
  const seed = n;
  const cluster = ((seed % 28) + 1).toString().padStart(3, "0");
  const txCount = 14 + Math.floor(_rand(seed) * 60);
  const gasLimit = 30_000_000;
  const gasUsed = Math.floor(gasLimit * (0.18 + _rand(seed + 1) * 0.4));
  return {
    number: n,
    hash: _shortHash(n),
    parent_hash: _shortHash(n - 1),
    proposer_cluster: `C-${cluster}`,
    round: n + 102_311,
    timestamp_iso: new Date(Date.now() - (90_000 - n % 60_000))
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z"),
    tx_count: txCount,
    gas_used: gasUsed,
    gas_limit: gasLimit,
    memo_count: Math.max(1, Math.floor(txCount * 0.62)),
    bls_agg_ms: 1.2 + _rand(seed + 2) * 0.9,
    dac_coverage: 0.94 + _rand(seed + 3) * 0.05,
    status: "committed",
  };
}

/* -------------------------------------------------------------------------- */
/* Tool: get_tx                                                               */
/* -------------------------------------------------------------------------- */

export interface GetTxInput {
  hash: string;
}

export interface GetTxResult {
  hash: string;
  block_number: number;
  from: string;
  to: string;
  value_lyth: string;
  fee_lyth: string;
  status: "success" | "reverted";
  memo: string | null;
  type: "transfer" | "swap" | "stake" | "vote" | "contract";
}

/**
 * Fetch a transaction receipt by hash.
 *
 * TODO(monolythium-vision): swap fixture for live SDK call
 * (`getRpcClient().ethGetTransactionReceipt(...)`).
 */
export function get_tx(input: GetTxInput): GetTxResult {
  const seed = input.hash.length;
  const types: GetTxResult["type"][] = ["transfer", "swap", "stake", "vote", "contract"];
  return {
    hash: input.hash,
    block_number: 12_300 + (seed % 400),
    from: `0x${_hex(seed * 31 + 17, 4)}…${_hex(seed * 7 + 3, 4)}`,
    to: `0x${_hex(seed * 53 + 11, 4)}…${_hex(seed * 11 + 5, 4)}`,
    value_lyth: (1 + _rand(seed) * 999).toFixed(4),
    fee_lyth: (0.0001 + _rand(seed + 1) * 0.0009).toFixed(6),
    status: "success",
    memo: seed % 4 === 0 ? "PROP-43:YES" : null,
    type: types[seed % types.length],
  };
}

/* -------------------------------------------------------------------------- */
/* Tool: get_validator                                                        */
/* -------------------------------------------------------------------------- */

export interface GetValidatorInput {
  address: string;
}

export interface GetValidatorResult {
  address: string;
  handle: string;
  region: string;
  reputation: number;
  uptime_90d: number;
  bonded: number;
  active_clusters: string[];
  standby_clusters: string[];
  slashes: number;
  active_since_round: number;
}

/**
 * Look up a validator/operator by address.
 *
 * TODO(monolythium-vision): swap fixture for live SDK call
 * (`getRpcClient().protocoreValidatorSet()` filtered by address).
 */
export function get_validator(input: GetValidatorInput): GetValidatorResult {
  const D: any = MONOSCAN_DATA;
  const ops: any[] = D.operators || [];
  const found = ops.find((o) =>
    o.addrShort.toLowerCase().includes(input.address.toLowerCase()),
  );
  const op = found || ops[0];
  return {
    address: op.addrShort,
    handle: op.handle,
    region: op.region,
    reputation: Number(op.reputation.toFixed(3)),
    uptime_90d: Number(op.uptime.toFixed(4)),
    bonded: op.bonded,
    active_clusters: op.memberships
      .filter((m: any) => m.role === "active")
      .map((m: any) => `C-${String(m.slot).padStart(3, "0")}`),
    standby_clusters: op.memberships
      .filter((m: any) => m.role === "standby")
      .map((m: any) => `C-${String(m.slot).padStart(3, "0")}`),
    slashes: op.slashes,
    active_since_round: 2_800_000 + (op.handle.charCodeAt(0) % 200_000),
  };
}

/* -------------------------------------------------------------------------- */
/* Tool: get_cluster                                                          */
/* -------------------------------------------------------------------------- */

export interface GetClusterInput {
  /** Cluster slot number (1-based). */
  id: number;
}

export interface GetClusterResult {
  slot: number;
  name: string;
  state: "nominal" | "maintenance" | "jail";
  members_live: number;
  members_total: number;
  standby_count: number;
  tvs_m_lyth: number;
  recent_rounds_signed: number;
  recent_rounds_window: number;
  apy_pct: number;
  rank: number | null;
  active_operators: string[];
}

/**
 * Fetch cluster summary + recent-round signing record.
 *
 * TODO(monolythium-vision): swap fixture for live SDK call (cluster
 * aggregate is OI-0070 — protocoreValidatorSet today only returns the
 * raw active set).
 */
export function get_cluster(input: GetClusterInput): GetClusterResult {
  const D: any = MONOSCAN_DATA;
  const clusters: any[] = D.clusters || [];
  const cl = clusters.find((c) => c.slot === input.id) || clusters[0];
  const window = 100;
  const signed =
    cl.state === "nominal"
      ? window - Math.floor(_rand(cl.slot) * 3)
      : cl.state === "maintenance"
        ? window - 6 - Math.floor(_rand(cl.slot) * 4)
        : window - 18 - Math.floor(_rand(cl.slot) * 6);
  return {
    slot: cl.slot,
    name: cl.name,
    state: cl.state,
    members_live: cl.members,
    members_total: cl.size,
    standby_count: cl.backupCount,
    tvs_m_lyth: Number(cl.tvs),
    recent_rounds_signed: signed,
    recent_rounds_window: window,
    apy_pct: Number((5.8 + _rand(cl.slot + 9) * 1.4).toFixed(2)),
    rank: cl.rank ?? null,
    active_operators: (cl.opMembers || [])
      .slice(0, 7)
      .map((m: any) => m.handle),
  };
}

/* -------------------------------------------------------------------------- */
/* Tool: get_gap_records                                                      */
/* -------------------------------------------------------------------------- */

export interface GetGapRecordsInput {
  /** Range string: "24h" | "7d" | "30d" — fixture is mostly for 24h. */
  range?: string;
}

export interface GapRecord {
  start_round: number;
  end_round: number;
  duration_ms: number;
  reason: "heartbeat" | "network-pause" | "coalesced";
  cluster_offline: string | null;
}

export interface GetGapRecordsResult {
  range: string;
  count: number;
  records: GapRecord[];
}

/**
 * Heartbeat-throttled empty-block gap records over a window.
 *
 * TODO(monolythium-vision): swap fixture for live indexer call once
 * mono-core OI-0070 ships the gap-record digest. The data model already
 * matches `memory/protocore-v2-node-specs.md`.
 */
export function get_gap_records(input: GetGapRecordsInput): GetGapRecordsResult {
  const range = input.range ?? "24h";
  // Three canned records — tuned to look like a real testnet day:
  // one heartbeat coalesced gap, one network pause from a cluster outage,
  // and one short maintenance window.
  const records: GapRecord[] = [
    {
      start_round: 12_341,
      end_round: 12_343,
      duration_ms: 2_140,
      reason: "heartbeat",
      cluster_offline: null,
    },
    {
      start_round: 12_402,
      end_round: 12_419,
      duration_ms: 19_870,
      reason: "network-pause",
      cluster_offline: "C-014",
    },
    {
      start_round: 12_511,
      end_round: 12_512,
      duration_ms: 980,
      reason: "coalesced",
      cluster_offline: null,
    },
  ];
  return {
    range,
    count: records.length,
    records,
  };
}

/* -------------------------------------------------------------------------- */
/* Tool: search_tokens                                                        */
/* -------------------------------------------------------------------------- */

export interface SearchTokensInput {
  query: string;
}

export interface TokenMatch {
  symbol: string;
  name: string;
  price_usd: number;
  change_24h_pct: number;
  market_cap_usd: number;
  volume_24h_usd: number;
}

export interface SearchTokensResult {
  query: string;
  count: number;
  tokens: TokenMatch[];
}

/**
 * Substring search over the listed market set.
 *
 * TODO(monolythium-vision): swap fixture for live indexer call once
 * mono-core ships a `protocore_searchTokens` namespace (currently mocked
 * via `data/mock.ts::MARKETS`).
 */
export function search_tokens(input: SearchTokensInput): SearchTokensResult {
  const q = input.query.toLowerCase().trim();
  const matched = (MARKETS as any[])
    .filter(
      (m) =>
        m.sym.toLowerCase().includes(q) ||
        (m.name || "").toLowerCase().includes(q),
    )
    .slice(0, 8)
    .map(
      (m): TokenMatch => ({
        symbol: m.sym,
        name: m.name,
        price_usd: Number(Number(m.price).toFixed(m.price < 1 ? 5 : 3)),
        change_24h_pct: Number(Number(m.chg24h).toFixed(2)),
        market_cap_usd: Math.round(m.mcap),
        volume_24h_usd: Math.round(m.vol24h),
      }),
    );
  return {
    query: input.query,
    count: matched.length,
    tokens: matched,
  };
}

/* -------------------------------------------------------------------------- */
/* Tool: get_address_activity                                                 */
/* -------------------------------------------------------------------------- */

export interface GetAddressActivityInput {
  address: string;
  /** Optional limit (default 5). */
  limit?: number;
}

export interface AddressActivityRow {
  hash: string;
  block_number: number;
  direction: "in" | "out";
  counterparty: string;
  value_lyth: string;
  type: "transfer" | "swap" | "stake" | "vote" | "contract";
  timestamp_relative: string;
}

export interface GetAddressActivityResult {
  address: string;
  count: number;
  activity: AddressActivityRow[];
  balance_lyth: string;
  is_private_denomination: boolean;
}

/**
 * Recent activity for an address. Fixture data — real implementation
 * paginates the indexer's per-address feed.
 *
 * TODO(monolythium-vision): swap fixture for live indexer call once
 * mono-core OI-0070 ships the per-address activity feed. Privacy gate:
 * if the indexer reports `is_private_denomination: true` the renderer
 * must hide amounts (per `memory/protocore-v2-privacy-bifurcation.md`).
 */
export function get_address_activity(
  input: GetAddressActivityInput,
): GetAddressActivityResult {
  const limit = input.limit ?? 5;
  const seed = input.address.length || 1;
  const types: AddressActivityRow["type"][] = [
    "transfer",
    "swap",
    "stake",
    "vote",
    "contract",
  ];
  const rows: AddressActivityRow[] = Array.from({ length: limit }, (_, i) => {
    const r = _rand(seed + i);
    return {
      hash: _shortHash(seed * 1000 + i * 31),
      block_number: 12_500 - i * 7,
      direction: r > 0.5 ? "out" : "in",
      counterparty: `0x${_hex(seed + i * 17, 4)}…${_hex(seed * 13 + i, 4)}`,
      value_lyth: (0.5 + _rand(seed + i + 9) * 240).toFixed(4),
      type: types[(seed + i) % types.length],
      timestamp_relative: `${i * 4 + 1}m ago`,
    };
  });
  return {
    address: input.address,
    count: rows.length,
    activity: rows,
    balance_lyth: (1_200 + _rand(seed) * 8_000).toFixed(4),
    is_private_denomination: false,
  };
}

/* -------------------------------------------------------------------------- */
/* Dispatch + tool catalog                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Catalog of every tool the (mock) LLM can invoke. Mirrors the shape an
 * Anthropic Messages API `tools: [...]` array expects — `name` +
 * `description` + JSON-Schema `input_schema`. The mock LLM does not
 * actually consult these (it pattern-matches), but keeping them here
 * means the swap to real Claude is one diff.
 */
export const TOOL_CATALOG: ReadonlyArray<{
  name: ToolName;
  description: string;
  input_schema: Record<string, unknown>;
}> = [
  {
    name: "get_block",
    description: "Fetch a block by number or hash. Returns committed state, gas, memo count, BLS aggregation, DAC coverage.",
    input_schema: {
      type: "object",
      properties: {
        number_or_hash: {
          oneOf: [{ type: "integer" }, { type: "string" }],
          description: "Block height (e.g. 12345) or full/short block hash.",
        },
      },
      required: ["number_or_hash"],
    },
  },
  {
    name: "get_tx",
    description: "Fetch a transaction receipt by hash.",
    input_schema: {
      type: "object",
      properties: { hash: { type: "string" } },
      required: ["hash"],
    },
  },
  {
    name: "get_validator",
    description: "Look up a validator/operator by address. Returns reputation, uptime, cluster memberships.",
    input_schema: {
      type: "object",
      properties: { address: { type: "string" } },
      required: ["address"],
    },
  },
  {
    name: "get_cluster",
    description: "Fetch DVT cluster summary by slot id (1-based).",
    input_schema: {
      type: "object",
      properties: { id: { type: "integer", minimum: 1 } },
      required: ["id"],
    },
  },
  {
    name: "get_gap_records",
    description: "Heartbeat-throttled empty-block gap records over a window.",
    input_schema: {
      type: "object",
      properties: {
        range: {
          type: "string",
          enum: ["24h", "7d", "30d"],
          default: "24h",
        },
      },
    },
  },
  {
    name: "search_tokens",
    description: "Substring search over listed markets — symbol or name.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "get_address_activity",
    description: "Recent transactions for an address. Honors privacy bifurcation.",
    input_schema: {
      type: "object",
      properties: {
        address: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["address"],
    },
  },
];

/** Dispatch table — keyed by tool name, returns the typed result. */
export const TOOLS = {
  get_block,
  get_tx,
  get_validator,
  get_cluster,
  get_gap_records,
  search_tokens,
  get_address_activity,
} as const;

/**
 * Type-erased invoker the mock LLM uses. Real Claude integration calls
 * the same surface — just pulls `name` + `input` from the tool_use block.
 */
export function invokeTool(name: ToolName, input: Record<string, unknown>): unknown {
  switch (name) {
    case "get_block":
      return get_block(input as unknown as GetBlockInput);
    case "get_tx":
      return get_tx(input as unknown as GetTxInput);
    case "get_validator":
      return get_validator(input as unknown as GetValidatorInput);
    case "get_cluster":
      return get_cluster(input as unknown as GetClusterInput);
    case "get_gap_records":
      return get_gap_records(input as unknown as GetGapRecordsInput);
    case "search_tokens":
      return search_tokens(input as unknown as SearchTokensInput);
    case "get_address_activity":
      return get_address_activity(input as unknown as GetAddressActivityInput);
  }
}
