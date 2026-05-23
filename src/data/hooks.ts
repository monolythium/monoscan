/**
 * React-Query hooks for monoscan.
 *
 * Single seam through which every page reads chain data. Hooks return
 * already-typed values from `@monolythium/core-sdk`; mock fallbacks live
 * in `./mock` and stay tagged `TODO(monolythium-vision)` for list-level
 * aggregates and per-signer enrichment that mono-core has not yet shipped
 * (per `plans/monoscan.md` Stage 3).
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
import * as CoreSdk from "@monolythium/core-sdk";
import {
  parseQuantityBig,
  type AccountPolicy,
  type AccountProofResponse,
  type AddressActivityEntry,
  type AddressActivityKindResponse,
  type AddressLabelRecord,
  type ApiAddressActivityEntry,
  type ApiBlockHeader,
  type ApiBlockTransactionsData,
  type ApiClusterStatus,
  type ApiTransactionReceipt,
  type ApiTransactionView,
  type AddressFlowResponse,
  type AddressProfileResponse,
  type AgentReputationResponse,
  type BlsCertificateResponse,
  type BlockHeader,
  type CapabilitiesResponse,
  type ChainStatsResponse,
  type CheckpointRecord,
  type ClobMarketResponse,
  type ClobMarketsResponse,
  type ClobOhlcResponse,
  type ClobOrderBookResponse,
  type ClobTradesResponse,
  type ClusterDelegatorsResponse,
  type ClusterDirectoryEntryResponse,
  type ClusterEntityResponse,
  type ClusterResignationsResponse,
  type DagParentsResponse,
  type ClusterStatusResponse,
  type DagSyncStatus,
  type DecodeTxResponse,
  type DelegationCapResponse,
  type DelegationsResponse,
  type EntityRatchetResponse,
  type EncryptionKeyResponse,
  type FeeHistoryResponse,
  type GapRecordsResponse,
  type IndexerStatus,
  type LythUpgradeStatusResponse,
  type MempoolSnapshot,
  type MetricsRangeResponse,
  type NativeReceiptResponse,
  type OperatorCapabilitiesResponse,
  type OperatorAuthorityResponse,
  type OperatorInfoResponse,
  type OperatorRiskResponse,
  type OperatorSigningActivityResponse,
  type UpcomingDutiesResponse,
  type PeerSummaryAggregate,
  type PeerSummary,
  type PrecompileDescriptor,
  type RpcClient,
  type RichListResponse,
  type SearchResponse,
  type TransactionReceipt,
  type TransactionView,
  type TxFeedResponse,
  type TxStatusResponse,
  type TokenBalanceRecord,
  type VerticesAtRoundResponse,
} from "@monolythium/core-sdk";
import { getApiClient, getRpcClient, isRpcConfigured, isWebSocketEnabled, QK } from "../sdk/client";

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

export interface PendingRewardsRowLive {
  cluster: number;
  weightBps: number;
  unsettledAmountLythoshi: string;
}

export interface PendingRewardsLive {
  wallet: string;
  totalAmountLythoshi: string;
  settledPendingLythoshi: string;
  unsettledAmountLythoshi: string;
  autoCompound: boolean;
  rows: PendingRewardsRowLive[];
  block: unknown;
}

interface PendingRewardsEnvelope {
  data: PendingRewardsLive;
}

export interface RedemptionQueueTicketLive {
  index: number;
  cluster: number;
  weightBps: number;
  createdHeight: number;
  maturityHeight: number;
  mature: boolean | null;
}

export interface RedemptionQueueLive {
  wallet: string;
  tickets: RedemptionQueueTicketLive[];
  count: number;
  returned: number;
  block: unknown;
}

interface RedemptionQueueEnvelope {
  data: unknown;
}

interface AgentReputationEnvelope {
  data: AgentReputationResponse;
}

type PendingRewardsApiClient = ReturnType<typeof getApiClient> & {
  addressPendingRewards?: (address: string, block?: "latest") => Promise<PendingRewardsEnvelope>;
};

type PendingRewardsRpcClient = RpcClient & {
  lythPendingRewards?: (wallet: string, block?: "latest") => Promise<PendingRewardsLive>;
};

type RedemptionQueueApiClient = ReturnType<typeof getApiClient> & {
  addressRedemptionQueue?: (address: string, block?: "latest") => Promise<RedemptionQueueEnvelope>;
};

type RedemptionQueueRpcClient = RpcClient & {
  lythRedemptionQueue?: (wallet: string, block?: "latest") => Promise<unknown>;
  call?: <T>(method: string, params?: unknown) => Promise<T>;
};

export interface MrcMetadataBalanceIdentity {
  assetId?: string | null;
  tokenId?: string | null;
}

export interface MrcMetadataBalanceRow {
  tokenId: string;
  mrc?: MrcMetadataBalanceIdentity | null;
}

export interface MrcMetadataRecord {
  standard: string;
  assetId: string;
  tokenId: string | null;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  uri: string | null;
  updatedAtBlock: number;
}

export interface MrcMetadataResponse {
  schemaVersion: number;
  assetId: string;
  tokenId: string | null;
  metadata: MrcMetadataRecord | null;
}

export type MrcMetadataByTokenBalance = Record<string, MrcMetadataResponse>;

type MrcMetadataRpcClient = {
  lythMrcMetadata?: (assetId: string, tokenId?: string | null) => Promise<MrcMetadataResponse>;
  call?: <T>(method: string, params?: unknown) => Promise<T>;
};

export const MRC_METADATA_BALANCE_LIMIT = 8;
/** Upstream metadata contract required before Monoscan can show bridge route trust rows. */
export const BRIDGE_ROUTE_DISCLOSURE_UPSTREAM_FIELD =
  "AddressProfileResponse.bridgeRouteDisclosures or TokenBalanceRecord.bridgeRouteDisclosure(s)";

export type BridgeAdminControl = "none" | "consensusOnly" | "operatorKey" | "unknown";
export type BridgeCircuitBreakerState = "armed" | "paused" | "disabled" | "unknown";
export type BridgeRiskTier = "low" | "medium" | "high" | "blocked";

export interface BridgeVerifierDisclosure {
  model: string;
  participantCount: number;
  threshold: number;
}

export interface BridgeRouteDisclosure {
  routeId: string;
  bridge: string;
  asset: string;
  sourceChain: string;
  destinationChain: string;
  verifier: BridgeVerifierDisclosure;
  drainCapAtomic: string;
  finalityBlocks: number;
  cooldownSeconds: number;
  adminControl: BridgeAdminControl;
  circuitBreaker: BridgeCircuitBreakerState;
  insuranceAtomic: string;
  lastIncidentDate?: string | null;
}

