/**
 * Monoscan SDK seam.
 *
 * Single place every page/component gets typed access to a Monolythium v4.0
 * node from. Hand-written `fetch` calls are forbidden — import the
 * singletons here instead. See ../../CLAUDE.md section 4.3 + the orchestration
 * contract at ../../../CLAUDE.md section 6.
 */

import {
  ApiClient,
  RpcClient,
  getRpcEndpoints,
  type ApiClientOptions,
  type RpcClientOptions,
} from "@monolythium/core-sdk";

/**
 * Default RPC endpoint resolution.
 *
 * Two env vars are supported, in priority order:
 *   1. `VITE_MONOSCAN_RPC_URL` — explorer-specific override.
 *   2. `VITE_MONO_RPC_URL`     — workspace-wide fallback shared with the
 *                                wallets / Monarch builds (per
 *                                `monolythium-vision/CLAUDE.md` §6).
 *
 * If neither is set, use the SDK-bundled chain-registry snapshot for
 * `testnet-69420`. This keeps browser sessions opened from another
 * machine from accidentally dialing their own `localhost:8545`.
 */
const REGISTRY_RPC_URL = getRpcEndpoints("testnet-69420")[0]?.url;

const RPC_URL: string =
  (import.meta.env.VITE_MONOSCAN_RPC_URL as string | undefined) ??
  (import.meta.env.VITE_MONO_RPC_URL as string | undefined) ??
  (import.meta.env.DEV ? "/rpc" : undefined) ??
  REGISTRY_RPC_URL;

const HASH32_RE = /^0x[0-9a-fA-F]{64}$/;
const DEFAULT_LYTH_TOKEN_ID = `0x${"00".repeat(32)}`;

export function isRpcConfigured(): boolean {
  return RPC_URL.trim().length > 0;
}

/**
 * Token id used for the public LYTH rich list. Override this when a
 * deployment has a non-zero canonical token id in the indexer.
 */
export function getLythTokenId(): string {
  const configured = import.meta.env.VITE_MONOSCAN_LYTH_TOKEN_ID as string | undefined;
  return configured && HASH32_RE.test(configured) ? configured : DEFAULT_LYTH_TOKEN_ID;
}

let _marketIds: Record<string, string> | null = null;

function parseMarketIds(): Record<string, string> {
  if (_marketIds !== null) return _marketIds;
  const raw = import.meta.env.VITE_MONOSCAN_MARKET_IDS as string | undefined;
  const out: Record<string, string> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      for (const [sym, id] of Object.entries(parsed)) {
        if (HASH32_RE.test(id)) out[sym.toUpperCase()] = id;
      }
    } catch {
      for (const entry of raw.split(/[;,]/)) {
        const [sym, id] = entry.split("=").map((s) => s.trim());
        if (sym && id && HASH32_RE.test(id)) out[sym.toUpperCase()] = id;
      }
    }
  }
  _marketIds = out;
  return out;
}

/**
 * Resolve a route token (`LYTH`, `USDC`, or a direct 32-byte id) to a CLOB
 * market id. Configure named markets with `VITE_MONOSCAN_MARKET_IDS`, either
 * as JSON (`{"LYTH":"0x..."}`) or `LYTH=0x...,USDC=0x...`.
 */
export function getMarketIdForSymbol(sym: string | undefined): string | undefined {
  if (!sym) return undefined;
  if (HASH32_RE.test(sym)) return sym;
  return parseMarketIds()[sym.toUpperCase()];
}

/**
 * Singleton RPC client. Lazily constructed so tests can `vi.mock` the module
 * without paying the network-config cost on import.
 */
let _rpc: RpcClient | null = null;
let _api: ApiClient | null = null;

export function getRpcClient(opts: RpcClientOptions = {}): RpcClient {
  if (!isRpcConfigured()) {
    throw new Error("Monoscan RPC URL is not configured");
  }
  if (_rpc === null) {
    _rpc = new RpcClient(RPC_URL, opts);
  }
  return _rpc;
}

