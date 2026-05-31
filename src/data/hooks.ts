/**
 * React-Query hooks for monoscan.
 *
 * Single seam through which every page reads chain data. Hooks return
 * already-typed values from `@monolythium/core-sdk`; local fallback rows live
 * in `./fallback` for list-level aggregates and per-signer enrichment that a
 * node may not retain yet.
 *
 * Cache strategy:
 *   - Chain head polls every 2s. The WebSocket path is gated behind
 *     `VITE_MONOSCAN_USE_WS` for deployments that expose subscriptions.
 *   - Block / tx detail is on-demand with staleTime 30s; receipts are
 *     immutable once finalized so retry-on-mount is cheap.
 *   - Cluster / operator / account surfaces use staleTime 30s — slow-moving
 *     bookkeeping rather than live ticker.
 *
 * Reset side: tests can call `queryClient.clear()` on the exported singleton.
 */

import { QueryClient, useQueries, useQuery } from "@tanstack/react-query";
import * as CoreSdk from "@monolythium/core-sdk";
import { keccak256Hex as keccak256 } from "../hash";
import {
  NATIVE_MARKET_ORDER_BOOK_STREAM_TOPIC,
  assertMrvStructuredFeeConformance,
  formatNativeReceiptFeeDisplay,
  isNativeMarketOrderBookStreamPayload,
  parseQuantityBig,
  type AccountPolicy,
  type AccountProofResponse,
  type AddressActivityEntry,
  type AddressActivityKindResponse,
  type AddressLabelRecord,
  type ApiEnvelope,
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
  type NativeAgentStateFilter,
  type NativeAgentStateResponse,
  type NativeEventsFilter,
  type NativeEventsResponse,
  type NoEvmArchiveSignatureVerification,
  type NoEvmArchiveTrustedSigner,
  type NoEvmBlsFinalityVerification,
  type NoEvmReceiptTrustPolicy,
  type NativeMarketOrderBookStreamPayload,
  type NativeReceiptResponse,
  type NativeReceiptFee,
  type NativeReceiptFeeDisplay,
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

/** How often to long-poll the chain head when subscriptions are unavailable. */
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
  standard?: string | null;
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

export type MrcHolderStandard = "mrc721" | "mrc1155" | "mrc4626";

export interface MrcHolderRecord {
  rank: number;
  address: string;
  balance: string;
  updatedAtBlock: number | string | bigint;
}

export interface MrcHoldersResponse {
  schemaVersion: number;
  standard: MrcHolderStandard;
  assetId: string;
  tokenId: string | null;
  limit: number;
  holders: MrcHolderRecord[];
}

export type MrcHoldersByTokenBalance = Record<string, MrcHoldersResponse>;

interface MrcHoldersEnvelope {
  data: MrcHoldersResponse;
}

type MrcHoldersApiClient = {
  get?: <T>(path: string, query?: Record<string, string | number | bigint | boolean | null | undefined>) => Promise<T>;
};

type MrcHoldersRpcClient = {
  lythMrcHolders?: (
    standard: MrcHolderStandard,
    assetId: string,
    tokenId: string | null,
    limit?: number,
  ) => Promise<MrcHoldersResponse>;
  call?: <T>(method: string, params?: unknown) => Promise<T>;
};

export const MRC_HOLDERS_BALANCE_LIMIT = 6;
export const MRC_ACCOUNT_POLICY_SPEND_LIMIT = 6;

export interface MrcPolicyRecord {
  enabled: boolean;
  perActionLimit: string;
  windowLimit: string;
  allowedAssets: string[];
}

export interface MrcAccountRecord {
  kind: string;
  account: string;
  controller: string | null;
  recovery: string | null;
  policyHash: string | null;
  policy: MrcPolicyRecord | null;
  nonce: string | null;
  updatedAtBlock: number;
}

export interface MrcPolicySpendRecord {
  account: string;
  assetId: string;
  window: string;
  amount: string;
  spent: string;
  updatedAtBlock: number;
}

export interface MrcAccountResponse {
  schemaVersion: 1;
  account: string;
  spendLimit: number;
  smartAccount: MrcAccountRecord | null;
  policyAccount: MrcAccountRecord | null;
  policySpends: MrcPolicySpendRecord[];
}

interface MrcAccountEnvelope {
  data: unknown;
}

type MrcAccountApiClient = {
  get?: <T>(path: string, query?: Record<string, string | number | bigint | boolean | null | undefined>) => Promise<T>;
};

type MrcAccountRpcClient = {
  lythMrcAccount?: (account: string, limit?: number) => Promise<unknown>;
  call?: <T>(method: string, params?: unknown) => Promise<T>;
};

/** Upstream metadata contract required before Monoscan can show bridge route trust rows. */
export const BRIDGE_ROUTE_DISCLOSURE_UPSTREAM_FIELD =
  "AddressProfileResponse.bridgeRouteDisclosures, TokenBalanceRecord.bridgeRouteDisclosure(s), or /api/v1/bridge/routes";

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
  bridgeId?: string | null;
  protocol?: string | null;
  asset: string;
  feeToken: string;
  wrappedAsset?: string | null;
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
  routeSelectionReady?: boolean | null;
  quoteReady?: boolean | null;
  submitReady?: boolean | null;
  readinessBlockedReasons?: string[];
  readinessWarnings?: string[];
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

type BridgeRoutesRpcClient = {
  lythBridgeRoutes?: (query?: { limit?: number }) => Promise<unknown>;
  call?: <T>(method: string, params?: unknown) => Promise<T>;
};

type ExecutionUnitPriceResponseLike = {
  executionUnitPriceLythoshi?: string | number | bigint;
  execution_unit_price_lythoshi?: string | number | bigint;
  basePricePerExecutionUnitLythoshi?: string | number | bigint;
  base_price_per_execution_unit_lythoshi?: string | number | bigint;
  priorityTipLythoshi?: string | number | bigint;
  priority_tip_lythoshi?: string | number | bigint;
  blockNumber?: number | string | bigint | null;
  block_number?: number | string | bigint | null;
  source?: string;
};

type FeeStatsRpcClient = RpcClient & {
  lythExecutionUnitPrice?: () => Promise<ExecutionUnitPriceResponseLike>;
  call?: <T>(method: string, params?: unknown) => Promise<T>;
};

const BRIDGE_ALLOWED_FEE_TOKEN = "LINK";

/* -------------------------------------------------------------------------- */
/* bigint → number helpers.                                                    */
/*                                                                             */
/* The SDK returns `bigint` for every quantity-shaped wire field (block        */
/* height, peer count, execution units, etc.). The page chrome consumes them   */
/* as `number`                                                                */
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

export interface StructuredNativeReceiptFee {
  fee: NativeReceiptFee;
  display: NativeReceiptFeeDisplay;
}

export function structuredNativeReceiptFee(
  value: unknown,
  options: { expectedTotalLythoshi?: string | number | bigint; label?: string } = {},
): StructuredNativeReceiptFee | null {
  try {
    assertMrvStructuredFeeConformance(value, {
      expectedTotalLythoshi: options.expectedTotalLythoshi,
      label: options.label ?? "native receipt fee",
    });
    return {
      fee: value,
      display: formatNativeReceiptFeeDisplay(value),
    };
  } catch {
    return null;
  }
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

function readStringListField(value: unknown, keys: string[]): string[] {
  const raw = readObjectField(value, keys);
  const values = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  return values
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (typeof entry === "number" && Number.isFinite(entry)) return Math.trunc(entry).toString();
      if (typeof entry === "bigint") return entry.toString();
      return "";
    })
    .filter(Boolean);
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
    executionUnitsUsed: numToBig(readRequiredNumberField(block, ["executionUnitsUsed"])),
    executionUnitLimit: numToBig(readRequiredNumberField(block, ["executionUnitLimit"])),
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
    gas: decimalToHexQuantity(readRequiredNumberField(tx, ["executionUnitLimit"])),
    maxFeePerGas: decimalToHexQuantity(readRequiredStringField(tx, ["maxExecutionFeeLythoshi"])),
    maxPriorityFeePerGas: decimalToHexQuantity(readRequiredStringField(tx, ["priorityTipLythoshi"])),
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
    executionUnitsUsed: numToBig(readRequiredNumberField(receipt, ["executionUnitsUsed"])),
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
    gas: decimalToHexQuantity(readRequiredStringField(decoded, ["executionUnitLimit"])),
    maxFeePerGas: decimalToHexQuantity(readRequiredStringField(decoded, ["maxExecutionFeeLythoshi"])),
    maxPriorityFeePerGas: decimalToHexQuantity(readRequiredStringField(decoded, ["priorityTipLythoshi"])),
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

export interface NativeMarketEventDisplayRow extends NativeReceiptEventDisplayRow {
  blockHeight: number | null;
  txIndex: number | null;
  primaryId: string | null;
  relatedId: string | null;
  account: string | null;
  counterparty: string | null;
}

export interface NativeMarketStateResponse {
  schemaVersion?: number;
  spotMarkets?: unknown[];
  spotOrders?: unknown[];
  nftListings?: unknown[];
  collectionRoyalties?: unknown[];
  filters?: Record<string, unknown>;
  source?: Record<string, unknown>;
}

export interface NativeMarketStateDisplayRow {
  kind: "spotMarket" | "spotOrder" | "nftListing" | "collectionRoyalty";
  primaryId: string | null;
  marketId: string | null;
  collectionId: string | null;
  tokenId: string | null;
  account: string | null;
  nonce: string | null;
  side: string | null;
  status: string | null;
  price: string | null;
  amount: string | null;
  baseAsset: string | null;
  quoteAsset: string | null;
  blockHeight: number | null;
  fields: Array<[string, string]>;
}

export interface NativeAgentStateDisplayRow {
  kind:
    | "issuer"
    | "attestation"
    | "consent"
    | "service"
    | "availability"
    | "arbiter"
    | "reputationReview"
    | "spendingPolicy"
    | "policySpend"
    | "escrow";
  primaryId: string | null;
  account: string | null;
  counterparty: string | null;
  nonce: string | null;
  assetId: string | null;
  status: string | null;
  amount: string | null;
  blockHeight: number | null;
  fields: Array<[string, string]>;
}

export interface NativeAgentStateDisplayRows {
  issuers: NativeAgentStateDisplayRow[];
  attestations: NativeAgentStateDisplayRow[];
  consents: NativeAgentStateDisplayRow[];
  services: NativeAgentStateDisplayRow[];
  availability: NativeAgentStateDisplayRow[];
  arbiters: NativeAgentStateDisplayRow[];
  reputationReviews: NativeAgentStateDisplayRow[];
  spendingPolicies: NativeAgentStateDisplayRow[];
  policySpends: NativeAgentStateDisplayRow[];
  escrows: NativeAgentStateDisplayRow[];
}

export const MRV_NATIVE_TX_EXTENSION_KIND = 0x30;
export const MRV_NATIVE_TX_EXTENSION_BODY_HEX = "0x01";
export const MRV_NATIVE_RECEIPT_TX_TYPE = 0x41;
export const NO_EVM_RECEIPT_PROOF_SCHEMA = CoreSdk.NO_EVM_RECEIPT_PROOF_SCHEMA;
export const NO_EVM_RECEIPT_PROOF_TYPE = CoreSdk.NO_EVM_RECEIPT_PROOF_TYPE;
export const NO_EVM_COMPACT_RECEIPT_PROOF_TYPE = "canonicalReceiptInclusion";
export const NO_EVM_RECEIPT_CODEC = CoreSdk.NO_EVM_RECEIPT_CODEC;
export const NO_EVM_RECEIPTS_ROOT_DOMAIN = "monolythium/v2/receipts_root/1";
export const NO_EVM_RECEIPTS_ROOT_ALGORITHM = `keccak256("${NO_EVM_RECEIPTS_ROOT_DOMAIN}" || receipts_len_u32_le || (idx_u32_le || receipt_len_u32_le || receipt_bytes)*)`;
export const NO_EVM_LEGACY_RECEIPTS_ROOT_ALGORITHM = "keccak256(monolythium/v2/receipts_root/1 || len || indexed bincode receipts)";
export const NO_EVM_BINARY_RECEIPTS_ROOT_ALGORITHM = CoreSdk.NO_EVM_RECEIPT_ROOT_ALGORITHM;
export const NO_EVM_BINARY_RECEIPTS_ROOT_EMPTY_DOMAIN = CoreSdk.NO_EVM_RECEIPTS_ROOT_DOMAIN;
export const NO_EVM_BINARY_RECEIPT_LEAF_DOMAIN = NO_EVM_BINARY_RECEIPTS_ROOT_EMPTY_DOMAIN.replace("receipts_root_empty", "receipt_leaf");
export const NO_EVM_BINARY_RECEIPT_NODE_DOMAIN = NO_EVM_BINARY_RECEIPTS_ROOT_EMPTY_DOMAIN.replace("receipts_root_empty", "receipt_node");
export const NO_EVM_COMPACT_INCLUSION_PROOF_SCHEMA = "mono.no_evm_receipt_compact_inclusion.v1";
export const NO_EVM_COMPACT_INCLUSION_TREE_ALGORITHM = "binary-keccak-receipt-tree";
export const NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA = CoreSdk.NO_EVM_ARCHIVE_PROOF_SCHEMA;
export const NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE = "indexerReceiptArchiveContentDigest";
export const NO_EVM_RECEIPT_FINALITY_EVIDENCE_SCHEMA = CoreSdk.NO_EVM_FINALITY_EVIDENCE_SCHEMA;
export const NO_EVM_RECEIPT_FINALITY_EVIDENCE_SOURCE = CoreSdk.NO_EVM_FINALITY_EVIDENCE_SOURCE;

const HEX_BYTES_RE = /^0x(?:[0-9a-fA-F]{2})*$/;
const HASH32_RE = /^0x[0-9a-fA-F]{64}$/;
const ARCHIVE_PROOF_SIGNATURE_PREFIX = "mono.snapshot.sig.v1";
const ARCHIVE_PROOF_SIGNER_ID_RE = /^0x[0-9a-fA-F]{40}$/;
const ARCHIVE_PROOF_SIGNATURE_PAYLOAD_RE = /^0x(?:[0-9a-fA-F]{2})+$/;
const U32_MAX = 0xffff_ffff;
const textEncoder = new TextEncoder();

export type MrvNativeEvidenceState = "present" | "missing" | "invalid";
export type NoEvmReceiptProofKind = "boundedCacheTranscript" | "compactInclusion";
export type NoEvmReceiptProofHistorySource = "legacyUnspecified" | "liveBlockCache" | "indexerReceiptArchive";

export interface MrvNativeExtensionEvidence {
  kind: number;
  bodyHex: string | null;
  source: string;
  validMrvV1: boolean;
}

export interface NoEvmReceiptProofTranscript {
  schema: typeof NO_EVM_RECEIPT_PROOF_SCHEMA;
  proofKind?: "boundedCacheTranscript";
  proofType: typeof NO_EVM_RECEIPT_PROOF_TYPE;
  historySource?: "legacyUnspecified" | "liveBlockCache";
  archiveProof?: null;
  finalityEvidence?: NoEvmReceiptFinalityEvidence | null;
  rootAlgorithm: string;
  receiptCodec: string;
  blockHash: string;
  txHash: string;
  receiptsRoot: string;
  targetReceiptHash: string;
  blockHeight: number;
  txIndex: number;
  receiptCount: number;
  receiptTranscript: string[];
  missingProofMaterial?: string[];
}

export interface NoEvmCompactInclusionProof {
  schema: typeof NO_EVM_COMPACT_INCLUSION_PROOF_SCHEMA;
  treeAlgorithm: typeof NO_EVM_COMPACT_INCLUSION_TREE_ALGORITHM;
  root: string;
  leafHash: string;
  siblingHashes: string[];
  pathSides: boolean[];
}

export interface NoEvmArchiveCoveringSnapshot {
  snapshotHeight: number;
  manifestHash: string;
  signatureDigest: string;
  contentHash: string;
  checkpointContentHash: string;
  checkpointFrom: number;
  checkpointTo: number;
  signatures: string[];
}

export interface NoEvmReceiptArchiveProofBinding {
  schema: typeof NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA;
  source: typeof NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE;
  manifestHash: string;
  contentHash: string;
  signatureDigest?: string;
  signatures: string[];
  coveringSnapshot?: NoEvmArchiveCoveringSnapshot;
}

export interface NoEvmReceiptBlsCertificate {
  round: number;
  signature: string;
  signersBitmap: string;
  signerIndices: number[];
  signerCount: number;
}

export interface NoEvmReceiptFinalityEvidence {
  schema: typeof NO_EVM_RECEIPT_FINALITY_EVIDENCE_SCHEMA;
  source: typeof NO_EVM_RECEIPT_FINALITY_EVIDENCE_SOURCE;
  round: number;
  certificate: NoEvmReceiptBlsCertificate;
}

export interface NoEvmCompactReceiptProofTranscript {
  schema: typeof NO_EVM_RECEIPT_PROOF_SCHEMA;
  proofKind: "compactInclusion";
  proofType: typeof NO_EVM_COMPACT_RECEIPT_PROOF_TYPE;
  historySource: "liveBlockCache" | "indexerReceiptArchive";
  rootAlgorithm: string;
  receiptCodec: string;
  blockHash: string;
  txHash: string;
  receiptsRoot: string;
  targetReceiptHash: string;
  blockHeight: number;
  txIndex: number;
  receiptCount: number;
  compactInclusionProof: NoEvmCompactInclusionProof;
  archiveProof?: NoEvmReceiptArchiveProofBinding | null;
  finalityEvidence?: NoEvmReceiptFinalityEvidence | null;
  targetReceiptBytes: string;
  receiptTranscript?: string[];
  missingProofMaterial?: string[];
}

export type NoEvmReceiptProofMaterial =
  | NoEvmReceiptProofTranscript
  | NoEvmCompactReceiptProofTranscript;

export type NoEvmReceiptProofConsistencyState = "verified" | "mismatch";

export interface NoEvmReceiptProofConsistency {
  state: NoEvmReceiptProofConsistencyState;
  proofKind: NoEvmReceiptProofKind;
  historySource: NoEvmReceiptProofHistorySource;
  computedReceiptsRoot: string;
  computedTargetReceiptHash: string | null;
  receiptCountMatches: boolean | null;
  targetReceiptAvailable: boolean;
  compactPathMatches: boolean | null;
  mismatches: string[];
}

export type NoEvmFinalityVerificationState = "verified" | "unverified" | "mismatch";

export interface NoEvmFinalityVerificationTrustOptions {
  chainId: number | bigint | string;
  clusterPublicKey: string | Uint8Array | readonly number[];
  committeeSize: number | bigint | string;
  threshold: number | bigint | string;
}

export type NoEvmArchiveVerificationKeyInput = string | Uint8Array | readonly number[];

export interface NoEvmArchiveVerificationTrustOptions {
  publicKeys: string | readonly NoEvmArchiveVerificationKeyInput[];
  threshold: number | bigint | string;
}

export interface NoEvmReceiptFinalityVerification {
  state: NoEvmFinalityVerificationState;
  result: NoEvmBlsFinalityVerification | null;
  reason: string | null;
}

export type NoEvmArchiveVerificationState = "verified" | "unconfigured" | "mismatch" | "malformed";
export type NoEvmArchiveSignatureSource = "exactHeight" | "coveringSnapshot" | "none";

export interface NoEvmReceiptArchiveVerification {
  state: NoEvmArchiveVerificationState;
  result: NoEvmArchiveSignatureVerification | null;
  reason: string | null;
  signatureSource: NoEvmArchiveSignatureSource;
}

export interface MrvNativeProofEvidence {
  source: string;
  summary: string;
  proofKind: NoEvmReceiptProofKind | null;
  historySource: NoEvmReceiptProofHistorySource | null;
  materialLabel: string | null;
  raw: unknown;
  transcript: NoEvmReceiptProofMaterial | null;
  consistency: NoEvmReceiptProofConsistency | null;
  archiveVerification: NoEvmReceiptArchiveVerification | null;
  finalityVerification: NoEvmReceiptFinalityVerification | null;
  validationErrors: string[];
}

export type MrvNativeProofFieldState = "present" | "explicit-null" | "missing";

export interface MrvNativeTransactionEvidence {
  txHash: string | null;
  operation: string | null;
  extension: MrvNativeExtensionEvidence | null;
  receiptTxType: number | null;
  receiptSchema: string | null;
  artifactHash: string | null;
  receiptCommitment: string | null;
  includedBlock: number | null;
  reverted: boolean | null;
  eventCount: number | null;
  nativeDeltaCount: number | null;
  proof: MrvNativeProofEvidence | null;
  proofFieldSource: string | null;
  proofFieldState: MrvNativeProofFieldState;
  pqCheckpoint: string | null;
  submittedState: MrvNativeEvidenceState;
  includedState: MrvNativeEvidenceState;
  receiptState: MrvNativeEvidenceState;
  proofState: MrvNativeEvidenceState;
  blockers: string[];
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

function readNativeEventIdentity(decoded: Record<string, unknown> | null, keys: string[]): string | null {
  if (!decoded) return null;
  for (const key of keys) {
    const value = decoded[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "bigint") return value.toString();
  }
  return null;
}

function nativeStateRecord(row: unknown): Record<string, unknown> | null {
  return row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : null;
}

function readNativeStateString(row: Record<string, unknown> | null, keys: string[]): string | null {
  if (!row) return null;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "bigint") return value.toString();
  }
  return null;
}

