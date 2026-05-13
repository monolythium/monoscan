/**
 * React-Query hooks for monoscan.
 *
 * Single seam through which every page reads chain data. Hooks return
 * already-typed values from `@monolythium/core-sdk`; mock fallbacks live
 * in `./mock` and stay tagged `TODO(monolythium-vision)` for the indexer
 * surfaces (markets, wallets, vertex breakdowns) that
 * mono-core has not yet shipped (per `plans/monoscan.md` Stage 3).
 *
 * Cache strategy:
 *   - Chain head polls every 2s (Stage 3 long-poll target). The live SDK's
 *     WebSocket entry point `lyth_subscribe` returns an RPC error over the
 *     plain HTTP transport today; the WebSocket upgrade is mono-core
 *     OI-0069 and is gated here behind `VITE_MONOSCAN_USE_WS` so the swap
 *     is a single feature-flag flip when it lands.
 *   - Block / tx detail is on-demand with staleTime 30s; receipts are
 *     immutable once finalized so retry-on-mount is cheap.
 *   - Cluster / operator / account surfaces use staleTime 30s — slow-moving
 *     bookkeeping rather than live ticker.
 *
 * Reset side: tests can call `queryClient.clear()` on the exported singleton.
 */

import { QueryClient, useQuery } from "@tanstack/react-query";
import {
  parseQuantityBig,
  type AccountPolicy,
  type AccountProofResponse,
  type AddressActivityEntry,
  type AddressLabelRecord,
  type BlsCertificateResponse,
  type BlockHeader,
  type CapabilitiesResponse,
  type CheckpointRecord,
  type ClusterDelegatorsResponse,
  type ClusterDirectoryEntryResponse,
  type ClusterEntityResponse,
  type ClusterResignationsResponse,
  type ClusterStatusResponse,
  type DagSyncStatus,
  type DelegationCapResponse,
  type DelegationsResponse,
  type EntityRatchetResponse,
  type EncryptionKeyResponse,
  type FeeHistoryResponse,
  type IndexerStatus,
  type MempoolSnapshot,
  type OperatorAuthorityResponse,
  type OperatorInfoResponse,
  type OperatorRiskResponse,
  type OperatorSigningActivityResponse,
  type UpcomingDutiesResponse,
  type PeerSummary,
  type PrecompileDescriptor,
  type RpcClient,
  type TransactionReceipt,
  type TransactionView,
  type TokenBalanceRecord,
} from "@monolythium/core-sdk";
import { getRpcClient, isRpcConfigured, isWebSocketEnabled, QK } from "../sdk/client";

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
export const HEAD_POLL_MS = 2_000;

/* -------------------------------------------------------------------------- */
/* bigint → number helpers.                                                    */
/*                                                                             */
/* The SDK returns `bigint` for every quantity-shaped wire field (block        */
/* height, peer count, gas, etc.). The page chrome consumes them as `number`   */
/* for `.toLocaleString()` / `.toFixed()` formatting. Convert at the seam,     */
/* not at every call site. Heights and counters cannot exceed                  */
/* `Number.MAX_SAFE_INTEGER` for any realistic chain age; if they ever do      */
/* the helper throws so the bug surfaces as a query error rather than silent   */
/* truncation.                                                                 */
/* -------------------------------------------------------------------------- */

