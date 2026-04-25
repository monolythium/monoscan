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
 * Default RPC endpoint used by the production explorer.
 *
 * Override at build time with `VITE_MONOSCAN_RPC_URL` (e.g. for self-hosters
 * pointing at their own mono-core node).
 */
const DEFAULT_RPC_URL: string =
  (import.meta.env.VITE_MONOSCAN_RPC_URL as string | undefined) ??
  "https://rpc.monolythium.com";

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
 * Indexer client placeholder.
 *
 * Stage 3 of `plans/monoscan.md` wires per-node indexer streams
 * (block + tx WebSocket subscriptions, address-activity feed, gap records,
 * private-asset policy lookups). Until `protocore_subscribe` over WS lands
 * (mono-core OI-0069), the indexer surface is HTTP-only — same `RpcClient`,
 * different family of methods.
 *
 * For Stage 2 we expose the RPC as the indexer too so call sites can already
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
  blockByNumber: (n: number | "latest") => ["mono", "block", "byNumber", n] as const,
  blockByHash: (h: string) => ["mono", "block", "byHash", h] as const,
  txReceipt: (h: string) => ["mono", "tx", h] as const,
  validatorSet: () => ["mono", "validators"] as const,
  validatorById: (id: string | number) => ["mono", "validator", id] as const,
  addressActivity: (addr: string) => ["mono", "address", addr] as const,
  accountBalance: (addr: string) => ["mono", "address", addr, "balance"] as const,
  accountPolicy: (addr: string) => ["mono", "address", addr, "policy"] as const,
  // TODO(monolythium-vision): no SDK exposure yet for markets / DAG vertices /
  // gap records — see Stage 3 wiring in plans/monoscan.md.
  markets: () => ["mono", "markets"] as const,
  marketBySym: (sym: string) => ["mono", "markets", sym] as const,
  dagRecent: () => ["mono", "dag", "recent"] as const,
  gapRecords: (range: string) => ["mono", "gaps", range] as const,
} as const;