function readNativeStateNumber(row: Record<string, unknown> | null, keys: string[]): number | null {
  const value = readNativeStateString(row, keys);
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nativeMarketStateRow(
  kind: NativeMarketStateDisplayRow["kind"],
  raw: unknown,
): NativeMarketStateDisplayRow {
  const row = nativeStateRecord(raw);
  const marketId = readNativeStateString(row, ["marketId", "market_id", "spotMarketId", "spot_market_id"]);
  const collectionId = readNativeStateString(row, ["collectionId", "collection_id", "assetId", "asset_id"]);
  const tokenId = readNativeStateString(row, ["tokenId", "token_id", "nftId", "nft_id"]);
  const primaryId = readNativeStateString(row, [
    "id",
    "marketId",
    "market_id",
    "orderId",
    "order_id",
    "listingId",
    "listing_id",
    "collectionId",
    "collection_id",
  ]);

  return {
    kind,
    primaryId,
    marketId,
    collectionId,
    tokenId,
    account: readNativeStateString(row, ["owner", "account", "maker", "seller", "recipient", "royaltyRecipient", "royalty_recipient"]),
    nonce: readNativeStateString(row, ["nonce", "orderNonce", "order_nonce"]),
    side: readNativeStateString(row, ["side", "orderSide", "order_side"]),
    status: readNativeStateString(row, ["status", "state", "listingStatus", "listing_status"]),
    price: readNativeStateString(row, ["price", "priceLythoshi", "price_lythoshi", "limitPrice", "limit_price"]),
    amount: readNativeStateString(row, ["amount", "amountBase", "amount_base", "remainingAmount", "remaining_amount", "royaltyBps", "royalty_bps"]),
    baseAsset: readNativeStateString(row, ["baseAssetId", "base_asset_id", "baseAsset", "base_asset", "baseToken", "base_token"]),
    quoteAsset: readNativeStateString(row, ["quoteAsset", "quote_asset", "quoteToken", "quote_token", "paymentAsset", "payment_asset"]),
    blockHeight: readNativeStateNumber(row, ["blockHeight", "block_height", "updatedAtBlock", "updated_at_block", "registeredAtBlock", "registered_at_block"]),
    fields: row
      ? Object.entries(row)
          .filter(([key]) => ![
            "id",
            "marketId",
            "market_id",
            "spotMarketId",
            "spot_market_id",
            "orderId",
            "order_id",
            "listingId",
            "listing_id",
            "collectionId",
            "collection_id",
            "tokenId",
            "token_id",
            "assetId",
            "asset_id",
            "owner",
            "account",
            "maker",
            "seller",
            "recipient",
            "royaltyRecipient",
            "royalty_recipient",
            "nonce",
            "orderNonce",
            "order_nonce",
            "side",
            "orderSide",
            "order_side",
            "status",
            "state",
            "listingStatus",
            "listing_status",
            "price",
            "priceLythoshi",
            "price_lythoshi",
            "limitPrice",
            "limit_price",
            "amount",
            "amountBase",
            "amount_base",
            "remainingAmount",
            "remaining_amount",
            "royaltyBps",
            "royalty_bps",
            "baseAssetId",
            "base_asset_id",
            "baseAsset",
            "base_asset",
            "baseToken",
            "base_token",
            "quoteAsset",
            "quote_asset",
            "quoteToken",
            "quote_token",
            "paymentAsset",
            "payment_asset",
            "blockHeight",
            "block_height",
            "updatedAtBlock",
            "updated_at_block",
            "registeredAtBlock",
            "registered_at_block",
          ].includes(key))
          .map(([key, value]) => [key, nativeFieldDisplay(value)] as [string, string])
      : [],
  };
}

function nativeAgentStateRow(
  kind: NativeAgentStateDisplayRow["kind"],
  raw: unknown,
): NativeAgentStateDisplayRow {
  const row = nativeStateRecord(raw);
  const primaryId = readNativeStateString(row, nativeAgentPrimaryIdKeys(kind));
  const account = readNativeStateString(row, nativeAgentAccountKeys(kind));
  const counterparty = readNativeStateString(row, nativeAgentCounterpartyKeys(kind));
  const directStatus = readNativeStateString(row, ["status", "state", "resolution"]);
  const maxConcurrent = readNativeStateString(row, ["maxConcurrent", "max_concurrent"]);
  const openRequests = readNativeStateString(row, ["openRequests", "open_requests"]);
  const scoreSummary = [
    readNativeStateString(row, ["speedScore", "speed_score"]),
    readNativeStateString(row, ["qualityScore", "quality_score"]),
    readNativeStateString(row, ["communicationScore", "communication_score"]),
    readNativeStateString(row, ["accuracyScore", "accuracy_score"]),
  ].filter((value): value is string => value !== null);

  return {
    kind,
    primaryId,
    account,
    counterparty,
    nonce: readNativeStateString(row, ["nonce"]),
    assetId: readNativeStateString(row, ["assetId", "asset_id", "paymentAssetId", "payment_asset_id"]),
    status: directStatus ?? nativeAgentBooleanStatus(kind, row),
    amount:
      kind === "availability" && (openRequests !== null || maxConcurrent !== null)
        ? `${openRequests ?? "0"}/${maxConcurrent ?? "?"}`
        : kind === "reputationReview" && scoreSummary.length > 0
          ? scoreSummary.join("/")
          : readNativeStateString(row, [
              "amount",
              "spent",
              "windowLimit",
              "window_limit",
              "perActionLimit",
              "per_action_limit",
            ]),
    blockHeight: readNativeStateNumber(row, ["updatedAtBlock", "updated_at_block", "createdAtBlock", "created_at_block"]),
    fields: row
      ? Object.entries(row)
          .filter(([key]) => ![
            "issuerId",
            "issuer_id",
            "attestationId",
            "attestation_id",
            "consentId",
            "consent_id",
            "serviceId",
            "service_id",
            "arbiterId",
            "arbiter_id",
            "reviewId",
            "review_id",
            "policyId",
            "policy_id",
            "escrowId",
            "escrow_id",
            "id",
            "owner",
            "buyer",
            "controller",
            "provider",
            "arbiter",
            "issuer",
            "subject",
            "reviewer",
            "grantee",
            "account",
            "lastActor",
            "last_actor",
            "nonce",
            "assetId",
            "asset_id",
            "paymentAssetId",
            "payment_asset_id",
            "status",
            "state",
            "resolution",
            "amount",
            "spent",
            "windowLimit",
            "window_limit",
            "perActionLimit",
            "per_action_limit",
            "enabled",
            "active",
            "paused",
            "maxConcurrent",
            "max_concurrent",
            "openRequests",
            "open_requests",
            "speedScore",
            "speed_score",
            "qualityScore",
            "quality_score",
            "communicationScore",
            "communication_score",
            "accuracyScore",
            "accuracy_score",
            "updatedAtBlock",
            "updated_at_block",
            "createdAtBlock",
            "created_at_block",
          ].includes(key))
          .map(([key, value]) => [key, nativeFieldDisplay(value)] as [string, string])
      : [],
  };
}

function nativeAgentPrimaryIdKeys(kind: NativeAgentStateDisplayRow["kind"]): string[] {
  switch (kind) {
    case "issuer":
      return ["issuerId", "issuer_id", "id"];
    case "attestation":
      return ["attestationId", "attestation_id", "id"];
    case "consent":
      return ["consentId", "consent_id", "id"];
    case "service":
      return ["serviceId", "service_id", "id"];
    case "availability":
      return ["provider", "account", "id"];
    case "arbiter":
      return ["arbiterId", "arbiter_id", "id"];
    case "reputationReview":
      return ["reviewId", "review_id", "id"];
    case "spendingPolicy":
    case "policySpend":
      return ["policyId", "policy_id", "id"];
    case "escrow":
      return ["escrowId", "escrow_id", "id"];
  }
}

function nativeAgentAccountKeys(kind: NativeAgentStateDisplayRow["kind"]): string[] {
  switch (kind) {
    case "issuer":
      return ["issuer", "account"];
    case "attestation":
      return ["subject", "account"];
    case "consent":
      return ["subject", "account"];
    case "service":
    case "availability":
      return ["provider", "account"];
    case "arbiter":
      return ["arbiter", "account"];
    case "reputationReview":
      return ["reviewer", "account"];
    case "spendingPolicy":
      return ["owner", "account", "controller"];
    case "policySpend":
      return ["controller", "account"];
    case "escrow":
      return ["buyer", "provider", "arbiter", "account"];
  }
}

function nativeAgentCounterpartyKeys(kind: NativeAgentStateDisplayRow["kind"]): string[] {
  switch (kind) {
    case "issuer":
    case "service":
    case "availability":
    case "arbiter":
      return ["lastActor", "last_actor"];
    case "attestation":
      return ["issuer", "issuerId", "issuer_id", "lastActor", "last_actor"];
    case "consent":
      return ["grantee", "lastActor", "last_actor"];
    case "reputationReview":
      return ["subject", "lastActor", "last_actor"];
    case "spendingPolicy":
      return ["controller", "owner", "lastActor", "last_actor"];
    case "policySpend":
      return ["controller", "lastActor", "last_actor"];
    case "escrow":
      return ["provider", "arbiter", "lastActor", "last_actor"];
  }
}

function nativeAgentBooleanStatus(
  kind: NativeAgentStateDisplayRow["kind"],
  row: Record<string, unknown> | null,
): string | null {
  if (!row) return null;
  if (typeof row["enabled"] === "boolean") return row["enabled"] ? "enabled" : "disabled";
  if (typeof row["active"] === "boolean") return row["active"] ? "active" : "inactive";
  if (typeof row["paused"] === "boolean") return row["paused"] ? "paused" : "available";
  if (kind === "availability") return "available";
  return null;
}

function nativeEventDisplayRow(event: {
  logIndex: number;
  address: string;
  eventTopic: string;
  decoded?: unknown;
  decodedJson: string;
}): NativeReceiptEventDisplayRow {
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
}

function readPresentField(value: unknown, keys: string[]): { key: string; value: unknown } | null {
  const row = unknownRecord(value);
  if (!row) return null;
  for (const key of keys) {
    const raw = row[key];
    if (raw === null || raw === undefined) continue;
    if (typeof raw === "string" && raw.trim() === "") continue;
    return { key, value: raw };
  }
  return null;
}

function normalizeHexBytes(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^0x[0-9a-fA-F]*$/.test(trimmed)) {
      const body = trimmed.slice(2);
      return `0x${(body.length % 2 === 0 ? body : `0${body}`).toLowerCase()}`;
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    const bytes = value.map((item) => {
      if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 255) {
        return null;
      }
      return item.toString(16).padStart(2, "0");
    });
    return bytes.every((item): item is string => item !== null) ? `0x${bytes.join("")}` : null;
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return `0x${Array.from(value as Uint8Array)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
  }
  return null;
}

function readExtensionBodyHex(row: Record<string, unknown>): string | null {
  for (const key of ["bodyHex", "body_hex", "body", "data"]) {
    if (row[key] !== undefined) {
      return normalizeHexBytes(row[key]);
    }
  }
  return null;
}

function mrvExtensionFromRecord(
  row: Record<string, unknown>,
  source: string,
): MrvNativeExtensionEvidence | null {
  const kind = readNumberField(row, ["kind", "extensionKind", "extension_kind"]);
  if (kind !== MRV_NATIVE_TX_EXTENSION_KIND) return null;
  const bodyHex = readExtensionBodyHex(row);
  return {
    kind,
    bodyHex,
    source,
    validMrvV1: bodyHex === MRV_NATIVE_TX_EXTENSION_BODY_HEX,
  };
}

function findMrvNativeExtension(
  value: unknown,
  source = "lyth_decodeTx",
  depth = 0,
): MrvNativeExtensionEvidence | null {
  if (depth > 4 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const ext = findMrvNativeExtension(value[i], `${source}[${i}]`, depth + 1);
      if (ext) return ext;
    }
    return null;
  }

  const row = unknownRecord(value);
  if (!row) return null;

  const direct = mrvExtensionFromRecord(row, source);
  if (direct) return direct;

  const priorityKeys = [
    "mrvExtension",
    "mrv_extension",
    "extension",
    "txExtension",
    "tx_extension",
    "extensions",
    "txExtensions",
    "tx_extensions",
    "nativeExtensions",
    "native_extensions",
    "transactionExtensions",
    "transaction_extensions",
    "nativeTx",
    "native_tx",
    "tx",
    "decodedCalldata",
    "decoded_calldata",
  ];
  for (const key of priorityKeys) {
    if (row[key] !== undefined) {
      const ext = findMrvNativeExtension(row[key], `${source}.${key}`, depth + 1);
      if (ext) return ext;
    }
  }

  for (const [key, nested] of Object.entries(row)) {
    const normalized = key.toLowerCase();
    if (!normalized.includes("mrv") && !normalized.includes("extension")) continue;
    const ext = findMrvNativeExtension(nested, `${source}.${key}`, depth + 1);
    if (ext) return ext;
  }
  return null;
}

function findMrvOperationHint(value: unknown, depth = 0): string | null {
  if (depth > 4 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hint = findMrvOperationHint(item, depth + 1);
      if (hint) return hint;
    }
    return null;
  }
  const row = unknownRecord(value);
  if (!row) {
    if (typeof value === "string" && value.toLowerCase().includes("mrv")) return value;
    return null;
  }

  for (const key of ["kind", "type", "method", "methodName", "operation", "op", "category"]) {
    const raw = row[key];
    if (typeof raw === "string" && raw.toLowerCase().includes("mrv")) return raw;
  }
  for (const nested of Object.values(row)) {
    const hint = findMrvOperationHint(nested, depth + 1);
    if (hint) return hint;
  }
  return null;
}

function proofSummary(value: unknown): string {
  if (typeof value === "string") return value.length > 24 ? `${value.slice(0, 22)}…` : value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "present";
}

function readTranscriptString(
  row: Record<string, unknown>,
  key: string,
  errors: string[],
  label = key,
): string | null {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${label} missing`);
    return null;
  }
  return value.trim();
}