export interface BridgeRouteAssessment {
  routeId: string;
  accepted: boolean;
  score: number;
  riskTier: BridgeRiskTier;
  blockedReasons: string[];
  warnings: string[];
}

type CoreBridgeHelpers = {
  assessBridgeRoute?: (route: BridgeRouteDisclosure) => BridgeRouteAssessment;
  rankBridgeRoutes?: (routes: readonly BridgeRouteDisclosure[]) => Array<{
    route: BridgeRouteDisclosure;
    assessment: BridgeRouteAssessment;
  }>;
};

const sdkBridgeHelpers = CoreSdk as unknown as CoreBridgeHelpers;

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

function numToBig(x: number): bigint {
  return BigInt(Math.trunc(x));
}

function decimalToHexQuantity(value: string | number | bigint | null | undefined): string {
  if (value === null || value === undefined || value === "") return "0x0";
  const big = typeof value === "bigint" ? value : BigInt(value);
  return `0x${big.toString(16)}`;
}

function readNumberField(value: unknown, keys: string[]): number | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  for (const key of keys) {
    const raw = row[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "bigint") return bigToNum(raw);
    if (typeof raw === "string" && raw.trim() !== "") {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function readRequiredNumberField(value: unknown, keys: string[]): number {
  const n = readNumberField(value, keys);
  if (n === null) {
    throw new Error(`missing numeric field: ${keys.join(" | ")}`);
  }
  return n;
}

function readStringField(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  for (const key of keys) {
    const raw = row[key];
    if (typeof raw === "string" && raw.trim() !== "") return raw;
    if (typeof raw === "bigint") return raw.toString();
    if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw).toString();
  }
  return null;
}

function readRequiredStringField(value: unknown, keys: string[]): string {
  const s = readStringField(value, keys);
  if (s === null) {
    throw new Error(`missing string field: ${keys.join(" | ")}`);
  }
  return s;
}

function readObjectField(value: unknown, keys: string[]): unknown | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
  }
  return null;
}

function unknownRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readBooleanField(value: unknown, keys: string[]): boolean | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  for (const key of keys) {
    const raw = row[key];
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") {
      const normalized = raw.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
  }
  return null;
}

function indexerHeightFromUnknown(value: unknown): number | null {
  return readNumberField(value, ["currentHeight", "current_height", "height"]);
}

function normalizeRedemptionQueueTicket(value: unknown, fallbackIndex: number): RedemptionQueueTicketLive | null {
  const row = unknownRecord(value);
  if (!row) return null;
  const cluster = readNumberField(row, ["cluster", "clusterId", "cluster_id"]);
  const weightBps = readNumberField(row, ["weightBps", "weight_bps"]);
  const createdHeight = readNumberField(row, ["createdHeight", "created_height"]);
  const maturityHeight = readNumberField(row, ["maturityHeight", "maturity_height"]);
  if (cluster === null || weightBps === null || createdHeight === null || maturityHeight === null) {
    return null;
  }
  return {
    index: readNumberField(row, ["index", "ticketIndex", "ticket_index"]) ?? fallbackIndex,
    cluster,
    weightBps,
    createdHeight,
    maturityHeight,
    mature: readBooleanField(row, ["mature", "isMature", "is_mature"]),
  };
}

export function normalizeRedemptionQueueResponse(value: unknown): RedemptionQueueLive | null {
  const envelope = unknownRecord(value);
  const root = unknownRecord(envelope?.data ?? value);
  if (!root) return null;
  const rawTickets = readObjectField(root, ["tickets", "rows"]);
  const ticketRows = Array.isArray(rawTickets)
    ? rawTickets
        .map((ticket, index) => normalizeRedemptionQueueTicket(ticket, index))
        .filter((ticket): ticket is RedemptionQueueTicketLive => ticket !== null)
    : [];
  return {
    wallet: readStringField(root, ["wallet", "address"]) ?? "",
    tickets: ticketRows,
    count: readNumberField(root, ["count", "total"]) ?? ticketRows.length,
    returned: readNumberField(root, ["returned", "returnedCount", "returned_count"]) ?? ticketRows.length,
    block: readObjectField(root, ["block"]) ?? null,
  };
}

export function apiBlockToRpcHeader(block: ApiBlockHeader): BlockHeader {
  return {
    number: numToBig(block.height),
    hash: block.blockHash,
    parent_hash: block.parentHash,
    state_root: block.stateRoot,
    timestamp: numToBig(block.timestamp),
    executionUnitsUsed: numToBig(readRequiredNumberField(block, ["executionUnitsUsed", "gasUsed", "gas_used"])),
    executionUnitLimit: numToBig(readRequiredNumberField(block, ["executionUnitLimit", "gasLimit", "gas_limit"])),
  };
}

export function apiTxToRpcTx(tx: ApiTransactionView, chainId: number): TransactionView {
  return {
    hash: tx.txHash,
    blockHash: tx.blockHash,
    blockNumber: decimalToHexQuantity(tx.blockHeight),
    transactionIndex: decimalToHexQuantity(tx.txIndex),
    from: tx.from,
    to: tx.to,
    nonce: decimalToHexQuantity(tx.nonce),
    value: decimalToHexQuantity(readRequiredStringField(tx, ["valueLythoshi", "value"])),
    gas: decimalToHexQuantity(readRequiredNumberField(tx, ["executionUnitLimit", "gasLimit", "gas"])),
    maxFeePerGas: decimalToHexQuantity(readRequiredStringField(tx, ["maxExecutionFeeLythoshi", "maxFeePerGas"])),
    maxPriorityFeePerGas: decimalToHexQuantity(readRequiredStringField(tx, ["priorityTipLythoshi", "maxPriorityFeePerGas"])),
    input: tx.input,
    type: "0x2",
    chainId: decimalToHexQuantity(chainId),
  };
}

export function apiReceiptToRpcReceipt(receipt: ApiTransactionReceipt): TransactionReceipt {
  return {
    tx_hash: receipt.txHash,
    block_hash: receipt.blockHash,
    block_number: numToBig(receipt.blockHeight),
    tx_index: receipt.txIndex,
    status: receipt.status,
    executionUnitsUsed: numToBig(readRequiredNumberField(receipt, ["executionUnitsUsed", "gasUsed", "gas_used"])),
  };
}

function decodedInputHex(decoded: DecodeTxResponse): string {
  const calldata = decoded.decodedCalldata;
  if (calldata && typeof calldata === "object") {
    const row = calldata as Record<string, unknown>;
    for (const key of ["rawCalldata", "raw_calldata", "calldata", "input"]) {
      const value = row[key];
      if (typeof value === "string" && value.startsWith("0x")) return value;
    }
  }
  return "0x";
}

