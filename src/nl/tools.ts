/**
 * Typed tool implementations the (mock) LLM can invoke.
 *
 * Tools are live-first where mono-core already exposes a public RPC surface,
 * then fall back to deterministic fixtures for indexer-only fields.
 *
 * The remaining fixture paths are list-level aggregates or metadata surfaces
 * that the public RPC does not expose yet. The Anthropic tool definitions
 * consume these signatures verbatim, so each future swap is one body change.
 *
 * The fixtures are intentionally tiny — the goal is a coherent demo, not
 * exhaustive testnet replay.
 */

import { MARKETS, MONOSCAN_DATA } from "../data/mock";
import { getRpcClient, isRpcConfigured } from "../sdk/client";
import type { ToolName } from "./types";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const _hex = (n: number, w = 8): string =>
  n.toString(16).padStart(w, "0");

const _shortHash = (n: number): string =>
  `0x${_hex(n)}…${_hex(n * 7919, 4)}`;

const _toBig = (v: string | bigint | number | null | undefined): bigint => {
  if (v === null || v === undefined) return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(v);
  return BigInt(v);
};

const LYTHOSHI_PER_LYTH = 100_000_000n;

const _formatLyth = (lythoshi: bigint): string => {
  const sign = lythoshi < 0n ? "-" : "";
  const abs = lythoshi < 0n ? -lythoshi : lythoshi;
  const whole = abs / LYTHOSHI_PER_LYTH;
  const frac = abs % LYTHOSHI_PER_LYTH;
  if (frac === 0n) return `${sign}${whole}`;
  const fracText = frac.toString().padStart(8, "0").replace(/0+$/, "");
  return `${sign}${whole}.${fracText}`;
};

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
  bls_agg_ms: number;
  dac_coverage: number;
  status: "committed" | "pending";
}

/**
 * Look up a block by number or hash.
 *
 * Uses live block-header RPC when available. The per-block tx/DAC
 * enrichment remains fixture-backed until the indexer aggregate ships.
 */
