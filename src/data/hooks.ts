/**
 * React-Query hooks for monoscan.
 *
 * Single seam through which every page reads chain data. Hooks return
 * already-typed values from the SDK; mock fallbacks live in `./mock` and are
 * tagged `TODO(monolythium-vision)` for swap-out as the indexer surface lands
 * (per `plans/monoscan.md` Stage 3).
 *
 * Cache strategy:
 *   - chain head polls every 2s (Stage 3 long-poll target; switches to a
 *     `protocore_subscribe` WebSocket the moment mono-core OI-0069 lands).
 *   - block / tx detail is on-demand with staleTime 30s; receipts are
 *     immutable once finalized so retry-on-mount is cheap.
 *   - validator/cluster/account surfaces use staleTime 30s — slow-moving
 *     bookkeeping rather than live ticker.
 *
 * Reset side: tests can call `queryClient.clear()` on the exported singleton.
 */

import { QueryClient, useQuery } from "@tanstack/react-query";
import type { BlockHeader, RpcClient, TransactionReceipt } from "@monolythium/core-sdk";
import { getRpcClient, QK } from "../sdk/client";

/** Singleton React-Query client. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

/** How often to long-poll the chain head until WS lands (mono-core OI-0069). */
const HEAD_POLL_MS = 2_000;

/* -------------------------------------------------------------------------- */
/* Live chain head — drives the top strip ticker.                              */
/* -------------------------------------------------------------------------- */

/** Compact chain-head digest the top strip + landing page consume. */
export interface ChainHead {
  round: number;
  blockNumber: number | null;
}

export function useChainHead() {
  return useQuery<ChainHead | null>({
    queryKey: QK.head(),
    queryFn: async () => {
      const rpc: RpcClient = getRpcClient();
      // protocore_currentRound returns the active DAG round info.
      // Today the wire shape is `{ height }` only; richer fields (rate,
      // latency, signers) come through the indexer surface in Stage 3.
      // TODO(monolythium-vision): swap to a richer chain-head digest once
      // the indexer ships the per-round metrics view (mono-core OI-0070).
      try {
        const round = await rpc.protocoreCurrentRound();
        const block = await rpc.ethBlockNumber().catch(() => null);
        return {
          round: Number(round.height ?? 0),
          blockNumber: block,
        };
      } catch {
        // Live node unreachable — return null so consumers fall back to mock.
        return null;
      }
    },
    refetchInterval: HEAD_POLL_MS,
    // Stale instantly so the 2s poll always refetches when mounted.
    staleTime: 0,
  });
}

/**
 * Aggregate chain-strip digest (round + block + peers + node version +
 * indexer height + mempool depth) the top strip surfaces in one shot.
 *
 * Each sub-call is best-effort — if a method fails (e.g. node disabled
 * `protocore_indexerStatus`) the field is `null` rather than the whole
 * digest going dark. This is the closest we can get to the rich strip
 * the design asks for until OI-0070 ships an aggregate.
 */
export interface ChainStrip {
  round: number | null;
  blockNumber: number | null;
  peerCount: number | null;
  netVersion: string | null;
  clientVersion: string | null;
  mempoolReady: number | null;
  indexerHeight: number | null;
}

export function useChainStrip() {
  return useQuery<ChainStrip | null>({
    queryKey: ["mono", "head", "strip"] as const,
    queryFn: async () => {
      const rpc = getRpcClient();
      const settle = async <T>(p: Promise<T>): Promise<T | null> => {
        try {
          return await p;
        } catch {
          return null;
        }
      };
      try {
        const [round, blockNumber, peerCount, netVersion, clientVersion, mempool, indexer] =
          await Promise.all([
            settle(rpc.protocoreCurrentRound().then((r) => Number(r.height ?? 0))),
            settle(rpc.ethBlockNumber()),
            settle(rpc.netPeerCount()),
            settle(rpc.netVersion()),
            settle(rpc.web3ClientVersion()),
            settle(rpc.protocoreMempoolStatus()),
            settle(rpc.protocoreIndexerStatus()),
          ]);
        return {
          round,
          blockNumber,
          peerCount,
          netVersion,
          clientVersion,
          mempoolReady: mempool ? mempool.count_ready : null,
          indexerHeight: indexer ? indexer.currentHeight : null,
        };
      } catch {
        return null;
      }
    },
    refetchInterval: HEAD_POLL_MS,
    staleTime: 0,
  });
}