export function decodedTxToRpcTx(decoded: DecodeTxResponse, chainId = 0): TransactionView {
  return {
    hash: decoded.txHash,
    blockHash: decoded.blockHash,
    blockNumber: decimalToHexQuantity(decoded.blockNumber),
    transactionIndex: decimalToHexQuantity(decoded.txIndex),
    from: decoded.from,
    to: decoded.to,
    nonce: decimalToHexQuantity(decoded.nonce),
    value: decimalToHexQuantity(readRequiredStringField(decoded, ["valueLythoshi", "value"])),
    gas: decimalToHexQuantity(readRequiredStringField(decoded, ["executionUnitLimit", "gasLimit"])),
    maxFeePerGas: decimalToHexQuantity(readRequiredStringField(decoded, ["maxExecutionFeeLythoshi", "maxFeePerGas"])),
    maxPriorityFeePerGas: decimalToHexQuantity(readRequiredStringField(decoded, ["priorityTipLythoshi", "maxPriorityFeePerGas"])),
    input: decodedInputHex(decoded),
    type: "0x2",
    chainId: decimalToHexQuantity(chainId),
  };
}

export function decodedTxToRpcReceipt(decoded: DecodeTxResponse): TransactionReceipt {
  return {
    tx_hash: decoded.txHash,
    block_hash: decoded.blockHash,
    block_number: numToBig(Number(decoded.blockNumber)),
    tx_index: decoded.txIndex,
    status: decoded.status === "success" ? 1 : decoded.status === "reverted" ? 0 : -1,
    executionUnitsUsed: numToBig(readNumberField(decoded, ["executionUnitsUsed", "gasUsed"]) ?? 0),
  };
}

export interface NativeReceiptEventDisplayRow {
  logIndex: number;
  address: string;
  eventTopic: string;
  family: string | null;
  eventName: string | null;
  payloadHash: string | null;
  decodedFields: Array<[string, string]>;
}