/** Singleton `/api/v1` client derived from the configured RPC endpoint. */
export function getApiClient(opts: ApiClientOptions = {}): ApiClient {
  if (!isRpcConfigured()) {
    throw new Error("Monoscan API URL is not configured");
  }
  if (_api === null) {
    _api = new ApiClient(RPC_URL, opts);
  }
  return _api;
}

/** Reset the singleton — only for tests / hot reload. */
export function resetRpcClient(): void {
  _rpc = null;
  _api = null;
  _indexer = null;
  _marketIds = null;
}

/**
 * Build-time feature flag for the WebSocket head-subscription path.
 *
 * Today the SDK's `lyth_subscribe` rejects over the plain HTTP transport
 * (mono-core OI-0069 still pending). The 2-second long-poll inside
 * `useChainHead` is the temporary fallback. When OI-0069 lands, set
 * `VITE_MONOSCAN_USE_WS=true` at build time and the WebSocket branch in
 * `data/hooks.ts::readLatestHeadFromWebSocket` takes over.
 *
 * Returns `false` until the env var explicitly opts in. Any other value
 * (`"0"`, `"false"`, undefined) keeps the flag off.
 */
export function isWebSocketEnabled(): boolean {
  const v = import.meta.env.VITE_MONOSCAN_USE_WS as string | undefined;
  return v === "true" || v === "1";
}

/**
 * Indexer client placeholder.
 *
 * Stage 3 of `plans/monoscan.md` wires per-node indexer streams
 * (block + tx WebSocket subscriptions, address-activity feed, gap records,
 * private-asset policy lookups). `lyth_subscribe` is the WebSocket entry
 * point but currently returns `not-implemented` over HTTP transport
 * (mono-core OI-0069 — until that lands monoscan long-polls instead).
 *
 * For now we expose the node API as the indexer too so call sites can already
 * import the right symbol; the moment a dedicated streaming `IndexerClient`
 * lands the swap is one-line.
 */
export interface IndexerClient {
  /** Same relative-path shape as ApiClient.get — kept for forward compat. */
  get<T>(path: string, query?: Record<string, string | number | bigint | boolean | null | undefined>): Promise<T>;
}

let _indexer: IndexerClient | null = null;

export function getIndexerClient(): IndexerClient {
  if (!isRpcConfigured()) {
    throw new Error("Monoscan indexer URL is not configured");
  }
  if (_indexer === null) {
    // TODO(monolythium-vision): swap in a streaming IndexerClient once
    // mono-core ships OI-0069. The HTTP `/api/v1` client is enough for the
    // current block, tx, address, cluster, and operator reads.
    _indexer = getApiClient();
  }
  return _indexer;
}

