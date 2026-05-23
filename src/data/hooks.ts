/**
 * React-Query hooks for monoscan.
 *
 * Single seam through which every page reads chain data. Hooks return
 * already-typed values from `@monolythium/core-sdk`; mock fallbacks live
 * in `./mock` and stay tagged `TODO(monolythium)` for list-level
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
import { keccak256 } from "ethers/crypto";
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
  type NativeEventsFilter,
  type NativeEventsResponse,
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
  asset: string;
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

export const MRV_NATIVE_TX_EXTENSION_KIND = 0x30;
export const MRV_NATIVE_TX_EXTENSION_BODY_HEX = "0x01";
export const MRV_NATIVE_RECEIPT_TX_TYPE = 0x41;
export const NO_EVM_RECEIPT_PROOF_SCHEMA = "mono.no_evm_receipt_proof.v1";
export const NO_EVM_RECEIPT_PROOF_TYPE = "canonicalReceiptsTranscript";
export const NO_EVM_RECEIPTS_ROOT_DOMAIN = "monolythium/v2/receipts_root/1";
export const NO_EVM_RECEIPTS_ROOT_ALGORITHM = `keccak256("${NO_EVM_RECEIPTS_ROOT_DOMAIN}" || receipts_len_u32_le || (idx_u32_le || receipt_len_u32_le || receipt_bytes)*)`;

const HEX_BYTES_RE = /^0x(?:[0-9a-fA-F]{2})*$/;
const HASH32_RE = /^0x[0-9a-fA-F]{64}$/;
const U32_MAX = 0xffff_ffff;
const textEncoder = new TextEncoder();

export type MrvNativeEvidenceState = "present" | "missing" | "invalid";

export interface MrvNativeExtensionEvidence {
  kind: number;
  bodyHex: string | null;
  source: string;
  validMrvV1: boolean;
}

export interface NoEvmReceiptProofTranscript {
  schema: typeof NO_EVM_RECEIPT_PROOF_SCHEMA;
  proofType: typeof NO_EVM_RECEIPT_PROOF_TYPE;
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
}

export type NoEvmReceiptProofConsistencyState = "verified" | "mismatch";

export interface NoEvmReceiptProofConsistency {
  state: NoEvmReceiptProofConsistencyState;
  computedReceiptsRoot: string;
  computedTargetReceiptHash: string | null;
  receiptCountMatches: boolean;
  targetReceiptAvailable: boolean;
  mismatches: string[];
}

export interface MrvNativeProofEvidence {
  source: string;
  summary: string;
  raw: unknown;
  transcript: NoEvmReceiptProofTranscript | null;
  consistency: NoEvmReceiptProofConsistency | null;
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
  key: keyof NoEvmReceiptProofTranscript,
  errors: string[],
): string | null {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(`${key} missing`);
    return null;
  }
  return value.trim();
}

function readTranscriptHash32(
  row: Record<string, unknown>,
  key: keyof NoEvmReceiptProofTranscript,
  errors: string[],
): string | null {
  const value = readTranscriptString(row, key, errors);
  if (value !== null && !HASH32_RE.test(value)) {
    errors.push(`${key} must be a 32-byte 0x hex value`);
  }
  return value;
}

function readTranscriptNumber(
  row: Record<string, unknown>,
  key: keyof NoEvmReceiptProofTranscript,
  errors: string[],
): number | null {
  const value = readNumberField(row, [key]);
  if (value === null) {
    errors.push(`${key} missing`);
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    errors.push(`${key} must be a non-negative integer`);
  }
  return value;
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

function computeNoEvmReceiptsRoot(receipts: Uint8Array[]): string {
  const rootParts = [
    textEncoder.encode(NO_EVM_RECEIPTS_ROOT_DOMAIN),
    u32Le(receipts.length),
  ];
  for (let index = 0; index < receipts.length; index += 1) {
    rootParts.push(u32Le(index), u32Le(receipts[index].length), receipts[index]);
  }
  return keccak256(concatUint8Arrays(rootParts));
}

export function verifyNoEvmReceiptProofConsistency(
  transcript: NoEvmReceiptProofTranscript,
): NoEvmReceiptProofConsistency {
  const receiptBytes = transcript.receiptTranscript.map(hexBytesToUint8Array);
  const decodedReceipts = receiptBytes.filter((receipt): receipt is Uint8Array => receipt !== null);
  const computedReceiptsRoot = computeNoEvmReceiptsRoot(decodedReceipts);
  const computedTargetReceiptHash = decodedReceipts[transcript.txIndex]
    ? keccak256(decodedReceipts[transcript.txIndex])
    : null;
  const receiptCountMatches = transcript.receiptCount === transcript.receiptTranscript.length;
  const targetReceiptAvailable = computedTargetReceiptHash !== null;
  const mismatches: string[] = [];

  if (transcript.rootAlgorithm !== NO_EVM_RECEIPTS_ROOT_ALGORITHM) {
    mismatches.push(`rootAlgorithm must be ${NO_EVM_RECEIPTS_ROOT_ALGORITHM}`);
  }
  if (!receiptCountMatches) {
    mismatches.push(`receiptCount ${transcript.receiptCount} does not match ${receiptBlobLabel(transcript.receiptTranscript.length)}`);
  }
  if (computedReceiptsRoot !== transcript.receiptsRoot.toLowerCase()) {
    mismatches.push("receiptsRoot mismatch");
  }
  if (!targetReceiptAvailable) {
    mismatches.push("receiptTranscript does not include txIndex receipt");
  } else if (computedTargetReceiptHash !== transcript.targetReceiptHash.toLowerCase()) {
    mismatches.push("targetReceiptHash mismatch");
  }

  return {
    state: mismatches.length > 0 ? "mismatch" : "verified",
    computedReceiptsRoot,
    computedTargetReceiptHash,
    receiptCountMatches,
    targetReceiptAvailable,
    mismatches,
  };
}

export function validateNoEvmReceiptProofTranscript(
  value: unknown,
): { transcript: NoEvmReceiptProofTranscript | null; errors: string[] } {
  const row = unknownRecord(value);
  if (!row) {
    return { transcript: null, errors: ["noEvmProof must be an object"] };
  }

  const errors: string[] = [];
  const schema = readTranscriptString(row, "schema", errors);
  const proofType = readTranscriptString(row, "proofType", errors);
  const rootAlgorithm = readTranscriptString(row, "rootAlgorithm", errors);
  const receiptCodec = readTranscriptString(row, "receiptCodec", errors);
  const blockHash = readTranscriptHash32(row, "blockHash", errors);
  const txHash = readTranscriptHash32(row, "txHash", errors);
  const receiptsRoot = readTranscriptHash32(row, "receiptsRoot", errors);
  const targetReceiptHash = readTranscriptHash32(row, "targetReceiptHash", errors);
  const blockHeight = readTranscriptNumber(row, "blockHeight", errors);
  const txIndex = readTranscriptNumber(row, "txIndex", errors);
  const receiptCount = readTranscriptNumber(row, "receiptCount", errors);
  const receiptTranscript = readReceiptTranscript(row, errors);

  if (schema !== null && schema !== NO_EVM_RECEIPT_PROOF_SCHEMA) {
    errors.push(`schema must be ${NO_EVM_RECEIPT_PROOF_SCHEMA}`);
  }
  if (proofType !== null && proofType !== NO_EVM_RECEIPT_PROOF_TYPE) {
    errors.push(`proofType must be ${NO_EVM_RECEIPT_PROOF_TYPE}`);
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

  return {
    transcript: {
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
    },
    errors: [],
  };
}

function receiptBlobLabel(count: number): string {
  return `${count} receipt blob${count === 1 ? "" : "s"}`;
}

function noEvmReceiptProofSummary(transcript: NoEvmReceiptProofTranscript): string {
  return `${transcript.proofType} · block ${transcript.blockHeight} · tx ${transcript.txIndex + 1}/${transcript.receiptCount} · ${receiptBlobLabel(transcript.receiptTranscript.length)}`;
}

function noEvmReceiptProofEvidence(source: string, value: unknown): MrvNativeProofEvidence {
  const { transcript, errors } = validateNoEvmReceiptProofTranscript(value);
  const consistency = transcript ? verifyNoEvmReceiptProofConsistency(transcript) : null;
  return {
    source,
    raw: value,
    transcript,
    consistency,
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
    ? noEvmReceiptProofEvidence(proofField.source, proofField.value)
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
      ? `${proofField.source} returned null; Monoscan treats the no-EVM receipt proof evidence as missing until a bounded receipts transcript is available.`
      : "native-receipt.noEvmProof must return a bounded receipts transcript before Monoscan can render no-EVM receipt proof evidence.",
    );
  } else if (!proof.transcript) {
    blockers.push(
      `${proof.source} returned an invalid bounded receipts transcript: ${proof.validationErrors.join("; ") || "unknown validation error"}.`,
    );
  } else if (proof.consistency?.state === "mismatch") {
    blockers.push(
      `${proof.source} returned a bounded receipts transcript that failed self-consistency: ${proof.consistency.mismatches.join("; ")}.`,
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
      // TODO(monolythium): swap to indexer aggregate (cluster +
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
    "bridgeId",
    "bridge_id",
    "trustedBridgeId",
    "trusted_bridge_id",
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
  const bridgeId = readBridgeNullableString(row, ["bridgeId", "bridge_id", "trustedBridgeId", "trusted_bridge_id", "bridgeConfigId", "bridge_config_id"]);
  const wrappedAsset = readBridgeNullableString(row, ["wrappedAsset", "wrapped_asset", "wrappedAssetId", "wrapped_asset_id", "wrappedToken", "wrapped_token"]);
  const routeSelectionReady = readBooleanField(row, ["routeSelectionReady", "route_selection_ready"]);
  const quoteReady = readBooleanField(row, ["quoteReady", "quote_ready"]);
  const submitReady = readBooleanField(row, ["submitReady", "submit_ready"]);
  const readinessBlockedReasons = readStringListField(row, ["blockedReasons", "blocked_reasons"]);
  const readinessWarnings = readStringListField(row, ["warnings"]);

  const route: BridgeRouteDisclosure = {
    routeId: readBridgeString(row, ["routeId", "route_id", "id"]),
    bridge: readBridgeString(row, ["bridge", "bridgeName", "bridge_name"]),
    asset: readBridgeString(row, ["asset", "assetId", "asset_id", "tokenId", "token_id"], wrappedAsset ?? ""),
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

function mergeOptionalBridgeRouteFields(
  primary: BridgeRouteDisclosure,
  secondary: BridgeRouteDisclosure,
): BridgeRouteDisclosure {
  return {
    ...primary,
    bridgeId: primary.bridgeId ?? secondary.bridgeId,
    wrappedAsset: primary.wrappedAsset ?? secondary.wrappedAsset,
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