function decodedNativeEventObject(decoded: unknown, decodedJson: string): Record<string, unknown> | null {
  if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
    return decoded as Record<string, unknown>;
  }
  try {
    const parsed = JSON.parse(decodedJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function nativeFieldDisplay(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return String(value);
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value);
}

export function nativeReceiptEventRows(
  receipt: NativeReceiptResponse<unknown> | null | undefined,
): NativeReceiptEventDisplayRow[] {
  return (receipt?.events ?? []).map((event) => {
    const decoded = decodedNativeEventObject(event.decoded, event.decodedJson);
    const decodedFields = decoded
      ? Object.entries(decoded)
          .filter(([key]) => !["block_height", "tx_index", "sequence", "family", "event_name", "payload_hash"].includes(key))
          .map(([key, value]) => [key, nativeFieldDisplay(value)] as [string, string])
      : [];

    return {
      logIndex: event.logIndex,
      address: event.address,
      eventTopic: event.eventTopic,
      family: typeof decoded?.family === "string" ? decoded.family : null,
      eventName: typeof decoded?.event_name === "string" ? decoded.event_name : null,
      payloadHash: typeof decoded?.payload_hash === "string" ? decoded.payload_hash : null,
      decodedFields,
    };
  });
}

function apiActivityToRpcActivity(row: ApiAddressActivityEntry): AddressActivityEntry {
  return {
    blockHeight: numToBig(row.blockHeight),
    txIndex: row.txIndex,
    logIndex: row.logIndex,
    kind: row.kind,
    direction: row.direction,
    counterparty: row.counterparty,
    tokenId: row.tokenId,
    amount: row.amount,
    cluster: row.cluster,
    weightBps: row.weightBps,
    subKind: row.subKind,
  };
}

function apiClusterStatusToRpcStatus(row: ApiClusterStatus): ClusterStatusResponse {
  return {
    clusterId: row.clusterId,
    threshold: row.threshold,
    size: row.size,
    live: row.live,
    lagging: row.lagging,
    offline: row.offline,
    maintenance: row.maintenance,
    members: row.members,
    epoch: row.epoch === null ? null : numToBig(row.epoch),
    round: row.round === null ? null : numToBig(row.round),
    quorum: row.quorum,
    reputationScore: row.reputationScore,
    livenessScore: row.livenessScore,
    lastUpdateHeight: numToBig(row.lastUpdateHeight),
  };
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
        const [round, blockNumber, peerSummary, peerCount, debugPeers, sync, netVersion, clientVersion, mempool, indexer] =
          await Promise.all([
            settle(rpc.lythCurrentRound().then((r) => bigToNum(r.height))),
            settle(rpc.ethBlockNumber().then((b) => bigToNum(b))),
            settle(rpc.lythPeerSummary()),
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
          peerCount: (peerSummary as PeerSummaryAggregate | null)?.peerCount ?? peerCount ?? debugPeers,
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
      const api = getApiClient();
      try {
        const response = await api.block(hash as string);
        return apiBlockToRpcHeader(response.data.block);
      } catch {
        return getRpcClient().ethGetBlockByHash(hash as string);
      }
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
      const api = getApiClient();
      try {
        const response = await api.block(n as number | "latest");
        return apiBlockToRpcHeader(response.data.block);
      } catch {
        return getRpcClient().ethGetBlockByNumber(n as number | "latest");
      }
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
      const api = getApiClient();
      const blocks = await Promise.all(
        heights.map((h) =>
          api
            .block(h)
            .then((response) => apiBlockToRpcHeader(response.data.block))
            .catch(() => rpc.ethGetBlockByNumber(h).catch(() => null)),
        ),
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
      try {
        const response = await getApiClient().transactionReceipt(hash as string);
        return apiReceiptToRpcReceipt(response.data.receipt);
      } catch {
        return getRpcClient().ethGetTransactionReceipt(hash as string);
      }
    },
  });
}

/** Native RISC-V receipt metadata and typed event rows.
 *
 * Uses only the SDK-supported `/native-receipt` API route and
 * `lyth_nativeReceipt` RPC method. Unsupported nodes return `null` so the tx
 * page can omit the RISC-V panel without inventing data.
 */
export function useTxNativeReceipt(hash: string | undefined) {
  return useQuery<NativeReceiptResponse<unknown> | null>({
    queryKey: QK.txNativeReceipt(hash ?? ""),
    enabled: Boolean(hash) && isRpcConfigured(),
    queryFn: async () => {
      try {
        const response = await getApiClient().transactionNativeReceipt(hash as string);
        return response.data;
      } catch {
        // Fall through to JSON-RPC for nodes without the `/api/v1` indexer route.
      }
      try {
        return await getRpcClient().lythNativeReceipt(hash as string);
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

/** Combined live tx-detail surface. `lyth_decodeTx` is preferred because it
 * carries decoded calldata, logs, and PQ-finality metadata in one RPC. */
export interface TxLiveDigest {
  tx: TransactionView | null;
  receipt: TransactionReceipt | null;
  decoded: DecodeTxResponse | null;
}

export function useTxByHashLive(hash: string | undefined) {
  return useQuery<TxLiveDigest | null>({
    queryKey: QK.txLive(hash ?? ""),
    enabled: Boolean(hash) && isRpcConfigured(),
    queryFn: async () => {
      const rpc = getRpcClient();
      const decoded = await rpc.lythDecodeTx(hash as string).catch(() => null);
      if (decoded) {
        return {
          tx: decodedTxToRpcTx(decoded),
          receipt: decoded.status === "unknown" ? null : decodedTxToRpcReceipt(decoded),
          decoded,
        };
      }
      try {
        const response = await getApiClient().transaction(hash as string);
        return {
          tx: apiTxToRpcTx(response.data.transaction, response.chainId),
          receipt: response.data.receipt
            ? apiReceiptToRpcReceipt(response.data.receipt)
            : null,
          decoded: null,
        };
      } catch {
        // Fall through to JSON-RPC for older nodes without `/api/v1`.
      }
      const [tx, receipt] = await Promise.all([
        rpc.ethGetTransactionByHash(hash as string).catch(() => null),
        rpc.ethGetTransactionReceipt(hash as string).catch(() => null),
      ]);
      return tx || receipt ? { tx, receipt, decoded: null } : null;
    },
    // Receipts are immutable once mined — no polling needed.
    staleTime: 60_000,
  });
}

export function useTxStatus(hash: string | undefined) {
  return useQuery<TxStatusResponse | null>({
    queryKey: QK.txStatus(hash ?? ""),
    enabled: Boolean(hash) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythTxStatus(hash as string);
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

export interface LatestTransactionRow {
  hash: string;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number | null;
  txIndex: number;
  from: string;
  to: string | null;
  value: string;
  executionUnitLimit: number;
  fee: unknown | null;
  input: string;
}

export interface LatestTransactionsDigest {
  rows: LatestTransactionRow[];
  latestBlock: number;
  scannedBlocks: number;
  scannedTransactions: number;
  nextCursor: string | null;
  source: "lyth_txFeed" | "block_scan";
}

export function apiBlockTransactionsToRows(page: ApiBlockTransactionsData): LatestTransactionRow[] {
  return page.transactions.map((tx) => ({
    hash: tx.txHash,
    blockNumber: tx.blockHeight,
    blockHash: tx.blockHash,
    blockTimestamp: page.block.timestamp ?? null,
    txIndex: tx.txIndex,
    from: tx.from,
    to: tx.to,
    value: readRequiredStringField(tx, ["valueLythoshi", "value"]),
    executionUnitLimit: readRequiredNumberField(tx, ["executionUnitLimit", "gasLimit", "gas"]),
    fee: readObjectField(tx, ["fee"]),
    input: tx.input,
  }));
}

export function txFeedToRows(feed: TxFeedResponse): LatestTransactionRow[] {
  return feed.transactions.map((tx) => ({
    hash: tx.txHash,
    blockNumber: tx.blockNumber,
    blockHash: tx.blockHash,
    blockTimestamp: tx.blockTimestamp,
    txIndex: tx.txIndex,
    from: tx.from,
    to: tx.to,
    value: tx.value,
    executionUnitLimit: readRequiredNumberField(tx, ["executionUnitLimit", "gasLimit", "gas"]),
    fee: readObjectField(tx, ["fee"]),
    input: tx.input,
  }));
}

/**
 * Recent transaction index. Prefer the node API's global transaction feed and
 * fall back to a newest-block scan for older peers.
 */
export function useLatestTransactions(limit = 50, blockWindow = 24) {
  const rowLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const scanBlocks = Math.max(1, Math.min(Math.trunc(blockWindow), 96));
  return useQuery<LatestTransactionsDigest | null>({
    queryKey: QK.latestTransactions(rowLimit, scanBlocks),
    enabled: isRpcConfigured(),
    queryFn: async () => {
      try {
        const rpc = getRpcClient();
        const feed = await getApiClient()
          .transactions(rowLimit, null)
          .then((response) => response.data)
          .catch(() => rpc.lythTxFeed(rowLimit).catch(() => null));
        if (feed) {
          return {
            rows: txFeedToRows(feed),
            latestBlock: feed.latestHeight,
            scannedBlocks: 0,
            scannedTransactions: feed.transactions.length,
            nextCursor: feed.nextCursor,
            source: "lyth_txFeed",
          };
        }
        const tip = bigToNum(await rpc.ethBlockNumber());
        const heights = Array.from({ length: scanBlocks }, (_, i) => tip - i).filter((h) => h >= 0);
        if (heights.length === 0) {
          return {
            rows: [],
            latestBlock: tip,
            scannedBlocks: 0,
            scannedTransactions: 0,
            nextCursor: null,
            source: "block_scan",
          };
        }
        const api = getApiClient();
        const pages = await Promise.all(
          heights.map((height) =>
            api.blockTransactions(height, 0, rowLimit).then((response) => response.data).catch(() => null),
          ),
        );
        const livePages = pages.filter((page): page is ApiBlockTransactionsData => page !== null);
        if (livePages.length === 0) return null;
        const rows = livePages
          .flatMap(apiBlockTransactionsToRows)
          .sort((a, b) => b.blockNumber - a.blockNumber || a.txIndex - b.txIndex)
          .slice(0, rowLimit);
        return {
          rows,
          latestBlock: tip,
          scannedBlocks: heights.length,
          scannedTransactions: livePages.reduce((sum, page) => sum + page.totalTransactions, 0),
          nextCursor: null,
          source: "block_scan",
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
    const page = await getApiClient()
      .clusters(0, 100)
      .then((response) => response.data.clusters)
      .catch(() => getRpcClient().lythClusterDirectory(0, 100));
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
        return await getApiClient()
          .cluster(cluster as number)
          .then((response) => apiClusterStatusToRpcStatus(response.data.cluster))
          .catch(() => getRpcClient().lythClusterStatus(cluster as number));
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
        return await getApiClient()
          .operator(operatorId as string)
          .then((response) => response.data.operator)
          .catch(() => getRpcClient().lythOperatorInfo(operatorId as string));
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

export function usePeerSummary() {
  return useQuery<PeerSummaryAggregate | null>({
    queryKey: QK.peerSummary(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      try {
        return await getRpcClient().lythPeerSummary();
      } catch {
        return null;
      }
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
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

export function useOperatorCapabilities() {
  return useQuery<OperatorCapabilitiesResponse | null>({
    queryKey: QK.operatorCapabilities(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      try {
        return await getRpcClient().lythOperatorCapabilities();
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useUpgradeStatus(block?: number | bigint | string | null) {
  return useQuery<LythUpgradeStatusResponse | null>({
    queryKey: QK.upgradeStatus(block ?? null),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      try {
        return await getRpcClient().lythUpgradeStatus(block ?? undefined);
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useMetricsRange(
  selectors: readonly string[],
  range?: readonly [number | bigint | string, number | bigint | string] | null,
) {
  return useQuery<MetricsRangeResponse | null>({
    queryKey: QK.metricsRange(selectors, range ?? null),
    enabled: selectors.length > 0 && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythMetricsRange([...selectors], range ?? undefined);
      } catch {
        return null;
      }
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
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

export function useDagParents(round: number | undefined) {
  return useQuery<DagParentsResponse | null>({
    queryKey: QK.dagParents(round ?? ""),
    enabled: round !== undefined && Number.isFinite(round) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythDagParents(round as number);
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

export function useGapRecords(fromBlock: number | undefined, toBlock: number | undefined) {
  return useQuery<GapRecordsResponse | null>({
    queryKey: QK.gapRecords(fromBlock ?? "", toBlock ?? ""),
    enabled:
      fromBlock !== undefined &&
      toBlock !== undefined &&
      Number.isFinite(fromBlock) &&
      Number.isFinite(toBlock) &&
      isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythGapRecords(fromBlock as number, toBlock as number);
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
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

export function usePendingRewards(addr: string | undefined) {
  return useQuery<PendingRewardsLive | null>({
    queryKey: QK.pendingRewards(addr ?? ""),
    enabled: Boolean(addr) && isRpcConfigured(),
    queryFn: async () => {
      try {
        const api = getApiClient() as PendingRewardsApiClient;
        const response =
          typeof api.addressPendingRewards === "function"
            ? await api.addressPendingRewards(addr as string, "latest")
            : await api.get<PendingRewardsEnvelope>(
                `/addresses/${encodeURIComponent(addr as string)}/pending-rewards`,
                { block: "latest" },
              );
        return response.data;
      } catch {
        try {
          const rpc = getRpcClient() as PendingRewardsRpcClient;
          return typeof rpc.lythPendingRewards === "function"
            ? await rpc.lythPendingRewards(addr as string, "latest")
            : null;
        } catch {
          return null;
        }
      }
    },
    staleTime: 30_000,
  });
}

export function useRedemptionQueue(addr: string | undefined) {
  return useQuery<RedemptionQueueLive | null>({
    queryKey: QK.redemptionQueue(addr ?? ""),
    enabled: Boolean(addr) && isRpcConfigured(),
    queryFn: async () => {
      try {
        const api = getApiClient() as RedemptionQueueApiClient;
        const response =
          typeof api.addressRedemptionQueue === "function"
            ? await api.addressRedemptionQueue(addr as string, "latest")
            : await api.get<RedemptionQueueEnvelope>(
                `/addresses/${encodeURIComponent(addr as string)}/redemption-queue`,
                { block: "latest" },
              );
        return normalizeRedemptionQueueResponse(response);
      } catch {
        try {
          const rpc = getRpcClient() as RedemptionQueueRpcClient;
          const response =
            typeof rpc.lythRedemptionQueue === "function"
              ? await rpc.lythRedemptionQueue(addr as string, "latest")
              : typeof rpc.call === "function"
                ? await rpc.call("lyth_redemptionQueue", [addr as string, "latest"])
                : null;
          return normalizeRedemptionQueueResponse(response);
        } catch {
          return null;
        }
      }
    },
    staleTime: 30_000,
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

function mrcMetadataBalanceQueryKey(row: MrcMetadataBalanceRow): string | null {
  const assetId = row.mrc?.assetId ?? null;
  if (!assetId) return null;
  return `${assetId}:${row.mrc?.tokenId ?? ""}:${row.tokenId}`;
}

function uniqueMrcMetadataBalanceRows(
  rows: readonly MrcMetadataBalanceRow[],
  limit = MRC_METADATA_BALANCE_LIMIT,
): MrcMetadataBalanceRow[] {
  const out: MrcMetadataBalanceRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const assetId = row.mrc?.assetId ?? null;
    if (!assetId) continue;
    const rpcKey = `${assetId}:${row.mrc?.tokenId ?? ""}`;
    if (seen.has(rpcKey)) continue;
    seen.add(rpcKey);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

export function mrcMetadataBalanceQueryKeys(
  rows: readonly MrcMetadataBalanceRow[],
  limit = MRC_METADATA_BALANCE_LIMIT,
): string[] {
  return uniqueMrcMetadataBalanceRows(rows, limit).map(mrcMetadataBalanceQueryKey).filter((key): key is string => Boolean(key));
}

export async function fetchMrcMetadataForTokenBalances(
  rows: readonly MrcMetadataBalanceRow[],
  rpc: MrcMetadataRpcClient = getRpcClient(),
  limit = MRC_METADATA_BALANCE_LIMIT,
): Promise<MrcMetadataByTokenBalance> {
  const out: MrcMetadataByTokenBalance = {};
  await Promise.all(uniqueMrcMetadataBalanceRows(rows, limit).map(async (row) => {
    const assetId = row.mrc?.assetId ?? null;
    if (!assetId) return;
    try {
      const tokenId = row.mrc?.tokenId ?? null;
      const response = typeof rpc.lythMrcMetadata === "function"
        ? await rpc.lythMrcMetadata(assetId, tokenId)
        : typeof rpc.call === "function"
          ? await rpc.call<MrcMetadataResponse>(
              "lyth_mrcMetadata",
              tokenId === null ? [assetId] : [assetId, tokenId],
            )
          : null;
      if (response?.metadata) {
        out[row.tokenId] = response;
      }
    } catch {
      // Missing or not-yet-finalized node support should leave wallet rows unchanged.
    }
  }));
  return out;
}

export function useMrcMetadataForTokenBalances(
  rows: readonly MrcMetadataBalanceRow[],
  limit = MRC_METADATA_BALANCE_LIMIT,
) {
  const keys = mrcMetadataBalanceQueryKeys(rows, limit);
  return useQuery<MrcMetadataByTokenBalance>({
    queryKey: QK.mrcMetadata(keys),
    enabled: keys.length > 0 && isRpcConfigured(),
    queryFn: () => fetchMrcMetadataForTokenBalances(rows, getRpcClient(), limit),
    staleTime: 60_000,
  });
}

export interface BridgeTrustDisclosureRow {
  route: BridgeRouteDisclosure;
  assessment: BridgeRouteAssessment;
  source: string;
}

export type BridgeRouteDisclosureSource = {
  value: unknown;
  source: string;
};

const BRIDGE_DISCLOSURE_KEYS = [
  "bridgeRouteDisclosure",
  "bridge_route_disclosure",
  "bridgeTrustDisclosure",
  "bridge_trust_disclosure",
  "routeDisclosure",
] as const;

const BRIDGE_DISCLOSURES_KEYS = [
  "bridgeRouteDisclosures",
  "bridge_route_disclosures",
  "bridgeTrustDisclosures",
  "bridge_trust_disclosures",
  "routeDisclosures",
] as const;

function bridgeRouteDisclosureKey(route: BridgeRouteDisclosure): string {
  return [
    route.routeId,
    route.bridge,
    route.asset,
    route.sourceChain,
    route.destinationChain,
  ].join("|");
}

function bridgeRouteMarkerPresent(row: Record<string, unknown>): boolean {
  return [
    "routeId",
    "route_id",
    "id",
    "bridge",
    "asset",
    "sourceChain",
    "source_chain",
    "destinationChain",
    "destination_chain",
    "verifier",
    "verifierConfig",
    "verifier_config",
    "drainCapAtomic",
    "drain_cap_atomic",
    "insuranceAtomic",
    "insurance_atomic",
  ].some((key) => {
    const value = row[key];
    return typeof value === "string" || typeof value === "number" || typeof value === "bigint" || unknownRecord(value) !== null;
  });
}

function readBridgeEnum<T extends string>(value: unknown, keys: string[], allowed: readonly T[], fallback: T): T {
  const raw = readStringField(value, keys);
  if (!raw) return fallback;
  return allowed.includes(raw as T) ? raw as T : fallback;
}

function readBridgeNumber(value: unknown, keys: string[]): number {
  const n = readNumberField(value, keys);
  return n !== null && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function readBridgeString(value: unknown, keys: string[], fallback = ""): string {
  return readStringField(value, keys)?.trim() ?? fallback;
}

function bridgeDisclosureValues(value: unknown, source: string): BridgeRouteDisclosureSource[] {
  const row = unknownRecord(value);
  if (!row) return [];
  const out: BridgeRouteDisclosureSource[] = [];
  for (const key of BRIDGE_DISCLOSURE_KEYS) {
    if (row[key] !== undefined) {
      out.push({ value: row[key], source });
    }
  }
  for (const key of BRIDGE_DISCLOSURES_KEYS) {
    const raw = row[key];
    if (Array.isArray(raw)) {
      raw.forEach((entry, index) => out.push({ value: entry, source: `${source}[${index}]` }));
    } else if (raw !== undefined) {
      out.push({ value: raw, source });
    }
  }
  return out;
}

export function normalizeBridgeRouteDisclosure(value: unknown): BridgeRouteDisclosure | null {
  const row = unknownRecord(value);
  if (!row || !bridgeRouteMarkerPresent(row)) return null;

  const verifier = unknownRecord(readObjectField(row, ["verifier", "verifierConfig", "verifier_config"])) ?? {};
  const lastIncidentDate = readStringField(row, ["lastIncidentDate", "last_incident_date", "incidentDate", "incident_date"]);

  return {
    routeId: readBridgeString(row, ["routeId", "route_id", "id"]),
    bridge: readBridgeString(row, ["bridge", "bridgeName", "bridge_name"]),
    asset: readBridgeString(row, ["asset", "assetId", "asset_id", "tokenId", "token_id"]),
    sourceChain: readBridgeString(row, ["sourceChain", "source_chain", "fromChain", "from_chain"]),
    destinationChain: readBridgeString(row, ["destinationChain", "destination_chain", "toChain", "to_chain"]),
    verifier: {
      model: readBridgeString(verifier, ["model", "type"]),
      participantCount: readBridgeNumber(verifier, ["participantCount", "participant_count", "participants", "signerCount", "signer_count"]),
      threshold: readBridgeNumber(verifier, ["threshold", "required", "requiredSigners", "required_signers"]),
    },
    drainCapAtomic: readBridgeString(row, ["drainCapAtomic", "drain_cap_atomic", "drainCap", "drain_cap"], "0"),
    finalityBlocks: readBridgeNumber(row, ["finalityBlocks", "finality_blocks", "finalityDelayBlocks", "finality_delay_blocks"]),
    cooldownSeconds: readBridgeNumber(row, ["cooldownSeconds", "cooldown_seconds", "cooldown"]),
    adminControl: readBridgeEnum<BridgeAdminControl>(
      row,
      ["adminControl", "admin_control", "monoAdminControl", "mono_admin_control"],
      ["none", "consensusOnly", "operatorKey", "unknown"],
      "unknown",
    ),
    circuitBreaker: readBridgeEnum<BridgeCircuitBreakerState>(
      row,
      ["circuitBreaker", "circuit_breaker", "breaker"],
      ["armed", "paused", "disabled", "unknown"],
      "unknown",
    ),
    insuranceAtomic: readBridgeString(row, ["insuranceAtomic", "insurance_atomic", "slashableInsuranceAtomic", "slashable_insurance_atomic"], "0"),
    lastIncidentDate,
  };
}

function decimalStringIsPositive(value: string): boolean {
  const trimmed = value.trim();
  return /^[0-9]+$/.test(trimmed) && /[1-9]/.test(trimmed);
}

function fallbackAssessBridgeRoute(route: BridgeRouteDisclosure): BridgeRouteAssessment {
  const blockedReasons: string[] = [];
  const warnings: string[] = [];

  if (route.routeId.trim() === "") blockedReasons.push("route id missing");
  if (route.bridge.trim() === "") blockedReasons.push("bridge name missing");
  if (route.asset.trim() === "") blockedReasons.push("asset disclosure missing");
  if (route.verifier.model.trim() === "") blockedReasons.push("verifier model missing");
  if (route.verifier.threshold < 2 || route.verifier.participantCount < 2) {
    blockedReasons.push("verifier set must not be 1-of-1");
  }
  if (route.verifier.threshold > route.verifier.participantCount) {
    blockedReasons.push("verifier threshold exceeds participant count");
  }
  if (!decimalStringIsPositive(route.drainCapAtomic)) {
    blockedReasons.push("per-asset drain cap missing or zero");
  }
  if (route.finalityBlocks === 0) blockedReasons.push("route finality delay missing");
  if (route.cooldownSeconds === 0) blockedReasons.push("route cooldown missing");
  if (route.adminControl !== "none" && route.adminControl !== "consensusOnly") {
    blockedReasons.push("Mono-side admin control is not consensus-only");
  }
  if (route.circuitBreaker === "paused") {
    blockedReasons.push("route circuit breaker is paused");
  } else if (route.circuitBreaker === "disabled" || route.circuitBreaker === "unknown") {
    blockedReasons.push("route circuit breaker missing");
  }
  if (!decimalStringIsPositive(route.insuranceAtomic)) {
    blockedReasons.push("slashable insurance pool missing or zero");
  }
  if (route.lastIncidentDate != null) {
    warnings.push("route reports a prior bridge incident");
  }

  if (blockedReasons.length > 0) {
    return {
      routeId: route.routeId,
      accepted: false,
      score: 0,
      riskTier: "blocked",
      blockedReasons,
      warnings,
    };
  }

  let score = 100;
  if (route.verifier.threshold * 3 <= route.verifier.participantCount) {
    score -= 10;
    warnings.push("verifier threshold is below one-third-plus quorum");
  }
  if (route.cooldownSeconds < 3_600) {
    score -= 10;
    warnings.push("cooldown is under one hour");
  }
  if (route.finalityBlocks < 2) {
    score -= 5;
    warnings.push("finality delay is under two blocks");
  }

  return {
    routeId: route.routeId,
    accepted: true,
    score,
    riskTier: score >= 90 ? "low" : score >= 75 ? "medium" : "high",
    blockedReasons,
    warnings,
  };
}

function assessBridgeRouteWithSdkFallback(route: BridgeRouteDisclosure): BridgeRouteAssessment {
  return typeof sdkBridgeHelpers.assessBridgeRoute === "function"
    ? sdkBridgeHelpers.assessBridgeRoute(route)
    : fallbackAssessBridgeRoute(route);
}

function rankBridgeRoutesWithSdkFallback(routes: readonly BridgeRouteDisclosure[]) {
  if (typeof sdkBridgeHelpers.rankBridgeRoutes === "function") {
    return sdkBridgeHelpers.rankBridgeRoutes(routes);
  }
  return routes
    .map((route) => ({ route, assessment: assessBridgeRouteWithSdkFallback(route) }))
    .sort((left, right) => {
      if (left.assessment.accepted !== right.assessment.accepted) {
        return left.assessment.accepted ? -1 : 1;
      }
      if (left.assessment.score !== right.assessment.score) {
        return right.assessment.score - left.assessment.score;
      }
      if (left.route.cooldownSeconds !== right.route.cooldownSeconds) {
        return left.route.cooldownSeconds - right.route.cooldownSeconds;
      }
      if (left.route.finalityBlocks !== right.route.finalityBlocks) {
        return left.route.finalityBlocks - right.route.finalityBlocks;
      }
      return left.assessment.routeId.localeCompare(right.assessment.routeId);
    });
}

export function assessBridgeTrustDisclosures(
  sources: readonly BridgeRouteDisclosureSource[],
): BridgeTrustDisclosureRow[] {
  const rows: BridgeTrustDisclosureRow[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const route = normalizeBridgeRouteDisclosure(source.value);
    if (!route) continue;
    const row = {
      route,
      assessment: assessBridgeRouteWithSdkFallback(route),
      source: source.source,
    };
    const key = bridgeRouteDisclosureKey(row.route);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }

  const sourceByKey = new Map(rows.map((row) => [bridgeRouteDisclosureKey(row.route), row.source]));
  return rankBridgeRoutesWithSdkFallback(rows.map((row) => row.route)).map(({ route, assessment }) => ({
    route,
    assessment,
    source: sourceByKey.get(bridgeRouteDisclosureKey(route)) ?? "upstream",
  }));
}

export function bridgeTrustDisclosuresFromAddressData(
  profile: unknown,
  tokenBalances: readonly unknown[] = [],
): BridgeTrustDisclosureRow[] {
  const sources: BridgeRouteDisclosureSource[] = [];
  sources.push(...bridgeDisclosureValues(profile, "addressProfile"));

  const profileRow = unknownRecord(profile);
  const profileBalances = Array.isArray(profileRow?.tokenBalances) ? profileRow.tokenBalances : [];
  [...profileBalances, ...tokenBalances].forEach((balance, index) => {
    const tokenId = readStringField(balance, ["tokenId", "token_id"]);
    sources.push(...bridgeDisclosureValues(balance, tokenId ? `tokenBalance:${tokenId}` : `tokenBalance:${index}`));
  });

  return assessBridgeTrustDisclosures(sources);
}

export function useRichList(tokenId: string | undefined, limit = 30) {
  return useQuery<RichListResponse | null>({
    queryKey: QK.richList(tokenId ?? "", limit),
    enabled: Boolean(tokenId) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythRichList(tokenId as string, limit);
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

export function useAddressActivityKind(addr: string | undefined) {
  return useQuery<AddressActivityKindResponse | null>({
    queryKey: QK.addressActivityKind(addr ?? ""),
    enabled: Boolean(addr) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythAddressActivityKind(addr as string);
      } catch {
        return null;
      }
    },
    staleTime: 60_000,
  });
}

export function useAddressProfile(addr: string | undefined) {
  return useQuery<AddressProfileResponse | null>({
    queryKey: QK.addressProfile(addr ?? ""),
    enabled: Boolean(addr) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getApiClient()
          .addressProfile(addr as string)
          .then((response) => response.data)
          .catch(() => getRpcClient().lythAddressProfile(addr as string));
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

export function useAddressFlow(addr: string | undefined, limit = 250) {
  const rowLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
  return useQuery<AddressFlowResponse | null>({
    queryKey: QK.addressFlow(addr ?? "", rowLimit),
    enabled: Boolean(addr) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getApiClient()
          .addressFlow(addr as string, rowLimit)
          .then((response) => response.data)
          .catch(() => getRpcClient().lythAddressFlow(addr as string, rowLimit));
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

export function useAgentReputation(provider: string | undefined, categoryId = 0) {
  const scopedCategoryId = Number.isFinite(categoryId) && categoryId >= 0 ? Math.trunc(categoryId) : 0;
  return useQuery<AgentReputationResponse | null>({
    queryKey: QK.agentReputation(provider ?? "", scopedCategoryId),
    enabled: Boolean(provider) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getApiClient()
          .get<AgentReputationEnvelope>(
            `/agents/${encodeURIComponent(provider as string)}/reputation`,
            { categoryId: scopedCategoryId },
          )
          .then((response) => response.data)
          .catch(() => getRpcClient().lythAgentReputation(provider as string, scopedCategoryId));
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
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
          settle(
            getApiClient()
              .addressActivity(addr as string, 30)
              .then((response) => response.data.entries.map(apiActivityToRpcActivity))
              .catch(() => rpc.lythGetAddressActivity(addr as string, 30)),
          ),
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

export function useClobMarket(marketId: string | undefined) {
  return useQuery<ClobMarketResponse | null>({
    queryKey: QK.clobMarket(marketId ?? ""),
    enabled: Boolean(marketId) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getApiClient()
          .market(marketId as string)
          .then((response) => response.data)
          .catch(() => getRpcClient().lythClobMarket(marketId as string));
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

export function useClobMarkets(limit = 100) {
  const rowLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
  return useQuery<ClobMarketsResponse | null>({
    queryKey: QK.clobMarkets(rowLimit),
    enabled: isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getApiClient()
          .markets(rowLimit)
          .then((response) => response.data)
          .catch(() => getRpcClient().lythClobMarkets(rowLimit));
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

export function useClobTrades(marketId: string | undefined, limit = 50, cursor?: string | null) {
  const rowLimit = Math.max(1, Math.min(Math.trunc(limit), 200));
  return useQuery<ClobTradesResponse | null>({
    queryKey: QK.clobTrades(marketId ?? "", rowLimit, cursor ?? null),
    enabled: Boolean(marketId) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getApiClient()
          .marketTrades(marketId as string, rowLimit, cursor ?? null)
          .then((response) => response.data)
          .catch(() => getRpcClient().lythClobTrades(marketId as string, rowLimit, cursor ?? null));
      } catch {
        return null;
      }
    },
    staleTime: 15_000,
  });
}

export function useClobOhlc(
  marketId: string | undefined,
  fromBlock?: number | bigint | null,
  toBlock?: number | bigint | null,
  bucketBlocks?: number | bigint | null,
) {
  return useQuery<ClobOhlcResponse | null>({
    queryKey: QK.clobOhlc(marketId ?? "", fromBlock ?? null, toBlock ?? null, bucketBlocks ?? null),
    enabled: Boolean(marketId) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getApiClient()
          .marketOhlc(marketId as string, fromBlock ?? null, toBlock ?? null, bucketBlocks ?? null)
          .then((response) => response.data)
          .catch(() =>
            getRpcClient().lythClobOhlc(
              marketId as string,
              fromBlock ?? null,
              toBlock ?? null,
              bucketBlocks ?? null,
            ),
          );
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
  });
}

export function useClobOrderBook(marketId: string | undefined, levels = 20) {
  const depth = Math.max(1, Math.min(Math.trunc(levels), 100));
  return useQuery<ClobOrderBookResponse | null>({
    queryKey: QK.clobOrderBook(marketId ?? "", depth),
    enabled: Boolean(marketId) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getApiClient()
          .marketOrderBook(marketId as string, depth)
          .then((response) => response.data)
          .catch(() => getRpcClient().lythClobOrderBook(marketId as string, depth));
      } catch {
        return null;
      }
    },
    staleTime: 10_000,
  });
}

export function useSearch(query: string | undefined, limit = 10) {
  const q = (query ?? "").trim();
  const rowLimit = Math.max(1, Math.min(Math.trunc(limit), 50));
  return useQuery<SearchResponse | null>({
    queryKey: QK.search(q, rowLimit),
    enabled: q.length > 0 && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getApiClient()
          .search(q, rowLimit)
          .then((response) => response.data)
          .catch(() => getRpcClient().lythSearch(q, rowLimit));
      } catch {
        return null;
      }
    },
    staleTime: 15_000,
  });
}

export function useVerticesAtRound(round: number | undefined) {
  return useQuery<VerticesAtRoundResponse | null>({
    queryKey: QK.verticesAtRound(round ?? ""),
    enabled: round !== undefined && Number.isFinite(round) && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getRpcClient().lythVerticesAtRound(round as number);
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

export function useChainStats() {
  return useQuery<ChainStatsResponse | null>({
    queryKey: QK.chainStats(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      try {
        return await getApiClient()
          .stats()
          .then((response) => response.data)
          .catch(() => getRpcClient().lythChainStats());
      } catch {
        return null;
      }
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

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
        const [
          chainStats,
          blockNumber,
          round,
          peerSummary,
          peerCount,
          debugPeers,
          clusters,
          healthyClusters,
          sync,
          mempool,
          indexer,
          netVersion,
        ] =
          await Promise.all([
            settle(
              getApiClient()
                .stats()
                .then((response) => response.data)
                .catch(() => rpc.lythChainStats()),
            ),
            settle(rpc.ethBlockNumber().then((b) => bigToNum(b))),
            settle(rpc.lythCurrentRound().then((r) => bigToNum(r.height))),
            settle(rpc.lythPeerSummary()),
            settle(rpc.netPeerCount().then((p) => bigToNum(p))),
            settle(rpc.debugP2pPeers().then((p) => p.length)),
            settle(readClusterSet("active").then((v) => v?.length ?? null)),
            settle(readClusterSet("healthy").then((v) => v?.length ?? null)),
            settle(rpc.lythSyncStatus()),
            settle(rpc.lythMempoolStatus()),
            settle(rpc.lythIndexerStatus()),
            settle(rpc.netVersion()),
          ]);
        const stats = chainStats as ChainStatsResponse | null;
        const peers = peerSummary as PeerSummaryAggregate | null;
        return {
          blockNumber: stats?.latestHeight ?? blockNumber,
          round,
          peerCount: peers?.peerCount ?? stats?.peerCount ?? peerCount ?? debugPeers,
          clusterCount: stats?.clusters.total ?? clusters,
          healthyClusterCount: healthyClusters,
          syncLag: sync ? bigToNum((sync as DagSyncStatus).lag) : null,
          syncState: sync ? (sync as DagSyncStatus).state : null,
          mempoolReady: stats?.mempool.ready ?? (mempool ? bigToNum((mempool as MempoolSnapshot).count_ready) : null),
          mempoolPending: stats?.mempool.pending ?? (mempool
            ? bigToNum((mempool as MempoolSnapshot).count_pending)
            : null),
          indexerHeight: indexerHeightFromUnknown(stats?.indexer) ?? (indexer
            ? bigToNum((indexer as IndexerStatus).currentHeight)
            : null),
          indexerLatestKnown: readNumberField(stats?.indexer, ["latestHeight", "latest_height"]) ?? (indexer
            ? bigToNumOpt((indexer as IndexerStatus).latestHeight ?? null)
            : null),
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