function bigToNum(x: bigint): number {
  if (x > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`bigint value ${x} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(x);
}

function bigToNumOpt(x: bigint | null | undefined): number | null {
  return x === null || x === undefined ? null : bigToNum(x);
}

export interface ClusterDescriptor {
  id: number;
  pubkey: string | null;
  stake: string | null;
  active: boolean;
  size: number | null;
  threshold: number | null;
  aggregateHealth: string | null;
}

/* -------------------------------------------------------------------------- */
/* Live chain head — drives the top strip ticker.                              */
/* -------------------------------------------------------------------------- */

/** Compact chain-head digest the top strip + landing page consume. */
export interface ChainHead {
  round: number;
  blockNumber: number | null;
}

/**
 * 2-second long-poll on `eth_blockNumber` + `lyth_currentRound`.
 *
 * Long-poll is a deliberate fallback until mono-core ships the WebSocket
 * upgrade in OI-0069 (see `plans/monoscan.md` Stage 3). The WS path is
 * gated behind `VITE_MONOSCAN_USE_WS=true`; today that flag throws inside
 * `subscribeHeadOverWebSocket` because `lyth_subscribe` is HTTP-only on
 * v0.0.1 of the chain. When OI-0069 lands, swap the WS impl in `subscribeHeadOverWebSocket`
 * and flip the env var — the consumers stay identical.
 */
export function useChainHead() {
  return useQuery<ChainHead | null>({
    queryKey: QK.head(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      if (isWebSocketEnabled()) {
        // Future: this branch returns the latest cached value off a
        // long-lived `lyth_subscribe("newHeads")` stream. Today the
        // helper throws — flag stays default-false until OI-0069 lands.
        return readLatestHeadFromWebSocket();
      }
      const rpc: RpcClient = getRpcClient();
      try {
        const round = await rpc.lythCurrentRound();
        const block = await rpc.ethBlockNumber().catch(() => null);
        return {
          round: bigToNum(round.height),
          blockNumber: block === null ? null : bigToNum(block),
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
 * `lyth_indexerStatus`) the field is `null` rather than the whole digest
 * going dark. This is the closest we can get to the rich strip the design
 * asks for until mono-core ships an aggregate counter view (OI-0070).
 */
export interface ChainStrip {
  round: number | null;
  blockNumber: number | null;
  peerCount: number | null;
  syncLag: number | null;
  syncState: string | null;
  netVersion: string | null;
  clientVersion: string | null;
  mempoolReady: number | null;
  indexerHeight: number | null;
}

export function useChainStrip() {
  return useQuery<ChainStrip | null>({
    queryKey: QK.headStrip(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      const rpc = getRpcClient();
      const settle = async <T>(p: Promise<T>): Promise<T | null> => {
        try {
          return await p;
        } catch {
          return null;
        }
      };
      try {
        const [round, blockNumber, peerCount, debugPeers, sync, netVersion, clientVersion, mempool, indexer] =
          await Promise.all([
            settle(rpc.lythCurrentRound().then((r) => bigToNum(r.height))),
            settle(rpc.ethBlockNumber().then((b) => bigToNum(b))),
            settle(rpc.netPeerCount().then((p) => bigToNum(p))),
            settle(rpc.debugP2pPeers().then((p) => p.length)),
            settle(rpc.lythSyncStatus()),
            settle(rpc.netVersion()),
            settle(rpc.web3ClientVersion()),
            settle(rpc.lythMempoolStatus()),
            settle(rpc.lythIndexerStatus()),
          ]);
        return {
          round,
          blockNumber,
          peerCount: peerCount ?? debugPeers,
          syncLag: sync ? bigToNum((sync as DagSyncStatus).lag) : null,
          syncState: sync ? (sync as DagSyncStatus).state : null,
          netVersion,
          clientVersion,
          mempoolReady: mempool ? bigToNum((mempool as MempoolSnapshot).count_ready) : null,
          indexerHeight: indexer
            ? bigToNum((indexer as IndexerStatus).currentHeight)
            : null,
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
    enabled: Boolean(hash) && isRpcConfigured(),
    queryFn: async () => {
      const rpc = getRpcClient();
      return rpc.ethGetBlockByHash(hash as string);
    },
  });
}

/**
 * Fetch a single block header by height. `"latest"` always re-fetches with
 * the head poll to avoid a stale chain tip.
 */
export function useBlockByNumber(n: number | "latest" | undefined) {
  return useQuery<BlockHeader | null>({
    queryKey: QK.blockByNumber(n ?? "latest"),
    enabled: n !== undefined && isRpcConfigured(),
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
 * blocks. (React Query handles per-block caching; the wrapper just
 * sequences the height list.)
 */
export function useLatestBlocks(count = 10) {
  return useQuery<BlockHeader[]>({
    queryKey: QK.blocksLatest(count),
    enabled: isRpcConfigured(),
    queryFn: async () => {
      const rpc = getRpcClient();
      const tipBig = await rpc.ethBlockNumber();
      const tip = bigToNum(tipBig);
      const heights = Array.from({ length: count }, (_, i) => tip - i).filter((h) => h >= 0);
      const blocks = await Promise.all(
        heights.map((h) => rpc.ethGetBlockByNumber(h).catch(() => null)),
      );
      return blocks.filter((b): b is BlockHeader => b !== null);
    },
    refetchInterval: HEAD_POLL_MS,
    staleTime: 0,
  });
}

/* -------------------------------------------------------------------------- */
/* Mempool snapshot — landing-page mempool ticker.                              */
/* -------------------------------------------------------------------------- */

/** Same shape as the SDK's `MempoolSnapshot` but with `bigint` collapsed to
 * `number` for chrome that reaches in for `.toLocaleString()`. */
export interface MempoolDigest {
  countReady: number;
  countPending: number;
  mailboxDepth: number;
}

/** Hook around `lyth_mempoolStatus`. Returns null when the namespace is
 *  disabled; consumers degrade to mock values. */
export function useMempool() {
  return useQuery<MempoolDigest | null>({
    queryKey: QK.mempool(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      const rpc = getRpcClient();
      try {
        const snap = await rpc.lythMempoolStatus();
        return {
          countReady: bigToNum(snap.count_ready),
          countPending: bigToNum(snap.count_pending),
          mailboxDepth: bigToNum(snap.mailbox_depth),
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
/* Transaction detail.                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Hook around `eth_getTransactionReceipt`. Returns the receipt envelope; the
 * mempool / indexer trace surface lives in `useTxTrace` once OI-0070 lands.
 */
export function useTxReceipt(hash: string | undefined) {
  return useQuery<TransactionReceipt | null>({
    queryKey: QK.txReceipt(hash ?? ""),
    enabled: Boolean(hash) && isRpcConfigured(),
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
export interface TxLiveDigest {
  tx: TransactionView | null;
  receipt: TransactionReceipt | null;
}

export function useTxByHashLive(hash: string | undefined) {
  return useQuery<TxLiveDigest | null>({
    queryKey: QK.txLive(hash ?? ""),
    enabled: Boolean(hash) && isRpcConfigured(),
    queryFn: async () => {
      const rpc = getRpcClient();
      const [tx, receipt] = await Promise.all([
        rpc.ethGetTransactionByHash(hash as string).catch(() => null),
        rpc.ethGetTransactionReceipt(hash as string).catch(() => null),
      ]);
      return tx || receipt ? { tx, receipt } : null;
    },
    // Receipts are immutable once mined — no polling needed.
    staleTime: 60_000,
  });
}

/* -------------------------------------------------------------------------- */
/* Cluster + address surfaces.                                                 */
/* -------------------------------------------------------------------------- */

function directoryEntryToCluster(row: ClusterDirectoryEntryResponse): ClusterDescriptor {
  return {
    id: row.clusterId,
    pubkey: null,
    stake: null,
    active: row.active,
    size: row.size,
    threshold: row.threshold,
    aggregateHealth: row.aggregateHealth,
  };
}

async function readClusterSet(
  filter: "all" | "active" | "healthy" = "all",
): Promise<ClusterDescriptor[] | null> {
  if (!isRpcConfigured()) return null;
  try {
    const page = await getRpcClient().lythClusterDirectory(0, 100);
    let rows = page.clusters;
    if (filter === "active") rows = rows.filter((c) => c.active);
    if (filter === "healthy") rows = rows.filter((c) => c.aggregateHealth === "ok");
    return rows.map(directoryEntryToCluster);
  } catch {
    return null;
  }
}

/** Configured cluster descriptor list exposed by the current SDK. */
export function useClusterSet() {
  return useQuery<ClusterDescriptor[] | null>({
    queryKey: QK.clusterSet(),
    queryFn: async () => {
      // TODO(monolythium-vision): swap to indexer aggregate (cluster +
      // operator + reward) once mono-core OI-0070 lands. Today's RPC returns
      // a compact descriptor list; the profile cards remain fixture-backed.
      return readClusterSet();
    },
    staleTime: 30_000,
  });
}

export function useActiveClusters() {
  return useQuery<ClusterDescriptor[] | null>({
    queryKey: QK.activeClusters(),
    queryFn: () => readClusterSet("active"),
    staleTime: 30_000,
  });
}

export function useHealthyClusters() {
  return useQuery<ClusterDescriptor[] | null>({
    queryKey: QK.healthyClusters(),
    queryFn: () => readClusterSet("healthy"),
    staleTime: 30_000,
  });
}

export function useClusterStatus(cluster: number | undefined) {
  return useQuery<ClusterStatusResponse | null>({
    queryKey: QK.clusterStatus(cluster ?? ""),
    enabled: cluster !== undefined && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythClusterStatus(cluster as number);
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

const OPERATOR_ID_RE = /^0x[0-9a-fA-F]{64}$/;

export function useOperatorAuthority(operatorId: string | undefined) {
  return useQuery<OperatorAuthorityResponse | null>({
    queryKey: QK.operatorAuthority(operatorId ?? ""),
    enabled: Boolean(operatorId && OPERATOR_ID_RE.test(operatorId)) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythResolveOperatorAuthority(operatorId as string);
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

export function useOperatorInfo(operatorId: string | undefined) {
  return useQuery<OperatorInfoResponse | null>({
    queryKey: QK.operatorInfo(operatorId ?? ""),
    enabled: Boolean(operatorId && OPERATOR_ID_RE.test(operatorId)) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythOperatorInfo(operatorId as string);
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useOperatorSigningActivity(authorityIndex: number | undefined, limit = 25) {
  return useQuery<OperatorSigningActivityResponse | null>({
    queryKey: [...QK.operatorSigningActivity(authorityIndex ?? ""), limit] as const,
    enabled: authorityIndex !== undefined && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythSigningActivity(authorityIndex as number, limit);
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

export function useOperatorDuties(authorityIndex: number | undefined, horizonRounds = 100) {
  return useQuery<UpcomingDutiesResponse | null>({
    queryKey: [...QK.operatorDuties(authorityIndex ?? ""), horizonRounds] as const,
    enabled: authorityIndex !== undefined && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythUpcomingDuties(authorityIndex as number, horizonRounds);
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

export function useOperatorRisk(authorityIndex: number | undefined, windowRounds = 250) {
  return useQuery<OperatorRiskResponse | null>({
    queryKey: [...QK.operatorRisk(authorityIndex ?? ""), windowRounds] as const,
    enabled: authorityIndex !== undefined && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythOperatorRisk(authorityIndex as number, windowRounds);
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

export function useDelegationCap() {
  return useQuery<DelegationCapResponse | null>({
    queryKey: QK.delegationCap(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      try {
        return await getRpcClient().lythGetDelegationCap();
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useClusterEntity(cluster: number | undefined) {
  return useQuery<ClusterEntityResponse | null>({
    queryKey: QK.clusterEntity(cluster ?? ""),
    enabled: cluster !== undefined && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythGetClusterEntity(cluster as number);
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useEntityRatchet() {
  return useQuery<EntityRatchetResponse | null>({
    queryKey: QK.entityRatchet(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      try {
        return await getRpcClient().lythGetEntityRatchet();
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useDagSyncStatus() {
  return useQuery<DagSyncStatus | null>({
    queryKey: QK.syncStatus(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      try {
        return await getRpcClient().lythSyncStatus();
      } catch {
        return null;
      }
    },
    refetchInterval: HEAD_POLL_MS,
    staleTime: 0,
  });
}

export function useP2pPeers() {
  return useQuery<PeerSummary[] | null>({
    queryKey: QK.p2pPeers(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      try {
        return await getRpcClient().debugP2pPeers();
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

export interface FeeStatsLive {
  gasPrice: bigint | null;
  gasPriceSource: "eth_gasPrice" | "eth_feeHistory" | null;
  oldestBlock: string | null;
  baseFeePerGas: string[];
  gasUsedRatio: number[];
}

export function useFeeStats() {
  return useQuery<FeeStatsLive | null>({
    queryKey: QK.feeStats(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      const rpc = getRpcClient();
      const settle = async <T>(p: Promise<T>): Promise<T | null> => {
        try {
          return await p;
        } catch {
          return null;
        }
      };
      const [gasPrice, history] = await Promise.all([
        settle(rpc.ethGasPrice()),
        settle(rpc.ethFeeHistory(8, "latest", [])),
      ]);
      const feeHistory = history as FeeHistoryResponse | null;
      const latestBaseFeeHex = feeHistory?.baseFeePerGas.at(-1);
      const latestBaseFee = latestBaseFeeHex ? parseQuantityBig(latestBaseFeeHex) : null;
      const gasPriceUsable = gasPrice !== null && gasPrice > 0n;
      return {
        gasPrice: gasPriceUsable ? gasPrice : latestBaseFee,
        gasPriceSource: gasPriceUsable ? "eth_gasPrice" : latestBaseFee !== null ? "eth_feeHistory" : null,
        oldestBlock: feeHistory?.oldestBlock ?? null,
        baseFeePerGas: feeHistory?.baseFeePerGas ?? [],
        gasUsedRatio: feeHistory?.gasUsedRatio ?? [],
      };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useActivePrecompiles() {
  return useQuery<PrecompileDescriptor[] | null>({
    queryKey: QK.precompiles(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      try {
        const response = await getRpcClient().lythListActivePrecompiles("latest");
        return response.precompiles ?? null;
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useCapabilities() {
  return useQuery<CapabilitiesResponse | null>({
    queryKey: QK.capabilities(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      try {
        return await getRpcClient().lythCapabilities("latest");
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useLatestCheckpoint(belowHeight?: number | bigint | string | null) {
  return useQuery<CheckpointRecord[] | null>({
    queryKey: QK.latestCheckpoint(
      belowHeight === undefined || belowHeight === null ? null : belowHeight.toString(),
    ),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      try {
        return await getRpcClient().lythGetLatestCheckpoint(belowHeight);
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useClusterResignations(
  operator?: string | null,
  status: "pending" | "applied" | "all" | string | null = "all",
) {
  return useQuery<ClusterResignationsResponse | null>({
    queryKey: QK.clusterResignations(operator ?? null, status ?? "all"),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      try {
        return await getRpcClient().lythGetClusterResignations(operator ?? null, status ?? "all");
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useBlsRoundCertificate(round: number | undefined) {
  return useQuery<BlsCertificateResponse | null>({
    queryKey: QK.blsRoundCert(round ?? ""),
    enabled: round !== undefined && Number.isFinite(round) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythGetBlsRoundCertificate(round as number);
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useEncryptionKey() {
  return useQuery<EncryptionKeyResponse | null>({
    queryKey: QK.encryptionKey(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      try {
        return await getRpcClient().lythGetEncryptionKey();
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useClusterDelegators(cluster: number | undefined) {
  return useQuery<ClusterDelegatorsResponse | null>({
    queryKey: QK.clusterDelegators(cluster ?? ""),
    enabled: cluster !== undefined && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythGetClusterDelegators(cluster as number);
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useWalletDelegations(addr: string | undefined) {
  return useQuery<DelegationsResponse | null>({
    queryKey: QK.walletDelegations(addr ?? ""),
    enabled: Boolean(addr) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythGetDelegations(addr as string, "latest");
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useWalletDelegationHistory(addr: string | undefined, limit = 50) {
  return useQuery({
    queryKey: [...QK.walletDelegationHistory(addr ?? ""), limit] as const,
    enabled: Boolean(addr) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythGetDelegationHistory(addr as string, limit);
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useTokenBalances(addr: string | undefined) {
  return useQuery<TokenBalanceRecord[] | null>({
    queryKey: QK.tokenBalances(addr ?? ""),
    enabled: Boolean(addr) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythGetTokenBalances(addr as string);
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useAddressLabel(addr: string | undefined) {
  return useQuery<AddressLabelRecord | null>({
    queryKey: QK.addressLabel(addr ?? ""),
    enabled: Boolean(addr) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythGetAddressLabel(addr as string);
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useAccountCode(addr: string | undefined) {
  return useQuery<string | null>({
    queryKey: QK.accountCode(addr ?? ""),
    enabled: Boolean(addr) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().ethGetCode(addr as string, "latest");
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

/**
 * Account balance as a `bigint` quantity, parsed out of the proof envelope
 * `eth_getBalance` returns. Callers that need the full proof envelope
 * (state root, inclusion proof) use `useAccountBalanceProof` below.
 */
export function useAccountBalance(addr: string | undefined) {
  return useQuery<bigint | null>({
    queryKey: QK.accountBalance(addr ?? ""),
    enabled: Boolean(addr) && isRpcConfigured(),
    queryFn: async () => {
      const rpc = getRpcClient();
      try {
        const env = await rpc.ethGetBalance(addr as string, "latest");
        return parseQuantityBig(env.value);
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

/** Account balance proof envelope (state root + inclusion proof). */
export function useAccountBalanceProof(addr: string | undefined) {
  return useQuery<AccountProofResponse | null>({
    queryKey: [...QK.accountBalance(addr ?? ""), "proof"] as const,
    enabled: Boolean(addr) && isRpcConfigured(),
    queryFn: async () => {
      const rpc = getRpcClient();
      try {
        return await rpc.ethGetBalance(addr as string, "latest");
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

/** Hook around `lyth_getAccountPolicy` — privacy-bifurcation policy. */
export function useAccountPolicy(addr: string | undefined) {
  return useQuery<AccountPolicy | null>({
    queryKey: QK.accountPolicy(addr ?? ""),
    enabled: Boolean(addr) && isRpcConfigured(),
    queryFn: async () => {
      const rpc = getRpcClient();
      try {
        return await rpc.lythGetAccountPolicy(addr as string);
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

/* -------------------------------------------------------------------------- */
/* Account history — wallet detail page.                                       */
/* -------------------------------------------------------------------------- */

/** Per-account live snapshot the wallet page consumes. */
export interface AccountHistoryDigest {
  /** Live balance (bigint wei-class quantity). */
  balance: bigint | null;
  /** Live nonce — count of confirmed sends, not the mempool view. */
  nonce: number | null;
  /** Live policy — `null` when the address has no explicit policy bits set. */
  policy: AccountPolicy | null;
  /** Live indexed address activity, newest-first. */
  activity: AddressActivityEntry[];
}

/**
 * Hook combining the three live address surfaces into one digest. Each
 * sub-call is best-effort, so a partial node response degrades the digest
 * field-by-field rather than failing the whole query.
 *
 * The address activity feed is best-effort: empty testnet accounts commonly
 * return no rows, so the wallet page keeps its fixture rows as a fallback.
 */
export function useAccountHistory(addr: string | undefined) {
  return useQuery<AccountHistoryDigest | null>({
    queryKey: QK.addressActivity(addr ?? ""),
    enabled: Boolean(addr) && isRpcConfigured(),
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
        const [balanceEnv, nonce, policy, activity] = await Promise.all([
          settle(rpc.ethGetBalance(addr as string, "latest")),
          settle(rpc.ethGetTransactionCount(addr as string, "latest")),
          settle(rpc.lythGetAccountPolicy(addr as string)),
          settle(rpc.lythGetAddressActivity(addr as string, 30)),
        ]);
        return {
          balance: balanceEnv ? parseQuantityBig(balanceEnv.value) : null,
          nonce: bigToNumOpt(nonce),
          policy,
          activity: activity ?? [],
        };
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

/* -------------------------------------------------------------------------- */
/* Aggregate counters — Statistics page.                                       */
/* -------------------------------------------------------------------------- */

/**
 * Best-effort live network-status snapshot. Returns the bits the SDK can
 * give us today (chain tip, peer count, mempool depth, cluster count,
 * indexer height); the rest of the Stats page stays on mock until
 * mono-core OI-0070 ships an aggregate counter view.
 */
export interface NetworkStatusLive {
  blockNumber: number | null;
  round: number | null;
  peerCount: number | null;
  clusterCount: number | null;
  healthyClusterCount: number | null;
  syncLag: number | null;
  syncState: string | null;
  mempoolReady: number | null;
  mempoolPending: number | null;
  indexerHeight: number | null;
  indexerLatestKnown: number | null;
  netVersion: string | null;
}

export function useNetworkStatus() {
  return useQuery<NetworkStatusLive | null>({
    queryKey: QK.networkStatus(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      const rpc = getRpcClient();
      const settle = async <T>(p: Promise<T>): Promise<T | null> => {
        try {
          return await p;
        } catch {
          return null;
        }
      };
      try {
        const [blockNumber, round, peerCount, debugPeers, clusters, healthyClusters, sync, mempool, indexer, netVersion] =
          await Promise.all([
            settle(rpc.ethBlockNumber().then((b) => bigToNum(b))),
            settle(rpc.lythCurrentRound().then((r) => bigToNum(r.height))),
            settle(rpc.netPeerCount().then((p) => bigToNum(p))),
            settle(rpc.debugP2pPeers().then((p) => p.length)),
            settle(readClusterSet("active").then((v) => v?.length ?? null)),
            settle(readClusterSet("healthy").then((v) => v?.length ?? null)),
            settle(rpc.lythSyncStatus()),
            settle(rpc.lythMempoolStatus()),
            settle(rpc.lythIndexerStatus()),
            settle(rpc.netVersion()),
          ]);
        return {
          blockNumber,
          round,
          peerCount: peerCount ?? debugPeers,
          clusterCount: clusters,
          healthyClusterCount: healthyClusters,
          syncLag: sync ? bigToNum((sync as DagSyncStatus).lag) : null,
          syncState: sync ? (sync as DagSyncStatus).state : null,
          mempoolReady: mempool ? bigToNum((mempool as MempoolSnapshot).count_ready) : null,
          mempoolPending: mempool
            ? bigToNum((mempool as MempoolSnapshot).count_pending)
            : null,
          indexerHeight: indexer
            ? bigToNum((indexer as IndexerStatus).currentHeight)
            : null,
          indexerLatestKnown: indexer
            ? bigToNumOpt((indexer as IndexerStatus).latestHeight ?? null)
            : null,
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

/* -------------------------------------------------------------------------- */
/* WebSocket head subscription — feature-flag stub.                             */
/*                                                                             */
/* Mono-core OI-0069 ships the WebSocket transport; today `lyth_subscribe`     */
/* is HTTP-only and rejects with an RPC error. The flag is wired here so       */
/* the swap is a one-line change inside this helper plus an env-var flip       */
/* — the rest of the codebase already routes through `useChainHead`.           */
/* -------------------------------------------------------------------------- */

async function readLatestHeadFromWebSocket(): Promise<ChainHead | null> {
  // Until OI-0069 lands the WS transport the RPC side rejects this method
  // and there is no cached frame. Throw so React-Query surfaces the error
  // and auto-retry policies kick in; consumers degrade through their
  // existing mock fallbacks.
  throw new Error(
    "WebSocket head stream not implemented — OI-0069 still pending. " +
      "Disable VITE_MONOSCAN_USE_WS or wait for the WS upgrade.",
  );
}