function readOptionalTranscriptString(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function readTranscriptHash32(
  row: Record<string, unknown>,
  key: string,
  errors: string[],
  label = key,
): string | null {
  const value = readTranscriptString(row, key, errors, label);
  if (value !== null && !HASH32_RE.test(value)) {
    errors.push(`${label} must be a 32-byte 0x hex value`);
  }
  return value;
}

function readOptionalTranscriptHash32(
  row: Record<string, unknown>,
  key: string,
  errors: string[],
  label = key,
): string | undefined {
  const value = row[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${label} must be a 32-byte 0x hex value`);
    return undefined;
  }
  const trimmed = value.trim();
  if (!HASH32_RE.test(trimmed)) {
    errors.push(`${label} must be a 32-byte 0x hex value`);
    return undefined;
  }
  return trimmed;
}

function readTranscriptNumber(
  row: Record<string, unknown>,
  key: string,
  errors: string[],
  label = key,
): number | null {
  const value = readNumberField(row, [key]);
  if (value === null) {
    errors.push(`${label} missing`);
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    errors.push(`${label} must be a non-negative integer`);
  }
  return value;
}

function readProofKind(
  row: Record<string, unknown>,
  proofType: string | null,
  errors: string[],
): NoEvmReceiptProofKind | null {
  const value = readOptionalTranscriptString(row, "proofKind");
  const proofKind = value ?? (proofType === NO_EVM_COMPACT_RECEIPT_PROOF_TYPE ? "compactInclusion" : "boundedCacheTranscript");
  if (proofKind === "boundedCacheTranscript" || proofKind === "compactInclusion") return proofKind;
  errors.push("proofKind must be boundedCacheTranscript or compactInclusion");
  return null;
}

function readProofHistorySource(
  row: Record<string, unknown>,
  errors: string[],
): NoEvmReceiptProofHistorySource | null {
  const value = readOptionalTranscriptString(row, "historySource");
  if (value === null) return null;
  if (value === "legacyUnspecified" || value === "liveBlockCache" || value === "indexerReceiptArchive") {
    return value;
  }
  errors.push("historySource must be legacyUnspecified, liveBlockCache, or indexerReceiptArchive");
  return null;
}

function readReceiptTranscript(
  row: Record<string, unknown>,
  errors: string[],
): string[] {
  const value = row.receiptTranscript;
  if (!Array.isArray(value)) {
    errors.push("receiptTranscript must be an array");
    return [];
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !HEX_BYTES_RE.test(entry.trim())) {
      errors.push(`receiptTranscript[${index}] must be a 0x byte blob`);
      return "";
    }
    return entry.trim();
  });
}

function readOptionalStringArray(
  row: Record<string, unknown>,
  key: string,
  errors: string[],
): string[] | undefined {
  const value = row[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    errors.push(`${key} must be an array`);
    return undefined;
  }
  const strings: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (typeof item !== "string" || item.trim() === "") {
      errors.push(`${key}[${index}] must be a non-empty string`);
    } else {
      strings.push(item.trim());
    }
  }
  return strings;
}

function readCompactInclusionProof(
  value: unknown,
  errors: string[],
): NoEvmCompactInclusionProof | null {
  const row = unknownRecord(value);
  if (!row) {
    errors.push("compactInclusionProof must be an object");
    return null;
  }

  const startErrorCount = errors.length;
  const schema = readTranscriptString(row, "schema", errors, "compactInclusionProof.schema");
  const treeAlgorithm = readTranscriptString(row, "treeAlgorithm", errors, "compactInclusionProof.treeAlgorithm");
  const root = readTranscriptHash32(row, "root", errors, "compactInclusionProof.root");
  const leafHash = readTranscriptHash32(row, "leafHash", errors, "compactInclusionProof.leafHash");
  const siblingHashesValue = row.siblingHashes;
  const pathSidesValue = row.pathSides;
  const siblingHashes: string[] = [];
  const pathSides: boolean[] = [];

  if (!Array.isArray(siblingHashesValue)) {
    errors.push("compactInclusionProof.siblingHashes must be an array");
  } else {
    siblingHashesValue.forEach((hash, index) => {
      if (typeof hash !== "string" || !HASH32_RE.test(hash.trim())) {
        errors.push(`compactInclusionProof.siblingHashes[${index}] must be a 32-byte 0x hex value`);
      } else {
        siblingHashes.push(hash.trim());
      }
    });
  }

  if (!Array.isArray(pathSidesValue)) {
    errors.push("compactInclusionProof.pathSides must be an array");
  } else {
    pathSidesValue.forEach((side, index) => {
      if (typeof side !== "boolean") {
        errors.push(`compactInclusionProof.pathSides[${index}] must be a boolean`);
      } else {
        pathSides.push(side);
      }
    });
  }

  if (schema !== null && schema !== NO_EVM_COMPACT_INCLUSION_PROOF_SCHEMA) {
    errors.push(`compactInclusionProof.schema must be ${NO_EVM_COMPACT_INCLUSION_PROOF_SCHEMA}`);
  }
  if (treeAlgorithm !== null && treeAlgorithm !== NO_EVM_COMPACT_INCLUSION_TREE_ALGORITHM) {
    errors.push(`compactInclusionProof.treeAlgorithm must be ${NO_EVM_COMPACT_INCLUSION_TREE_ALGORITHM}`);
  }
  if (Array.isArray(siblingHashesValue) && Array.isArray(pathSidesValue) && siblingHashesValue.length !== pathSidesValue.length) {
    errors.push("compactInclusionProof siblingHashes/pathSides length mismatch");
  }

  if (
    errors.length > startErrorCount
    || schema !== NO_EVM_COMPACT_INCLUSION_PROOF_SCHEMA
    || treeAlgorithm !== NO_EVM_COMPACT_INCLUSION_TREE_ALGORITHM
    || root === null
    || leafHash === null
  ) {
    return null;
  }

  return {
    schema,
    treeAlgorithm,
    root,
    leafHash,
    siblingHashes,
    pathSides,
  };
}

function readArchiveProofSignatures(
  value: unknown,
  errors: string[],
  label = "archiveProof.signatures",
): string[] {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }

  const signatures: string[] = [];
  value.forEach((signature, index) => {
    if (typeof signature !== "string" || signature.trim() === "") {
      errors.push(`${label}[${index}] must be a non-empty string`);
      return;
    }

    const trimmed = signature.trim();
    const fields = trimmed.split(":");
    if (fields.length !== 3) {
      errors.push(`${label}[${index}] must have 3 colon-separated fields`);
      return;
    }

    const [prefix, signerId, payload] = fields;
    if (prefix !== ARCHIVE_PROOF_SIGNATURE_PREFIX) {
      errors.push(`${label}[${index}] prefix must be ${ARCHIVE_PROOF_SIGNATURE_PREFIX}`);
      return;
    }
    if (!ARCHIVE_PROOF_SIGNER_ID_RE.test(signerId)) {
      errors.push(`${label}[${index}] signer id must be a 20-byte 0x hex value`);
      return;
    }
    if (!ARCHIVE_PROOF_SIGNATURE_PAYLOAD_RE.test(payload)) {
      errors.push(`${label}[${index}] payload must be a non-empty 0x hex byte blob`);
      return;
    }

    signatures.push(trimmed);
  });

  return signatures;
}

function readArchiveCoveringSnapshot(
  value: unknown,
  errors: string[],
  archiveContentHash: string | null,
  proofBlockHeight: number | null,
): NoEvmArchiveCoveringSnapshot | undefined {
  if (value === undefined || value === null) return undefined;
  const row = unknownRecord(value);
  if (!row) {
    errors.push("archiveProof.coveringSnapshot must be an object");
    return undefined;
  }

  const startErrorCount = errors.length;
  const snapshotHeight = readTranscriptNumber(row, "snapshotHeight", errors, "archiveProof.coveringSnapshot.snapshotHeight");
  const manifestHash = readTranscriptHash32(row, "manifestHash", errors, "archiveProof.coveringSnapshot.manifestHash");
  const signatureDigest = readTranscriptHash32(row, "signatureDigest", errors, "archiveProof.coveringSnapshot.signatureDigest");
  const contentHash = readTranscriptHash32(row, "contentHash", errors, "archiveProof.coveringSnapshot.contentHash");
  const checkpointContentHash = readTranscriptHash32(row, "checkpointContentHash", errors, "archiveProof.coveringSnapshot.checkpointContentHash");
  const checkpointFrom = readTranscriptNumber(row, "checkpointFrom", errors, "archiveProof.coveringSnapshot.checkpointFrom");
  const checkpointTo = readTranscriptNumber(row, "checkpointTo", errors, "archiveProof.coveringSnapshot.checkpointTo");
  const signatures = readArchiveProofSignatures(
    row.signatures,
    errors,
    "archiveProof.coveringSnapshot.signatures",
  );

  if (checkpointFrom !== null && checkpointFrom !== 0) {
    errors.push("archiveProof.coveringSnapshot.checkpointFrom must be 0");
  }
  if (checkpointTo !== null && snapshotHeight !== null && checkpointTo > snapshotHeight) {
    errors.push("archiveProof.coveringSnapshot.checkpointTo must be <= snapshotHeight");
  }
  if (checkpointTo !== null && proofBlockHeight !== null && checkpointTo !== proofBlockHeight) {
    errors.push("archiveProof.coveringSnapshot.checkpointTo must match blockHeight");
  }
  if (
    checkpointContentHash !== null
    && archiveContentHash !== null
    && checkpointContentHash.toLowerCase() !== archiveContentHash.toLowerCase()
  ) {
    errors.push("archiveProof.coveringSnapshot.checkpointContentHash must match archiveProof.contentHash");
  }
  if (Array.isArray(row.signatures) && signatures.length === 0) {
    errors.push("archiveProof.coveringSnapshot.signatures must be non-empty");
  }

  if (
    errors.length > startErrorCount
    || snapshotHeight === null
    || manifestHash === null
    || signatureDigest === null
    || contentHash === null
    || checkpointContentHash === null
    || checkpointFrom === null
    || checkpointTo === null
  ) {
    return undefined;
  }

  return {
    snapshotHeight,
    manifestHash,
    signatureDigest,
    contentHash,
    checkpointContentHash,
    checkpointFrom,
    checkpointTo,
    signatures,
  };
}

function readArchiveProofBinding(
  value: unknown,
  errors: string[],
  proofBlockHeight: number | null,
): NoEvmReceiptArchiveProofBinding | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const row = unknownRecord(value);
  if (!row) {
    errors.push("archiveProof must be an object");
    return undefined;
  }

  const startErrorCount = errors.length;
  const schema = readTranscriptString(row, "schema", errors, "archiveProof.schema");
  const source = readTranscriptString(row, "source", errors, "archiveProof.source");
  const manifestHash = readTranscriptHash32(row, "manifestHash", errors, "archiveProof.manifestHash");
  const contentHash = readTranscriptHash32(row, "contentHash", errors, "archiveProof.contentHash");
  const signatureDigest = readOptionalTranscriptHash32(row, "signatureDigest", errors, "archiveProof.signatureDigest");
  const signatures = readArchiveProofSignatures(row.signatures, errors);
  const coveringSnapshot = readArchiveCoveringSnapshot(
    row.coveringSnapshot,
    errors,
    contentHash,
    proofBlockHeight,
  );

  if (schema !== null && schema !== NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA) {
    errors.push(`archiveProof.schema must be ${NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA}`);
  }
  if (source !== null && source !== NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE) {
    errors.push(`archiveProof.source must be ${NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE}`);
  }

  if (
    errors.length > startErrorCount
    || schema !== NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA
    || source !== NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE
    || manifestHash === null
    || contentHash === null
  ) {
    return undefined;
  }

  return {
    schema,
    source,
    manifestHash,
    contentHash,
    ...(signatureDigest !== undefined ? { signatureDigest } : {}),
    signatures,
    ...(coveringSnapshot !== undefined ? { coveringSnapshot } : {}),
  };
}

function readBlsCertificate(
  value: unknown,
  errors: string[],
): NoEvmReceiptBlsCertificate | null {
  const row = unknownRecord(value);
  if (!row) {
    errors.push("finalityEvidence.certificate must be an object");
    return null;
  }

  const startErrorCount = errors.length;
  const round = readTranscriptNumber(row, "round", errors, "finalityEvidence.certificate.round");
  const signature = readTranscriptString(row, "signature", errors, "finalityEvidence.certificate.signature");
  const signersBitmap = readTranscriptString(row, "signersBitmap", errors, "finalityEvidence.certificate.signersBitmap");
  const signerCount = readTranscriptNumber(row, "signerCount", errors, "finalityEvidence.certificate.signerCount");
  const signerIndicesValue = row.signerIndices;
  const signerIndices: number[] = [];

  if (signature !== null && !HEX_BYTES_RE.test(signature)) {
    errors.push("finalityEvidence.certificate.signature must be a 0x byte blob");
  }
  if (signersBitmap !== null && !HEX_BYTES_RE.test(signersBitmap)) {
    errors.push("finalityEvidence.certificate.signersBitmap must be a 0x byte blob");
  }
  if (!Array.isArray(signerIndicesValue)) {
    errors.push("finalityEvidence.certificate.signerIndices must be an array");
  } else {
    signerIndicesValue.forEach((item, index) => {
      const value = typeof item === "bigint"
        ? bigToNum(item)
        : typeof item === "string" && item.trim() !== ""
          ? Number(item)
          : item;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        errors.push(`finalityEvidence.certificate.signerIndices[${index}] must be a non-negative integer`);
      } else {
        signerIndices.push(value);
      }
    });
  }

  if (
    errors.length > startErrorCount
    || round === null
    || signature === null
    || signersBitmap === null
    || signerCount === null
  ) {
    return null;
  }

  return {
    round,
    signature,
    signersBitmap,
    signerIndices,
    signerCount,
  };
}

function readFinalityEvidence(
  value: unknown,
  errors: string[],
): NoEvmReceiptFinalityEvidence | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const row = unknownRecord(value);
  if (!row) {
    errors.push("finalityEvidence must be an object");
    return undefined;
  }

  const startErrorCount = errors.length;
  const schema = readTranscriptString(row, "schema", errors, "finalityEvidence.schema");
  const source = readTranscriptString(row, "source", errors, "finalityEvidence.source");
  const round = readTranscriptNumber(row, "round", errors, "finalityEvidence.round");
  const certificate = readBlsCertificate(row.certificate, errors);

  if (schema !== null && schema !== NO_EVM_RECEIPT_FINALITY_EVIDENCE_SCHEMA) {
    errors.push(`finalityEvidence.schema must be ${NO_EVM_RECEIPT_FINALITY_EVIDENCE_SCHEMA}`);
  }
  if (source !== null && source !== NO_EVM_RECEIPT_FINALITY_EVIDENCE_SOURCE) {
    errors.push(`finalityEvidence.source must be ${NO_EVM_RECEIPT_FINALITY_EVIDENCE_SOURCE}`);
  }
  if (round !== null && certificate !== null && round !== certificate.round) {
    errors.push("finalityEvidence.round must match finalityEvidence.certificate.round");
  }

  if (
    errors.length > startErrorCount
    || schema !== NO_EVM_RECEIPT_FINALITY_EVIDENCE_SCHEMA
    || source !== NO_EVM_RECEIPT_FINALITY_EVIDENCE_SOURCE
    || round === null
    || certificate === null
  ) {
    return undefined;
  }

  return {
    schema,
    source,
    round,
    certificate,
  };
}

function u32Le(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  bytes[0] = value & 0xff;
  bytes[1] = (value >>> 8) & 0xff;
  bytes[2] = (value >>> 16) & 0xff;
  bytes[3] = (value >>> 24) & 0xff;
  return bytes;
}

function hexBytesToUint8Array(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (!HEX_BYTES_RE.test(trimmed)) return null;
  const bytes = new Uint8Array(trimmed.length / 2 - 1);
  for (let index = 2; index < trimmed.length; index += 2) {
    bytes[(index - 2) / 2] = Number.parseInt(trimmed.slice(index, index + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return `0x${Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

interface NormalizedNoEvmFinalityTrustOptions {
  chainId: number | bigint;
  clusterPublicKey: Uint8Array;
  committeeSize: number;
  threshold: number;
}

interface NormalizedNoEvmArchiveTrustOptions {
  trustedSigners: NoEvmArchiveTrustedSigner[];
  threshold: number;
}

type NoEvmFinalityTrustResolution =
  | { kind: "configured"; options: NormalizedNoEvmFinalityTrustOptions }
  | { kind: "unconfigured"; reason: string }
  | { kind: "invalid"; reason: string };

type NoEvmArchiveTrustResolution =
  | { kind: "configured"; options: NormalizedNoEvmArchiveTrustOptions }
  | { kind: "unconfigured"; reason: string }
  | { kind: "invalid"; reason: string };

const NO_EVM_RECEIPT_TRUST_REGISTRY_NETWORK = "testnet-69420";

const NO_EVM_FINALITY_TRUST_ENV = {
  chainId: ["VITE_MONOSCAN_CHAIN_ID", "VITE_MONO_CHAIN_ID"],
  clusterPublicKey: [
    "VITE_MONOSCAN_TRUSTED_BLS_CLUSTER_PUBKEY",
    "VITE_MONO_TRUSTED_BLS_CLUSTER_PUBKEY",
  ],
  committeeSize: [
    "VITE_MONOSCAN_TRUSTED_BLS_COMMITTEE_SIZE",
    "VITE_MONO_TRUSTED_BLS_COMMITTEE_SIZE",
  ],
  threshold: [
    "VITE_MONOSCAN_TRUSTED_BLS_THRESHOLD",
    "VITE_MONO_TRUSTED_BLS_THRESHOLD",
  ],
} as const;

const NO_EVM_ARCHIVE_TRUST_ENV = {
  publicKeys: [
    "VITE_MONOSCAN_TRUSTED_ARCHIVE_PUBKEYS",
    "VITE_MONO_TRUSTED_ARCHIVE_PUBKEYS",
  ],
  threshold: [
    "VITE_MONOSCAN_TRUSTED_ARCHIVE_THRESHOLD",
    "VITE_MONO_TRUSTED_ARCHIVE_THRESHOLD",
  ],
} as const;

function viteEnvString(keys: readonly string[]): string | null {
  const env = import.meta.env as Record<string, unknown>;
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function parseNonNegativeU64Input(
  value: number | bigint | string,
  label: string,
  errors: string[],
): number | bigint | null {
  try {
    const parsed = typeof value === "bigint"
      ? value
      : typeof value === "number"
        ? BigInt(value)
        : BigInt(value.trim());
    if (parsed < 0n) {
      errors.push(`${label} must be a non-negative integer`);
      return null;
    }
    return parsed <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(parsed) : parsed;
  } catch {
    errors.push(`${label} must be a non-negative integer`);
    return null;
  }
}

function parsePositiveSafeIntegerInput(
  value: number | bigint | string,
  label: string,
  errors: string[],
): number | null {
  try {
    const parsed = typeof value === "bigint"
      ? value
      : typeof value === "number"
        ? BigInt(value)
        : BigInt(value.trim());
    if (parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
      errors.push(`${label} must be a positive safe integer`);
      return null;
    }
    return Number(parsed);
  } catch {
    errors.push(`${label} must be a positive safe integer`);
    return null;
  }
}

function archivePublicKeyInputs(
  value: string | readonly NoEvmArchiveVerificationKeyInput[],
  errors: string[],
): NoEvmArchiveVerificationKeyInput[] {
  const values = typeof value === "string"
    ? value.split(",").map((item) => item.trim()).filter((item) => item !== "")
    : Array.from(value);
  if (values.length === 0) {
    errors.push("trusted archive public keys must be non-empty");
  }
  return values;
}

function normalizeArchivePublicKey(
  value: NoEvmArchiveVerificationKeyInput,
  label: string,
  errors: string[],
): Uint8Array | null {
  const bytes = typeof value === "string"
    ? hexBytesToUint8Array(value)
    : new Uint8Array(value);
  if (!bytes || bytes.length !== CoreSdk.ML_DSA_65_PUBLIC_KEY_LEN) {
    errors.push(`${label} must be ${CoreSdk.ML_DSA_65_PUBLIC_KEY_LEN} bytes`);
    return null;
  }
  return bytes;
}

function normalizeFinalityClusterPublicKey(
  value: string | Uint8Array | readonly number[],
  errors: string[],
): Uint8Array | null {
  const bytes = typeof value === "string"
    ? hexBytesToUint8Array(value)
    : new Uint8Array(value);
  if (!bytes || bytes.length !== 48) {
    errors.push("trusted BLS cluster public key must be 48 bytes");
    return null;
  }
  return bytes;
}

function normalizeNoEvmFinalityTrustOptions(
  options: NoEvmFinalityVerificationTrustOptions,
): NoEvmFinalityTrustResolution {
  const errors: string[] = [];
  const chainId = parseNonNegativeU64Input(options.chainId, "trusted BLS chain id", errors);
  const clusterPublicKey = normalizeFinalityClusterPublicKey(options.clusterPublicKey, errors);
  const committeeSize = parsePositiveSafeIntegerInput(
    options.committeeSize,
    "trusted BLS committee size",
    errors,
  );
  const threshold = parsePositiveSafeIntegerInput(
    options.threshold,
    "trusted BLS threshold",
    errors,
  );

  if (committeeSize !== null && threshold !== null && threshold > committeeSize) {
    errors.push("trusted BLS threshold cannot exceed committee size");
  }

  if (errors.length > 0 || chainId === null || clusterPublicKey === null || committeeSize === null || threshold === null) {
    return { kind: "invalid", reason: `trusted BLS finality config invalid: ${errors.join("; ")}` };
  }

  return {
    kind: "configured",
    options: {
      chainId,
      clusterPublicKey,
      committeeSize,
      threshold,
    },
  };
}

function normalizeNoEvmArchiveTrustOptions(
  options: NoEvmArchiveVerificationTrustOptions,
): NoEvmArchiveTrustResolution {
  const errors: string[] = [];
  const publicKeyInputs = archivePublicKeyInputs(options.publicKeys, errors);
  const trustedSigners: NoEvmArchiveTrustedSigner[] = [];
  publicKeyInputs.forEach((publicKey, index) => {
    const normalized = normalizeArchivePublicKey(
      publicKey,
      `trusted archive public key ${index + 1}`,
      errors,
    );
    if (normalized) {
      trustedSigners.push({ publicKey: normalized });
    }
  });
  const threshold = parsePositiveSafeIntegerInput(
    options.threshold,
    "trusted archive threshold",
    errors,
  );

  if (threshold !== null && publicKeyInputs.length > 0 && threshold > publicKeyInputs.length) {
    errors.push("trusted archive threshold cannot exceed trusted public key count");
  }

  if (errors.length > 0 || trustedSigners.length !== publicKeyInputs.length || threshold === null) {
    return { kind: "invalid", reason: `trusted archive signer config invalid: ${errors.join("; ")}` };
  }

  return {
    kind: "configured",
    options: {
      trustedSigners,
      threshold,
    },
  };
}

function noEvmReceiptTrustPolicyFromBundledRegistry(): NoEvmReceiptTrustPolicy | null {
  return CoreSdk.getNoEvmReceiptTrustPolicy(NO_EVM_RECEIPT_TRUST_REGISTRY_NETWORK);
}

function isWithinOptionalTrustBounds(
  value: number | bigint,
  validFrom: number | bigint | undefined,
  validTo: number | bigint | undefined,
): boolean {
  const checked = BigInt(value);
  if (validFrom != null && checked < BigInt(validFrom)) return false;
  if (validTo != null && checked > BigInt(validTo)) return false;
  return true;
}

function noEvmFinalityTrustOptionsFromEnv(): NoEvmFinalityTrustResolution {
  const chainId = viteEnvString(NO_EVM_FINALITY_TRUST_ENV.chainId);
  const clusterPublicKey = viteEnvString(NO_EVM_FINALITY_TRUST_ENV.clusterPublicKey);
  const committeeSize = viteEnvString(NO_EVM_FINALITY_TRUST_ENV.committeeSize);
  const threshold = viteEnvString(NO_EVM_FINALITY_TRUST_ENV.threshold);
  const values = [chainId, clusterPublicKey, committeeSize, threshold];

  if (values.every((value) => value === null)) {
    return {
      kind: "unconfigured",
      reason: "trusted BLS finality key not configured",
    };
  }

  const missing: string[] = [];
  if (chainId === null) missing.push(NO_EVM_FINALITY_TRUST_ENV.chainId[0]);
  if (clusterPublicKey === null) missing.push(NO_EVM_FINALITY_TRUST_ENV.clusterPublicKey[0]);
  if (committeeSize === null) missing.push(NO_EVM_FINALITY_TRUST_ENV.committeeSize[0]);
  if (threshold === null) missing.push(NO_EVM_FINALITY_TRUST_ENV.threshold[0]);
  if (missing.length > 0) {
    return {
      kind: "invalid",
      reason: `trusted BLS finality config incomplete: missing ${missing.join(", ")}`,
    };
  }

  return normalizeNoEvmFinalityTrustOptions({
    chainId: chainId as string,
    clusterPublicKey: clusterPublicKey as string,
    committeeSize: committeeSize as string,
    threshold: threshold as string,
  });
}

function noEvmFinalityTrustOptionsFromRegistry(
  transcript: NoEvmReceiptProofMaterial,
): NoEvmFinalityTrustResolution {
  let policy: NoEvmReceiptTrustPolicy | null;
  try {
    policy = noEvmReceiptTrustPolicyFromBundledRegistry();
  } catch (error) {
    return {
      kind: "invalid",
      reason: error instanceof Error
        ? `registry BLS finality trust policy invalid: ${error.message}`
        : "registry BLS finality trust policy invalid",
    };
  }

  const finalityPolicy = policy?.finality ?? null;
  if (finalityPolicy === null) {
    return {
      kind: "unconfigured",
      reason: "trusted BLS finality key not configured",
    };
  }
  if (finalityPolicy.mode !== "cluster") {
    return {
      kind: "invalid",
      reason: "registry BLS finality trust policy mode multisig is not supported by Monoscan threshold-cluster verification",
    };
  }

  const finalityEvidence = transcript.finalityEvidence ?? null;
  if (
    finalityEvidence
    && !isWithinOptionalTrustBounds(
      finalityEvidence.round,
      finalityPolicy.validFromRound,
      finalityPolicy.validToRound,
    )
  ) {
    return {
      kind: "invalid",
      reason: `registry BLS finality trust policy is not valid at round ${finalityEvidence.round}`,
    };
  }

  const chainId = finalityPolicy.chainId ?? policy?.chainId;
  if (chainId == null) {
    return {
      kind: "invalid",
      reason: "registry BLS finality trust policy requires a chain id",
    };
  }

  return normalizeNoEvmFinalityTrustOptions({
    chainId,
    clusterPublicKey: finalityPolicy.clusterPublicKey,
    committeeSize: finalityPolicy.committeeSize,
    threshold: finalityPolicy.threshold,
  });
}

function resolveNoEvmFinalityTrustOptions(
  transcript: NoEvmReceiptProofMaterial,
  trustOptions?: NoEvmFinalityVerificationTrustOptions | null,
): NoEvmFinalityTrustResolution {
  if (trustOptions === null) {
    return {
      kind: "unconfigured",
      reason: "trusted BLS finality key not configured",
    };
  }
  if (trustOptions !== undefined) {
    return normalizeNoEvmFinalityTrustOptions(trustOptions);
  }

  const envResolution = noEvmFinalityTrustOptionsFromEnv();
  return envResolution.kind === "unconfigured"
    ? noEvmFinalityTrustOptionsFromRegistry(transcript)
    : envResolution;
}

function noEvmArchiveTrustOptionsFromEnv(): NoEvmArchiveTrustResolution {
  const publicKeys = viteEnvString(NO_EVM_ARCHIVE_TRUST_ENV.publicKeys);
  const threshold = viteEnvString(NO_EVM_ARCHIVE_TRUST_ENV.threshold);
  const values = [publicKeys, threshold];

  if (values.every((value) => value === null)) {
    return {
      kind: "unconfigured",
      reason: "trusted archive signer config not configured",
    };
  }

  const missing: string[] = [];
  if (publicKeys === null) missing.push(NO_EVM_ARCHIVE_TRUST_ENV.publicKeys[0]);
  if (threshold === null) missing.push(NO_EVM_ARCHIVE_TRUST_ENV.threshold[0]);
  if (missing.length > 0) {
    return {
      kind: "invalid",
      reason: `trusted archive signer config incomplete: missing ${missing.join(", ")}`,
    };
  }

  return normalizeNoEvmArchiveTrustOptions({
    publicKeys: publicKeys as string,
    threshold: threshold as string,
  });
}

function noEvmArchiveTrustOptionsFromRegistry(
  transcript: NoEvmReceiptProofMaterial,
): NoEvmArchiveTrustResolution {
  let policy: NoEvmReceiptTrustPolicy | null;
  try {
    policy = noEvmReceiptTrustPolicyFromBundledRegistry();
  } catch (error) {
    return {
      kind: "invalid",
      reason: error instanceof Error
        ? `registry archive signer trust policy invalid: ${error.message}`
        : "registry archive signer trust policy invalid",
    };
  }

  const archivePolicy = policy?.archive ?? null;
  if (archivePolicy === null) {
    return {
      kind: "unconfigured",
      reason: "trusted archive signer config not configured",
    };
  }

  const blockHeight = transcript.blockHeight;
  if (!isWithinOptionalTrustBounds(blockHeight, archivePolicy.validFromHeight, archivePolicy.validToHeight)) {
    return {
      kind: "invalid",
      reason: `registry archive signer trust policy is not valid at block height ${blockHeight}`,
    };
  }

  const activeSigners = archivePolicy.trustedSigners.filter((signer) =>
    isWithinOptionalTrustBounds(blockHeight, signer.validFromHeight, signer.validToHeight),
  );

  return normalizeNoEvmArchiveTrustOptions({
    publicKeys: activeSigners.map((signer) => signer.publicKey),
    threshold: archivePolicy.threshold,
  });
}

function resolveNoEvmArchiveTrustOptions(
  transcript: NoEvmReceiptProofMaterial,
  trustOptions?: NoEvmArchiveVerificationTrustOptions | null,
): NoEvmArchiveTrustResolution {
  if (trustOptions === null) {
    return {
      kind: "unconfigured",
      reason: "trusted archive signer config not configured",
    };
  }
  if (trustOptions !== undefined) {
    return normalizeNoEvmArchiveTrustOptions(trustOptions);
  }

  const envResolution = noEvmArchiveTrustOptionsFromEnv();
  return envResolution.kind === "unconfigured"
    ? noEvmArchiveTrustOptionsFromRegistry(transcript)
    : envResolution;
}

function noEvmFinalityMismatchReason(result: NoEvmBlsFinalityVerification): string {
  const issues: string[] = [];
  if (!result.signerCountMatches) issues.push("signer count mismatch");
  if (!result.signerBitmapMatchesIndices) issues.push("signer bitmap/index mismatch");
  if (!result.signerIndicesInRange) issues.push("signer index outside configured committee");
  if (!result.allSignersTrusted) issues.push("untrusted signer index");
  if (!result.thresholdMet) issues.push("threshold not met");
  if (!result.signatureValid) issues.push("BLS signature invalid");
  return issues.join("; ") || "BLS finality evidence did not satisfy configured trust policy";
}

function noEvmArchiveSignatureSource(
  archiveProof: NoEvmReceiptArchiveProofBinding,
): NoEvmArchiveSignatureSource {
  if (archiveProof.signatureDigest != null || archiveProof.signatures.length > 0) {
    return "exactHeight";
  }
  if (archiveProof.coveringSnapshot) {
    return "coveringSnapshot";
  }
  return "none";
}

function noEvmArchiveMismatchReason(result: NoEvmArchiveSignatureVerification): string {
  return result.issues.map((issue) => issue.message).join("; ")
    || "archive snapshot signatures did not satisfy configured trust policy";
}

function archiveProofForSignatureVerification(
  archiveProof: NoEvmReceiptArchiveProofBinding,
  signatureSource: NoEvmArchiveSignatureSource,
): NoEvmReceiptArchiveProofBinding {
  if (signatureSource !== "coveringSnapshot" || !archiveProof.coveringSnapshot) {
    return archiveProof;
  }
  return {
    ...archiveProof,
    signatureDigest: archiveProof.coveringSnapshot.signatureDigest,
    signatures: archiveProof.coveringSnapshot.signatures,
  };
}

export function verifyNoEvmReceiptFinalityEvidence(
  transcript: NoEvmReceiptProofMaterial,
  trustOptions?: NoEvmFinalityVerificationTrustOptions | null,
): NoEvmReceiptFinalityVerification | null {
  const finalityEvidence = transcript.finalityEvidence ?? null;
  if (!finalityEvidence) return null;

  const trustResolution = resolveNoEvmFinalityTrustOptions(transcript, trustOptions);

  if (trustResolution.kind === "unconfigured") {
    return {
      state: "unverified",
      result: null,
      reason: trustResolution.reason,
    };
  }
  if (trustResolution.kind === "invalid") {
    return {
      state: "mismatch",
      result: null,
      reason: trustResolution.reason,
    };
  }

  try {
    const result = CoreSdk.verifyNoEvmFinalityEvidenceThreshold(
      finalityEvidence as Parameters<typeof CoreSdk.verifyNoEvmFinalityEvidenceThreshold>[0],
      trustResolution.options,
    );
    return {
      state: result.verified ? "verified" : "mismatch",
      result,
      reason: result.verified ? null : noEvmFinalityMismatchReason(result),
    };
  } catch (error) {
    return {
      state: "mismatch",
      result: null,
      reason: error instanceof Error
        ? error.message
        : "BLS finality evidence verification failed",
    };
  }
}

export function verifyNoEvmReceiptArchiveProofSignatures(
  transcript: NoEvmReceiptProofMaterial,
  trustOptions?: NoEvmArchiveVerificationTrustOptions | null,
): NoEvmReceiptArchiveVerification | null {
  if (noEvmReceiptProofKind(transcript) !== "compactInclusion") return null;
  const archiveProof = (transcript as NoEvmCompactReceiptProofTranscript).archiveProof ?? null;
  if (!archiveProof) return null;

  const signatureSource = noEvmArchiveSignatureSource(archiveProof);
  const trustResolution = resolveNoEvmArchiveTrustOptions(transcript, trustOptions);

  if (trustResolution.kind === "unconfigured") {
    return {
      state: "unconfigured",
      result: null,
      reason: trustResolution.reason,
      signatureSource,
    };
  }
  if (trustResolution.kind === "invalid") {
    return {
      state: "malformed",
      result: null,
      reason: trustResolution.reason,
      signatureSource,
    };
  }

  const verifyArchiveSignatures = CoreSdk.verifyNoEvmArchiveProofSignatures as
    | typeof CoreSdk.verifyNoEvmArchiveProofSignatures
    | undefined;
  if (typeof verifyArchiveSignatures !== "function") {
    return {
      state: "malformed",
      result: null,
      reason: "trusted archive signature verifier unavailable in @monolythium/core-sdk",
      signatureSource,
    };
  }

  try {
    const archiveProofMaterial = archiveProofForSignatureVerification(archiveProof, signatureSource);
    const result = verifyArchiveSignatures(
      archiveProofMaterial as Parameters<typeof CoreSdk.verifyNoEvmArchiveProofSignatures>[0],
      trustResolution.options.trustedSigners,
      trustResolution.options.threshold,
    );
    return {
      state: result.verified ? "verified" : "mismatch",
      result,
      reason: result.verified ? null : noEvmArchiveMismatchReason(result),
      signatureSource,
    };
  } catch (error) {
    return {
      state: "malformed",
      result: null,
      reason: error instanceof Error
        ? error.message
        : "archive snapshot signature verification failed",
      signatureSource,
    };
  }
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return combined;
}

function hashUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const hash = hexBytesToUint8Array(keccak256(concatUint8Arrays(parts)));
  return hash ?? new Uint8Array();
}

function computeNoEvmLegacyReceiptsRoot(receipts: Uint8Array[]): string {
  const rootParts = [
    textEncoder.encode(NO_EVM_RECEIPTS_ROOT_DOMAIN),
    u32Le(receipts.length),
  ];
  for (let index = 0; index < receipts.length; index += 1) {
    rootParts.push(u32Le(index), u32Le(receipts[index].length), receipts[index]);
  }
  return keccak256(concatUint8Arrays(rootParts));
}

function computeNoEvmReceiptLeafHashBytes(receipt: Uint8Array, txIndex: number): Uint8Array {
  return hashUint8Arrays([
    textEncoder.encode(NO_EVM_BINARY_RECEIPT_LEAF_DOMAIN),
    u32Le(txIndex),
    u32Le(receipt.length),
    receipt,
  ]);
}

function computeNoEvmReceiptNodeHashBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  return hashUint8Arrays([
    textEncoder.encode(NO_EVM_BINARY_RECEIPT_NODE_DOMAIN),
    left,
    right,
  ]);
}

function computeNoEvmBinaryReceiptsRoot(receipts: Uint8Array[]): string {
  if (receipts.length === 0) {
    return keccak256(concatUint8Arrays([
      textEncoder.encode(NO_EVM_BINARY_RECEIPTS_ROOT_EMPTY_DOMAIN),
      u32Le(0),
    ]));
  }

  let level = receipts.map((receipt, index) => computeNoEvmReceiptLeafHashBytes(receipt, index));
  while (level.length > 1) {
    const nextLevel: Uint8Array[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      nextLevel.push(computeNoEvmReceiptNodeHashBytes(left, right));
    }
    level = nextLevel;
  }
  return bytesToHex(level[0]);
}

function rootAlgorithmUsesBinaryTree(rootAlgorithm: string): boolean {
  return rootAlgorithm === NO_EVM_BINARY_RECEIPTS_ROOT_ALGORITHM
    || rootAlgorithm === NO_EVM_LEGACY_RECEIPTS_ROOT_ALGORITHM
    || rootAlgorithm === NO_EVM_COMPACT_INCLUSION_TREE_ALGORITHM;
}

function isSupportedNoEvmRootAlgorithm(rootAlgorithm: string): boolean {
  return rootAlgorithm === NO_EVM_RECEIPTS_ROOT_ALGORITHM
    || rootAlgorithm === NO_EVM_LEGACY_RECEIPTS_ROOT_ALGORITHM
    || rootAlgorithm === NO_EVM_BINARY_RECEIPTS_ROOT_ALGORITHM
    || rootAlgorithm === NO_EVM_COMPACT_INCLUSION_TREE_ALGORITHM;
}

function computeNoEvmReceiptsRoot(receipts: Uint8Array[], rootAlgorithm: string): string {
  return rootAlgorithmUsesBinaryTree(rootAlgorithm)
    ? computeNoEvmBinaryReceiptsRoot(receipts)
    : computeNoEvmLegacyReceiptsRoot(receipts);
}

function computeCompactRootFromPath(
  leafHash: Uint8Array,
  siblingHashes: Uint8Array[],
  pathSides: boolean[],
): Uint8Array {
  let current = leafHash;
  for (let index = 0; index < siblingHashes.length; index += 1) {
    const sibling = siblingHashes[index];
    current = pathSides[index]
      ? computeNoEvmReceiptNodeHashBytes(sibling, current)
      : computeNoEvmReceiptNodeHashBytes(current, sibling);
  }
  return current;
}

function noEvmReceiptProofKind(transcript: NoEvmReceiptProofMaterial): NoEvmReceiptProofKind {
  return transcript.proofKind ?? "boundedCacheTranscript";
}

function noEvmReceiptProofHistorySource(transcript: NoEvmReceiptProofMaterial): NoEvmReceiptProofHistorySource {
  return transcript.historySource ?? "legacyUnspecified";
}

export function noEvmReceiptProofHistorySourceLabel(source: NoEvmReceiptProofHistorySource): string {
  switch (source) {
    case "indexerReceiptArchive":
      return "indexer receipt archive";
    case "liveBlockCache":
      return "live block cache";
    case "legacyUnspecified":
      return "legacy/unspecified receipt material";
  }
}

export function noEvmReceiptProofKindLabel(kind: NoEvmReceiptProofKind): string {
  return kind === "compactInclusion" ? "compact inclusion proof" : "bounded receipts transcript";
}

export function noEvmReceiptProofMaterialLabel(transcript: NoEvmReceiptProofMaterial): string {
  return `${noEvmReceiptProofHistorySourceLabel(noEvmReceiptProofHistorySource(transcript))} · ${noEvmReceiptProofKindLabel(noEvmReceiptProofKind(transcript))}`;
}

export function verifyNoEvmReceiptProofConsistency(
  transcript: NoEvmReceiptProofMaterial,
): NoEvmReceiptProofConsistency {
  const proofKind = noEvmReceiptProofKind(transcript);
  if (proofKind === "compactInclusion") {
    return verifyNoEvmCompactReceiptProofConsistency(transcript as NoEvmCompactReceiptProofTranscript);
  }

  const bounded = transcript as NoEvmReceiptProofTranscript;
  const receiptBytes = bounded.receiptTranscript.map(hexBytesToUint8Array);
  const decodedReceipts = receiptBytes.filter((receipt): receipt is Uint8Array => receipt !== null);
  const computedReceiptsRoot = computeNoEvmReceiptsRoot(decodedReceipts, bounded.rootAlgorithm);
  const computedTargetReceiptHash = decodedReceipts[bounded.txIndex]
    ? keccak256(decodedReceipts[bounded.txIndex])
    : null;
  const receiptCountMatches = bounded.receiptCount === bounded.receiptTranscript.length;
  const targetReceiptAvailable = computedTargetReceiptHash !== null;
  const mismatches: string[] = [];

  if (!isSupportedNoEvmRootAlgorithm(bounded.rootAlgorithm)) {
    mismatches.push(`rootAlgorithm must be ${NO_EVM_RECEIPTS_ROOT_ALGORITHM} or ${NO_EVM_BINARY_RECEIPTS_ROOT_ALGORITHM}`);
  }
  if (!receiptCountMatches) {
    mismatches.push(`receiptCount ${bounded.receiptCount} does not match ${receiptBlobLabel(bounded.receiptTranscript.length)}`);
  }
  if (computedReceiptsRoot !== bounded.receiptsRoot.toLowerCase()) {
    mismatches.push("receiptsRoot mismatch");
  }
  if (!targetReceiptAvailable) {
    mismatches.push("receiptTranscript does not include txIndex receipt");
  } else if (computedTargetReceiptHash !== bounded.targetReceiptHash.toLowerCase()) {
    mismatches.push("targetReceiptHash mismatch");
  }

  return {
    state: mismatches.length > 0 ? "mismatch" : "verified",
    proofKind,
    historySource: noEvmReceiptProofHistorySource(bounded),
    computedReceiptsRoot,
    computedTargetReceiptHash,
    receiptCountMatches,
    targetReceiptAvailable,
    compactPathMatches: null,
    mismatches,
  };
}

function verifyNoEvmCompactReceiptProofConsistency(
  transcript: NoEvmCompactReceiptProofTranscript,
): NoEvmReceiptProofConsistency {
  const targetReceipt = hexBytesToUint8Array(transcript.targetReceiptBytes);
  const computedTargetReceiptHash = targetReceipt ? keccak256(targetReceipt) : null;
  const computedLeafHashBytes = targetReceipt ? computeNoEvmReceiptLeafHashBytes(targetReceipt, transcript.txIndex) : null;
  const computedLeafHash = computedLeafHashBytes ? bytesToHex(computedLeafHashBytes) : null;
  const siblingHashes = transcript.compactInclusionProof.siblingHashes
    .map(hexBytesToUint8Array)
    .filter((hash): hash is Uint8Array => hash !== null);
  const compactPathRoot = computedLeafHashBytes && siblingHashes.length === transcript.compactInclusionProof.siblingHashes.length
    ? computeCompactRootFromPath(computedLeafHashBytes, siblingHashes, transcript.compactInclusionProof.pathSides)
    : null;
  const computedReceiptsRoot = compactPathRoot ? bytesToHex(compactPathRoot) : transcript.compactInclusionProof.root.toLowerCase();
  const compactPathMatches = computedReceiptsRoot === transcript.compactInclusionProof.root.toLowerCase();
  const targetReceiptAvailable = computedTargetReceiptHash !== null;
  const mismatches: string[] = [];

  if (!isSupportedNoEvmRootAlgorithm(transcript.rootAlgorithm)) {
    mismatches.push(`rootAlgorithm must be ${NO_EVM_BINARY_RECEIPTS_ROOT_ALGORITHM}`);
  }
  if (!targetReceiptAvailable) {
    mismatches.push("targetReceiptBytes must be a 0x byte blob");
  } else if (computedTargetReceiptHash !== transcript.targetReceiptHash.toLowerCase()) {
    mismatches.push("targetReceiptHash mismatch");
  }
  if (computedLeafHash !== null && computedLeafHash !== transcript.compactInclusionProof.leafHash.toLowerCase()) {
    mismatches.push("compactInclusionProof.leafHash mismatch");
  }
  if (transcript.receiptsRoot.toLowerCase() !== transcript.compactInclusionProof.root.toLowerCase()) {
    mismatches.push("receiptsRoot must equal compactInclusionProof.root");
  }
  if (!compactPathMatches) {
    mismatches.push("compact inclusion path mismatch");
  }

  return {
    state: mismatches.length > 0 ? "mismatch" : "verified",
    proofKind: "compactInclusion",
    historySource: transcript.historySource,
    computedReceiptsRoot,
    computedTargetReceiptHash,
    receiptCountMatches: null,
    targetReceiptAvailable,
    compactPathMatches,
    mismatches,
  };
}

export function validateNoEvmReceiptProofTranscript(
  value: unknown,
): { transcript: NoEvmReceiptProofMaterial | null; errors: string[] } {
  const row = unknownRecord(value);
  if (!row) {
    return { transcript: null, errors: ["noEvmProof must be an object"] };
  }

  const errors: string[] = [];
  const schema = readTranscriptString(row, "schema", errors);
  const proofType = readTranscriptString(row, "proofType", errors);
  const proofKind = readProofKind(row, proofType, errors);
  const historySource = readProofHistorySource(row, errors);
  const rootAlgorithm = readTranscriptString(row, "rootAlgorithm", errors);
  const receiptCodec = readTranscriptString(row, "receiptCodec", errors);
  const blockHash = readTranscriptHash32(row, "blockHash", errors);
  const txHash = readTranscriptHash32(row, "txHash", errors);
  const receiptsRoot = readTranscriptHash32(row, "receiptsRoot", errors);
  const targetReceiptHash = readTranscriptHash32(row, "targetReceiptHash", errors);
  const blockHeight = readTranscriptNumber(row, "blockHeight", errors);
  const txIndex = readTranscriptNumber(row, "txIndex", errors);
  const receiptCount = readTranscriptNumber(row, "receiptCount", errors);
  const finalityEvidence = readFinalityEvidence(row.finalityEvidence, errors);
  const missingProofMaterial = readOptionalStringArray(row, "missingProofMaterial", errors);

  if (schema !== null && schema !== NO_EVM_RECEIPT_PROOF_SCHEMA) {
    errors.push(`schema must be ${NO_EVM_RECEIPT_PROOF_SCHEMA}`);
  }
  if (txIndex !== null && receiptCount !== null && txIndex >= receiptCount) {
    errors.push("txIndex must be less than receiptCount");
  }
  if (txIndex !== null && txIndex > U32_MAX) {
    errors.push("txIndex must fit in u32");
  }
  if (receiptCount !== null && receiptCount > U32_MAX) {
    errors.push("receiptCount must fit in u32");
  }

  if (proofKind === "compactInclusion") {
    const compactInclusionProof = readCompactInclusionProof(row.compactInclusionProof, errors);
    const archiveProof = readArchiveProofBinding(row.archiveProof, errors, blockHeight);
    const targetReceiptBytes = readTranscriptString(row, "targetReceiptBytes", errors);
    if (proofType !== null && proofType !== NO_EVM_COMPACT_RECEIPT_PROOF_TYPE) {
      errors.push(`proofType must be ${NO_EVM_COMPACT_RECEIPT_PROOF_TYPE}`);
    }
    if (historySource === null) {
      errors.push("historySource missing");
    } else if (historySource !== "liveBlockCache" && historySource !== "indexerReceiptArchive") {
      errors.push("historySource must be liveBlockCache or indexerReceiptArchive for compactInclusion proofs");
    }
    if (rootAlgorithm !== null && !rootAlgorithmUsesBinaryTree(rootAlgorithm)) {
      errors.push(`rootAlgorithm must be ${NO_EVM_BINARY_RECEIPTS_ROOT_ALGORITHM}`);
    }
    if (receiptCodec !== null && receiptCodec !== NO_EVM_RECEIPT_CODEC) {
      errors.push(`receiptCodec must be ${NO_EVM_RECEIPT_CODEC}`);
    }
    if (archiveProof !== undefined && archiveProof !== null && historySource !== "indexerReceiptArchive") {
      errors.push("archiveProof requires historySource indexerReceiptArchive");
    }
    if (targetReceiptBytes !== null && !HEX_BYTES_RE.test(targetReceiptBytes)) {
      errors.push("targetReceiptBytes must be a 0x byte blob");
    }

    if (
      errors.length > 0
      || schema !== NO_EVM_RECEIPT_PROOF_SCHEMA
      || proofType !== NO_EVM_COMPACT_RECEIPT_PROOF_TYPE
      || historySource === null
      || (historySource !== "liveBlockCache" && historySource !== "indexerReceiptArchive")
      || rootAlgorithm === null
      || receiptCodec === null
      || blockHash === null
      || txHash === null
      || receiptsRoot === null
      || targetReceiptHash === null
      || blockHeight === null
      || txIndex === null
      || receiptCount === null
      || compactInclusionProof === null
      || targetReceiptBytes === null
    ) {
      return { transcript: null, errors };
    }

    return {
      transcript: {
        schema,
        proofKind: "compactInclusion",
        proofType,
        historySource,
        rootAlgorithm,
        receiptCodec,
        blockHash,
        txHash,
        receiptsRoot,
        targetReceiptHash,
        blockHeight,
        txIndex,
        receiptCount,
        compactInclusionProof,
        ...(archiveProof !== undefined ? { archiveProof } : {}),
        ...(finalityEvidence !== undefined ? { finalityEvidence } : {}),
        targetReceiptBytes,
        ...(missingProofMaterial ? { missingProofMaterial } : {}),
      },
      errors: [],
    };
  }

  const receiptTranscript = readReceiptTranscript(row, errors);
  if (proofType !== null && proofType !== NO_EVM_RECEIPT_PROOF_TYPE) {
    errors.push(`proofType must be ${NO_EVM_RECEIPT_PROOF_TYPE}`);
  }
  if (historySource === "indexerReceiptArchive") {
    errors.push("historySource indexerReceiptArchive requires compactInclusion proofKind");
  }
  if (row.compactInclusionProof !== undefined && row.compactInclusionProof !== null) {
    errors.push("boundedCacheTranscript proof cannot carry compactInclusionProof");
  }
  if (row.archiveProof !== undefined && row.archiveProof !== null) {
    errors.push("boundedCacheTranscript proof cannot carry archiveProof");
  }
  if (receiptCount !== null && receiptTranscript.length > receiptCount) {
    errors.push("receiptTranscript cannot exceed receiptCount");
  }

  if (
    errors.length > 0
    || schema !== NO_EVM_RECEIPT_PROOF_SCHEMA
    || proofType !== NO_EVM_RECEIPT_PROOF_TYPE
    || rootAlgorithm === null
    || receiptCodec === null
    || blockHash === null
    || txHash === null
    || receiptsRoot === null
    || targetReceiptHash === null
    || blockHeight === null
    || txIndex === null
    || receiptCount === null
  ) {
    return { transcript: null, errors };
  }

  const transcript: NoEvmReceiptProofTranscript = {
    schema,
    proofType,
    rootAlgorithm,
    receiptCodec,
    blockHash,
    txHash,
    receiptsRoot,
    targetReceiptHash,
    blockHeight,
    txIndex,
    receiptCount,
    receiptTranscript,
    ...(finalityEvidence !== undefined ? { finalityEvidence } : {}),
    ...(missingProofMaterial ? { missingProofMaterial } : {}),
  };
  if (Object.prototype.hasOwnProperty.call(row, "proofKind")) {
    transcript.proofKind = "boundedCacheTranscript";
  }
  if (historySource !== null) {
    transcript.historySource = historySource as "legacyUnspecified" | "liveBlockCache";
  }

  return {
    transcript,
    errors: [],
  };
}

function receiptBlobLabel(count: number): string {
  return `${count} receipt blob${count === 1 ? "" : "s"}`;
}

function noEvmReceiptProofSummary(transcript: NoEvmReceiptProofMaterial): string {
  if (noEvmReceiptProofKind(transcript) === "compactInclusion") {
    const compact = transcript as NoEvmCompactReceiptProofTranscript;
    const siblingCount = compact.compactInclusionProof.siblingHashes.length;
    return `${compact.proofType} · ${noEvmReceiptProofHistorySourceLabel(compact.historySource)} · block ${compact.blockHeight} · tx ${compact.txIndex + 1}/${compact.receiptCount} · compact Merkle path ${siblingCount} sibling hash${siblingCount === 1 ? "" : "es"}`;
  }
  const bounded = transcript as NoEvmReceiptProofTranscript;
  return `${bounded.proofType} · block ${bounded.blockHeight} · tx ${bounded.txIndex + 1}/${bounded.receiptCount} · ${receiptBlobLabel(bounded.receiptTranscript.length)}`;
}

function detectNoEvmReceiptProofKind(value: unknown): NoEvmReceiptProofKind | null {
  const row = unknownRecord(value);
  if (!row) return null;
  const proofKind = readOptionalTranscriptString(row, "proofKind");
  const proofType = readOptionalTranscriptString(row, "proofType");
  if (proofKind === "compactInclusion" || proofType === NO_EVM_COMPACT_RECEIPT_PROOF_TYPE) {
    return "compactInclusion";
  }
  if (proofKind === "boundedCacheTranscript" || proofType === NO_EVM_RECEIPT_PROOF_TYPE) {
    return "boundedCacheTranscript";
  }
  return null;
}

function proofEvidenceBlockerLabel(proofKind: NoEvmReceiptProofKind | null): string {
  return proofKind === "compactInclusion" ? "compact receipt inclusion proof" : "bounded receipts transcript";
}

function noEvmReceiptProofEvidence(
  source: string,
  value: unknown,
  finalityTrustOptions?: NoEvmFinalityVerificationTrustOptions | null,
  archiveTrustOptions?: NoEvmArchiveVerificationTrustOptions | null,
): MrvNativeProofEvidence {
  const { transcript, errors } = validateNoEvmReceiptProofTranscript(value);
  const consistency = transcript ? verifyNoEvmReceiptProofConsistency(transcript) : null;
  const proofKind = transcript ? noEvmReceiptProofKind(transcript) : detectNoEvmReceiptProofKind(value);
  const archiveVerification = transcript
    ? verifyNoEvmReceiptArchiveProofSignatures(transcript, archiveTrustOptions)
    : null;
  const finalityVerification = transcript
    ? verifyNoEvmReceiptFinalityEvidence(transcript, finalityTrustOptions)
    : null;
  return {
    source,
    raw: value,
    transcript,
    consistency,
    archiveVerification,
    finalityVerification,
    proofKind,
    historySource: transcript ? noEvmReceiptProofHistorySource(transcript) : null,
    materialLabel: transcript ? noEvmReceiptProofMaterialLabel(transcript) : null,
    validationErrors: errors,
    summary: transcript
      ? noEvmReceiptProofSummary(transcript)
      : errors[0] ?? proofSummary(value),
  };
}

function readNativeNoEvmProofField(
  nativeReceipt: unknown,
): { source: string; state: MrvNativeProofFieldState; value: unknown | null } {
  const row = unknownRecord(nativeReceipt);
  if (!row) {
    return { source: "native-receipt.noEvmProof", state: "missing", value: null };
  }

  for (const key of ["noEvmProof", "no_evm_proof"]) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = row[key];
    const source = `native-receipt.${key}`;
    if (value === null) return { source, state: "explicit-null", value: null };
    if (value === undefined) return { source, state: "missing", value: null };
    if (typeof value === "string" && value.trim() === "") {
      return { source, state: "missing", value: null };
    }
    return { source, state: "present", value };
  }

  return { source: "native-receipt.noEvmProof", state: "missing", value: null };
}

function pqCheckpointSummary(decoded: unknown): string | null {
  const pq = readPresentField(decoded, ["pqAttestation", "pq_attestation"]);
  if (!pq) return null;
  const checkpointHeight = readStringField(pq.value, ["checkpointHeight", "checkpoint_height", "height"]);
  return checkpointHeight ? `checkpoint #${checkpointHeight}` : proofSummary(pq.value);
}

export function mrvNativeTransactionEvidence(
  decoded: DecodeTxResponse | Record<string, unknown> | null | undefined,
  nativeReceipt: NativeReceiptResponse<unknown> | Record<string, unknown> | null | undefined,
  finalityTrustOptions?: NoEvmFinalityVerificationTrustOptions | null,
  archiveTrustOptions?: NoEvmArchiveVerificationTrustOptions | null,
): MrvNativeTransactionEvidence | null {
  const extension = findMrvNativeExtension(decoded);
  const receiptTxType = readNumberField(nativeReceipt, ["txType", "tx_type"]);
  const receiptSchema = readStringField(nativeReceipt, ["schema"]);
  const artifactHash = readStringField(nativeReceipt, ["artifactHash", "artifact_hash"]);
  const receiptCommitment = readStringField(nativeReceipt, ["receiptCommitment", "receipt_commitment"]);
  const operation = findMrvOperationHint(readObjectField(decoded, ["decodedCalldata", "decoded_calldata"]))
    ?? findMrvOperationHint(decoded);
  const hasMrvReceipt = Boolean(nativeReceipt)
    && (receiptTxType === MRV_NATIVE_RECEIPT_TX_TYPE
      || (receiptTxType === null && receiptSchema === "riscv.receipt.v1"));
  const hasMrvHint = Boolean(extension || hasMrvReceipt || operation);

  if (!hasMrvHint) return null;

  const includedBlock = readNumberField(decoded, ["blockNumber", "blockHeight", "block_number", "block_height"])
    ?? readNumberField(nativeReceipt, ["blockHeight", "blockNumber", "block_height", "block_number"]);
  const proofField = readNativeNoEvmProofField(nativeReceipt);
  const proof = proofField.state === "present"
    ? noEvmReceiptProofEvidence(proofField.source, proofField.value, finalityTrustOptions, archiveTrustOptions)
    : null;
  const submittedState: MrvNativeEvidenceState = extension
    ? (extension.validMrvV1 ? "present" : "invalid")
    : "missing";
  const includedState: MrvNativeEvidenceState = includedBlock !== null ? "present" : "missing";
  const receiptState: MrvNativeEvidenceState = hasMrvReceipt ? "present" : "missing";
  const proofState: MrvNativeEvidenceState = proof
    ? (proof.transcript && proof.consistency?.state === "verified" ? "present" : "invalid")
    : "missing";
  const blockers: string[] = [];

  if (!extension) {
    blockers.push(
      "lyth_decodeTx must expose txExtensions[]/extensions[] with MRV v1 { kind: 0x30, bodyHex: \"0x01\" } before Monoscan can prove the submitted MRV lane.",
    );
  } else if (!extension.validMrvV1) {
    blockers.push(
      "MRV submitted-lane proof requires extension kind 0x30 with bodyHex \"0x01\"; the transaction detail payload exposed a different body.",
    );
  }
  if (!hasMrvReceipt) {
    blockers.push(
      "GET /api/v1/transactions/{hash}/native-receipt or lyth_nativeReceipt(txHash) must return txType 0x41, artifactHash, counters, and events for MRV receipt evidence.",
    );
  }
  if (!proof) {
    blockers.push(proofField.state === "explicit-null"
      ? `${proofField.source} returned null; Monoscan treats the no-EVM receipt proof evidence as missing until a bounded receipts transcript or compact receipt inclusion proof is available.`
      : "native-receipt.noEvmProof must return a bounded receipts transcript or compact receipt inclusion proof before Monoscan can render no-EVM receipt proof evidence.",
    );
  } else if (!proof.transcript) {
    blockers.push(
      `${proof.source} returned an invalid ${proofEvidenceBlockerLabel(proof.proofKind)}: ${proof.validationErrors.join("; ") || "unknown validation error"}.`,
    );
  } else if (proof.consistency?.state === "mismatch") {
    blockers.push(
      `${proof.source} returned a ${proofEvidenceBlockerLabel(proof.proofKind)} that failed self-consistency: ${proof.consistency.mismatches.join("; ")}.`,
    );
  }

  return {
    txHash: readStringField(decoded, ["txHash", "hash"]) ?? readStringField(nativeReceipt, ["txHash", "hash"]),
    operation,
    extension,
    receiptTxType,
    receiptSchema,
    artifactHash,
    receiptCommitment,
    includedBlock,
    reverted: readBooleanField(nativeReceipt, ["reverted"]),
    eventCount: readNumberField(nativeReceipt, ["eventCount", "event_count"]),
    nativeDeltaCount: readNumberField(nativeReceipt, ["nativeDeltaCount", "native_delta_count"]),
    proof,
    proofFieldSource: proofField.state === "missing" ? null : proofField.source,
    proofFieldState: proofField.state,
    pqCheckpoint: pqCheckpointSummary(decoded),
    submittedState,
    includedState,
    receiptState,
    proofState,
    blockers,
  };
}

export function nativeReceiptEventRows(
  receipt: NativeReceiptResponse<unknown> | null | undefined,
): NativeReceiptEventDisplayRow[] {
  return (receipt?.events ?? []).map(nativeEventDisplayRow);
}

export function nativeReceiptMarketEventRows(
  receipt: NativeReceiptResponse<unknown> | null | undefined,
): NativeReceiptEventDisplayRow[] {
  return nativeReceiptEventRows(receipt).filter((row) => {
    const family = row.family?.toLowerCase() ?? "";
    const name = row.eventName?.toLowerCase() ?? "";
    if (family.includes("market") || family.includes("clob") || name.includes("market") || name.includes("clob")) {
      return true;
    }
    return row.decodedFields.some(([key]) => {
      const normalized = key.toLowerCase();
      return normalized === "market_id"
        || normalized === "order_id"
        || normalized === "trade_id"
        || normalized === "price_lythoshi"
        || normalized === "base_amount"
        || normalized === "quote_amount";
    });
  });
}

export function nativeMarketEventRows(
  response: NativeEventsResponse<unknown> | null | undefined,
): NativeMarketEventDisplayRow[] {
  return (response?.events ?? []).map((event) => {
    const decoded = decodedNativeEventObject(event.decoded, event.decodedJson);
    const row = nativeEventDisplayRow(event);
    return {
      ...row,
      blockHeight: typeof event.blockHeight === "number"
        ? event.blockHeight
        : readNativeEventIdentity(decoded, ["block_height"]) !== null
          ? Number(readNativeEventIdentity(decoded, ["block_height"]))
          : null,
      txIndex: typeof event.txIndex === "number"
        ? event.txIndex
        : readNativeEventIdentity(decoded, ["tx_index"]) !== null
          ? Number(readNativeEventIdentity(decoded, ["tx_index"]))
          : null,
      primaryId: readNativeEventIdentity(decoded, ["market_id", "listing_id", "order_id", "trade_id"]),
      relatedId: readNativeEventIdentity(decoded, ["related_id", "maker_order_id", "taker_order_id", "collection_id", "token_id"]),
      account: readNativeEventIdentity(decoded, ["account", "owner", "seller", "buyer", "maker", "taker"]),
      counterparty: readNativeEventIdentity(decoded, ["counterparty", "seller", "buyer", "maker", "taker"]),
    };
  });
}

export interface NativeMarketOrderBookDeltaDisplayRow extends NativeMarketOrderBookStreamPayload {
  topic: typeof NATIVE_MARKET_ORDER_BOOK_STREAM_TOPIC;
}

export const NATIVE_MARKET_ORDER_BOOK_DELTA_LIMIT_MAX = 200;

export function nativeMarketOrderBookDeltaRows(
  payloads: readonly unknown[] | null | undefined,
  options: { marketId?: string | null; limit?: number } = {},
): NativeMarketOrderBookDeltaDisplayRow[] {
  const requestedLimit = typeof options.limit === "number" && Number.isFinite(options.limit)
    ? Math.trunc(options.limit)
    : NATIVE_MARKET_ORDER_BOOK_DELTA_LIMIT_MAX;
  const rowLimit = Math.max(
    1,
    Math.min(
      requestedLimit,
      NATIVE_MARKET_ORDER_BOOK_DELTA_LIMIT_MAX,
    ),
  );
  const marketId = options.marketId?.trim();
  const rows: NativeMarketOrderBookDeltaDisplayRow[] = [];
  for (const payload of payloads ?? []) {
    if (!isNativeMarketOrderBookStreamPayload(payload)) continue;
    if (marketId && payload.marketId !== marketId) continue;
    rows.push({
      ...payload,
      topic: NATIVE_MARKET_ORDER_BOOK_STREAM_TOPIC,
    });
  }
  return rows.slice(-rowLimit);
}

export function nativeMarketStateRows(
  response: NativeMarketStateResponse | null | undefined,
): {
  spotMarkets: NativeMarketStateDisplayRow[];
  spotOrders: NativeMarketStateDisplayRow[];
  nftListings: NativeMarketStateDisplayRow[];
  collectionRoyalties: NativeMarketStateDisplayRow[];
} {
  return {
    spotMarkets: (response?.spotMarkets ?? []).map((row) => nativeMarketStateRow("spotMarket", row)),
    spotOrders: (response?.spotOrders ?? []).map((row) => nativeMarketStateRow("spotOrder", row)),
    nftListings: (response?.nftListings ?? []).map((row) => nativeMarketStateRow("nftListing", row)),
    collectionRoyalties: (response?.collectionRoyalties ?? []).map((row) => nativeMarketStateRow("collectionRoyalty", row)),
  };
}

export function nativeAgentStateRows(
  response: NativeAgentStateResponse | null | undefined,
): NativeAgentStateDisplayRows {
  return {
    issuers: (response?.issuers ?? []).map((row) => nativeAgentStateRow("issuer", row)),
    attestations: (response?.attestations ?? []).map((row) => nativeAgentStateRow("attestation", row)),
    consents: (response?.consents ?? []).map((row) => nativeAgentStateRow("consent", row)),
    services: (response?.services ?? []).map((row) => nativeAgentStateRow("service", row)),
    availability: (response?.availability ?? []).map((row) => nativeAgentStateRow("availability", row)),
    arbiters: (response?.arbiters ?? []).map((row) => nativeAgentStateRow("arbiter", row)),
    reputationReviews: (response?.reputationReviews ?? []).map((row) => nativeAgentStateRow("reputationReview", row)),
    spendingPolicies: (response?.spendingPolicies ?? []).map((row) => nativeAgentStateRow("spendingPolicy", row)),
    policySpends: (response?.policySpends ?? []).map((row) => nativeAgentStateRow("policySpend", row)),
    escrows: (response?.escrows ?? []).map((row) => nativeAgentStateRow("escrow", row)),
  };
}

export function nativeAgentStateDisplayRowsAll(rows: NativeAgentStateDisplayRows): NativeAgentStateDisplayRow[] {
  return [
    ...rows.issuers,
    ...rows.attestations,
    ...rows.consents,
    ...rows.services,
    ...rows.availability,
    ...rows.arbiters,
    ...rows.reputationReviews,
    ...rows.spendingPolicies,
    ...rows.policySpends,
    ...rows.escrows,
  ];
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
 * 2-second long-poll on current block height and current round.
 *
 * The WebSocket path is gated behind `VITE_MONOSCAN_USE_WS=true`; polling
 * remains the default for broad node compatibility.
 */
export function useChainHead() {
  return useQuery<ChainHead | null>({
    queryKey: QK.head(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      if (isWebSocketEnabled()) {
        // Future subscription-backed deployments return the latest cached
        // head value here.
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
        // Live node unreachable; consumers render local fallback rows.
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
 * going dark.
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
/**
 * Page transactions for a specific block via the indexer API. Returns the
 * full envelope so callers can read `totalTransactions` for pagination and
 * `block.timestamp` for row age display.
 */
export function useBlockTransactions(
  block: number | "latest" | undefined,
  page = 0,
  limit = 25,
) {
  const rowLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const safePage = Math.max(0, Math.trunc(page));
  return useQuery<ApiBlockTransactionsData | null>({
    queryKey: QK.blockTransactions(block ?? "latest", safePage, rowLimit),
    enabled: block !== undefined && isRpcConfigured(),
    queryFn: async () => {
      try {
        return await getApiClient()
          .blockTransactions(block as number | "latest", safePage, rowLimit)
          .then((response) => response.data);
      } catch {
        return null;
      }
    },
    staleTime: block === "latest" ? 0 : 30_000,
  });
}

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
 * The first request fans out to N parallel block-header calls; subsequent
 * polls reuse the cached entries and only fetch the new tip blocks. React
 * Query handles per-block caching; the wrapper just sequences the height list.
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
 *  disabled; consumers degrade to local fallback values. */
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
 * mempool / indexer trace surface lives in `useTxTrace` once the retained
 * trace surface is available.
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
export async function fetchTxNativeReceipt(hash: string): Promise<NativeReceiptResponse<unknown> | null> {
  try {
    const response = await getApiClient().transactionNativeReceipt(hash);
    return response.data;
  } catch {
    // Fall through to JSON-RPC for nodes without the `/api/v1` indexer route.
  }
  try {
    return await getRpcClient().lythNativeReceipt(hash);
  } catch {
    return null;
  }
}

export function useTxNativeReceipt(hash: string | undefined) {
  return useQuery<NativeReceiptResponse<unknown> | null>({
    queryKey: QK.txNativeReceipt(hash ?? ""),
    enabled: Boolean(hash) && isRpcConfigured(),
    queryFn: () => fetchTxNativeReceipt(hash as string),
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

export interface LatestTransactionReceiptSummary {
  status: number;
  executionUnitsUsed: number;
  logsCount: number;
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
  fee: NativeReceiptFee | null;
  feeDisplay: NativeReceiptFeeDisplay | null;
  input: string;
  receipt: LatestTransactionReceiptSummary | null;
}

export interface LatestTransactionsDigest {
  rows: LatestTransactionRow[];
  latestBlock: number;
  scannedBlocks: number;
  scannedTransactions: number;
  nextCursor: string | null;
  source: "lyth_txFeed" | "block_scan";
}

function txFeedReceiptToSummary(value: unknown): LatestTransactionReceiptSummary | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const status = readNumberField(row, ["status"]);
  if (status === null) return null;
  return {
    status,
    executionUnitsUsed: readNumberField(row, ["executionUnitsUsed", "execution_units_used"]) ?? 0,
    logsCount: readNumberField(row, ["logsCount", "logs_count"]) ?? 0,
  };
}

export function apiBlockTransactionsToRows(page: ApiBlockTransactionsData): LatestTransactionRow[] {
  return page.transactions.map((tx, index) => {
    const structuredFee = structuredNativeReceiptFee(readObjectField(tx, ["fee"]), {
      label: `block transaction[${index}].fee`,
    });
    return {
      hash: tx.txHash,
      blockNumber: tx.blockHeight,
      blockHash: tx.blockHash,
      blockTimestamp: page.block.timestamp ?? null,
      txIndex: tx.txIndex,
      from: tx.from,
      to: tx.to,
      value: readRequiredStringField(tx, ["valueLythoshi", "value"]),
      executionUnitLimit: readRequiredNumberField(tx, ["executionUnitLimit"]),
      fee: structuredFee?.fee ?? null,
      feeDisplay: structuredFee?.display ?? null,
      input: tx.input,
      receipt: null,
    };
  });
}

export function txFeedToRows(feed: TxFeedResponse): LatestTransactionRow[] {
  return feed.transactions.map((tx, index) => {
    const structuredFee = structuredNativeReceiptFee(readObjectField(tx, ["fee"]), {
      label: `tx feed transaction[${index}].fee`,
    });
    return {
      hash: tx.txHash,
      blockNumber: tx.blockNumber,
      blockHash: tx.blockHash,
      blockTimestamp: tx.blockTimestamp,
      txIndex: tx.txIndex,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      executionUnitLimit: readRequiredNumberField(tx, ["executionUnitLimit"]),
      fee: structuredFee?.fee ?? null,
      feeDisplay: structuredFee?.display ?? null,
      input: tx.input,
      receipt: txFeedReceiptToSummary(readObjectField(tx, ["receipt"])),
    };
  });
}

/**
 * Recent transaction index. Prefer the node API's global transaction feed and
 * fall back to a newest-block scan for older peers.
 */
export function useLatestTransactions(limit = 50, blockWindow = 24, cursor: string | null = null) {
  const rowLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const scanBlocks = Math.max(1, Math.min(Math.trunc(blockWindow), 96));
  return useQuery<LatestTransactionsDigest | null>({
    queryKey: QK.latestTransactions(rowLimit, scanBlocks, cursor),
    enabled: isRpcConfigured(),
    queryFn: async () => {
      try {
        const rpc = getRpcClient();
        const feed = await getApiClient()
          .transactions(rowLimit, cursor)
          .then((response) => response.data)
          .catch(() => rpc.lythTxFeed(rowLimit, cursor).catch(() => null));
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
        // The block-window scan is a page-0-only fallback: it walks the newest
        // heights when no indexed feed answers. Cursor pages have no block-scan
        // equivalent (the cursor is opaque to the scan), so a non-null cursor
        // with no feed yields an empty page rather than re-scanning the head.
        if (cursor !== null) return null;
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
/* LYTH burn — indexer-DERIVED estimate.                                        */
/*                                                                             */
/* chain-69420 splits every transaction fee 50% burn / 30% operator / 20%      */
/* treasury (milestone `fee_burn_bps = 5000`). The burn is debited from the    */
/* sender and credited to no account — it is removed from supply outright.     */
/* There is NO burn address (the SDK `BURN_ADDR` zero-address carries a 0       */
/* balance on this chain), NO burn event, and NO chain-side `total_burned`     */
/* counter or `lyth_totalBurned` / supply RPC today.                           */
/*                                                                             */
/* So total-burned must be DERIVED from the per-tx fee the indexer retains.    */
/* Every transaction carries `fee.total_lythoshi` (base + tip) via the         */
/* `/api/v1` transaction feed and `lyth_txFeed`. The burn for a tx is          */
/* `floor(total_lythoshi * FEE_BURN_BPS / 10000)`.                             */
/*                                                                             */
/* HONESTY: this figure is an indexed estimate, not an authoritative chain     */
/* counter. It                                                                 */
/*   - covers only the blocks the connected node still retains, and            */
/*   - the bounded forward walk below stops after `maxPages` pages, so on a    */
/*     long chain the surface labels the figure as a partial scan.             */
/* It also slightly UNDER-counts: the 50/30/20 integer split routes its        */
/* division remainder (dust) to the burn, which the per-tx 50% floor here      */
/* does not add back. The true burn is therefore `>=` this estimate.          */
/* -------------------------------------------------------------------------- */

/** Milestone fee-split: basis points of every fee that is burned (50%). */
export const FEE_BURN_BPS = 5000n;
/** Basis-point denominator. */
export const FEE_BPS_DENOMINATOR = 10000n;

/** Default page size for the bounded burn walk over the transaction feed. */
export const BURN_FEED_PAGE_SIZE = 100;
/** Default page cap for the bounded burn walk (pages × pageSize tx ceiling). */
export const BURN_FEED_MAX_PAGES = 25;

/**
 * Burn attributable to a single fee, in lythoshi.
 *
 * `floor(totalFeeLythoshi * FEE_BURN_BPS / FEE_BPS_DENOMINATOR)`. Returns `0n`
 * for empty / unparseable / negative inputs rather than throwing, so a single
 * malformed feed row never poisons the running total.
 */
export function burnFromFeeLythoshi(totalFeeLythoshi: string | number | bigint | null | undefined): bigint {
  if (totalFeeLythoshi === null || totalFeeLythoshi === undefined || totalFeeLythoshi === "") return 0n;
  let fee: bigint;
  try {
    fee = typeof totalFeeLythoshi === "bigint" ? totalFeeLythoshi : BigInt(totalFeeLythoshi);
  } catch {
    return 0n;
  }
  if (fee <= 0n) return 0n;
  return (fee * FEE_BURN_BPS) / FEE_BPS_DENOMINATOR;
}

/** One transaction's burn contribution, ready for the recent-burns table. */
export interface BurnContribution {
  hash: string;
  blockNumber: number;
  blockTimestamp: number | null;
  from: string;
  to: string | null;
  feeLythoshi: string;
  burnLythoshi: string;
}

/** Per-UTC-day burn bucket, for the time-series chart. */
export interface BurnDayBucket {
  /** `YYYY-MM-DD` in UTC. `null` when no block timestamp was available. */
  day: string | null;
  burnLythoshi: string;
  txCount: number;
}

/** Aggregate of a bounded burn walk over the transaction feed. */
export interface BurnDigest {
  /** Cumulative burned lythoshi across every fee-charging tx scanned. */
  totalBurnedLythoshi: string;
  /** Cumulative fee lythoshi scanned (burn is FEE_BURN_BPS of this). */
  totalFeesLythoshi: string;
  /** Number of fee-charging transactions scanned. */
  txCount: number;
  /** Number of feed pages walked. */
  pagesScanned: number;
  /** Node-reported chain tip at scan time. */
  latestBlock: number;
  /** Lowest block height observed in the scan window. */
  oldestBlockScanned: number | null;
  /**
   * True when the walk hit `maxPages` before exhausting the feed — the figure
   * then covers only the most recent slice of indexed history.
   */
  truncated: boolean;
  /** Per-UTC-day burn buckets, oldest-first. */
  perDay: BurnDayBucket[];
  /** Newest fee-charging transactions, largest-burn-first within the scan. */
  recent: BurnContribution[];
  /** Wire source that answered the walk. */
  source: "lyth_txFeed" | "api_transactions";
}

function feedTxFeeTotalLythoshi(tx: unknown): string | null {
  const fee = readObjectField(tx, ["fee"]);
  return readStringField(fee, ["total_lythoshi", "totalLythoshi"]);
}

function utcDayFromTimestamp(timestamp: number | null | undefined): string | null {
  if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp)) return null;
  const ms = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Fold a set of transaction-feed pages into a {@link BurnDigest}. Pure so it
 * can be unit-tested without a render env or live node. `recentLimit` caps the
 * recent-contributions table.
 */
export function aggregateBurnDigest(
  pages: readonly TxFeedResponse[],
  options: { truncated: boolean; source: BurnDigest["source"]; recentLimit?: number } = {
    truncated: false,
    source: "lyth_txFeed",
  },
): BurnDigest {
  const recentLimit = options.recentLimit ?? 12;
  let totalBurned = 0n;
  let totalFees = 0n;
  let txCount = 0;
  let latestBlock = 0;
  let oldestBlock: number | null = null;
  const perDay = new Map<string, { burn: bigint; count: number }>();
  const contributions: BurnContribution[] = [];

  for (const page of pages) {
    if (Number.isFinite(page.latestHeight) && page.latestHeight > latestBlock) {
      latestBlock = page.latestHeight;
    }
    for (const tx of page.transactions) {
      const feeStr = feedTxFeeTotalLythoshi(tx);
      if (feeStr === null) continue;
      let fee: bigint;
      try {
        fee = BigInt(feeStr);
      } catch {
        continue;
      }
      if (fee <= 0n) continue;
      const burn = burnFromFeeLythoshi(fee);
      if (burn <= 0n) continue;
      totalFees += fee;
      totalBurned += burn;
      txCount += 1;
      const blockNumber = readNumberField(tx, ["blockNumber", "blockHeight"]) ?? 0;
      if (oldestBlock === null || blockNumber < oldestBlock) oldestBlock = blockNumber;
      const blockTimestamp = readNumberField(tx, ["blockTimestamp", "block_timestamp"]);
      const dayKey = utcDayFromTimestamp(blockTimestamp) ?? "unknown";
      const bucket = perDay.get(dayKey) ?? { burn: 0n, count: 0 };
      bucket.burn += burn;
      bucket.count += 1;
      perDay.set(dayKey, bucket);
      contributions.push({
        hash: readStringField(tx, ["txHash", "hash"]) ?? "",
        blockNumber,
        blockTimestamp: blockTimestamp ?? null,
        from: readStringField(tx, ["from"]) ?? "",
        to: readStringField(tx, ["to"]),
        feeLythoshi: fee.toString(),
        burnLythoshi: burn.toString(),
      });
    }
  }

  const perDayBuckets: BurnDayBucket[] = Array.from(perDay.entries())
    .sort((a, b) => {
      if (a[0] === "unknown") return 1;
      if (b[0] === "unknown") return -1;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    })
    .map(([day, value]) => ({
      day: day === "unknown" ? null : day,
      burnLythoshi: value.burn.toString(),
      txCount: value.count,
    }));

  const recent = contributions
    .slice()
    .sort((a, b) => {
      if (b.blockNumber !== a.blockNumber) return b.blockNumber - a.blockNumber;
      return BigInt(b.burnLythoshi) > BigInt(a.burnLythoshi) ? 1 : -1;
    })
    .slice(0, recentLimit);

  return {
    totalBurnedLythoshi: totalBurned.toString(),
    totalFeesLythoshi: totalFees.toString(),
    txCount,
    pagesScanned: pages.length,
    latestBlock,
    oldestBlockScanned: oldestBlock,
    truncated: options.truncated,
    perDay: perDayBuckets,
    recent,
    source: options.source,
  };
}

/**
 * Walk the live transaction feed forward (bounded) and fold it into a
 * {@link BurnDigest}. Prefers the `/api/v1` transaction feed and falls back to
 * `lyth_txFeed`; both expose the same opaque forward cursor + per-tx
 * `fee.total_lythoshi`. The walk stops at the first empty / cursor-less page or
 * after `maxPages` pages, whichever comes first.
 */
export async function fetchBurnDigest(
  pageSize = BURN_FEED_PAGE_SIZE,
  maxPages = BURN_FEED_MAX_PAGES,
): Promise<BurnDigest | null> {
  if (!isRpcConfigured()) return null;
  const limit = Math.max(1, Math.min(Math.trunc(pageSize), 100));
  const pageCap = Math.max(1, Math.min(Math.trunc(maxPages), 200));
  const rpc = getRpcClient();
  const api = getApiClient();

  let source: BurnDigest["source"] = "api_transactions";
  const pages: TxFeedResponse[] = [];
  let cursor: string | null = null;
  let truncated = false;

  for (let i = 0; i < pageCap; i += 1) {
    let page: TxFeedResponse | null = null;
    try {
      page = await api.transactions(limit, cursor).then((response) => response.data);
    } catch {
      page = null;
    }
    if (page === null) {
      try {
        page = await rpc.lythTxFeed(limit, cursor);
        source = "lyth_txFeed";
      } catch {
        page = null;
      }
    }
    if (page === null) {
      // First page failed entirely → no live feed; let the caller fall back.
      if (i === 0) return null;
      break;
    }
    pages.push(page);
    cursor = page.nextCursor;
    if (cursor === null || page.transactions.length === 0) break;
    if (i === pageCap - 1) truncated = true;
  }

  if (pages.length === 0) return null;
  return aggregateBurnDigest(pages, { truncated, source });
}

/**
 * Cumulative LYTH-burned estimate, derived from the indexed transaction feed.
 *
 * Indexer-DERIVED, not an authoritative chain counter — see the section banner
 * above. Returns `null` when no live feed answers so the page can show the
 * "connect a node" empty state instead of a fabricated number.
 */
export function useBurnSummary(
  pageSize = BURN_FEED_PAGE_SIZE,
  maxPages = BURN_FEED_MAX_PAGES,
) {
  return useQuery<BurnDigest | null>({
    queryKey: QK.burnSummary(pageSize, maxPages),
    enabled: isRpcConfigured(),
    queryFn: () => fetchBurnDigest(pageSize, maxPages),
    refetchInterval: 60_000,
    staleTime: 30_000,
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
      // Current RPC returns a compact descriptor list; profile cards add local
      // fallback rows for aggregate fields the node does not retain yet.
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

/** One row in `useLiveOperatorRoster`. */
export interface LiveOperatorRosterEntry {
  /** 32-byte hex operator id (the addressable identity). */
  operatorId: string;
  /** BLS aggregate public key registered with this cluster slot. */
  blsPubkey: string;
  /** Reported per-cluster state (active / standby / jailed / etc.). */
  state: string;
  /** Cluster id this operator is currently sitting in. */
  clusterId: number;
}

/** Aggregate operator roster digest. */
export interface LiveOperatorRoster {
  /** True when every reachable cluster status returned a result. */
  loaded: boolean;
  /** True when one or more cluster statuses are still resolving. */
  loading: boolean;
  /** Deduped operator rows across every cluster fetched. */
  operators: LiveOperatorRosterEntry[];
  /** Cluster ids the roster could not resolve (RPC error etc.). */
  failedClusters: number[];
  /** Total cluster count published by the directory. */
  clusterCount: number | null;
  /** Cluster ids fetched. May be a subset when `clusterCount > limit`. */
  fetchedClusters: number[];
}

/**
 * Aggregate operator membership across every cluster currently advertised by
 * the chain. Cap defaults to 50 clusters per render to keep the fan-out
 * bounded; the explorer falls back to fixture data above the cap.
 */
export function useLiveOperatorRoster(maxClusters = 50): LiveOperatorRoster {
  const clusters = useClusterSet();
  const directory = clusters.data ?? null;
  const clusterIds = (directory ?? []).map((c) => c.id).filter((id): id is number => typeof id === "number");
  const fetchIds = clusterIds.slice(0, Math.max(0, Math.trunc(maxClusters)));
  const statuses = useQueries({
    queries: fetchIds.map((id) => ({
      queryKey: QK.clusterStatus(id),
      enabled: isRpcConfigured(),
      queryFn: async (): Promise<ClusterStatusResponse | null> => {
        try {
          return await getApiClient()
            .cluster(id)
            .then((response) => apiClusterStatusToRpcStatus(response.data.cluster))
            .catch(() => getRpcClient().lythClusterStatus(id));
        } catch {
          return null;
        }
      },
      staleTime: 30_000,
    })),
  });
  const operatorsById = new Map<string, LiveOperatorRosterEntry>();
  const failedClusters: number[] = [];
  for (let i = 0; i < fetchIds.length; i++) {
    const id = fetchIds[i];
    const result = statuses[i];
    if (result.data === null || result.data === undefined) {
      if (!result.isLoading && !result.isFetching) failedClusters.push(id);
      continue;
    }
    for (const member of result.data.members ?? []) {
      const operatorId = member?.operatorId;
      if (typeof operatorId !== "string" || !OPERATOR_ID_RE.test(operatorId)) continue;
      if (operatorsById.has(operatorId)) continue;
      operatorsById.set(operatorId, {
        operatorId,
        blsPubkey: typeof member.blsPubkey === "string" ? member.blsPubkey : "",
        state: typeof member.state === "string" ? member.state : "unknown",
        clusterId: id,
      });
    }
  }
  const loaded = directory !== null && fetchIds.every((_, i) => !statuses[i].isLoading);
  const loading = directory === null || fetchIds.some((_, i) => statuses[i].isLoading);
  return {
    loaded,
    loading,
    operators: Array.from(operatorsById.values()),
    failedClusters,
    clusterCount: directory?.length ?? null,
    fetchedClusters: fetchIds,
  };
}

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
  gasPriceSource: "lyth_executionUnitPrice" | "eth_feeHistory" | null;
  oldestBlock: string | null;
  baseFeePerGas: string[];
  gasUsedRatio: number[];
}

function parseRpcQuantityValue(value: unknown): bigint | null {
  if (typeof value === "bigint") return value >= 0n ? value : null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  try {
    return trimmed.startsWith("0x") || trimmed.startsWith("0X")
      ? parseQuantityBig(trimmed)
      : BigInt(trimmed);
  } catch {
    return null;
  }
}

function executionUnitPriceFromQuote(value: unknown): bigint | null {
  const row = unknownRecord(value);
  if (!row) return null;
  const price = parseRpcQuantityValue(
    row.executionUnitPriceLythoshi ?? row.execution_unit_price_lythoshi,
  );
  return price !== null && price > 0n ? price : null;
}

async function readExecutionUnitPrice(
  rpc: FeeStatsRpcClient,
): Promise<ExecutionUnitPriceResponseLike | null> {
  if (typeof rpc.lythExecutionUnitPrice === "function") {
    return rpc.lythExecutionUnitPrice();
  }
  if (typeof rpc.call === "function") {
    return rpc.call<ExecutionUnitPriceResponseLike>("lyth_executionUnitPrice", []);
  }
  return null;
}

export function useFeeStats() {
  return useQuery<FeeStatsLive | null>({
    queryKey: QK.feeStats(),
    queryFn: async () => {
      if (!isRpcConfigured()) return null;
      const rpc = getRpcClient() as FeeStatsRpcClient;
      const settle = async <T>(p: Promise<T>): Promise<T | null> => {
        try {
          return await p;
        } catch {
          return null;
        }
      };
      const [nativeQuote, history] = await Promise.all([
        settle(readExecutionUnitPrice(rpc)),
        settle(rpc.ethFeeHistory(8, "latest", [])),
      ]);
      const feeHistory = history as FeeHistoryResponse | null;
      const latestBaseFeeHex = feeHistory?.baseFeePerGas.at(-1);
      const latestBaseFee = latestBaseFeeHex ? parseQuantityBig(latestBaseFeeHex) : null;
      const nativePrice = executionUnitPriceFromQuote(nativeQuote);
      return {
        gasPrice: nativePrice ?? latestBaseFee,
        gasPriceSource: nativePrice !== null ? "lyth_executionUnitPrice" : latestBaseFee !== null ? "eth_feeHistory" : null,
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

/** Indexer availability digest for surfaces that depend on indexed history. */
export interface IndexerAvailability {
  /** True when chainStats has responded — the explorer is talking to a real node. */
  liveChain: boolean;
  /** True when the node's indexer is reporting active. */
  available: boolean;
  /** True only when we have a positive "disabled" signal from the node. */
  disabled: boolean;
  /**
   * Short human reason. Set when disabled or unknown so callers can
   * surface why a CLOB/markets/activity panel is empty.
   */
  reason: string | null;
}

/**
 * Pure derivation of indexer availability from the two live signals the
 * node publishes:
 *   1. `lyth_operatorCapabilities.surfaces.indexer_history.status` — explicit
 *      "disabled" / "available" advertisement.
 *   2. `lyth_chainStats.indexer` — the indexer block reported alongside chain
 *      stats. A null block means no indexer is wired up on this peer.
 *
 * `available=false` + `disabled=true` is a hard confirmation that
 * markets/address-activity/NFT-listing endpoints will fail; callers should
 * render an explanatory empty state instead of falling back to the fixture
 * demo rows.
 */
export function deriveIndexerAvailability(input: {
  capabilities: OperatorCapabilitiesResponse | null | undefined;
  capabilitiesLoading?: boolean;
  stats: ChainStatsResponse | null | undefined;
  statsLoading?: boolean;
}): IndexerAvailability {
  const surfaceStatus = input.capabilities?.surfaces?.indexer_history?.status ?? null;
  const liveChain = Boolean(input.stats);

  if (surfaceStatus === "disabled") {
    return {
      liveChain,
      available: false,
      disabled: true,
      reason: "Indexer is disabled on the connected node",
    };
  }
  if (surfaceStatus === "available") {
    return { liveChain, available: true, disabled: false, reason: null };
  }
  if (input.stats && input.stats.indexer === null) {
    return {
      liveChain,
      available: false,
      disabled: true,
      reason: "Connected node is running without an indexer",
    };
  }
  return { liveChain, available: false, disabled: false, reason: null };
}

/**
 * Hook form of `deriveIndexerAvailability`. Reads operator capabilities and
 * chain stats from React Query and projects the merged availability digest.
 */
export function useIndexerAvailability(): IndexerAvailability {
  const capabilities = useOperatorCapabilities();
  const stats = useChainStats();
  return deriveIndexerAvailability({
    capabilities: capabilities.data,
    capabilitiesLoading: capabilities.isLoading,
    stats: stats.data,
    statsLoading: stats.isLoading,
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

function boundedMrcHoldersLimit(limit = MRC_HOLDERS_BALANCE_LIMIT): number {
  return Math.max(1, Math.min(Math.trunc(limit), 25));
}

function normalizeMrcHolderStandard(standard: string | null | undefined): MrcHolderStandard | null {
  return standard === "mrc721" || standard === "mrc1155" || standard === "mrc4626" ? standard : null;
}

function mrcHolderBalanceIdentity(row: MrcMetadataBalanceRow): {
  standard: MrcHolderStandard;
  assetId: string;
  tokenId: string | null;
} | null {
  const standard = normalizeMrcHolderStandard(row.mrc?.standard);
  const assetId = row.mrc?.assetId ?? null;
  if (!standard || !assetId) return null;
  if (standard === "mrc4626") {
    return { standard, assetId, tokenId: null };
  }
  const tokenId = row.mrc?.tokenId ?? null;
  return tokenId ? { standard, assetId, tokenId } : null;
}

function mrcHoldersBalanceQueryKey(row: MrcMetadataBalanceRow): string | null {
  const identity = mrcHolderBalanceIdentity(row);
  if (!identity) return null;
  const { standard, assetId, tokenId } = identity;
  return `${standard}:${assetId}:${tokenId}:${row.tokenId}`;
}

function uniqueMrcHoldersBalanceRows(
  rows: readonly MrcMetadataBalanceRow[],
  limit = MRC_HOLDERS_BALANCE_LIMIT,
): MrcMetadataBalanceRow[] {
  const out: MrcMetadataBalanceRow[] = [];
  const seen = new Set<string>();
  const rowLimit = boundedMrcHoldersLimit(limit);
  for (const row of rows) {
    const identity = mrcHolderBalanceIdentity(row);
    if (!identity) continue;
    const { standard, assetId, tokenId } = identity;
    const holderKey = `${standard}:${assetId}:${tokenId}`;
    if (seen.has(holderKey)) continue;
    seen.add(holderKey);
    out.push(row);
    if (out.length >= rowLimit) break;
  }
  return out;
}

export function mrcHoldersBalanceQueryKeys(
  rows: readonly MrcMetadataBalanceRow[],
  limit = MRC_HOLDERS_BALANCE_LIMIT,
): string[] {
  return uniqueMrcHoldersBalanceRows(rows, limit).map(mrcHoldersBalanceQueryKey).filter((key): key is string => Boolean(key));
}

function unwrapMrcHoldersResponse(response: MrcHoldersResponse | MrcHoldersEnvelope): MrcHoldersResponse {
  return "data" in response ? response.data : response;
}

async function fetchMrcHoldersForIdentity(
  standard: MrcHolderStandard,
  assetId: string,
  tokenId: string | null,
  limit: number,
  api: MrcHoldersApiClient,
  rpc: MrcHoldersRpcClient,
): Promise<MrcHoldersResponse | null> {
  const tokenPathSegment = tokenId ?? "";
  if (standard !== "mrc4626" && !tokenPathSegment) return null;
  try {
    if (typeof api.get !== "function") throw new Error("MRC holder REST client unavailable");
    const path = standard === "mrc4626"
      ? `/mrc/${encodeURIComponent(standard)}/${encodeURIComponent(assetId)}/holders`
      : `/mrc/${encodeURIComponent(standard)}/${encodeURIComponent(assetId)}/${encodeURIComponent(tokenPathSegment)}/holders`;
    return unwrapMrcHoldersResponse(await api.get<MrcHoldersResponse | MrcHoldersEnvelope>(
      path,
      { limit },
    ));
  } catch {
    if (typeof rpc.lythMrcHolders === "function") {
      return rpc.lythMrcHolders(standard, assetId, tokenId, limit);
    }
    if (typeof rpc.call === "function") {
      return rpc.call<MrcHoldersResponse>("lyth_mrcHolders", [standard, assetId, tokenId, limit]);
    }
    return null;
  }
}

export async function fetchMrcHoldersForTokenBalances(
  rows: readonly MrcMetadataBalanceRow[],
  clients: { api?: MrcHoldersApiClient; rpc?: MrcHoldersRpcClient } = {},
  limit = MRC_HOLDERS_BALANCE_LIMIT,
): Promise<MrcHoldersByTokenBalance> {
  const rowLimit = boundedMrcHoldersLimit(limit);
  const api = clients.api ?? getApiClient();
  const rpc: MrcHoldersRpcClient = clients.rpc ?? (getRpcClient() as unknown as MrcHoldersRpcClient);
  const out: MrcHoldersByTokenBalance = {};
  await Promise.all(uniqueMrcHoldersBalanceRows(rows, rowLimit).map(async (row) => {
    const identity = mrcHolderBalanceIdentity(row);
    if (!identity) return;
    const { standard, assetId, tokenId } = identity;
    try {
      const response = await fetchMrcHoldersForIdentity(standard, assetId, tokenId, rowLimit, api, rpc);
      if (response && Array.isArray(response.holders)) {
        out[row.tokenId] = response;
      }
    } catch {
      // Missing node support should leave wallet token rows unchanged.
    }
  }));
  return out;
}

export function useMrcHoldersForTokenBalances(
  rows: readonly MrcMetadataBalanceRow[],
  limit = MRC_HOLDERS_BALANCE_LIMIT,
) {
  const rowLimit = boundedMrcHoldersLimit(limit);
  const keys = mrcHoldersBalanceQueryKeys(rows, rowLimit);
  return useQuery<MrcHoldersByTokenBalance>({
    queryKey: QK.mrcHolders(keys, rowLimit),
    enabled: keys.length > 0 && isRpcConfigured(),
    queryFn: () => fetchMrcHoldersForTokenBalances(rows, {}, rowLimit),
    staleTime: 60_000,
  });
}

function boundedMrcAccountSpendLimit(limit = MRC_ACCOUNT_POLICY_SPEND_LIMIT): number {
  return Math.max(1, Math.min(Math.trunc(limit), 50));
}

function unwrapMrcAccountResponse(value: unknown): unknown {
  const envelope = unknownRecord(value) as (Record<string, unknown> & MrcAccountEnvelope) | null;
  const data = unknownRecord(envelope?.data);
  if (
    data
    && (
      data.account !== undefined
      || data.smartAccount !== undefined
      || data.smart_account !== undefined
      || data.policyAccount !== undefined
      || data.policy_account !== undefined
      || data.policySpends !== undefined
      || data.policy_spends !== undefined
    )
  ) {
    return data;
  }
  return value;
}

function normalizeMrcAccountRecord(value: unknown): MrcAccountRecord | null {
  const row = unknownRecord(value);
  if (!row) return null;
  const kind = readStringField(row, ["kind"]);
  const account = readStringField(row, ["account"]);
  const updatedAtBlock = readNumberField(row, ["updatedAtBlock", "updated_at_block", "blockHeight", "block_height"]);
  if (!kind || !account || updatedAtBlock === null) return null;
  return {
    kind,
    account,
    controller: readStringField(row, ["controller"]),
    recovery: readStringField(row, ["recovery"]),
    policyHash: readStringField(row, ["policyHash", "policy_hash"]),
    policy: normalizeMrcPolicyRecord(readObjectField(row, ["policy", "policyBody", "policy_body"])),
    nonce: readStringField(row, ["nonce"]),
    updatedAtBlock,
  };
}

function normalizeMrcPolicyRecord(value: unknown): MrcPolicyRecord | null {
  const row = unknownRecord(value);
  if (!row) return null;
  const enabled = readBooleanField(row, ["enabled"]);
  const perActionLimit = readStringField(row, ["perActionLimit", "per_action_limit"]);
  const windowLimit = readStringField(row, ["windowLimit", "window_limit"]);
  if (enabled === null || !perActionLimit || !windowLimit) return null;
  return {
    enabled,
    perActionLimit,
    windowLimit,
    allowedAssets: readStringListField(row, ["allowedAssets", "allowed_assets"]),
  };
}

function normalizeMrcPolicySpendRecord(value: unknown): MrcPolicySpendRecord | null {
  const row = unknownRecord(value);
  if (!row) return null;
  const account = readStringField(row, ["account"]);
  const assetId = readStringField(row, ["assetId", "asset_id"]);
  const window = readStringField(row, ["window"]);
  const amount = readStringField(row, ["amount"]);
  const spent = readStringField(row, ["spent"]);
  const updatedAtBlock = readNumberField(row, ["updatedAtBlock", "updated_at_block", "blockHeight", "block_height"]);
  if (!account || !assetId || !window || !amount || !spent || updatedAtBlock === null) return null;
  return {
    account,
    assetId,
    window,
    amount,
    spent,
    updatedAtBlock,
  };
}

export function normalizeMrcAccountResponse(value: unknown): MrcAccountResponse | null {
  const root = unknownRecord(unwrapMrcAccountResponse(value));
  if (!root) return null;
  const schemaVersion = readNumberField(root, ["schemaVersion", "schema_version"]);
  const account = readStringField(root, ["account"]);
  const spendLimit = readNumberField(root, ["spendLimit", "spend_limit"]);
  if (schemaVersion !== 1 || !account || spendLimit === null) return null;
  const rawSpends = readObjectField(root, ["policySpends", "policy_spends"]);
  const policySpends = Array.isArray(rawSpends)
    ? rawSpends
        .map(normalizeMrcPolicySpendRecord)
        .filter((row): row is MrcPolicySpendRecord => row !== null)
    : [];
  return {
    schemaVersion: 1,
    account,
    spendLimit,
    smartAccount: normalizeMrcAccountRecord(readObjectField(root, ["smartAccount", "smart_account"])),
    policyAccount: normalizeMrcAccountRecord(readObjectField(root, ["policyAccount", "policy_account"])),
    policySpends,
  };
}

export async function fetchMrcAccount(
  account: string,
  limit = MRC_ACCOUNT_POLICY_SPEND_LIMIT,
  clients: { api?: MrcAccountApiClient; rpc?: MrcAccountRpcClient } = {},
): Promise<MrcAccountResponse | null> {
  const rowLimit = boundedMrcAccountSpendLimit(limit);
  const api = clients.api ?? getApiClient();
  const rpc = clients.rpc ?? (getRpcClient() as unknown as MrcAccountRpcClient);
  try {
    if (typeof api.get !== "function") throw new Error("MRC account REST client unavailable");
    const response = await api.get(
      `/mrc/accounts/${encodeURIComponent(account)}`,
      { limit: rowLimit },
    );
    const normalized = normalizeMrcAccountResponse(response);
    if (normalized) return normalized;
  } catch {
    // Fall through to JSON-RPC for nodes without the REST indexer route.
  }

  try {
    const response = typeof rpc.lythMrcAccount === "function"
      ? await rpc.lythMrcAccount(account, rowLimit)
      : typeof rpc.call === "function"
        ? await rpc.call("lyth_mrcAccount", [account, rowLimit])
        : null;
    return normalizeMrcAccountResponse(response);
  } catch {
    return null;
  }
}

export function useMrcAccount(addr: string | undefined, limit = MRC_ACCOUNT_POLICY_SPEND_LIMIT) {
  const rowLimit = boundedMrcAccountSpendLimit(limit);
  return useQuery<MrcAccountResponse | null>({
    queryKey: QK.mrcAccount(addr ?? "", rowLimit),
    enabled: Boolean(addr) && isRpcConfigured(),
    queryFn: () => fetchMrcAccount(addr as string, rowLimit),
    staleTime: 30_000,
  });
}

export interface BridgeTrustDisclosureRow {
  route: BridgeRouteDisclosure;
  assessment: BridgeRouteAssessment;
  source: string;
  readiness?: BridgeRouteReadiness | null;
}

export const BRIDGE_TRUST_DISCLOSURE_DISPLAY_LIMIT = 5;
export const BRIDGE_ROUTES_DISCOVERY_LIMIT = 25;

export interface BridgeRouteReadiness {
  routeSelectionReady: boolean;
  quoteReady: boolean;
  submitReady: boolean;
  blockedReasons: string[];
  warnings: string[];
}

export interface BridgeTrustDisclosureDisplaySlice {
  preferred: BridgeTrustDisclosureRow | null;
  rows: BridgeTrustDisclosureRow[];
  hiddenCount: number;
  totalCount: number;
}

export type BridgeRouteDisclosureSource = {
  value: unknown;
  source: string;
  readiness?: BridgeRouteReadiness | null;
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
    "protocol",
    "routeProtocol",
    "route_protocol",
    "bridgeId",
    "bridge_id",
    "feeToken",
    "fee_token",
    "asset",
    "sourceChain",
    "source_chain",
    "destinationChain",
    "destination_chain",
    "wrappedAsset",
    "wrapped_asset",
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

function normalizeBridgeEnumValue(value: string): string {
  return value.trim().replace(/[-_\s]+([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());
}

function readBridgeEnum<T extends string>(value: unknown, keys: string[], allowed: readonly T[], fallback: T): T {
  const raw = readStringField(value, keys);
  if (!raw) return fallback;
  const normalized = normalizeBridgeEnumValue(raw);
  return allowed.find((allowedValue) =>
    allowedValue === raw ||
    allowedValue.toLowerCase() === raw.trim().toLowerCase() ||
    allowedValue.toLowerCase() === normalized.toLowerCase()
  ) ?? fallback;
}

function readBridgeNumber(value: unknown, keys: string[]): number {
  const n = readNumberField(value, keys);
  return n !== null && Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function readBridgeNullableString(value: unknown, keys: string[]): string | null {
  const raw = readStringField(value, keys)?.trim();
  return raw ? raw : null;
}

function readBridgeString(value: unknown, keys: string[], fallback = ""): string {
  return readStringField(value, keys)?.trim() ?? fallback;
}

function bridgeRouteReadinessFromValue(value: unknown): BridgeRouteReadiness | null {
  const row = unknownRecord(value);
  if (!row) return null;
  const routeSelectionReady = readBooleanField(row, ["routeSelectionReady", "route_selection_ready"]);
  const quoteReady = readBooleanField(row, ["quoteReady", "quote_ready"]);
  const submitReady = readBooleanField(row, ["submitReady", "submit_ready"]);
  const blockedReasons = readStringListField(row, ["blockedReasons", "blocked_reasons"]);
  const warnings = readStringListField(row, ["warnings"]);
  if (
    routeSelectionReady === null &&
    quoteReady === null &&
    submitReady === null &&
    blockedReasons.length === 0 &&
    warnings.length === 0
  ) {
    return null;
  }
  return {
    routeSelectionReady: routeSelectionReady ?? false,
    quoteReady: quoteReady ?? false,
    submitReady: submitReady ?? false,
    blockedReasons,
    warnings,
  };
}

function bridgeRouteReadinessFromRoute(route: BridgeRouteDisclosure): BridgeRouteReadiness | null {
  if (
    route.routeSelectionReady === undefined &&
    route.quoteReady === undefined &&
    route.submitReady === undefined &&
    (route.readinessBlockedReasons?.length ?? 0) === 0 &&
    (route.readinessWarnings?.length ?? 0) === 0
  ) {
    return null;
  }
  return {
    routeSelectionReady: route.routeSelectionReady ?? false,
    quoteReady: route.quoteReady ?? false,
    submitReady: route.submitReady ?? false,
    blockedReasons: route.readinessBlockedReasons ?? [],
    warnings: route.readinessWarnings ?? [],
  };
}

function bridgeDisclosureValues(value: unknown, source: string): BridgeRouteDisclosureSource[] {
  const row = unknownRecord(value);
  if (!row) return [];
  const out: BridgeRouteDisclosureSource[] = [];
  const parentReadiness = bridgeRouteReadinessFromValue(row);
  for (const key of BRIDGE_DISCLOSURE_KEYS) {
    if (row[key] !== undefined) {
      out.push({
        value: row[key],
        source,
        readiness: bridgeRouteReadinessFromValue(row[key]) ?? parentReadiness,
      });
    }
  }
  for (const key of BRIDGE_DISCLOSURES_KEYS) {
    const raw = row[key];
    if (Array.isArray(raw)) {
      raw.forEach((entry, index) => out.push({
        value: entry,
        source: `${source}[${index}]`,
        readiness: bridgeRouteReadinessFromValue(entry) ?? parentReadiness,
      }));
    } else if (raw !== undefined) {
      out.push({
        value: raw,
        source,
        readiness: bridgeRouteReadinessFromValue(raw) ?? parentReadiness,
      });
    }
  }
  return out;
}

function pushBridgeRouteDiscoveryArray(
  out: BridgeRouteDisclosureSource[],
  value: unknown,
  source: string,
  readiness: BridgeRouteReadiness | null = null,
): void {
  if (!Array.isArray(value)) return;
  value.forEach((route, index) => {
    out.push({
      value: route,
      source: `${source}[${index}]`,
      readiness: bridgeRouteReadinessFromValue(route) ?? readiness,
    });
  });
}

function bridgeRouteDiscoverySources(value: unknown, source: string): BridgeRouteDisclosureSource[] {
  const out: BridgeRouteDisclosureSource[] = [];
  const raw = unknownRecord(value);
  const data = raw?.data ?? value;
  const dataRecord = unknownRecord(data);
  if (Array.isArray(data)) {
    pushBridgeRouteDiscoveryArray(out, data, source);
    return out;
  }
  if (!dataRecord) return out;

  const readiness = bridgeRouteReadinessFromValue(dataRecord);
  const hasRoutes = Array.isArray(dataRecord.routes);
  pushBridgeRouteDiscoveryArray(out, dataRecord.routes, source, readiness);
  pushBridgeRouteDiscoveryArray(
    out,
    dataRecord.bridgeRoutes,
    hasRoutes ? `${source}.bridgeRoutes` : source,
    readiness,
  );
  pushBridgeRouteDiscoveryArray(out, dataRecord.bridgeRouteDisclosures, `${source}.bridgeRouteDisclosures`, readiness);
  pushBridgeRouteDiscoveryArray(out, dataRecord.bridge_route_disclosures, `${source}.bridge_route_disclosures`, readiness);
  pushBridgeRouteDiscoveryArray(out, dataRecord.routeDisclosures, `${source}.routeDisclosures`, readiness);
  return out;
}

export function normalizeBridgeRouteDisclosure(value: unknown): BridgeRouteDisclosure | null {
  const row = unknownRecord(value);
  if (!row || !bridgeRouteMarkerPresent(row)) return null;

  const verifier = unknownRecord(readObjectField(row, ["verifier", "verifierConfig", "verifier_config"])) ?? {};
  const lastIncidentDate = readStringField(row, ["lastIncidentDate", "last_incident_date", "incidentDate", "incident_date"]);
  const bridgeId = readBridgeNullableString(row, ["bridgeId", "bridge_id", "bridgeConfigId", "bridge_config_id"]);
  const wrappedAsset = readBridgeNullableString(row, ["wrappedAsset", "wrapped_asset", "wrappedAssetId", "wrapped_asset_id", "wrappedToken", "wrapped_token"]);
  const routeSelectionReady = readBooleanField(row, ["routeSelectionReady", "route_selection_ready"]);
  const quoteReady = readBooleanField(row, ["quoteReady", "quote_ready"]);
  const submitReady = readBooleanField(row, ["submitReady", "submit_ready"]);
  const readinessBlockedReasons = readStringListField(row, ["blockedReasons", "blocked_reasons"]);
  const readinessWarnings = readStringListField(row, ["warnings"]);

  const route: BridgeRouteDisclosure = {
    routeId: readBridgeString(row, ["routeId", "route_id", "id"]),
    bridge: readBridgeString(row, ["bridge", "bridgeName", "bridge_name"]),
    protocol: readBridgeNullableString(row, ["protocol", "routeProtocol", "route_protocol"]),
    asset: readBridgeString(row, ["asset", "assetId", "asset_id", "tokenId", "token_id"], wrappedAsset ?? ""),
    feeToken: readBridgeString(row, ["feeToken", "fee_token"]),
    sourceChain: readBridgeString(row, ["sourceChain", "source_chain", "fromChain", "from_chain"]),
    destinationChain: readBridgeString(row, ["destinationChain", "destination_chain", "toChain", "to_chain"]),
    verifier: {
      model: readBridgeString(verifier, ["model", "type"]),
      participantCount: readBridgeNumber(verifier, ["participantCount", "participant_count", "participants", "signerCount", "signer_count"]),
      threshold: readBridgeNumber(verifier, ["threshold", "required", "requiredSigners", "required_signers"]),
    },
    drainCapAtomic: readBridgeString(row, ["drainCapAtomic", "drain_cap_atomic", "drainCap", "drain_cap"], "0"),
    finalityBlocks: readBridgeNumber(row, ["finalityBlocks", "finality_blocks", "finalityDelayBlocks", "finality_delay_blocks", "finalityDelay", "finality_delay"]),
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
    insuranceAtomic: readBridgeString(row, ["insuranceAtomic", "insurance_atomic", "slashableInsuranceAtomic", "slashable_insurance_atomic", "insurancePoolAtomic", "insurance_pool_atomic"], "0"),
    lastIncidentDate,
  };
  if (bridgeId !== null) route.bridgeId = bridgeId;
  if (wrappedAsset !== null) route.wrappedAsset = wrappedAsset;
  if (routeSelectionReady !== null) route.routeSelectionReady = routeSelectionReady;
  if (quoteReady !== null) route.quoteReady = quoteReady;
  if (submitReady !== null) route.submitReady = submitReady;
  if (readinessBlockedReasons.length > 0) route.readinessBlockedReasons = readinessBlockedReasons;
  if (readinessWarnings.length > 0) route.readinessWarnings = readinessWarnings;
  return route;
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
  if (!isChainlinkCcipRoute(route.protocol, route.bridge, route.verifier.model)) {
    blockedReasons.push("bridge protocol must be Chainlink CCIP");
  }
  if (route.asset.trim() === "") blockedReasons.push("asset disclosure missing");
  if (route.feeToken.trim() === "") {
    blockedReasons.push("route fee token missing");
  } else if (route.feeToken.trim().toUpperCase() !== BRIDGE_ALLOWED_FEE_TOKEN) {
    blockedReasons.push("CCIP route fee token must be LINK");
  }
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

function isChainlinkCcipRoute(
  protocol: string | null | undefined,
  bridge: string,
  verifierModel: string,
): boolean {
  const normalizedProtocol = normalizeBridgeProtocol(protocol ?? "");
  if (normalizedProtocol.length > 0) {
    return normalizedProtocol === "chainlinkccip" || normalizedProtocol === "ccip";
  }
  return bridgeLabelLooksCcip(bridge) || bridgeLabelLooksCcip(verifierModel);
}

function bridgeLabelLooksCcip(value: string): boolean {
  return normalizeBridgeProtocol(value).includes("ccip");
}

function normalizeBridgeProtocol(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function uniqueBridgeMessages(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function stricterBridgeRisk(left: BridgeRiskTier, right: BridgeRiskTier): BridgeRiskTier {
  const order: Record<BridgeRiskTier, number> = {
    low: 0,
    medium: 1,
    high: 2,
    blocked: 3,
  };
  return order[left] >= order[right] ? left : right;
}

function mergeBridgeRouteAssessment(
  local: BridgeRouteAssessment,
  sdk: BridgeRouteAssessment,
): BridgeRouteAssessment {
  const blockedReasons = uniqueBridgeMessages([...sdk.blockedReasons, ...local.blockedReasons]);
  const warnings = uniqueBridgeMessages([...sdk.warnings, ...local.warnings]);
  const accepted = blockedReasons.length === 0 && sdk.accepted && local.accepted;
  return {
    routeId: sdk.routeId || local.routeId,
    accepted,
    score: accepted ? Math.min(local.score, sdk.score) : 0,
    riskTier: accepted ? stricterBridgeRisk(local.riskTier, sdk.riskTier) : "blocked",
    blockedReasons,
    warnings,
  };
}

function assessBridgeRouteWithSdkFallback(route: BridgeRouteDisclosure): BridgeRouteAssessment {
  const local = fallbackAssessBridgeRoute(route);
  if (typeof sdkBridgeHelpers.assessBridgeRoute !== "function") return local;
  return mergeBridgeRouteAssessment(local, sdkBridgeHelpers.assessBridgeRoute(route));
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

function mergeOptionalBridgeRouteFields(
  primary: BridgeRouteDisclosure,
  secondary: BridgeRouteDisclosure,
): BridgeRouteDisclosure {
  return {
    ...primary,
    bridgeId: primary.bridgeId ?? secondary.bridgeId,
    wrappedAsset: primary.wrappedAsset ?? secondary.wrappedAsset,
    protocol: primary.protocol ?? secondary.protocol,
    feeToken: primary.feeToken || secondary.feeToken,
    routeSelectionReady: primary.routeSelectionReady ?? secondary.routeSelectionReady,
    quoteReady: primary.quoteReady ?? secondary.quoteReady,
    submitReady: primary.submitReady ?? secondary.submitReady,
    readinessBlockedReasons: primary.readinessBlockedReasons ?? secondary.readinessBlockedReasons,
    readinessWarnings: primary.readinessWarnings ?? secondary.readinessWarnings,
  };
}

function mergeBridgeRouteReadiness(
  primary: BridgeRouteReadiness | null | undefined,
  secondary: BridgeRouteReadiness | null | undefined,
): BridgeRouteReadiness | null {
  if (primary && secondary) {
    return {
      routeSelectionReady: primary.routeSelectionReady || secondary.routeSelectionReady,
      quoteReady: primary.quoteReady || secondary.quoteReady,
      submitReady: primary.submitReady || secondary.submitReady,
      blockedReasons: primary.blockedReasons.length > 0 ? primary.blockedReasons : secondary.blockedReasons,
      warnings: primary.warnings.length > 0 ? primary.warnings : secondary.warnings,
    };
  }
  return primary ?? secondary ?? null;
}

export function assessBridgeTrustDisclosures(
  sources: readonly BridgeRouteDisclosureSource[],
): BridgeTrustDisclosureRow[] {
  const rowsByKey = new Map<string, BridgeTrustDisclosureRow>();

  for (const source of sources) {
    const route = normalizeBridgeRouteDisclosure(source.value);
    if (!route) continue;
    const readiness = source.readiness ?? bridgeRouteReadinessFromRoute(route);
    const key = bridgeRouteDisclosureKey(route);
    const existing = rowsByKey.get(key);
    if (existing) {
      const mergedRoute = mergeOptionalBridgeRouteFields(existing.route, route);
      rowsByKey.set(key, {
        ...existing,
        route: mergedRoute,
        assessment: assessBridgeRouteWithSdkFallback(mergedRoute),
        readiness: mergeBridgeRouteReadiness(existing.readiness, readiness),
      });
      continue;
    }
    const row: BridgeTrustDisclosureRow = {
      route,
      assessment: assessBridgeRouteWithSdkFallback(route),
      source: source.source,
      readiness,
    };
    rowsByKey.set(key, row);
  }

  const rows = [...rowsByKey.values()];
  const sourceByKey = new Map(rows.map((row) => [bridgeRouteDisclosureKey(row.route), row.source]));
  const readinessByKey = new Map(rows.map((row) => [bridgeRouteDisclosureKey(row.route), row.readiness ?? null]));
  return rankBridgeRoutesWithSdkFallback(rows.map((row) => row.route)).map(({ route, assessment }) => ({
    route,
    assessment,
    source: sourceByKey.get(bridgeRouteDisclosureKey(route)) ?? "upstream",
    readiness: readinessByKey.get(bridgeRouteDisclosureKey(route)) ?? bridgeRouteReadinessFromRoute(route),
  }));
}

export function mergeBridgeTrustDisclosures(
  disclosures: readonly BridgeTrustDisclosureRow[],
): BridgeTrustDisclosureRow[] {
  const sourceByKey = new Map<string, string>();
  const routeByKey = new Map<string, BridgeRouteDisclosure>();
  const readinessByKey = new Map<string, BridgeRouteReadiness | null>();
  for (const row of disclosures) {
    const key = bridgeRouteDisclosureKey(row.route);
    if (!sourceByKey.has(key)) sourceByKey.set(key, row.source);
    routeByKey.set(
      key,
      routeByKey.has(key)
        ? mergeOptionalBridgeRouteFields(routeByKey.get(key) as BridgeRouteDisclosure, row.route)
        : row.route,
    );
    readinessByKey.set(
      key,
      mergeBridgeRouteReadiness(readinessByKey.get(key), row.readiness ?? bridgeRouteReadinessFromRoute(row.route)),
    );
  }
  return rankBridgeRoutesWithSdkFallback([...routeByKey.values()]).map(({ route, assessment }) => ({
    route,
    assessment,
    source: sourceByKey.get(bridgeRouteDisclosureKey(route)) ?? "upstream",
    readiness: readinessByKey.get(bridgeRouteDisclosureKey(route)) ?? bridgeRouteReadinessFromRoute(route),
  }));
}

export function bridgeTrustDisclosureDisplaySlice(
  disclosures: readonly BridgeTrustDisclosureRow[],
  limit = BRIDGE_TRUST_DISCLOSURE_DISPLAY_LIMIT,
): BridgeTrustDisclosureDisplaySlice {
  const boundedLimit = Number.isFinite(limit) && limit > 0
    ? Math.trunc(limit)
    : BRIDGE_TRUST_DISCLOSURE_DISPLAY_LIMIT;
  const rows = disclosures.slice(0, boundedLimit);
  return {
    preferred: disclosures[0] ?? null,
    rows,
    hiddenCount: Math.max(0, disclosures.length - rows.length),
    totalCount: disclosures.length,
  };
}

export function bridgeRouteDisclosureFailureDetails(row: BridgeTrustDisclosureRow): string[] {
  const details: string[] = [];
  const warningSet = new Set([...row.assessment.blockedReasons, ...row.assessment.warnings]);

  if (row.route.cooldownSeconds === 0 || warningSet.has("route cooldown missing")) {
    details.push(`cooldown missing (${row.route.cooldownSeconds}s)`);
  } else if (warningSet.has("cooldown is under one hour")) {
    details.push(`cooldown under one hour (${row.route.cooldownSeconds}s)`);
  }

  if (row.route.finalityBlocks === 0 || warningSet.has("route finality delay missing")) {
    details.push(`finality missing (${row.route.finalityBlocks} blocks)`);
  } else if (warningSet.has("finality delay is under two blocks")) {
    details.push(`finality below two blocks (${row.route.finalityBlocks} blocks)`);
  }

  if (row.route.circuitBreaker === "paused") {
    details.push("circuit breaker paused");
  } else if (row.route.circuitBreaker === "disabled" || row.route.circuitBreaker === "unknown" || warningSet.has("route circuit breaker missing")) {
    details.push(`circuit breaker ${row.route.circuitBreaker}`);
  }

  if (!decimalStringIsPositive(row.route.insuranceAtomic) || warningSet.has("slashable insurance pool missing or zero")) {
    details.push(`insurance missing or zero (${row.route.insuranceAtomic})`);
  }

  if (warningSet.has("bridge protocol must be Chainlink CCIP")) {
    details.push(`protocol ${row.route.protocol ?? "missing"}`);
  }

  if (warningSet.has("route fee token missing") || warningSet.has("CCIP route fee token must be LINK")) {
    details.push(`fee token ${row.route.feeToken || "missing"}`);
  }

  return details;
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

function boundedBridgeRoutesLimit(limit = BRIDGE_ROUTES_DISCOVERY_LIMIT): number {
  return Math.max(1, Math.min(Math.trunc(limit), 100));
}

export async function fetchBridgeRouteDisclosures(
  limit = BRIDGE_ROUTES_DISCOVERY_LIMIT,
): Promise<BridgeTrustDisclosureRow[] | null> {
  const rowLimit = boundedBridgeRoutesLimit(limit);
  try {
    const response = await getApiClient()
      .get<unknown>("/bridge/routes", { limit: rowLimit })
      .catch(async () => {
        const rpc = getRpcClient() as unknown as BridgeRoutesRpcClient;
        if (typeof rpc.lythBridgeRoutes === "function") {
          return rpc.lythBridgeRoutes({ limit: rowLimit });
        }
        return rpc.call?.<unknown>("lyth_bridgeRoutes", [{ limit: rowLimit }]) ?? null;
      });
    return assessBridgeTrustDisclosures(bridgeRouteDiscoverySources(response, "bridgeRoutes"));
  } catch {
    return null;
  }
}

export function useBridgeRouteDisclosures(limit = BRIDGE_ROUTES_DISCOVERY_LIMIT) {
  const rowLimit = boundedBridgeRoutesLimit(limit);
  return useQuery<BridgeTrustDisclosureRow[] | null>({
    queryKey: QK.bridgeRoutes(rowLimit),
    enabled: isRpcConfigured(),
    queryFn: () => fetchBridgeRouteDisclosures(rowLimit),
    staleTime: 60_000,
  });
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
 * return no rows, so the wallet page keeps its local rows as a fallback.
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

export const NATIVE_MARKET_ORDER_BOOK_LEVELS_MAX = 32;
export const NATIVE_MARKET_ORDER_BOOK_REPLAY_LIMIT_MAX = 500;

export interface NativeMarketOrderBookReplayOptions {
  fromBlock?: number | bigint | string | null;
  toBlock?: number | bigint | string | null;
  cursor?: string | null;
  replayLimit?: number | null;
}

interface NativeMarketOrderBookReplayResponse {
  schemaVersion: number;
  replay: true;
  streamTopic: typeof NATIVE_MARKET_ORDER_BOOK_STREAM_TOPIC;
  deltas: NativeMarketOrderBookStreamPayload[];
  fromBlock?: number | string;
  toBlock?: number | string;
  cursor?: string | null;
  nextCursor?: string | null;
}

type NativeMarketOrderBookReplayQuery = Record<string, string | number | bigint | boolean | null | undefined>;

interface NativeMarketOrderBookSnapshot {
  book: ClobOrderBookResponse;
  latestHeight: number | null;
}

export function boundedNativeMarketOrderBookLevels(levels = 20): number {
  const requestedLevels = Number.isFinite(levels) ? Math.trunc(levels) : 20;
  return Math.max(1, Math.min(requestedLevels, NATIVE_MARKET_ORDER_BOOK_LEVELS_MAX));
}

function boundedNativeMarketOrderBookReplayLimit(limit: number | null | undefined): number {
  const requestedLimit = typeof limit === "number" && Number.isFinite(limit)
    ? Math.trunc(limit)
    : NATIVE_MARKET_ORDER_BOOK_REPLAY_LIMIT_MAX;
  return Math.max(1, Math.min(requestedLimit, NATIVE_MARKET_ORDER_BOOK_REPLAY_LIMIT_MAX));
}

function readReplayBlock(value: number | bigint | string | null | undefined): number | bigint | string | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : null;
  if (typeof value === "bigint") return value >= 0n ? value : null;
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function readApiEnvelopeHeight(envelope: ApiEnvelope<unknown>): number | null {
  const height = envelope.latest?.height;
  return typeof height === "number" && Number.isSafeInteger(height) && height >= 0 ? height : null;
}

async function fetchNativeMarketOrderBookSnapshot(
  marketId: string,
  depth: number,
): Promise<NativeMarketOrderBookSnapshot | null> {
  try {
    const envelope = await getApiClient()
      .marketOrderBook(marketId, depth)
      .catch(() => null);
    if (envelope !== null) {
      return {
        book: envelope.data,
        latestHeight: readApiEnvelopeHeight(envelope as ApiEnvelope<unknown>),
      };
    }
    const book = await getRpcClient().lythClobOrderBook(marketId, depth);
    return { book, latestHeight: null };
  } catch {
    return null;
  }
}

function normalizeNativeMarketOrderBookReplayResponse(
  response: ApiEnvelope<unknown>,
  marketId: string,
): NativeMarketOrderBookReplayResponse {
  const data = response.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("native market orderbook replay payload is malformed");
  }
  const row = data as Record<string, unknown>;
  const deltas = row.deltas;
  if (
    row.streamTopic !== NATIVE_MARKET_ORDER_BOOK_STREAM_TOPIC ||
    row.replay !== true ||
    !Array.isArray(deltas)
  ) {
    throw new Error("native market orderbook replay payload is malformed");
  }
  const validated: NativeMarketOrderBookStreamPayload[] = [];
  for (const delta of deltas) {
    if (!isNativeMarketOrderBookStreamPayload(delta) || delta.marketId !== marketId) {
      throw new Error("native market orderbook replay delta is malformed");
    }
    validated.push(delta);
  }
  return {
    schemaVersion: typeof row.schemaVersion === "number" ? row.schemaVersion : 1,
    replay: true,
    streamTopic: NATIVE_MARKET_ORDER_BOOK_STREAM_TOPIC,
    deltas: validated,
    fromBlock: typeof row.fromBlock === "number" || typeof row.fromBlock === "string" ? row.fromBlock : undefined,
    toBlock: typeof row.toBlock === "number" || typeof row.toBlock === "string" ? row.toBlock : undefined,
    cursor: typeof row.cursor === "string" ? row.cursor : row.cursor === null ? null : undefined,
    nextCursor: typeof row.nextCursor === "string" ? row.nextCursor : row.nextCursor === null ? null : undefined,
  };
}

export async function fetchNativeMarketOrderBookReplayDeltas(
  query: {
    marketId: string;
    fromBlock?: number | bigint | string | null;
    toBlock?: number | bigint | string | null;
    cursor?: string | null;
    limit?: number | null;
  },
): Promise<NativeMarketOrderBookReplayResponse> {
  const fromBlock = readReplayBlock(query.fromBlock);
  const toBlock = readReplayBlock(query.toBlock);
  const cursor = query.cursor?.trim() || null;
  const apiQuery: NativeMarketOrderBookReplayQuery = {
    marketId: query.marketId,
    fromBlock,
    toBlock,
    cursor,
    limit: boundedNativeMarketOrderBookReplayLimit(query.limit),
  };
  const response = await getApiClient().get<ApiEnvelope<unknown>>(
    "/native-market-orderbook-deltas",
    apiQuery,
  );
  return normalizeNativeMarketOrderBookReplayResponse(response, query.marketId);
}

function nativeMarketOrderBookSideKey(side: string | undefined): "bids" | "asks" | null {
  const normalized = side?.toLowerCase();
  if (normalized === "bid" || normalized === "buy") return "bids";
  if (normalized === "ask" || normalized === "sell") return "asks";
  return null;
}

function nativeMarketOrderBookLevelAmount(value: string | undefined): bigint | null {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  return BigInt(value);
}

function nativeMarketOrderBookLevelMap(
  levels: ClobOrderBookResponse["bids"],
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const level of levels) {
    const amount = nativeMarketOrderBookLevelAmount(level.size);
    if (amount === null) continue;
    out.set(level.price, (out.get(level.price) ?? 0n) + amount);
  }
  return out;
}

function addNativeMarketOrderBookLevel(
  levels: Map<string, bigint>,
  price: string,
  delta: bigint,
): void {
  const next = (levels.get(price) ?? 0n) + delta;
  if (next > 0n) {
    levels.set(price, next);
  } else {
    levels.delete(price);
  }
}

function compareQuantityStrings(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a === b ? 0 : a < b ? -1 : 1;
}

function nativeMarketOrderBookLevelsFromMap(
  levels: Map<string, bigint>,
  side: "bids" | "asks",
  depth: number,
): ClobOrderBookResponse["bids"] {
  return [...levels.entries()]
    .filter(([, size]) => size > 0n)
    .sort(([left], [right]) => side === "bids"
      ? compareQuantityStrings(right, left)
      : compareQuantityStrings(left, right))
    .slice(0, depth)
    .map(([price, size]) => ({ price, size: size.toString() }));
}

export function applyNativeMarketOrderBookDeltas(
  snapshot: ClobOrderBookResponse,
  deltas: readonly NativeMarketOrderBookStreamPayload[],
  levels = snapshot.levels ?? NATIVE_MARKET_ORDER_BOOK_LEVELS_MAX,
): ClobOrderBookResponse {
  const depth = boundedNativeMarketOrderBookLevels(levels);
  const books = {
    bids: nativeMarketOrderBookLevelMap(snapshot.bids),
    asks: nativeMarketOrderBookLevelMap(snapshot.asks),
  };
  const replayOrders = new Map<string, { side: "bids" | "asks"; price: string; remaining: bigint }>();

  for (const delta of deltas) {
    if (!isNativeMarketOrderBookStreamPayload(delta) || delta.marketId !== snapshot.marketId) {
      throw new Error("native market orderbook delta is malformed");
    }
    const side = nativeMarketOrderBookSideKey(delta.side);
    const price = delta.price;
    if (side === null || typeof price !== "string" || !/^(0|[1-9][0-9]*)$/.test(price)) continue;
    const previous = replayOrders.get(delta.orderId);
    const hadPrevious = previous !== undefined;
    if (previous) {
      addNativeMarketOrderBookLevel(books[previous.side], previous.price, -previous.remaining);
      replayOrders.delete(delta.orderId);
    }
    if (delta.action === "upsert") {
      const remaining = nativeMarketOrderBookLevelAmount(delta.remaining ?? delta.quantity);
      if (remaining === null || remaining === 0n) continue;
      replayOrders.set(delta.orderId, { side, price, remaining });
      addNativeMarketOrderBookLevel(books[side], price, remaining);
    } else if (!hadPrevious) {
      const removed = nativeMarketOrderBookLevelAmount(delta.quantity);
      if (removed !== null && removed > 0n) {
        addNativeMarketOrderBookLevel(books[side], price, -removed);
      }
    }
  }

  return {
    ...snapshot,
    levels: depth,
    bids: nativeMarketOrderBookLevelsFromMap(books.bids, "bids", depth),
    asks: nativeMarketOrderBookLevelsFromMap(books.asks, "asks", depth),
  };
}

function nativeMarketOrderBookReplayQuery(
  marketId: string,
  snapshotHeight: number | null,
  options: NativeMarketOrderBookReplayOptions = {},
): { marketId: string; fromBlock?: number | bigint | string | null; toBlock?: number | bigint | string | null; cursor?: string | null; limit?: number | null } | null {
  const cursor = options.cursor?.trim() || null;
  const explicitFromBlock = readReplayBlock(options.fromBlock);
  const toBlock = readReplayBlock(options.toBlock);
  const fromBlock = explicitFromBlock ?? (
    typeof snapshotHeight === "number" && toBlock !== null
      ? snapshotHeight + 1
      : null
  );
  if (cursor === null && (fromBlock === null || toBlock === null)) return null;
  if (
    cursor === null &&
    typeof fromBlock === "number" &&
    typeof toBlock === "number" &&
    fromBlock > toBlock
  ) {
    return null;
  }
  return {
    marketId,
    fromBlock,
    toBlock,
    cursor,
    limit: options.replayLimit,
  };
}

export async function fetchNativeMarketOrderBook(
  marketId: string,
  levels = 20,
  replayOptions: NativeMarketOrderBookReplayOptions = {},
): Promise<ClobOrderBookResponse | null> {
  const depth = boundedNativeMarketOrderBookLevels(levels);
  const snapshot = await fetchNativeMarketOrderBookSnapshot(marketId, depth);
  if (snapshot === null) {
    return null;
  }
  const replayQuery = nativeMarketOrderBookReplayQuery(marketId, snapshot.latestHeight, replayOptions);
  if (replayQuery === null) return snapshot.book;
  try {
    const replay = await fetchNativeMarketOrderBookReplayDeltas(replayQuery);
    return applyNativeMarketOrderBookDeltas(snapshot.book, replay.deltas, depth);
  } catch {
    return snapshot.book;
  }
}

export function useNativeMarketOrderBook(
  marketId: string | undefined,
  levels = 20,
  replayOptions: NativeMarketOrderBookReplayOptions = {},
) {
  const depth = boundedNativeMarketOrderBookLevels(levels);
  const fromBlock = readReplayBlock(replayOptions.fromBlock);
  const toBlock = readReplayBlock(replayOptions.toBlock);
  const cursor = replayOptions.cursor?.trim() || null;
  return useQuery<ClobOrderBookResponse | null>({
    queryKey: QK.nativeMarketOrderBook(marketId ?? "", depth, fromBlock, toBlock, cursor),
    enabled: Boolean(marketId) && isRpcConfigured(),
    queryFn: async () => fetchNativeMarketOrderBook(marketId as string, depth, replayOptions),
    staleTime: 10_000,
  });
}

/** CLOB precompile (0x1001) order book depth via `lyth_clobOrderBook`.
 *
 *  The native_spot_markets system at `lyth_nativeMarketOrderBook` is a
 *  separate market layer; conflating them via `useNativeMarketOrderBook`
 *  was a documentation bug — the CLOB has its own depth RPC and the
 *  market detail page should hit that one. */
export function useClobOrderBook(marketId: string | undefined, levels = 20) {
  const depth = Math.max(1, Math.min(50, Math.trunc(levels)));
  return useQuery<ClobOrderBookResponse | null>({
    queryKey: QK.clobOrderBook(marketId ?? "", depth),
    enabled: Boolean(marketId) && isRpcConfigured(),
    queryFn: async () => {
      const rpc = getRpcClient() as { call?: <T>(method: string, params: unknown[]) => Promise<T> };
      if (typeof rpc.call !== "function") return null;
      try {
        return await rpc.call<ClobOrderBookResponse>("lyth_clobOrderBook", [
          marketId as string,
          depth,
        ]);
      } catch (err) {
        // -32601 method-not-found means the chain is older than the
        // RPC surface; surface null so the consumer falls back to the
        // best-bid/ask single-tick view rather than crashing.
        if (
          err instanceof Error &&
          /-32601|method not found/i.test(err.message)
        ) {
          return null;
        }
        throw err;
      }
    },
    staleTime: 5_000,
  });
}

export const NATIVE_MARKET_EVENTS_LIMIT = 25;
export const NATIVE_MARKET_EVENTS_BLOCK_WINDOW = 2_048;

interface NativeMarketEventsApiEnvelope {
  data: NativeEventsResponse<unknown>;
}

interface NativeMarketStateApiEnvelope {
  data: NativeMarketStateResponse;
}

type NativeMarketEventsQuery = Record<string, string | number | bigint | boolean | null | undefined>;

function boundedNativeMarketEventFilter(
  toBlock: number,
  limit = NATIVE_MARKET_EVENTS_LIMIT,
  blockWindow = NATIVE_MARKET_EVENTS_BLOCK_WINDOW,
  primaryId?: string | null,
  eventName?: string | null,
): NativeEventsFilter {
  const boundedTo = Math.max(0, Math.trunc(toBlock));
  const boundedWindow = Math.max(1, Math.min(Math.trunc(blockWindow), 100_000));
  const rowLimit = Math.max(1, Math.min(Math.trunc(limit), 200));
  return {
    fromBlock: Math.max(0, boundedTo - boundedWindow + 1),
    toBlock: boundedTo,
    limit: rowLimit,
    primaryId: primaryId ?? null,
    eventName: eventName ?? null,
  };
}

export async function fetchNativeMarketEvents(
  filter: NativeEventsFilter,
): Promise<NativeEventsResponse<unknown> | null> {
  const query = filter as unknown as NativeMarketEventsQuery;
  try {
    return await getApiClient()
      .get<NativeMarketEventsApiEnvelope>("/native-market-events", query)
      .then((response) => response.data)
      .catch(() => getRpcClient().call<NativeEventsResponse<unknown>>("lyth_nativeMarketEvents", [filter]));
  } catch {
    return null;
  }
}

export function useNativeMarketEvents(options: {
  latestBlock: number | null | undefined;
  limit?: number;
  blockWindow?: number;
  primaryId?: string | null;
  eventName?: string | null;
}) {
  const latestBlock = typeof options.latestBlock === "number" && Number.isFinite(options.latestBlock)
    ? Math.trunc(options.latestBlock)
    : null;
  const filter = latestBlock === null
    ? null
    : boundedNativeMarketEventFilter(
        latestBlock,
        options.limit ?? NATIVE_MARKET_EVENTS_LIMIT,
        options.blockWindow ?? NATIVE_MARKET_EVENTS_BLOCK_WINDOW,
        options.primaryId ?? null,
        options.eventName ?? null,
      );
  const rowLimit = Number(filter?.limit ?? NATIVE_MARKET_EVENTS_LIMIT);

  return useQuery<NativeEventsResponse<unknown> | null>({
    queryKey: QK.nativeMarketEvents(
      filter?.fromBlock?.toString() ?? "pending",
      filter?.toBlock?.toString() ?? "pending",
      rowLimit,
      options.primaryId ?? null,
      options.eventName ?? null,
    ),
    enabled: filter !== null && isRpcConfigured(),
    queryFn: async () => fetchNativeMarketEvents(filter as NativeEventsFilter),
    staleTime: 15_000,
  });
}

export type NativeAgentStateLookup = Pick<
  NativeAgentStateFilter,
  "policyId" | "escrowId" | "account" | "includePolicySpends" | "limit"
> & {
  enabled?: boolean;
};

function nativeAgentStateFilterForNode(filter: NativeAgentStateLookup = {}): NativeAgentStateFilter {
  const policyId = filter.policyId ?? null;
  const escrowId = filter.escrowId ?? null;
  const account = policyId === null && escrowId === null ? filter.account ?? null : null;
  const canIncludePolicySpends = policyId !== null || account !== null;
  return {
    ...(policyId !== null ? { policyId } : {}),
    ...(escrowId !== null ? { escrowId } : {}),
    ...(account !== null ? { account } : {}),
    ...(canIncludePolicySpends && filter.includePolicySpends !== undefined
      ? { includePolicySpends: filter.includePolicySpends }
      : {}),
    ...(filter.limit !== undefined ? { limit: filter.limit } : {}),
  };
}

export async function fetchNativeAgentState(
  filter: NativeAgentStateLookup = {},
): Promise<NativeAgentStateResponse | null> {
  const query = nativeAgentStateFilterForNode(filter);
  try {
    return await getApiClient()
      .nativeAgentState(query)
      .then((response) => response.data)
      .catch(() => getRpcClient().lythNativeAgentState(query));
  } catch {
    return null;
  }
}

export function useNativeAgentState(options: NativeAgentStateLookup = {}) {
  const limit = typeof options.limit === "number" && Number.isFinite(options.limit)
    ? Math.max(1, Math.min(Math.trunc(options.limit), 100))
    : 25;
  const filter = nativeAgentStateFilterForNode({ ...options, limit });
  return useQuery<NativeAgentStateResponse | null>({
    queryKey: QK.nativeAgentState(
      filter.policyId ?? null,
      filter.escrowId ?? null,
      filter.account ?? null,
      limit,
    ),
    enabled: options.enabled !== false && isRpcConfigured(),
    queryFn: async () => fetchNativeAgentState(filter),
    staleTime: 15_000,
  });
}

export async function fetchNativeMarketState(
  filter: { primaryId?: string | null; account?: string | null } = {},
): Promise<NativeMarketStateResponse | null> {
  const query = {
    ...(filter.primaryId ? { primaryId: filter.primaryId } : {}),
    ...(filter.account ? { account: filter.account } : {}),
  };
  try {
    return await getApiClient()
      .get<NativeMarketStateApiEnvelope>("/native-market-state", query)
      .then((response) => response.data)
      .catch(() => getRpcClient().call<NativeMarketStateResponse>("lyth_nativeMarketState", [filter]));
  } catch {
    return null;
  }
}

export function useNativeMarketState(options: { primaryId?: string | null } = {}) {
  const primaryId = options.primaryId ?? null;
  return useQuery<NativeMarketStateResponse | null>({
    queryKey: QK.nativeMarketState(primaryId),
    enabled: isRpcConfigured(),
    queryFn: async () => fetchNativeMarketState(primaryId ? { primaryId } : {}),
    staleTime: 15_000,
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
 * indexer height); the rest of the Stats page uses local fallback rows until
 * a retained aggregate counter view is available.
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
/* Some deployments expose subscription transport; polling remains the default. */
/* is HTTP-only and rejects with an RPC error. The flag is wired here so       */
/* the swap is a one-line change inside this helper plus an env-var flip       */
/* — the rest of the codebase already routes through `useChainHead`.           */
/* -------------------------------------------------------------------------- */

async function readLatestHeadFromWebSocket(): Promise<ChainHead | null> {
  // This build has no subscription cache. Throw so React-Query surfaces the
  // error and auto-retry policies kick in; consumers degrade through their
  // existing local fallbacks.
  throw new Error(
    "WebSocket head stream is not configured. " +
      "Disable VITE_MONOSCAN_USE_WS or wait for the WS upgrade.",
  );
}

/* ==========================================================================
 * New-surface hooks (PF-6 / MB-6 / PF-4 / MB-5 / MB-4 / MB-2)
 *
 * Each hook calls the live `lyth_*` read method published in
 * `@monolythium/core-sdk` 0.3.10 through the SDK client, resolving the node
 * via `sdk/client.ts`. When RPC is unconfigured, a method errors, or the
 * chain returns the `{ status: "indexer_unavailable" }` graceful fallback,
 * the hook degrades to the `data/fallback.ts` fixture (clearly a fixture, not
 * fabricated live data) so the surface still renders. All SDK-type coupling
 * lives in `sdk/surfaces.ts` (re-exports + view-model adapters); the page
 * components consume the view-models unchanged.
 * ========================================================================== */

import {
  BRIDGE_ROUTE_HEALTH,
  CLUSTER_DIRECTORY,
  CLUSTER_DIVERSITY,
  ORACLE_DASHBOARD,
  PROVER_MARKET,
  SPENDING_POLICIES,
} from "./fallback";
import {
  diversityScoreFromView,
  normalizeHostingClass,
  type BridgeBreakerState,
  type BridgeRouteHealth,
  type ClusterDirectory,
  type ClusterDirectoryEntry,
  type ClusterDiversityRollup,
  type ClusterFormationStatus,
  type OperatorNetworkMetadataRow,
  type OracleDashboard,
  type OracleFeed,
  type OracleSigner,
  type ProofRequest,
  type ProverBid,
  type ProverMarket,
  type SpendingPolicyDimensions,
} from "../sdk/surfaces";
import type {
  BridgeHealthRecord,
  OracleFeedConfig,
  OracleLatestPrice,
  OracleSignerRow,
  ProofRequestRow,
  ProverBidView,
  SpendingPolicyView,
} from "@monolythium/core-sdk";

/* -------------------------------------------------------------------------- */
/* v5-surface SDK-method type augmentations.                                   */
/*                                                                             */
/* The SDK 0.3.10 RpcClient declares the v5 read methods; we widen the local   */
/* `RpcClient` reference so call sites stay typed without depending on the     */
/* exact published method-name list. Every method is invoked through a         */
/* `try/catch` that degrades to the fixture, so an absent method on an older   */
/* node simply falls back.                                                     */
/* -------------------------------------------------------------------------- */

const ZERO_HASH = `0x${"00".repeat(32)}`;

/** `0x0`/empty/all-zero → null; otherwise the raw value. Used for cap fields. */
function nonZeroOrNull(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    return BigInt(raw) === 0n ? null : raw;
  } catch {
    return raw === ZERO_HASH ? null : raw;
  }
}

/** `0x`-hex (or decimal) uint256 → decimal string; `null` passes through. */
function toDecimalString(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    return BigInt(raw).toString(10);
  } catch {
    return raw;
  }
}

function isIndexerUnavailable(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { status?: string }).status === "indexer_unavailable"
  );
}

/* ----------------------------- PF-6 diversity ----------------------------- */

/** Resolve one operator's network metadata into the rendered row. */
async function readOperatorMetadataRow(
  rpc: ReturnType<typeof getRpcClient>,
  operatorId: string,
): Promise<OperatorNetworkMetadataRow | null> {
  try {
    const md = await rpc.lythGetOperatorNetworkMetadata(operatorId);
    return {
      operatorId: md.operatorId ?? operatorId,
      asn: md.asn ?? 0,
      geoRegion: md.geoRegion ?? "",
      hostingClass: normalizeHostingClass(md.hostingClass),
      pcrDigest: md.pcrDigest ?? ZERO_HASH,
    };
  } catch {
    return null;
  }
}

/**
 * Build the diversity rollup for one cluster from the live SDK: the flat
 * `lyth_getClusterDiversity` view + the cluster's roster operator ids from
 * `lyth_clusterStatus` (fanned out to `lyth_getOperatorNetworkMetadata`).
 */
async function readClusterDiversity(
  clusterId: number,
): Promise<ClusterDiversityRollup | null> {
  if (!isRpcConfigured()) {
    return CLUSTER_DIVERSITY.find((v) => v.diversity.clusterId === clusterId) ?? null;
  }
  try {
    const rpc = getRpcClient();
    const view = await rpc.lythGetClusterDiversity(clusterId);
    let operators: OperatorNetworkMetadataRow[] = [];
    let resolvedMembers = 0;
    try {
      const status: ClusterStatusResponse = await rpc.lythClusterStatus(clusterId);
      const members = status.members ?? [];
      resolvedMembers = members.length;
      const rows = await Promise.all(
        members.map((m) => readOperatorMetadataRow(rpc, m.operatorId)),
      );
      operators = rows.filter((r): r is OperatorNetworkMetadataRow => r !== null);
    } catch {
      operators = [];
    }
    return {
      diversity: diversityScoreFromView(view, resolvedMembers || operators.length),
      operators,
    };
  } catch {
    return CLUSTER_DIVERSITY.find((v) => v.diversity.clusterId === clusterId) ?? null;
  }
}

/**
 * PF-6 — cluster network-diversity score + per-operator metadata. Live:
 * `lyth_getClusterDiversity` + `lyth_clusterStatus` +
 * `lyth_getOperatorNetworkMetadata`. Falls back to the `CLUSTER_DIVERSITY`
 * fixture when RPC is unconfigured or the method is unavailable.
 */
export function useClusterDiversity(clusterId: number | undefined) {
  return useQuery<ClusterDiversityRollup | null>({
    queryKey: QK.clusterDiversity(clusterId ?? ""),
    enabled: clusterId !== undefined,
    queryFn: () => readClusterDiversity(clusterId as number),
    staleTime: 60_000,
  });
}

/**
 * PF-6 — the full diversity set for the index view. Fans `lyth_getClusterDiversity`
 * out over the live `lyth_clusterDirectory` ids; falls back to the fixture set
 * when RPC is unconfigured or the directory cannot be read.
 */
export function useClusterDiversitySet() {
  return useQuery<ClusterDiversityRollup[] | null>({
    queryKey: QK.clusterDiversitySet(),
    queryFn: async () => {
      if (!isRpcConfigured()) return CLUSTER_DIVERSITY;
      try {
        const rpc = getRpcClient();
        const directory = await getApiClient()
          .clusters(0, 100)
          .then((r) => r.data.clusters)
          .catch(() => rpc.lythClusterDirectory(0, 100));
        const ids = (directory.clusters ?? [])
          .map((c) => c.clusterId)
          .filter((id): id is number => typeof id === "number")
          .slice(0, 50);
        // Live directory read succeeded but the chain has no clusters yet —
        // render the real empty state, never the fixture set.
        if (ids.length === 0) return [];
        const rows = await Promise.all(
          ids.map(async (id): Promise<ClusterDiversityRollup | null> => {
            try {
              const view = await rpc.lythGetClusterDiversity(id);
              return {
                diversity: diversityScoreFromView(view, 0),
                operators: [],
              };
            } catch {
              return null;
            }
          }),
        );
        return rows.filter((r): r is ClusterDiversityRollup => r !== null);
      } catch {
        return CLUSTER_DIVERSITY;
      }
    },
    staleTime: 60_000,
  });
}

/* ------------------------------- MB-6 oracle ------------------------------ */

function oracleSignerFromRow(row: OracleSignerRow): OracleSigner {
  return {
    address: row.writer,
    servesOracleWriter: true,
    feeds: [],
    bond: null,
  };
}

function oracleFeedFromConfig(
  cfg: OracleFeedConfig,
  price: OracleLatestPrice | null,
): OracleFeed {
  return {
    feedId: cfg.feedId,
    label: null,
    decimals: cfg.decimals,
    minSigners: cfg.minSigners,
    allowedWritersLen: cfg.allowedWritersLen,
    heartbeatSecs: cfg.heartbeatSeconds,
    deviationBps: cfg.deviationBps,
    latestRoundId: price && price.round > 0 ? price.round : null,
    latestMedian: price?.median ?? null,
    finalizedAtBlock: price?.finalizedAtBlock ?? null,
    observationsLen: null,
  };
}

/**
 * MB-6 — oracle dashboard: signer roster + configured feeds + latest medians.
 *
 * Live: `lyth_oracleSigners` (global writer roster). The fixture supplies the
 * feed catalogue (the chain has no "list every feed" method — feeds are read
 * per-id via `lyth_oracleFeedConfig` + `lyth_oracleLatestPrice`), so monoscan
 * enriches each known feed id with the live config/price and otherwise falls
 * back. When the signer projection is unavailable
 * (`{ status: "indexer_unavailable" }`) the signer roster degrades to the
 * fixture.
 */
export function useOracleDashboard() {
  return useQuery<OracleDashboard | null>({
    queryKey: QK.oracleDashboard(),
    queryFn: async () => {
      if (!isRpcConfigured()) return ORACLE_DASHBOARD;
      try {
        const rpc = getRpcClient();
        // On a live chain the signer roster is whatever the chain reports —
        // empty if no signers are authorized. The fixture roster is never
        // surfaced as live data; an unavailable projection degrades to [].
        let signers: OracleSigner[] = [];
        try {
          const roster = await rpc.lythOracleSigners();
          if (!isIndexerUnavailable(roster)) {
            signers = roster.writers.map(oracleSignerFromRow);
          }
        } catch {
          // projection unavailable — leave the live roster empty, not fixtures
        }
        // The chain has no "list every feed" method, so we probe the known feed
        // ids with the live per-feed config read. A feed id with no live config
        // (read throws) is dropped — it is not seeded from the fixture. The
        // fixture only contributes the human label for ids that DO resolve live.
        const feedProbes: Array<OracleFeed | null> = await Promise.all(
          ORACLE_DASHBOARD.feeds.map(async (fixtureFeed) => {
            try {
              const [cfg, price] = await Promise.all([
                rpc.lythOracleFeedConfig(fixtureFeed.feedId),
                rpc.lythOracleLatestPrice(fixtureFeed.feedId).catch(() => null),
              ]);
              const feed = oracleFeedFromConfig(cfg, price);
              // Preserve the human label the fixture knows for the feed id.
              feed.label = fixtureFeed.label;
              feed.observationsLen = price ? fixtureFeed.observationsLen : null;
              return feed;
            } catch {
              return null;
            }
          }),
        );
        const feeds: OracleFeed[] = feedProbes.filter((f): f is OracleFeed => f !== null);
        // No live "oracle admin" read on this surface; the fixture admin is not
        // surfaced as live data, so it renders unset on a live chain.
        return { signers, feeds, admin: null };
      } catch {
        return ORACLE_DASHBOARD;
      }
    },
    staleTime: 30_000,
  });
}

/* --------------------------- PF-4 spending policy ------------------------- */

function spendingPolicyFromView(view: SpendingPolicyView): SpendingPolicyDimensions {
  return {
    subAccount: view.address,
    configured: view.exists,
    disabled: view.exists && !view.enabled,
    perTxCapLythoshi: nonZeroOrNull(view.perTxCap),
    dailyCapLythoshi: nonZeroOrNull(view.dailyCap),
    weeklyCapLythoshi: nonZeroOrNull(view.weeklyCap),
    monthlyCapLythoshi: nonZeroOrNull(view.monthlyCap),
    // The §18.8 read shape carries no per-window spend counters.
    dailySpentLythoshi: null,
    weeklySpentLythoshi: null,
    monthlySpentLythoshi: null,
    categoryAllowRoot:
      view.categoryAllowRoot && view.categoryAllowRoot !== ZERO_HASH
        ? view.categoryAllowRoot
        : null,
    destinationAllowRoot:
      view.destinationAllowRoot && view.destinationAllowRoot !== ZERO_HASH
        ? view.destinationAllowRoot
        : null,
    timeWindow: view.timeOfDayWindow
      ? {
          enabled: view.timeOfDayWindow.enabled,
          startHour: view.timeOfDayWindow.startHour,
          endHour: view.timeOfDayWindow.endHour,
        }
      : null,
    expiryUnixSecs: view.expiryUnixSeconds,
    policyVersion: view.version,
  };
}

/**
 * PF-4 — §18.8 spending-policy dimensions for one agent sub-account. Live:
 * `lyth_getSpendingPolicy`. Returns `null` (the card renders the unconfigured
 * state) when the policy does not exist; falls back to the fixture when RPC is
 * unconfigured or the read errors.
 */
export function useSpendingPolicy(addr: string | undefined) {
  return useQuery<SpendingPolicyDimensions | null>({
    queryKey: QK.spendingPolicy(addr ?? ""),
    enabled: Boolean(addr),
    queryFn: async () => {
      if (!addr) return null;
      if (!isRpcConfigured()) return SPENDING_POLICIES[addr] ?? null;
      try {
        const view = await getRpcClient().lythGetSpendingPolicy(addr);
        if (!view.exists) return null;
        return spendingPolicyFromView(view);
      } catch {
        return SPENDING_POLICIES[addr] ?? null;
      }
    },
    staleTime: 30_000,
  });
}

/* --------------------------- MB-5 cluster directory ----------------------- */

function directoryStatusFromEntry(
  entry: ClusterDirectoryEntryResponse,
  status: ClusterStatusResponse | null,
): ClusterFormationStatus {
  if (!entry.active) return "retired";
  if (status && status.live < status.threshold) return "draining";
  return "active";
}

function directoryEntryToView(
  entry: ClusterDirectoryEntryResponse,
  status: ClusterStatusResponse | null,
): ClusterDirectoryEntry {
  const size = status?.size ?? entry.size;
  const threshold = status?.threshold ?? entry.threshold;
  const roster = (status?.members ?? []).map((m) => m.blsPubkey).filter(Boolean);
  const epoch = status?.epoch != null ? Number(status.epoch) : 0;
  return {
    clusterId: entry.clusterId,
    effectiveEpoch: epoch,
    // The directory page carries no anchor address; surface the id-derived
    // placeholder until a node retains the ClusterFormed anchor.
    anchorAddress: "",
    roster,
    liveMembers: status?.live ?? size,
    size,
    threshold,
    status: directoryStatusFromEntry(entry, status),
    formedAtBlock: status?.lastUpdateHeight != null ? Number(status.lastUpdateHeight) : null,
  };
}

/**
 * MB-5 — cluster directory: roster, anchor, effective epoch, formation status.
 *
 * Live: `lyth_clusterDirectory` (the compact descriptor page) joined with
 * `lyth_clusterStatus` per cluster for roster + threshold + epoch. Falls back
 * to the `CLUSTER_DIRECTORY` fixture when RPC is unconfigured or the directory
 * cannot be read.
 */
export function useClusterDirectory() {
  return useQuery<ClusterDirectory | null>({
    queryKey: QK.clusterDirectory(),
    queryFn: async () => {
      if (!isRpcConfigured()) return CLUSTER_DIRECTORY;
      try {
        const rpc = getRpcClient();
        const page = await getApiClient()
          .clusters(0, 100)
          .then((r) => r.data.clusters)
          .catch(() => rpc.lythClusterDirectory(0, 100));
        const entries = page.clusters ?? [];
        // Live directory read succeeded but the chain has formed no clusters —
        // render the real empty state, never the fixture directory.
        if (entries.length === 0) return { clusters: [], currentEpoch: null };
        const capped = entries.slice(0, 50);
        const clusters = await Promise.all(
          capped.map(async (entry) => {
            let status: ClusterStatusResponse | null = null;
            try {
              status = await getApiClient()
                .cluster(entry.clusterId)
                .then((r) => apiClusterStatusToRpcStatus(r.data.cluster))
                .catch(() => rpc.lythClusterStatus(entry.clusterId));
            } catch {
              status = null;
            }
            return directoryEntryToView(entry, status);
          }),
        );
        const currentEpoch =
          clusters.map((c) => c.effectiveEpoch).filter((e) => e > 0).sort((a, b) => b - a)[0] ??
          CLUSTER_DIRECTORY.currentEpoch;
        return { clusters, currentEpoch };
      } catch {
        return CLUSTER_DIRECTORY;
      }
    },
    staleTime: 30_000,
  });
}

/* ----------------------------- MB-4 prover market ------------------------- */

function proofRequestFromRow(row: ProofRequestRow): ProofRequest {
  return {
    id: row.requestId,
    buyer: row.buyer,
    vkeyHash: row.vkeyHash,
    maxFee: toDecimalString(row.maxFee) ?? "0",
    deadline: row.deadlineUnixSeconds,
    state: row.state,
    assignedProver: row.assignedProver,
    winningFee: toDecimalString(row.winningFee),
  };
}

function proverBidFromView(requestId: string, bid: ProverBidView): ProverBid {
  return {
    requestId,
    prover: bid.prover,
    fee: toDecimalString(bid.fee) ?? "0",
  };
}

/**
 * MB-4 — prover market: open requests, bids, registered provers.
 *
 * Live: `lyth_listProofRequests` (indexer projection) for the request rows +
 * `lyth_getProverBids` per request for the live bid book. The registered-prover
 * roster has no list method (provers are discovered by capability bit), so it
 * is supplied by the fixture. When the projection is unavailable
 * (`{ status: "indexer_unavailable" }`) or RPC is unconfigured the whole market
 * degrades to the `PROVER_MARKET` fixture.
 */
export function useProverMarket() {
  return useQuery<ProverMarket | null>({
    queryKey: QK.proverMarket(),
    queryFn: async () => {
      if (!isRpcConfigured()) return PROVER_MARKET;
      try {
        const rpc = getRpcClient();
        const list = await rpc.lythListProofRequests(null, 50);
        if (isIndexerUnavailable(list)) return PROVER_MARKET;
        const requests = (list.requests ?? []).map(proofRequestFromRow);
        // The live projection responded. There is no on-chain "list provers"
        // method (provers are discovered by capability bit), so on a live chain
        // the registered-prover roster renders empty rather than seeding the
        // fixture — showing fixture provers next to a real (possibly empty)
        // request book would misrepresent live state.
        if (requests.length === 0) {
          return { requests: [], bids: [], provers: [] };
        }
        const bidLists = await Promise.all(
          requests
            .filter((r) => r.state === "open" || r.state === "assigned")
            .map(async (r) => {
              try {
                const res = await rpc.lythGetProverBids(r.id);
                return (res.bids ?? []).map((b) => proverBidFromView(r.id, b));
              } catch {
                return [] as ProverBid[];
              }
            }),
        );
        const bids = bidLists.flat();
        return { requests, bids, provers: [] };
      } catch {
        return PROVER_MARKET;
      }
    },
    staleTime: 30_000,
  });
}

/* ----------------------------- MB-2 bridge health ------------------------- */

function bridgeRouteFromRecord(
  record: BridgeHealthRecord,
  drained: string | null,
  asset: string,
): BridgeRouteHealth {
  const cb = record.circuitBreaker;
  const cap = nonZeroOrNull(toDecimalString(cb.defaultDrainCapPerWindow));
  const drainedDec = toDecimalString(drained) ?? "0";
  let remaining: string | null = null;
  let proximity: number | null = null;
  if (cap !== null) {
    const capBig = BigInt(cap);
    const drainedBig = BigInt(drainedDec);
    const rem = capBig > drainedBig ? capBig - drainedBig : 0n;
    remaining = rem.toString(10);
    proximity = capBig > 0n ? Math.min(1, Number((drainedBig * 10000n) / capBig) / 10000) : null;
  }
  const breaker: BridgeBreakerState =
    cap === null ? "disabled" : cb.paused ? "paused" : "armed";
  return {
    bridgeId: record.bridgeId,
    asset,
    drainedThisBucket: drainedDec,
    capPerWindow: cap,
    remaining,
    proximity,
    windowBlocks: cb.defaultDrainWindowBlocks,
    breaker,
    pausedAtBlock: cb.pausedAtBlock,
    resumeCooldownBlocks: cb.resumeCooldownBlocks,
    pausedReason: null,
  };
}

/**
 * MB-2 — per-route bridge health: drain-cap proximity + circuit-breaker state.
 *
 * Live: `lyth_bridgeHealth` (the paged global bridge set; each record carries
 * the circuit-breaker posture). The bridge id alone does not name the wrapped
 * asset, so the rendered `asset` falls back to a short bridge-id label. Falls
 * back to the `BRIDGE_ROUTE_HEALTH` fixture when RPC is unconfigured or the
 * read errors.
 */
export function useBridgeRouteHealth() {
  return useQuery<BridgeRouteHealth[] | null>({
    queryKey: QK.bridgeRouteHealth(),
    queryFn: async () => {
      if (!isRpcConfigured()) return BRIDGE_ROUTE_HEALTH;
      try {
        const rpc = getRpcClient();
        const health = await rpc.lythBridgeHealth(null, 50);
        const records = health.records ?? [];
        // Live bridge-health read succeeded but no routes are registered —
        // render the real empty state, never the fixture routes.
        if (records.length === 0) return [];
        return records.map((record) => {
          const assetLabel = `${record.bridgeId.slice(0, 10)}…`;
          // `lyth_bridgeHealth` carries the bridge-default cap/window + breaker
          // posture; the live per-asset drain bucket needs a wrapped-asset id
          // (`lyth_bridgeDrainStatus`) that the health page does not name, so
          // the rendered bucket starts at 0 and shows the bridge-default cap.
          return bridgeRouteFromRecord(record, "0", assetLabel);
        });
      } catch {
        return BRIDGE_ROUTE_HEALTH;
      }
    },
    staleTime: 30_000,
  });
}
