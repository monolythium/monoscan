/**
 * Monoscan SDK seam.
 *
 * Single place every page/component gets typed access to a Monolythium v2
 * node from. Hand-written `fetch` calls are forbidden — import the
 * singletons here instead. See ../../CLAUDE.md section 4.3 + the orchestration
 * contract at ../../../CLAUDE.md section 6.
 */

import { RpcClient, type RpcClientOptions } from "@monolythium/core-sdk";

/**
 * Default RPC endpoint resolution.
 *
 * Two env vars are supported, in priority order:
 *   1. `VITE_MONOSCAN_RPC_URL` — explorer-specific override.
 *   2. `VITE_MONO_RPC_URL`     — workspace-wide fallback shared with the
 *                                wallets / Monarch builds (per
 *                                `monolythium-vision/CLAUDE.md` §6).
 *
 * If neither is set, default to a local node at `http://localhost:8545`.
 * Production deploys override via Railway env vars at build time.
 */
const DEFAULT_RPC_URL: string =
  (import.meta.env.VITE_MONOSCAN_RPC_URL as string | undefined) ??
  (import.meta.env.VITE_MONO_RPC_URL as string | undefined) ??
  "http://localhost:8545";

/**
 * Singleton RPC client. Lazily constructed so tests can `vi.mock` the module
 * without paying the network-config cost on import.
 */
let _rpc: RpcClient | null = null;

export function getRpcClient(opts: RpcClientOptions = {}): RpcClient {
  if (_rpc === null) {
    _rpc = new RpcClient(DEFAULT_RPC_URL, opts);
  }
  return _rpc;
}

/** Reset the singleton — only for tests / hot reload. */
export function resetRpcClient(): void {
  _rpc = null;
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
 * For now we expose the RPC as the indexer too so call sites can already
 * import the right symbol; the moment a real `IndexerClient` lands the swap
 * is one-line.
 */
export interface IndexerClient {
  /** Same wire-shape as RpcClient.call — kept for forward compat. */
  call<T>(method: string, params?: unknown): Promise<T>;
}

let _indexer: IndexerClient | null = null;

export function getIndexerClient(): IndexerClient {
  if (_indexer === null) {
    // TODO(monolythium-vision): swap in a typed IndexerClient once mono-core
    // ships the indexer API surface (see plans/monoscan.md Stage 3 +
    // mono-core OI-0070 / OI-0069). Reusing RpcClient.call keeps the seam
    // honest without forcing every page to know which client to import from.
    _indexer = getRpcClient();
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
  mempool: () => ["mono", "mempool"] as const,
  validatorSet: () => ["mono", "validators"] as const,
  validatorById: (id: string | number) => ["mono", "validator", id] as const,
  networkStatus: () => ["mono", "stats", "network"] as const,
  addressActivity: (addr: string) => ["mono", "address", addr] as const,
  accountBalance: (addr: string) => ["mono", "address", addr, "balance"] as const,
  accountPolicy: (addr: string) => ["mono", "address", addr, "policy"] as const,
  // TODO(monolythium-vision): no SDK exposure yet for markets / DAG vertices /
  // operators (cluster aggregate beyond `lyth_validatorSet`). Stays mock
  // until mono-core OI-0070 indexer + a `lyth_clob_*` namespace land.
  markets: () => ["mono", "markets"] as const,
  marketBySym: (sym: string) => ["mono", "markets", sym] as const,
  dagRecent: () => ["mono", "dag", "recent"] as const,
  gapRecords: (range: string) => ["mono", "gaps", range] as const,
} as const;