/** React-Query keys, kept in one place so cache invalidation is grep-able. */
export const QK = {
  head: () => ["mono", "head"] as const,
  headStrip: () => ["mono", "head", "strip"] as const,
  blockByNumber: (n: number | "latest") => ["mono", "block", "byNumber", n] as const,
  blockByHash: (h: string) => ["mono", "block", "byHash", h] as const,
  blocksLatest: (n: number) => ["mono", "blocks", "latest", n] as const,
  txReceipt: (h: string) => ["mono", "tx", h] as const,
  txLive: (h: string) => ["mono", "tx", h, "live"] as const,
  txFeed: (limit: number, cursor: string | null = null) =>
    ["mono", "transactions", "feed", limit, cursor ?? "head"] as const,
  latestTransactions: (limit: number, blockWindow: number) =>
    ["mono", "transactions", "latest", limit, blockWindow] as const,
  mempool: () => ["mono", "mempool"] as const,
  clusterSet: () => ["mono", "clusters"] as const,
  activeClusters: () => ["mono", "clusters", "active"] as const,
  healthyClusters: () => ["mono", "clusters", "healthy"] as const,
  clusterStatus: (id: string | number) => ["mono", "cluster", id, "status"] as const,
  clusterEntity: (id: string | number) => ["mono", "cluster", id, "entity"] as const,
  operatorAuthority: (id: string) => ["mono", "operator", id, "authority"] as const,
  operatorInfo: (id: string) => ["mono", "operator", id, "info"] as const,
  operatorSigningActivity: (idx: string | number) => ["mono", "operator", idx, "signing"] as const,
  operatorDuties: (idx: string | number) => ["mono", "operator", idx, "duties"] as const,
  operatorRisk: (idx: string | number) => ["mono", "operator", idx, "risk"] as const,
  delegationCap: () => ["mono", "clusters", "delegation-cap"] as const,
  entityRatchet: () => ["mono", "clusters", "entity-ratchet"] as const,
  syncStatus: () => ["mono", "sync"] as const,
  p2pPeers: () => ["mono", "peers"] as const,
  precompiles: () => ["mono", "protocol", "precompiles"] as const,
  capabilities: () => ["mono", "protocol", "capabilities"] as const,
  latestCheckpoint: (belowHeight: number | string | null = null) =>
    ["mono", "protocol", "latest-checkpoint", belowHeight ?? "latest"] as const,
  clusterResignations: (operator: string | null = null, status: string | null = null) =>
    ["mono", "protocol", "cluster-resignations", operator ?? "all", status ?? "all"] as const,
  blsRoundCert: (round: number | string) => ["mono", "round", round, "bls-cert"] as const,
  feeStats: () => ["mono", "protocol", "fees"] as const,
  encryptionKey: () => ["mono", "protocol", "encryption-key"] as const,
  clusterDelegators: (id: string | number) => ["mono", "cluster", id, "delegators"] as const,
  walletDelegations: (addr: string) => ["mono", "address", addr, "delegations"] as const,
  walletDelegationHistory: (addr: string) => ["mono", "address", addr, "delegation-history"] as const,
  tokenBalances: (addr: string) => ["mono", "address", addr, "token-balances"] as const,
  addressLabel: (addr: string) => ["mono", "address", addr, "label"] as const,
  accountCode: (addr: string) => ["mono", "address", addr, "code"] as const,
  networkStatus: () => ["mono", "stats", "network"] as const,
  chainStats: () => ["mono", "stats", "chain"] as const,
  addressActivity: (addr: string) => ["mono", "address", addr] as const,
  addressProfile: (addr: string) => ["mono", "address", addr, "profile"] as const,
  addressFlow: (addr: string, limit: number) => ["mono", "address", addr, "flow", limit] as const,
  accountBalance: (addr: string) => ["mono", "address", addr, "balance"] as const,
  accountPolicy: (addr: string) => ["mono", "address", addr, "policy"] as const,
  addressActivityKind: (addr: string) => ["mono", "address", addr, "activity-kind"] as const,
  richList: (tokenId: string, limit: number) => ["mono", "rich-list", tokenId, limit] as const,
  search: (query: string, limit: number) => ["mono", "search", query, limit] as const,
  markets: () => ["mono", "markets"] as const,
  marketBySym: (sym: string) => ["mono", "markets", sym] as const,
  clobMarket: (marketId: string) => ["mono", "markets", "clob", marketId] as const,
  clobMarkets: (limit: number) => ["mono", "markets", "clob", "list", limit] as const,
  clobTrades: (marketId: string, limit: number, cursor: string | null = null) =>
    ["mono", "markets", "clob", marketId, "trades", limit, cursor ?? "head"] as const,
  clobOhlc: (
    marketId: string,
    fromBlock: number | bigint | string | null = null,
    toBlock: number | bigint | string | null = null,
    bucketBlocks: number | bigint | string | null = null,
  ) =>
    [
      "mono",
      "markets",
      "clob",
      marketId,
      "ohlc",
      fromBlock?.toString() ?? "auto",
      toBlock?.toString() ?? "auto",
      bucketBlocks?.toString() ?? "auto",
    ] as const,
  clobOrderBook: (marketId: string, levels: number | null = null) =>
    ["mono", "markets", "clob", marketId, "order-book", levels ?? "default"] as const,
  dagRecent: () => ["mono", "dag", "recent"] as const,
  verticesAtRound: (round: number | string) => ["mono", "dag", "vertices", round] as const,
  dagParents: (round: number | string) => ["mono", "dag", "parents", round] as const,
  gapRecords: (from: number | string, to: number | string) => ["mono", "gaps", from, to] as const,
} as const;