/* -------------------------------------------------------------------------- */
/* Block detail / list views.                                                  */
/* -------------------------------------------------------------------------- */

export function useBlockByHash(hash: string | undefined) {
  return useQuery<BlockHeader | null>({
    queryKey: QK.blockByHash(hash ?? ""),
    enabled: Boolean(hash),
    queryFn: async () => {
      const rpc = getRpcClient();
      return rpc.ethGetBlockByHash(hash as string);
    },
  });
}

/**
 * Fetch a single block header by height. `"latest"` always re-fetches with
 * the head poll to avoid stale chain tip.
 */
export function useBlockByNumber(n: number | "latest" | undefined) {
  return useQuery<BlockHeader | null>({
    queryKey: QK.blockByNumber(n ?? "latest"),
    enabled: n !== undefined,
    queryFn: async () => {
      const rpc = getRpcClient();
      return rpc.ethGetBlockByNumber(n as number | "latest");
    },
    // For the chain tip we want the head poll cadence; for fixed heights
    // headers are immutable so default 30s staleTime is fine.
    refetchInterval: n === "latest" ? HEAD_POLL_MS : false,
    staleTime: n === "latest" ? 0 : 30_000,
  });
}

/**
 * Page through the most-recent N blocks ending at the head. Used by the
 * landing-page live feed and the dedicated block-list view (when added).
 *
 * The first request fans out to N parallel `eth_getBlockByNumber` calls;
 * subsequent polls reuse the cached entries and only fetch the new tip
 * blocks. (React Query handles per-block caching; the wrapper just sequences
 * the height list.)
 */
export function useLatestBlocks(count = 10) {
  return useQuery<BlockHeader[]>({
    queryKey: ["mono", "blocks", "latest", count] as const,
    queryFn: async () => {
      const rpc = getRpcClient();
      const tip = await rpc.ethBlockNumber();
      const heights = Array.from({ length: count }, (_, i) => tip - i).filter((h) => h >= 0);
      const blocks = await Promise.all(
        heights.map((h) =>
          rpc.ethGetBlockByNumber(h).catch(() => null),
        ),
      );
      return blocks.filter((b): b is BlockHeader => b !== null);
    },
    refetchInterval: HEAD_POLL_MS,
    staleTime: 0,
  });
}

/* -------------------------------------------------------------------------- */
/* Transaction detail.                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Hook around `eth_getTransactionReceipt`. Returns the receipt envelope; the
 * mempool / indexer trace surface lives in `useTxTrace` once OI-0070 lands.
 */
export function useTxReceipt(hash: string | undefined) {
  return useQuery<TransactionReceipt | null>({
    queryKey: QK.txReceipt(hash ?? ""),
    enabled: Boolean(hash),
    queryFn: async () => {
      const rpc = getRpcClient();
      return rpc.ethGetTransactionReceipt(hash as string);
    },
  });
}

/**
 * Combined live tx-detail surface. Returns the live receipt when the node
 * has it, otherwise `null` so the caller can fall back to mocked detail.
 *
 * TODO(monolythium-vision): when the indexer ships logs + decoded calldata
 * + sig timeline (mono-core OI-0070), wire that here so TxPage can render
 * the rich attestation panel without the mock fixture.
 */