export async function get_block(input: GetBlockInput): Promise<GetBlockResult> {
  const raw = String(input.number_or_hash).toLowerCase();
  const n = /^\d+$/.test(raw)
    ? parseInt(raw, 10)
    : 12_345; // fallback for hash queries — fixture key
  const seed = n;
  const cluster = ((seed % 28) + 1).toString().padStart(3, "0");
  const txCount = 14 + Math.floor(_rand(seed) * 60);
  const executionUnitLimit = 30_000_000;
  const executionUnitsUsed = Math.floor(executionUnitLimit * (0.18 + _rand(seed + 1) * 0.4));
  const fallback: GetBlockResult = {
    number: n,
    hash: _shortHash(n),
    parent_hash: _shortHash(n - 1),
    proposer_cluster: `C-${cluster}`,
    round: n + 102_311,
    timestamp_iso: new Date(Date.now() - (90_000 - n % 60_000))
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z"),
    tx_count: txCount,
    gas_used: executionUnitsUsed,
    gas_limit: executionUnitLimit,
    bls_agg_ms: 1.2 + _rand(seed + 2) * 0.9,
    dac_coverage: 0.94 + _rand(seed + 3) * 0.05,
    status: "committed",
  };
  if (!isRpcConfigured()) return fallback;
  try {
    const rpc = getRpcClient();
    const live = raw.startsWith("0x") && raw.length > 20
      ? await rpc.ethGetBlockByHash(String(input.number_or_hash))
      : await rpc.ethGetBlockByNumber(n);
    if (!live) return fallback;
    return {
      ...fallback,
      number: Number(live.number),
      hash: live.hash,
      parent_hash: live.parent_hash,
      round: Number(live.number),
      timestamp_iso: new Date(Number(live.timestamp) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
      gas_used: Number(live.executionUnitsUsed),
      gas_limit: Number(live.executionUnitLimit),
      status: "committed",
    };
  } catch {
    return fallback;
  }
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
  input_note: string | null;
  type: "transfer" | "swap" | "stake" | "contract";
}

/**
 * Fetch a transaction receipt by hash.
 *
 * Uses `lyth_decodeTx` when available so tx type, memo, status, and value
 * come from the same explorer-grade RPC the transaction page consumes.
 */
export async function get_tx(input: GetTxInput): Promise<GetTxResult> {
  const seed = input.hash.length;
  const types: GetTxResult["type"][] = ["transfer", "swap", "stake", "contract"];
  const fallback: GetTxResult = {
    hash: input.hash,
    block_number: 12_300 + (seed % 400),
    from: `0x${_hex(seed * 31 + 17, 4)}…${_hex(seed * 7 + 3, 4)}`,
    to: `0x${_hex(seed * 53 + 11, 4)}…${_hex(seed * 11 + 5, 4)}`,
    value_lyth: (1 + _rand(seed) * 999).toFixed(4),
    fee_lyth: (0.0001 + _rand(seed + 1) * 0.0009).toFixed(6),
    status: "success",
    input_note: null,
    type: types[seed % types.length],
  };
  if (!isRpcConfigured()) return fallback;
  try {
    const rpc = getRpcClient();
    const decoded = await rpc.lythDecodeTx(input.hash).catch(() => null);
    if (decoded) {
      const calldata = decoded.decodedCalldata && typeof decoded.decodedCalldata === "object"
        ? decoded.decodedCalldata as Record<string, unknown>
        : null;
      const method = String(calldata?.method ?? calldata?.methodName ?? "").toLowerCase();
      const type: GetTxResult["type"] = method.includes("swap")
        ? "swap"
        : method.includes("stake") || method.includes("delegat")
          ? "stake"
          : method
            ? "contract"
            : "transfer";
      return {
        ...fallback,
        hash: decoded.txHash,
        block_number: Number(decoded.blockNumber),
        from: decoded.from,
        to: decoded.to ?? "contract creation",
        value_lyth: _formatLyth(_toBig(decoded.value)),
        status: decoded.status === "reverted" ? "reverted" : "success",
        input_note: decoded.memo,
        type,
      };
    }
    const [tx, receipt] = await Promise.all([
      rpc.ethGetTransactionByHash(input.hash).catch(() => null),
      rpc.ethGetTransactionReceipt(input.hash).catch(() => null),
    ]);
    if (!tx && !receipt) return fallback;
    return {
      ...fallback,
      hash: tx?.hash ?? receipt?.tx_hash ?? input.hash,
      block_number: receipt ? Number(receipt.block_number) : tx ? Number(_toBig(tx.blockNumber)) : fallback.block_number,
      from: tx?.from ?? fallback.from,
      to: tx?.to ?? fallback.to,
      value_lyth: tx ? _formatLyth(_toBig(tx.value)) : fallback.value_lyth,
      status: receipt?.status === 0 ? "reverted" : "success",
      type: tx?.input && tx.input !== "0x" ? "contract" : "transfer",
    };
  } catch {
    return fallback;
  }
}

/* -------------------------------------------------------------------------- */
/* Tool: get_operator                                                         */
/* -------------------------------------------------------------------------- */

export interface GetOperatorInput {
  address: string;
}

export interface GetOperatorResult {
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
 * Look up an operator by address.
 *
 * TODO(monolythium): swap fixture for live SDK/indexer operator lookup.
 */
export function get_operator(input: GetOperatorInput): GetOperatorResult {
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
 * Uses live cluster descriptors when available. Rich operator roster, APY,
 * and recent signing aggregates still fall back to fixtures until OI-0070.
 */
export async function get_cluster(input: GetClusterInput): Promise<GetClusterResult> {
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
  const fallback: GetClusterResult = {
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
  if (!isRpcConfigured()) return fallback;
  try {
    const rpc = getRpcClient();
    const directory = await rpc.lythClusterDirectory(0, 100).catch(() => null);
    const rows = directory?.clusters ?? [];
    const live = rows.find((row) => row.clusterId === input.id);
    if (!live) return fallback;
    const status = await rpc.lythClusterStatus(live.clusterId).catch(() => null);
    const isHealthy = live.aggregateHealth === "ok";
    const liveOperators = status?.live ?? (live.active && isHealthy ? live.size : fallback.members_live);
    return {
      ...fallback,
      slot: live.clusterId,
      name: `Cluster ${String(live.clusterId).padStart(3, "0")}`,
      state: live.active && isHealthy ? "nominal" : live.active ? "maintenance" : "jail",
      members_live: liveOperators,
      members_total: status?.size ?? live.size,
      standby_count: Math.max(0, (status?.size ?? live.size) - liveOperators),
      tvs_m_lyth: fallback.tvs_m_lyth,
      rank: rows.findIndex((row) => row.clusterId === live.clusterId) + 1,
      active_operators:
        status?.members
          .filter((member) => member.state === "live")
          .slice(0, 7)
          .map((member) => member.operatorId) ?? fallback.active_operators,
    };
  } catch {
    return fallback;
  }
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
  reason: string;
  cluster_offline: string | null;
}

export interface GetGapRecordsResult {
  range: string;
  count: number;
  records: GapRecord[];
}

/**
 * Heartbeat-throttled empty-block gap records over a window.
 */
export async function get_gap_records(input: GetGapRecordsInput): Promise<GetGapRecordsResult> {
  const range = input.range ?? "24h";
  if (isRpcConfigured()) {
    try {
      const rpc = getRpcClient();
      const latest = Number(await rpc.ethBlockNumber());
      const span = range === "30d" ? 1024 : range === "7d" ? 512 : 128;
      const from = Math.max(0, latest - span);
      const live = await rpc.lythGapRecords(from, latest);
      return {
        range: `${Number(live.range.fromBlock).toLocaleString()}-${Number(live.range.toBlock).toLocaleString()}`,
        count: live.gapRecords.length,
        records: live.gapRecords.map((row) => ({
          start_round: Number(row.startBlock),
          end_round: Number(row.endBlock),
          duration_ms: Number(row.durationSeconds) * 1000,
          reason: row.reason,
          cluster_offline: null,
        })),
      };
    } catch {
      // Fall through to deterministic fixtures.
    }
  }
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
 * Uses the live CLOB market/search index when available. Market-cap and
 * 24h-change remain fixture-only fields; live CLOB summaries expose last
 * price, total base volume, and trade count.
 */
export async function search_tokens(input: SearchTokensInput): Promise<SearchTokensResult> {
  const q = input.query.toLowerCase().trim();
  if (isRpcConfigured()) {
    try {
      const rpc = getRpcClient();
      const [search, clob] = await Promise.all([
        rpc.lythSearch(input.query, 8).catch(() => null),
        rpc.lythClobMarkets(50).catch(() => null),
      ]);
      const hitIds = new Set((search?.hits ?? []).map((hit) => hit.id.toLowerCase()));
      const live = (clob?.markets ?? [])
        .filter((m) => m.marketId.toLowerCase().includes(q) || hitIds.has(m.marketId.toLowerCase()))
        .slice(0, 8)
        .map((m, i): TokenMatch => {
          const price = Number(m.lastPrice);
          const baseVolume = Number(m.totalVolumeBase);
          return {
            symbol: `MKT-${i + 1}`,
            name: `CLOB ${m.marketId.slice(0, 10)}…${m.marketId.slice(-6)}`,
            price_usd: Number((Number.isFinite(price) ? price : 0).toFixed(price < 1 ? 5 : 3)),
            change_24h_pct: 0,
            market_cap_usd: 0,
            volume_24h_usd: Math.round(
              Number.isFinite(price) && Number.isFinite(baseVolume) ? price * baseVolume : 0,
            ),
          };
        });
      if (live.length > 0) {
        return {
          query: input.query,
          count: live.length,
          tokens: live,
        };
      }
    } catch {
      // Fall through to fixture markets.
    }
  }
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
  type: "transfer" | "swap" | "stake" | "contract";
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
 * Recent activity for an address. Uses live balance/policy/activity when
 * the indexer-backed RPC returns rows; falls back to deterministic fixtures
 * when the queried address has no indexed activity yet.
 */
export async function get_address_activity(
  input: GetAddressActivityInput,
): Promise<GetAddressActivityResult> {
  const limit = input.limit ?? 5;
  const seed = input.address.length || 1;
  const types: AddressActivityRow["type"][] = [
    "transfer",
    "swap",
    "stake",
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
  const fallback: GetAddressActivityResult = {
    address: input.address,
    count: rows.length,
    activity: rows,
    balance_lyth: (1_200 + _rand(seed) * 8_000).toFixed(4),
    is_private_denomination: false,
  };
  if (!isRpcConfigured()) return fallback;
  try {
    const rpc = getRpcClient();
    const [profile, flow, balance, policy, activity] = await Promise.all([
      rpc.lythAddressProfile(input.address).catch(() => null),
      rpc.lythAddressFlow(input.address, Math.max(limit, 25)).catch(() => null),
      rpc.ethGetBalance(input.address, "latest").catch(() => null),
      rpc.lythGetAccountPolicy(input.address).catch(() => null),
      rpc.lythGetAddressActivity(input.address, limit).catch(() => []),
    ]);
    const liveRows: AddressActivityRow[] = activity.map((row, i) => {
      const type: AddressActivityRow["type"] =
        row.kind === "delegation" ? "stake"
          : row.kind === "staking" ? "stake"
            : row.kind === "swap" ? "swap"
              : row.kind === "transfer" ? "transfer"
                : "contract";
      return {
        hash: `block:${row.blockHeight}:${row.txIndex}:${row.logIndex}`,
        block_number: Number(row.blockHeight),
        direction: row.direction ?? "in",
        counterparty: row.counterparty ?? (row.cluster !== null ? `C-${String(row.cluster + 1).padStart(3, "0")}` : "—"),
        value_lyth: row.amount ?? (row.weightBps !== null ? `${row.weightBps} bps` : "—"),
        type,
        timestamp_relative: i === 0 ? "latest indexed" : `#${i + 1}`,
      };
    });
    const flowRows: AddressActivityRow[] = (flow?.topCounterparties ?? [])
      .slice(0, limit)
      .map((row, i) => ({
        hash: `counterparty:${i}`,
        block_number: 0,
        direction: _toBig(row.outbound) > _toBig(row.inbound) ? "out" : "in",
        counterparty: row.address,
        value_lyth: _formatLyth(_toBig(_toBig(row.outbound) > _toBig(row.inbound) ? row.outbound : row.inbound)),
        type: "transfer",
        timestamp_relative: `${row.eventCount} indexed event${row.eventCount === 1 ? "" : "s"}`,
      }));
    return {
      ...fallback,
      count: liveRows.length || flowRows.length,
      activity: liveRows.length > 0 ? liveRows : flowRows.length > 0 ? flowRows : fallback.activity,
      balance_lyth: profile
        ? _formatLyth(_toBig(profile.account.nativeBalance))
        : balance ? _formatLyth(_toBig(balance.value)) : fallback.balance_lyth,
      is_private_denomination: policy?.mode === "private" || profile?.activity.kind === "private",
    };
  } catch {
    return fallback;
  }
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
    description: "Fetch a block by number or hash. Returns committed state, execution-unit usage, transaction count, BLS aggregation, DAC coverage.",
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
    name: "get_operator",
    description: "Look up an operator by address. Returns reputation, uptime, cluster memberships.",
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
  get_operator,
  get_cluster,
  get_gap_records,
  search_tokens,
  get_address_activity,
} as const;

/**
 * Type-erased invoker the mock LLM uses. Real Claude integration calls
 * the same surface — just pulls `name` + `input` from the tool_use block.
 */
export async function invokeTool(name: ToolName, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_block":
      return get_block(input as unknown as GetBlockInput);
    case "get_tx":
      return get_tx(input as unknown as GetTxInput);
    case "get_operator":
      return get_operator(input as unknown as GetOperatorInput);
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
