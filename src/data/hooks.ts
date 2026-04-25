/**
 * React-Query hooks for monoscan.
 *
 * Single seam through which every page reads chain data. Hooks return
 * already-typed values from the SDK; mock fallbacks live in `./mock` and are
 * tagged `TODO(monolythium-vision)` for swap-out as the indexer surface lands
 * (per `plans/monoscan.md` Stage 3).
 *
 * Cache strategy:
 *   - chain head polls every 4s (matches v2 testnet ~3s round time + jitter)
 *   - block / tx detail is on-demand with staleTime 30s; receipts immutable
 *     once finalized so retry-on-mount is cheap.
 *   - everything else (validators, address activity, markets) staleTime 30s.
 *
 * Reset side: tests can call `queryClient.clear()` on the exported singleton.
 */

import { QueryClient, useQuery } from "@tanstack/react-query";
import type { RpcClient } from "@monolythium/core-sdk";
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

/* -------------------------------------------------------------------------- */
/* Live chain head — drives the top strip ticker.                              */
/* -------------------------------------------------------------------------- */

export function useChainHead() {
  return useQuery({
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
    refetchInterval: 4_000,
  });
}

/* -------------------------------------------------------------------------- */
/* Block / tx detail — on-demand.                                              */
/* -------------------------------------------------------------------------- */

export function useBlockByHash(hash: string | undefined) {
  return useQuery({
    queryKey: QK.blockByHash(hash ?? ""),
    enabled: Boolean(hash),
    queryFn: async () => {
      const rpc = getRpcClient();
      return rpc.ethGetBlockByHash(hash as string);
    },
  });
}

export function useTxReceipt(hash: string | undefined) {
  return useQuery({
    queryKey: QK.txReceipt(hash ?? ""),
    enabled: Boolean(hash),
    queryFn: async () => {
      const rpc = getRpcClient();
      return rpc.ethGetTransactionReceipt(hash as string);
    },
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