export function useTxByHashLive(hash: string | undefined) {
  return useQuery<TransactionReceipt | null>({
    queryKey: ["mono", "tx", hash ?? "", "live"] as const,
    enabled: Boolean(hash),
    queryFn: async () => {
      const rpc = getRpcClient();
      // The SDK does not yet expose `eth_getTransactionByHash`; the receipt
      // is the closest live shape and is sufficient for "this tx confirmed
      // at block X with status Y".
      return rpc.ethGetTransactionReceipt(hash as string);
    },
    // Receipts are immutable once mined — no polling needed.
    staleTime: 60_000,
  });
}

/* -------------------------------------------------------------------------- */
/* Validator + address surfaces.                                               */
/* -------------------------------------------------------------------------- */

export function useValidatorSet() {
  return useQuery({
    queryKey: QK.validatorSet(),
    queryFn: async () => {
      const rpc = getRpcClient();
      // TODO(monolythium-vision): swap to indexer aggregate (cluster +
      // operator + reward) once mono-core OI-0070 lands. Today's RPC only
      // returns the active validator set descriptor; the cluster shape
      // monoscan renders is richer than that.
      return rpc.protocoreValidatorSet();
    },
  });
}

export function useAccountBalance(addr: string | undefined) {
  return useQuery({
    queryKey: QK.accountBalance(addr ?? ""),
    enabled: Boolean(addr),
    queryFn: async () => {
      const rpc = getRpcClient();
      return rpc.ethGetBalance(addr as string, "latest");
    },
  });
}

export function useAccountPolicy(addr: string | undefined) {
  return useQuery({
    queryKey: QK.accountPolicy(addr ?? ""),
    enabled: Boolean(addr),
    queryFn: async () => {
      const rpc = getRpcClient();
      // protocoreGetAccountPolicy returns the privacy-bifurcation policy
      // (private/public denom flag, receiver consent, etc.).
      return rpc.protocoreGetAccountPolicy(addr as string);
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Aggregate counters — Statistics page.                                       */
/* -------------------------------------------------------------------------- */

/**
 * Best-effort live network-status snapshot. Returns the bits the SDK can
 * give us today (chain tip, peer count, mempool depth, validator count,
 * indexer height); the rest of the Stats page stays on mock until
 * mono-core OI-0070 ships an aggregate counter view.
 */
export interface NetworkStatusLive {
  blockNumber: number | null;
  round: number | null;
  peerCount: number | null;
  validatorCount: number | null;
  mempoolReady: number | null;
  mempoolPending: number | null;
  indexerHeight: number | null;
  indexerLatestKnown: number | null;
  netVersion: string | null;
}

export function useNetworkStatus() {
  return useQuery<NetworkStatusLive | null>({
    queryKey: ["mono", "stats", "network"] as const,
    queryFn: async () => {
      const rpc = getRpcClient();
      const settle = async <T>(p: Promise<T>): Promise<T | null> => {
        try {
          return await p;
        } catch {
          return null;
        }
      };
      try {
        const [blockNumber, round, peerCount, validators, mempool, indexer, netVersion] =
          await Promise.all([
            settle(rpc.ethBlockNumber()),
            settle(rpc.protocoreCurrentRound().then((r) => Number(r.height ?? 0))),
            settle(rpc.netPeerCount()),
            settle(rpc.protocoreValidatorSet().then((v) => v.length)),
            settle(rpc.protocoreMempoolStatus()),
            settle(rpc.protocoreIndexerStatus()),
            settle(rpc.netVersion()),
          ]);
        return {
          blockNumber,
          round,
          peerCount,
          validatorCount: validators,
          mempoolReady: mempool ? mempool.count_ready : null,
          mempoolPending: mempool ? mempool.count_pending : null,
          indexerHeight: indexer ? indexer.currentHeight : null,
          indexerLatestKnown: indexer ? indexer.latestHeight : null,
          netVersion,
        };
      } catch {
        return null;
      }
    },
    // Counters drift on a leisurely cadence; one minute is fine.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
