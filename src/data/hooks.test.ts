/**
 * Smoke tests for the live-SDK seam.
 *
 * The hooks themselves require a React render env to exercise; that's
 * Stage 4 work (proper component tests once Tanstack Router is wired
 * to per-page routes). For Stage 3 we assert two things:
 *
 *   1. The long-poll cadence is 2 seconds — the contract that drives
 *      the head ticker until mono-core ships OI-0069's WebSocket
 *      transport.
 *   2. The chain-strip query function speaks `lyth_*` (Law §13.2 native
 *      namespace) — not the old `protocore_*` names that pre-dated the
 *      SDK rename.
 *   3. The WebSocket fallback path stays disabled by default so the
 *      explorer never tries an unimplemented WS transport at runtime
 *      (per `plans/monoscan.md` Stage 3 + OI-0069).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { keccak256 } from "ethers/crypto";
import {
  ApiClient,
  CHAIN_REGISTRY,
  RpcClient,
  type AgentReputationResponse,
  type NativeReceiptResponse,
  type ReceiptProofTrustPolicy,
} from "@monolythium/core-sdk";
import { MlDsa65Backend, bytesToHex as sdkBytesToHex } from "@monolythium/core-sdk/crypto";
import {
  HEAD_POLL_MS,
  apiBlockToRpcHeader,
  apiBlockTransactionsToRows,
  apiReceiptToRpcReceipt,
  apiTxToRpcTx,
  applyNativeMarketOrderBookDeltas,
  assessBridgeTrustDisclosures,
  bridgeRouteDisclosureFailureDetails,
  bridgeTrustDisclosureDisplaySlice,
  bridgeTrustDisclosuresFromAddressData,
  decodedTxToRpcReceipt,
  decodedTxToRpcTx,
  fetchBridgeRouteDisclosures,
  fetchMrcAccount,
  fetchMrcHoldersForTokenBalances,
  fetchNativeAgentState,
  fetchNativeMarketEvents,
  fetchNativeMarketOrderBook,
  fetchNativeMarketOrderBookReplayDeltas,
  fetchNativeMarketState,
  fetchTxNativeReceipt,
  fetchMrcMetadataForTokenBalances,
  mergeBridgeTrustDisclosures,
  MRV_NATIVE_RECEIPT_TX_TYPE,
  MRV_NATIVE_TX_EXTENSION_BODY_HEX,
  MRV_NATIVE_TX_EXTENSION_KIND,
  NO_EVM_BINARY_RECEIPTS_ROOT_ALGORITHM,
  NO_EVM_BINARY_RECEIPT_LEAF_DOMAIN,
  NO_EVM_COMPACT_INCLUSION_PROOF_SCHEMA,
  NO_EVM_COMPACT_INCLUSION_TREE_ALGORITHM,
  NO_EVM_COMPACT_RECEIPT_PROOF_TYPE,
  NO_EVM_RECEIPTS_ROOT_ALGORITHM,
  NO_EVM_RECEIPT_CODEC,
  NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
  NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
  NO_EVM_RECEIPT_FINALITY_EVIDENCE_SCHEMA,
  NO_EVM_RECEIPT_FINALITY_EVIDENCE_SOURCE,
  NO_EVM_RECEIPT_PROOF_SCHEMA,
  NO_EVM_RECEIPT_PROOF_TYPE,
  mrvNativeTransactionEvidence,
  mrcHoldersBalanceQueryKeys,
  mrcMetadataBalanceQueryKeys,
  normalizeMrcAccountResponse,
  normalizeBridgeRouteDisclosure,
  normalizeRedemptionQueueResponse,
  nativeReceiptEventRows,
  nativeAgentStateRows,
  nativeMarketOrderBookDeltaRows,
  nativeMarketEventRows,
  nativeMarketStateRows,
  nativeReceiptMarketEventRows,
  queryClient,
  structuredNativeReceiptFee,
  txFeedToRows,
  verifyNoEvmReceiptArchiveProofSignatures,
  verifyNoEvmReceiptFinalityEvidence,
  verifyNoEvmReceiptProofConsistency,
  type NoEvmArchiveVerificationTrustOptions,
  type NoEvmFinalityVerificationTrustOptions,
  type NoEvmArchiveCoveringSnapshot,
  type NoEvmCompactReceiptProofTranscript,
  type NoEvmReceiptFinalityEvidence,
  type NoEvmReceiptProofTranscript,
} from "./hooks";
import { isWebSocketEnabled, resetRpcClient } from "../sdk/client";

const originalTestnetReceiptProofTrust = CHAIN_REGISTRY["testnet-69420"].receipt_proof_trust;

afterEach(() => {
  // Clear the singletons + RQ cache so tests don't leak state.
  queryClient.clear();
  resetRpcClient();
  setTestnetReceiptProofTrust(originalTestnetReceiptProofTrust);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function setTestnetReceiptProofTrust(policy: ReceiptProofTrustPolicy | null | undefined): void {
  const testnet = CHAIN_REGISTRY["testnet-69420"];
  if (policy == null) {
    delete testnet.receipt_proof_trust;
  } else {
    testnet.receipt_proof_trust = policy;
  }
}

type NativeReceiptFixture = Omit<NativeReceiptResponse<unknown>, "noEvmProof"> & {
  noEvmProof?: NoEvmReceiptProofTranscript | NoEvmCompactReceiptProofTranscript | Record<string, unknown> | null;
  [key: string]: unknown;
};

function nativeReceiptFixture(
  overrides: Partial<NativeReceiptFixture> = {},
): NativeReceiptResponse<unknown> & Record<string, unknown> {
  return {
    txHash: `0x${"22".repeat(32)}`,
    blockHash: `0x${"33".repeat(32)}`,
    blockHeight: 100,
    txIndex: 0,
    schema: "riscv.receipt.v1",
    artifactHash: `0x${"aa".repeat(32)}`,
    receiptCommitment: `0x${"bb".repeat(32)}`,
    counters: { cycles: 44, syscallUnits: 3, stateIoUnits: 2 },
    fee: {
      total_lythoshi: "440000000000",
      total_lyth: "4,400",
      cycles_used: 44,
      base_price_per_cycle_lythoshi: "10000000000",
      state_io_units: 2,
      state_io_price_per_unit_lythoshi: "0",
      priority_tip_lythoshi: "0",
    },
    reverted: false,
    nativeDeltaCount: 0,
    eventCount: 0,
    events: [],
    source: {
      chainProvider: "mock_chain",
      indexerProvider: "native_events",
      metadataLogIndex: 0xffff_ffff,
    },
    ...overrides,
  } as NativeReceiptResponse<unknown> & Record<string, unknown>;
}

function noEvmReceiptProofTranscript(
  overrides: Partial<NoEvmReceiptProofTranscript> = {},
): NoEvmReceiptProofTranscript {
  const transcript: NoEvmReceiptProofTranscript = {
    schema: NO_EVM_RECEIPT_PROOF_SCHEMA,
    proofType: NO_EVM_RECEIPT_PROOF_TYPE,
    rootAlgorithm: NO_EVM_RECEIPTS_ROOT_ALGORITHM,
    receiptCodec: "rlp",
    blockHash: `0x${"33".repeat(32)}`,
    txHash: `0x${"22".repeat(32)}`,
    receiptsRoot: `0x${"00".repeat(32)}`,
    targetReceiptHash: `0x${"00".repeat(32)}`,
    blockHeight: 100,
    txIndex: 1,
    receiptCount: 2,
    receiptTranscript: ["0x01", "0xaabb"],
    ...overrides,
  };
  const consistency = verifyNoEvmReceiptProofConsistency(transcript);
  return {
    ...transcript,
    receiptsRoot: overrides.receiptsRoot ?? consistency.computedReceiptsRoot,
    targetReceiptHash: overrides.targetReceiptHash ?? consistency.computedTargetReceiptHash ?? transcript.targetReceiptHash,
  };
}

function hexToBytes(hex: string): Uint8Array {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(body.length / 2);
  for (let index = 0; index < body.length; index += 2) {
    bytes[index / 2] = Number.parseInt(body.slice(index, index + 2), 16);
  }
  return bytes;
}

function testU32Le(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  bytes[0] = value & 0xff;
  bytes[1] = (value >>> 8) & 0xff;
  bytes[2] = (value >>> 16) & 0xff;
  bytes[3] = (value >>> 24) & 0xff;
  return bytes;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }
  return combined;
}

function compactReceiptLeafHash(receipt: Uint8Array, txIndex: number): string {
  return keccak256(concatBytes([
    new TextEncoder().encode(NO_EVM_BINARY_RECEIPT_LEAF_DOMAIN),
    testU32Le(txIndex),
    testU32Le(receipt.length),
    receipt,
  ]));
}

function blsFinalityEvidence(round = 57): NoEvmReceiptFinalityEvidence {
  return {
    schema: NO_EVM_RECEIPT_FINALITY_EVIDENCE_SCHEMA,
    source: NO_EVM_RECEIPT_FINALITY_EVIDENCE_SOURCE,
    round,
    certificate: {
      round,
      signature: "0x1234",
      signersBitmap: "0xabcd",
      signerIndices: [1, 3],
      signerCount: 2,
    },
  };
}

const verifiedBlsClusterPublicKey =
  "0xb77f27a88bfe18988cfcf68ba7462d188a0e655bdd68318c706a3b51887a61fa7d7a9c8843e26f91c91446819925db97";
const verifiedBlsFinalitySignature =
  "0xb52a7567f736afbda5e09d5af4bd8da36cff89c3e8d09ca4c98f8bffe5fbdca7af2437f1fbf92e4f52df8a54ed1c2de71954d1134637a675734db73acb4c0c545f4b3cd39577b4985e8a26b767a68d825c48f0a90e606d8ccbbd8885ef27fcd7";
const verifiedBlsTrustOptions: NoEvmFinalityVerificationTrustOptions = {
  chainId: 69_420,
  clusterPublicKey: verifiedBlsClusterPublicKey,
  committeeSize: 7,
  threshold: 1,
};

function verifiedBlsFinalityEvidence(): NoEvmReceiptFinalityEvidence {
  return {
    schema: NO_EVM_RECEIPT_FINALITY_EVIDENCE_SCHEMA,
    source: NO_EVM_RECEIPT_FINALITY_EVIDENCE_SOURCE,
    round: 58,
    certificate: {
      round: 58,
      signature: verifiedBlsFinalitySignature,
      signersBitmap: "0x08",
      signerIndices: [3],
      signerCount: 1,
    },
  };
}

const validArchiveProofSignature =
  `mono.snapshot.sig.v1:0x${"ab".repeat(20)}:0x${"12".repeat(64)}`;
const validArchiveSignatureDigest = `0x${"66".repeat(32)}`;
const verifiedArchiveSigner = MlDsa65Backend.fromSeed(new Uint8Array(32).fill(12));
const untrustedArchiveSigner = MlDsa65Backend.fromSeed(new Uint8Array(32).fill(13));
const verifiedArchiveTrustOptions: NoEvmArchiveVerificationTrustOptions = {
  publicKeys: [verifiedArchiveSigner.publicKey()],
  threshold: 1,
};

function signedArchiveProofSignature(
  signer: MlDsa65Backend,
  signatureDigest: string,
): string {
  return `mono.snapshot.sig.v1:${signer.getAddress()}:${sdkBytesToHex(signer.sign(hexToBytes(signatureDigest)))}`;
}

function validArchiveCoveringSnapshot(
  overrides: Partial<NoEvmArchiveCoveringSnapshot> = {},
): NoEvmArchiveCoveringSnapshot {
  return {
    snapshotHeight: 130,
    manifestHash: `0x${"61".repeat(32)}`,
    signatureDigest: `0x${"62".repeat(32)}`,
    contentHash: `0x${"63".repeat(32)}`,
    checkpointContentHash: `0x${"55".repeat(32)}`,
    checkpointFrom: 0,
    checkpointTo: 126,
    signatures: [validArchiveProofSignature],
    ...overrides,
  };
}

function compactNoEvmReceiptProofTranscript(
  overrides: Partial<NoEvmCompactReceiptProofTranscript> = {},
): NoEvmCompactReceiptProofTranscript {
  const targetReceiptBytes = overrides.targetReceiptBytes ?? "0x04050607";
  const targetReceipt = hexToBytes(targetReceiptBytes);
  const txIndex = overrides.txIndex ?? 0;
  const receiptsRoot = overrides.receiptsRoot ?? compactReceiptLeafHash(targetReceipt, txIndex);
  const targetReceiptHash = overrides.targetReceiptHash ?? keccak256(targetReceipt);
  return {
    schema: NO_EVM_RECEIPT_PROOF_SCHEMA,
    proofKind: "compactInclusion",
    proofType: NO_EVM_COMPACT_RECEIPT_PROOF_TYPE,
    historySource: "indexerReceiptArchive",
    rootAlgorithm: NO_EVM_BINARY_RECEIPTS_ROOT_ALGORITHM,
    receiptCodec: NO_EVM_RECEIPT_CODEC,
    blockHash: `0x${"33".repeat(32)}`,
    txHash: `0x${"22".repeat(32)}`,
    receiptsRoot,
    targetReceiptHash,
    blockHeight: 100,
    txIndex,
    receiptCount: 1,
    compactInclusionProof: {
      schema: NO_EVM_COMPACT_INCLUSION_PROOF_SCHEMA,
      treeAlgorithm: NO_EVM_COMPACT_INCLUSION_TREE_ALGORITHM,
      root: receiptsRoot,
      leafHash: receiptsRoot,
      siblingHashes: [],
      pathSides: [],
    },
    archiveProof: {
      schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
      source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
      manifestHash: `0x${"44".repeat(32)}`,
      contentHash: `0x${"55".repeat(32)}`,
      signatures: [],
    },
    finalityEvidence: null,
    targetReceiptBytes,
    missingProofMaterial: [
      "signed archive or snapshot manifest binding receipt bytes to blockHash and receiptsRoot",
      "BLS aggregate finality certificate for block round",
    ],
    ...overrides,
  };
}

function registryReceiptProofTrustPolicy(
  overrides: {
    archiveSigner?: MlDsa65Backend;
    archiveThreshold?: number;
    finalityChainId?: number;
    finalityMode?: "cluster" | "multisig";
  } = {},
): ReceiptProofTrustPolicy {
  const finalityMode = overrides.finalityMode ?? "cluster";
  return {
    archive: {
      signature_threshold: overrides.archiveThreshold ?? 1,
      signers: [{
        public_key: sdkBytesToHex((overrides.archiveSigner ?? verifiedArchiveSigner).publicKey()),
        signer_id: (overrides.archiveSigner ?? verifiedArchiveSigner).getAddress(),
      }],
    },
    finality: finalityMode === "cluster"
      ? {
          mode: "cluster",
          chain_id: overrides.finalityChainId ?? 69_420,
          cluster_public_key: verifiedBlsClusterPublicKey,
          committee_size: 7,
          threshold: 1,
        }
      : {
          mode: "multisig",
          chain_id: overrides.finalityChainId ?? 69_420,
          threshold: 1,
          signers: [],
        },
  };
}

function compactVerifiedTrustProof(): NoEvmCompactReceiptProofTranscript {
  return compactNoEvmReceiptProofTranscript({
    blockHeight: 130,
    finalityEvidence: verifiedBlsFinalityEvidence(),
    archiveProof: {
      schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
      source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
      manifestHash: `0x${"44".repeat(32)}`,
      contentHash: `0x${"55".repeat(32)}`,
      signatureDigest: validArchiveSignatureDigest,
      signatures: [signedArchiveProofSignature(verifiedArchiveSigner, validArchiveSignatureDigest)],
    },
  });
}

function apiEnvelope<T>(data: T) {
  return {
    schemaVersion: 1,
    chainId: 69420,
    genesisHash: `0x${"00".repeat(32)}`,
    latest: {
      available: true,
      height: 100,
      hash: `0x${"11".repeat(32)}`,
      timestamp: 1_700_000_000,
    },
    data,
  };
}

function nativeFee(overrides: Record<string, unknown> = {}) {
  return {
    total_lythoshi: "7700000000",
    total_lyth: "77",
    cycles_used: 42,
    base_price_per_cycle_lythoshi: "100000000",
    state_io_units: 7,
    state_io_price_per_unit_lythoshi: "100000000",
    priority_tip_lythoshi: "0",
    ...overrides,
  };
}

describe("live-SDK seam", () => {
  it("polls the chain head every 2 seconds", () => {
    expect(HEAD_POLL_MS).toBe(2_000);
  });

  it("keeps the WebSocket head subscription disabled by default", () => {
    // `isWebSocketEnabled` flips on `VITE_MONOSCAN_USE_WS=true`; the
    // explorer must never speculatively dial WS until OI-0069 lands.
    expect(isWebSocketEnabled()).toBe(false);
  });

  it("speaks the native lyth_* namespace, not the old protocore_*", async () => {
    // Probe the SDK to confirm the methods the hooks call exist on the
    // exported RpcClient surface. If a future rename lands, this test
    // fails before any consumer hits the broken wire.
    const sdk = await import("@monolythium/core-sdk");
    const proto = sdk.RpcClient.prototype as unknown as Record<string, unknown>;
    const apiProto = sdk.ApiClient.prototype as unknown as Record<string, unknown>;
    expect(typeof apiProto.block).toBe("function");
    expect(typeof apiProto.blockTransactions).toBe("function");
    expect(typeof apiProto.transaction).toBe("function");
    expect(typeof apiProto.transactionNativeReceipt).toBe("function");
    expect(typeof apiProto.transactionNativeReceiptEvents).toBe("function");
    expect(typeof apiProto.transactions).toBe("function");
    expect(typeof apiProto.addressActivity).toBe("function");
    expect(typeof apiProto.addressProfile).toBe("function");
    expect(typeof apiProto.addressFlow).toBe("function");
    expect(typeof apiProto.addressPendingRewards).toBe("function");
    expect(typeof apiProto.clusters).toBe("function");
    expect(typeof apiProto.operator).toBe("function");
    expect(typeof apiProto.search).toBe("function");
    expect(typeof apiProto.stats).toBe("function");
    expect(typeof apiProto.markets).toBe("function");
    expect(typeof apiProto.market).toBe("function");
    expect(typeof apiProto.marketTrades).toBe("function");
    expect(typeof apiProto.marketOhlc).toBe("function");
    expect(typeof apiProto.marketOrderBook).toBe("function");
    expect(sdk.NATIVE_MARKET_ORDER_BOOK_STREAM_TOPIC).toBe("nativeMarketOrderBook");
    expect(sdk.API_STREAM_TOPICS).toContain("nativeMarketOrderBook");
    expect(typeof sdk.isNativeMarketOrderBookStreamPayload).toBe("function");
    expect(typeof sdk.assertNativeMarketOrderBookStreamPayload).toBe("function");
    expect(typeof sdk.assertMrvStructuredFeeConformance).toBe("function");
    expect(typeof proto.lythCurrentRound).toBe("function");
    expect(typeof proto.lythClusterDirectory).toBe("function");
    expect(typeof proto.lythClusterStatus).toBe("function");
    expect(typeof proto.lythOperatorInfo).toBe("function");
    expect(typeof proto.lythResolveOperatorAuthority).toBe("function");
    expect(typeof proto.lythSigningActivity).toBe("function");
    expect(typeof proto.lythUpcomingDuties).toBe("function");
    expect(typeof proto.lythOperatorRisk).toBe("function");
    expect(typeof proto.lythMempoolStatus).toBe("function");
    expect(typeof proto.lythIndexerStatus).toBe("function");
    expect(typeof proto.lythGetAccountPolicy).toBe("function");
    expect(typeof proto.lythGetTokenBalances).toBe("function");
    expect(typeof (proto.lythMrcMetadata ?? proto.call)).toBe("function");
    expect(typeof ((proto as Record<string, unknown>).lythMrcAccount ?? proto.call)).toBe("function");
    expect(typeof proto.lythGetAddressLabel).toBe("function");
    expect(typeof proto.lythGetDelegationHistory).toBe("function");
    expect(typeof proto.lythPendingRewards).toBe("function");
    expect(typeof (proto.lythRedemptionQueue ?? proto.call)).toBe("function");
    expect(typeof proto.lythGetAddressActivity).toBe("function");
    expect(typeof proto.lythCapabilities).toBe("function");
    expect(typeof proto.lythAgentReputation).toBe("function");
    expect(typeof proto.lythGetLatestCheckpoint).toBe("function");
    expect(typeof proto.lythGetClusterResignations).toBe("function");
    expect(typeof proto.lythGetBlsRoundCertificate).toBe("function");
    expect(typeof proto.lythGetLeaderCertificate).toBe("function");
    expect(typeof proto.lythGetDacCertificate).toBe("function");
    expect(typeof proto.lythDecodeTx).toBe("function");
    expect(typeof proto.lythNativeReceipt).toBe("function");
    expect(typeof proto.lythNativeReceiptEvents).toBe("function");
    expect(typeof proto.lythGapRecords).toBe("function");
    expect(typeof proto.lythDagParents).toBe("function");
    expect(typeof proto.lythRichList).toBe("function");
    expect(typeof proto.lythClobMarket).toBe("function");
    expect(typeof proto.lythClobMarkets).toBe("function");
    expect(typeof proto.lythClobTrades).toBe("function");
    expect(typeof proto.lythClobOhlc).toBe("function");
    expect(typeof proto.lythClobOrderBook).toBe("function");
    expect(typeof proto.call).toBe("function");
    expect(typeof proto.lythTxFeed).toBe("function");
    expect(typeof proto.lythAddressProfile).toBe("function");
    expect(typeof proto.lythAddressFlow).toBe("function");
    expect(typeof proto.lythSearch).toBe("function");
    expect(typeof proto.lythChainStats).toBe("function");
    expect(typeof proto.lythPeerSummary).toBe("function");
    expect(typeof proto.lythOperatorCapabilities).toBe("function");
    expect(typeof proto.lythUpgradeStatus).toBe("function");
    expect(typeof proto.lythMetricsRange).toBe("function");
    expect(typeof proto.lythTxStatus).toBe("function");
    expect(typeof proto.lythVerticesAtRound).toBe("function");
    expect(typeof proto.lythAddressActivityKind).toBe("function");
    // The `protocore_*` names should NOT exist on the new SDK — if they
    // re-appear it means a downstream regression dragged the v0 names
    // back. Treat as a hard fail.
    expect((proto as Record<string, unknown>).protocoreCurrentRound).toBeUndefined();
  });

  it("prefers the native receipt API and preserves explicit null noEvmProof", async () => {
    const txHash = `0x${"55".repeat(32)}`;
    const receiptCommitment = `0x${"10".repeat(32)}`;
    const receipt = nativeReceiptFixture({
      txHash,
      receiptCommitment,
      noEvmProof: null,
    });
    const apiSpy = vi
      .spyOn(ApiClient.prototype, "transactionNativeReceipt")
      .mockResolvedValue(apiEnvelope(receipt));
    const rpcSpy = vi.spyOn(RpcClient.prototype, "lythNativeReceipt");

    const result = await fetchTxNativeReceipt(txHash);

    expect(apiSpy).toHaveBeenCalledWith(txHash);
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(result?.txHash).toBe(txHash);
    expect((result as Record<string, unknown> | null)?.receiptCommitment).toBe(receiptCommitment);
    expect((result as Record<string, unknown> | null)?.noEvmProof).toBeNull();
  });

  it("preserves non-null noEvmProof transcript objects from the native receipt API", async () => {
    const txHash = `0x${"57".repeat(32)}`;
    const noEvmProof = noEvmReceiptProofTranscript({ txHash });
    const receipt = nativeReceiptFixture({
      txHash,
      noEvmProof,
    });
    const apiSpy = vi
      .spyOn(ApiClient.prototype, "transactionNativeReceipt")
      .mockResolvedValue(apiEnvelope(receipt));
    const rpcSpy = vi.spyOn(RpcClient.prototype, "lythNativeReceipt");

    const result = await fetchTxNativeReceipt(txHash);

    expect(apiSpy).toHaveBeenCalledWith(txHash);
    expect(rpcSpy).not.toHaveBeenCalled();
    expect((result as Record<string, unknown> | null)?.noEvmProof).toEqual(noEvmProof);
  });

  it("falls back to lyth_nativeReceipt when the native receipt API is unavailable", async () => {
    const txHash = `0x${"66".repeat(32)}`;
    const receiptCommitment = `0x${"11".repeat(32)}`;
    const noEvmProof = noEvmReceiptProofTranscript({ txHash });
    const receipt = nativeReceiptFixture({
      txHash,
      receiptCommitment,
      noEvmProof,
    });
    const apiSpy = vi
      .spyOn(ApiClient.prototype, "transactionNativeReceipt")
      .mockRejectedValue(new Error("api unavailable"));
    const rpcSpy = vi
      .spyOn(RpcClient.prototype, "lythNativeReceipt")
      .mockResolvedValue(receipt);

    const result = await fetchTxNativeReceipt(txHash);

    expect(apiSpy).toHaveBeenCalledWith(txHash);
    expect(rpcSpy).toHaveBeenCalledWith(txHash);
    expect((result as Record<string, unknown> | null)?.receiptCommitment).toBe(receiptCommitment);
    expect((result as Record<string, unknown> | null)?.noEvmProof).toEqual(noEvmProof);
  });

  it("reads recent native market events from the dedicated API path", async () => {
    const marketId = `0x${"44".repeat(32)}`;
    const response = {
      schemaVersion: 1,
      fromBlock: 100,
      toBlock: 120,
      limit: 5,
      filters: { family: "market", primaryId: marketId },
      events: [
        {
          blockHeight: 118,
          txIndex: 0,
          logIndex: 2,
          address: "monoc1market",
          eventTopic: `0x${"55".repeat(32)}`,
          decoded: null,
          decodedJson: JSON.stringify({
            block_height: 118,
            tx_index: 0,
            sequence: 2,
            family: "market",
            event_name: "market.order.filled",
            payload_hash: `0x${"66".repeat(32)}`,
            market_id: marketId,
            order_id: `0x${"77".repeat(32)}`,
            price_lythoshi: "900",
          }),
        },
      ],
      source: { indexerProvider: "native_events" },
    };
    const apiSpy = vi
      .spyOn(ApiClient.prototype, "get")
      .mockResolvedValue(apiEnvelope(response));
    const rpcSpy = vi.spyOn(RpcClient.prototype, "call");

    const result = await fetchNativeMarketEvents({
      fromBlock: 100,
      toBlock: 120,
      limit: 5,
      primaryId: marketId,
    });

    expect(apiSpy).toHaveBeenCalledWith("/native-market-events", {
      fromBlock: 100,
      toBlock: 120,
      limit: 5,
      primaryId: marketId,
    });
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(result?.events).toHaveLength(1);
    expect(nativeMarketEventRows(result)[0]).toMatchObject({
      blockHeight: 118,
      txIndex: 0,
      eventName: "market.order.filled",
      primaryId: marketId,
    });
  });

  it("falls back to lyth_nativeMarketEvents when the dedicated API path is unavailable", async () => {
    const response = {
      schemaVersion: 1,
      fromBlock: 10,
      toBlock: 12,
      limit: 2,
      filters: { family: "market" },
      events: [],
      source: { indexerProvider: "native_events" },
    };
    const apiSpy = vi
      .spyOn(ApiClient.prototype, "get")
      .mockRejectedValue(new Error("api unavailable"));
    const rpcSpy = vi
      .spyOn(RpcClient.prototype, "call")
      .mockResolvedValue(response);

    const filter = { fromBlock: 10, toBlock: 12, limit: 2 };
    const result = await fetchNativeMarketEvents(filter);

    expect(apiSpy).toHaveBeenCalledWith("/native-market-events", filter);
    expect(rpcSpy).toHaveBeenCalledWith("lyth_nativeMarketEvents", [filter]);
    expect(result).toBe(response);
  });

  it("reads bounded native market order-book snapshots through the SDK/API seam", async () => {
    const marketId = `0x${"88".repeat(32)}`;
    const response = {
      schemaVersion: 1,
      marketId,
      levels: 32,
      bids: [{ price: "900", size: "12" }],
      asks: [{ price: "1000", size: "3" }],
    };
    const apiSpy = vi
      .spyOn(ApiClient.prototype, "marketOrderBook")
      .mockResolvedValue(apiEnvelope(response) as any);
    const rpcSpy = vi.spyOn(RpcClient.prototype, "lythClobOrderBook");

    const result = await fetchNativeMarketOrderBook(marketId, 99);

    expect(apiSpy).toHaveBeenCalledWith(marketId, 32);
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(result).toBe(response);
  });

  it("falls back to lyth_clobOrderBook for native order-book snapshots", async () => {
    const marketId = `0x${"87".repeat(32)}`;
    const response = {
      schemaVersion: 1,
      marketId,
      levels: 5,
      bids: [],
      asks: [],
    };
    const apiSpy = vi
      .spyOn(ApiClient.prototype, "marketOrderBook")
      .mockRejectedValue(new Error("api unavailable"));
    const rpcSpy = vi
      .spyOn(RpcClient.prototype, "lythClobOrderBook")
      .mockResolvedValue(response);

    const result = await fetchNativeMarketOrderBook(marketId, 5);

    expect(apiSpy).toHaveBeenCalledWith(marketId, 5);
    expect(rpcSpy).toHaveBeenCalledWith(marketId, 5);
    expect(result).toBe(response);
  });

  it("replays validated native market order-book deltas onto snapshots", async () => {
    const marketId = `0x${"86".repeat(32)}`;
    const placedOrder = `0x${"01".repeat(32)}`;
    const cancelledOrder = `0x${"02".repeat(32)}`;
    const snapshot = {
      schemaVersion: 1,
      marketId,
      levels: 5,
      bids: [{ price: "900", size: "10" }],
      asks: [{ price: "1100", size: "5" }],
    };
    vi
      .spyOn(ApiClient.prototype, "marketOrderBook")
      .mockResolvedValue(apiEnvelope(snapshot) as any);
    const replaySpy = vi
      .spyOn(ApiClient.prototype, "get")
      .mockResolvedValue(apiEnvelope({
        schemaVersion: 1,
        replay: true,
        streamTopic: "nativeMarketOrderBook",
        fromBlock: 101,
        toBlock: 103,
        limit: 10,
        cursor: null,
        nextCursor: null,
        deltas: [
          {
            marketId,
            orderId: placedOrder,
            eventName: "market.spot.order_placed",
            action: "upsert",
            side: "bid",
            price: "950",
            quantity: "7",
            remaining: "7",
            status: "open",
            blockHeight: 101,
            txIndex: 0,
            logIndex: 0,
          },
          {
            marketId,
            orderId: cancelledOrder,
            eventName: "market.spot.order_cancelled",
            action: "remove",
            side: "ask",
            price: "1100",
            quantity: "2",
            remaining: "0",
            status: "cancelled",
            blockHeight: 102,
            txIndex: 0,
            logIndex: 1,
          },
        ],
      }) as any);

    const result = await fetchNativeMarketOrderBook(marketId, 5, { toBlock: 103, replayLimit: 10 });

    expect(replaySpy).toHaveBeenCalledWith("/native-market-orderbook-deltas", {
      marketId,
      fromBlock: 101,
      toBlock: 103,
      cursor: null,
      limit: 10,
    });
    expect(result?.bids).toEqual([
      { price: "950", size: "7" },
      { price: "900", size: "10" },
    ]);
    expect(result?.asks).toEqual([{ price: "1100", size: "3" }]);
  });

  it("rejects malformed native market order-book replay payloads and keeps the snapshot fallback", async () => {
    const marketId = `0x${"84".repeat(32)}`;
    const snapshot = {
      schemaVersion: 1,
      marketId,
      levels: 5,
      bids: [{ price: "900", size: "10" }],
      asks: [],
    };
    vi
      .spyOn(ApiClient.prototype, "marketOrderBook")
      .mockResolvedValue(apiEnvelope(snapshot) as any);
    const malformedReplay = apiEnvelope({
      schemaVersion: 1,
      replay: true,
      streamTopic: "nativeMarketOrderBook",
      deltas: [{
        marketId,
        orderId: `0x${"03".repeat(32)}`,
        eventName: "market.spot.order_placed",
        action: "replace",
        blockHeight: 101,
        txIndex: 0,
        logIndex: 0,
      }],
    });
    vi
      .spyOn(ApiClient.prototype, "get")
      .mockResolvedValue(malformedReplay as any);

    await expect(fetchNativeMarketOrderBookReplayDeltas({
      marketId,
      fromBlock: 101,
      toBlock: 101,
      limit: 10,
    })).rejects.toThrow(/malformed/);
    await expect(fetchNativeMarketOrderBook(marketId, 5, { toBlock: 101 })).resolves.toBe(snapshot);
  });

  it("applies replay rows without inventing levels when valid deltas omit book fields", () => {
    const marketId = `0x${"83".repeat(32)}`;
    const snapshot = {
      schemaVersion: 1,
      marketId,
      levels: 5,
      bids: [{ price: "900", size: "10" }],
      asks: [],
    };

    const result = applyNativeMarketOrderBookDeltas(snapshot, [{
      marketId,
      orderId: `0x${"04".repeat(32)}`,
      eventName: "market.spot.order_placed",
      action: "upsert",
      blockHeight: 101,
      txIndex: 0,
      logIndex: 0,
    }], 5);

    expect(result.bids).toEqual(snapshot.bids);
    expect(result.asks).toEqual([]);
  });

  it("removes replay-added native order-book liquidity by order id", () => {
    const marketId = `0x${"82".repeat(32)}`;
    const orderId = `0x${"05".repeat(32)}`;
    const snapshot = {
      schemaVersion: 1,
      marketId,
      levels: 5,
      bids: [{ price: "900", size: "10" }],
      asks: [],
    };

    const result = applyNativeMarketOrderBookDeltas(snapshot, [
      {
        marketId,
        orderId,
        eventName: "market.spot.order_placed",
        action: "upsert",
        side: "bid",
        price: "950",
        quantity: "7",
        remaining: "7",
        status: "open",
        blockHeight: 101,
        txIndex: 0,
        logIndex: 0,
      },
      {
        marketId,
        orderId,
        eventName: "market.spot.order_settled",
        action: "remove",
        side: "bid",
        price: "950",
        quantity: "7",
        remaining: "0",
        status: "filled",
        blockHeight: 102,
        txIndex: 0,
        logIndex: 1,
      },
    ], 5);

    expect(result.bids).toEqual(snapshot.bids);
  });

  it("accepts only SDK-valid nativeMarketOrderBook stream deltas and bounds rows", () => {
    const marketId = `0x${"86".repeat(32)}`;
    const otherMarketId = `0x${"85".repeat(32)}`;
    const base = {
      marketId,
      orderId: `0x${"01".repeat(32)}`,
      eventName: "market.order.placed",
      action: "upsert",
      side: "bid",
      price: "900",
      quantity: "12",
      remaining: "12",
      status: "open",
      blockHeight: 100,
      txIndex: 0,
      logIndex: 0,
    };

    const rows = nativeMarketOrderBookDeltaRows([
      { ...base, orderId: `0x${"02".repeat(32)}`, blockHeight: 99 },
      { ...base, orderId: `0x${"03".repeat(32)}`, relatedOrderId: `0x${"04".repeat(32)}`, action: "remove", remaining: "0" },
      { ...base, marketId: otherMarketId, orderId: `0x${"05".repeat(32)}` },
      { ...base, orderId: `0x${"06".repeat(32)}`, action: "replace" },
      null,
    ], { marketId, limit: 1 });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      topic: "nativeMarketOrderBook",
      marketId,
      orderId: `0x${"03".repeat(32)}`,
      action: "remove",
      relatedOrderId: `0x${"04".repeat(32)}`,
    });
  });

  it("reads native market current state from the dedicated API path", async () => {
    const marketId = `0x${"88".repeat(32)}`;
    const response = {
      schemaVersion: 1,
      filters: { primaryId: marketId },
      spotMarkets: [{
        market_id: marketId,
        base_asset: `0x${"01".repeat(32)}`,
        quote_asset: `0x${"02".repeat(32)}`,
        status: "open",
        registered_at_block: 120,
      }],
      spotOrders: [{
        order_id: `0x${"89".repeat(32)}`,
        market_id: marketId,
        maker: "monoc1maker",
        nonce: 7,
        side: "buy",
        price_lythoshi: "900",
        remaining_amount: "12",
        status: "open",
      }],
      nftListings: [{
        listing_id: `0x${"90".repeat(32)}`,
        collection_id: `0x${"91".repeat(32)}`,
        token_id: "7",
        seller: "monoc1seller",
        price_lythoshi: "1000",
      }],
      collectionRoyalties: [{
        collection_id: `0x${"91".repeat(32)}`,
        royalty_recipient: "monoc1artist",
        royalty_bps: 250,
      }],
      source: { indexerProvider: "native_market_state" },
    };
    const apiSpy = vi
      .spyOn(ApiClient.prototype, "get")
      .mockResolvedValue(apiEnvelope(response));
    const rpcSpy = vi.spyOn(RpcClient.prototype, "call");

    const result = await fetchNativeMarketState({ primaryId: marketId });
    const rows = nativeMarketStateRows(result);

    expect(apiSpy).toHaveBeenCalledWith("/native-market-state", { primaryId: marketId });
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(rows.spotMarkets[0]).toMatchObject({
      kind: "spotMarket",
      primaryId: marketId,
      marketId,
      baseAsset: `0x${"01".repeat(32)}`,
      quoteAsset: `0x${"02".repeat(32)}`,
      status: "open",
      blockHeight: 120,
    });
    expect(rows.spotMarkets[0]?.fields).not.toContainEqual(["base_asset", `0x${"01".repeat(32)}`]);
    expect(rows.spotOrders[0]).toMatchObject({
      kind: "spotOrder",
      marketId,
      account: "monoc1maker",
      nonce: "7",
      side: "buy",
      price: "900",
      amount: "12",
    });
    expect(rows.spotOrders[0]?.fields).not.toContainEqual(["nonce", "7"]);
    expect(rows.nftListings[0]).toMatchObject({
      kind: "nftListing",
      account: "monoc1seller",
      tokenId: "7",
    });
    expect(rows.collectionRoyalties[0]).toMatchObject({
      kind: "collectionRoyalty",
      account: "monoc1artist",
      amount: "250",
    });
  });

  it("falls back to lyth_nativeMarketState when the dedicated state API path is unavailable", async () => {
    const response = {
      schemaVersion: 1,
      filters: {},
      spotMarkets: [],
      spotOrders: [],
      nftListings: [],
      collectionRoyalties: [],
      source: { indexerProvider: "native_market_state" },
    };
    const apiSpy = vi
      .spyOn(ApiClient.prototype, "get")
      .mockRejectedValue(new Error("api unavailable"));
    const rpcSpy = vi
      .spyOn(RpcClient.prototype, "call")
      .mockResolvedValue(response);

    const result = await fetchNativeMarketState({ account: "monoc1maker" });

    expect(apiSpy).toHaveBeenCalledWith("/native-market-state", { account: "monoc1maker" });
    expect(rpcSpy).toHaveBeenCalledWith("lyth_nativeMarketState", [{ account: "monoc1maker" }]);
    expect(result).toBe(response);
  });

  it("reads native agent state without fabricating missing current-state rows", async () => {
    const policyId = `0x${"aa".repeat(32)}`;
    const escrowId = `0x${"bb".repeat(32)}`;
    const issuerId = `0x${"11".repeat(32)}`;
    const attestationId = `0x${"12".repeat(32)}`;
    const consentId = `0x${"13".repeat(32)}`;
    const serviceId = `0x${"14".repeat(32)}`;
    const arbiterId = `0x${"15".repeat(32)}`;
    const reviewId = `0x${"16".repeat(32)}`;
    const owner = "mono1agentowner";
    const provider = "mono1agentprovider";
    const response = {
      schemaVersion: 1,
      limit: 5,
      filters: { policyId: null, escrowId: null, account: owner, includePolicySpends: true },
      issuers: [{
        issuerId,
        issuer: provider,
        nonce: 1,
        metadataHash: null,
        updatedAtBlock: 45,
      }],
      attestations: [{
        attestationId,
        issuerId,
        issuer: provider,
        subject: owner,
        nonce: 2,
        schemaHash: `0x${"17".repeat(32)}`,
        payloadHash: null,
        active: true,
        updatedAtBlock: 46,
      }],
      consents: [{
        consentId,
        subject: owner,
        grantee: "mono1agentgrantee",
        nonce: 3,
        scopeHash: null,
        expiresAt: null,
        active: false,
        updatedAtBlock: 47,
      }],
      services: [{
        serviceId,
        provider,
        nonce: 4,
        categoryHash: `0x${"18".repeat(32)}`,
        metadataHash: null,
        active: true,
        updatedAtBlock: 48,
      }],
      availability: [{
        provider,
        maxConcurrent: 8,
        openRequests: 2,
        paused: false,
        updatedAtBlock: 49,
      }],
      arbiters: [{
        arbiterId,
        arbiter: "mono1agentarbiter",
        nonce: 5,
        tier: 2,
        metadataHash: null,
        updatedAtBlock: 50,
      }],
      reputationReviews: [{
        reviewId,
        reviewer: "mono1agentreviewer",
        subject: provider,
        categoryId: 7,
        speedScore: 9,
        qualityScore: 8,
        communicationScore: 10,
        accuracyScore: 9,
        payloadHash: null,
        updatedAtBlock: 51,
      }],
      spendingPolicies: [{
        policyId,
        owner,
        controller: "mono1agentcontroller",
        nonce: 6,
        assetId: `0x${"cc".repeat(32)}`,
        enabled: true,
        perActionLimit: "100",
        windowLimit: "500",
        windowSecs: 60,
        updatedAtBlock: 42,
      }],
      policySpends: [{
        policyId,
        controller: "mono1agentcontroller",
        assetId: `0x${"cc".repeat(32)}`,
        window: 7,
        amount: "25",
        spent: "125",
        updatedAtBlock: 43,
      }],
      escrows: [{
        escrowId,
        buyer: owner,
        provider: "mono1agentprovider",
        arbiter: "mono1agentarbiter",
        nonce: 7,
        assetId: `0x${"cc".repeat(32)}`,
        amount: "1000",
        termsHash: `0x${"dd".repeat(32)}`,
        round: 2,
        buyerAccepted: true,
        providerAccepted: false,
        submittedPayloadHash: null,
        status: "accepted",
        resolution: null,
        lastActor: owner,
        createdAtBlock: 40,
        updatedAtBlock: 44,
      }],
      source: { indexerProvider: "native_agent_state", projection: "native_agent_state" },
    };
    const apiSpy = vi
      .spyOn(ApiClient.prototype, "nativeAgentState")
      .mockResolvedValue(apiEnvelope(response));
    const rpcSpy = vi.spyOn(RpcClient.prototype, "lythNativeAgentState");

    const result = await fetchNativeAgentState({ account: owner, includePolicySpends: true, limit: 5 });
    const rows = nativeAgentStateRows(result);

    expect(apiSpy).toHaveBeenCalledWith({ account: owner, includePolicySpends: true, limit: 5 });
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(rows.issuers[0]).toMatchObject({
      kind: "issuer",
      primaryId: issuerId,
      account: provider,
      nonce: "1",
      blockHeight: 45,
    });
    expect(rows.attestations[0]).toMatchObject({
      kind: "attestation",
      primaryId: attestationId,
      account: owner,
      counterparty: provider,
      nonce: "2",
      status: "active",
      blockHeight: 46,
    });
    expect(rows.consents[0]).toMatchObject({
      kind: "consent",
      primaryId: consentId,
      account: owner,
      counterparty: "mono1agentgrantee",
      nonce: "3",
      status: "inactive",
      blockHeight: 47,
    });
    expect(rows.services[0]).toMatchObject({
      kind: "service",
      primaryId: serviceId,
      account: provider,
      nonce: "4",
      status: "active",
      blockHeight: 48,
    });
    expect(rows.availability[0]).toMatchObject({
      kind: "availability",
      account: provider,
      status: "available",
      amount: "2/8",
      blockHeight: 49,
    });
    expect(rows.arbiters[0]).toMatchObject({
      kind: "arbiter",
      primaryId: arbiterId,
      account: "mono1agentarbiter",
      nonce: "5",
      blockHeight: 50,
    });
    expect(rows.reputationReviews[0]).toMatchObject({
      kind: "reputationReview",
      primaryId: reviewId,
      account: "mono1agentreviewer",
      counterparty: provider,
      amount: "9/8/10/9",
      blockHeight: 51,
    });
    expect(rows.spendingPolicies[0]).toMatchObject({
      kind: "spendingPolicy",
      primaryId: policyId,
      account: owner,
      counterparty: "mono1agentcontroller",
      nonce: "6",
      amount: "500",
      blockHeight: 42,
    });
    expect(rows.policySpends[0]).toMatchObject({
      kind: "policySpend",
      amount: "25",
      blockHeight: 43,
    });
    expect(rows.escrows[0]).toMatchObject({
      kind: "escrow",
      primaryId: escrowId,
      nonce: "7",
      status: "accepted",
      amount: "1000",
      blockHeight: 44,
    });
    expect(nativeAgentStateRows({
      ...response,
      issuers: [],
      attestations: [],
      consents: [],
      services: [],
      availability: [],
      arbiters: [],
      reputationReviews: [],
      spendingPolicies: [],
      policySpends: [],
      escrows: [],
    })).toEqual({
      issuers: [],
      attestations: [],
      consents: [],
      services: [],
      availability: [],
      arbiters: [],
      reputationReviews: [],
      spendingPolicies: [],
      policySpends: [],
      escrows: [],
    });
  });

  it("falls back to lyth_nativeAgentState with a valid account-scoped filter", async () => {
    const response = {
      schemaVersion: 1,
      limit: 5,
      filters: { policyId: null, escrowId: null, account: "mono1agentowner", includePolicySpends: true },
      issuers: [],
      attestations: [],
      consents: [],
      services: [],
      availability: [],
      arbiters: [],
      reputationReviews: [],
      spendingPolicies: [],
      policySpends: [],
      escrows: [],
      source: { indexerProvider: "native_agent_state", projection: "native_agent_state" },
    };
    const apiSpy = vi
      .spyOn(ApiClient.prototype, "nativeAgentState")
      .mockRejectedValue(new Error("api unavailable"));
    const rpcSpy = vi
      .spyOn(RpcClient.prototype, "lythNativeAgentState")
      .mockResolvedValue(response);

    const result = await fetchNativeAgentState({
      account: "mono1agentowner",
      policyId: `0x${"aa".repeat(32)}`,
      includePolicySpends: true,
      limit: 5,
    });

    expect(apiSpy).toHaveBeenCalledWith({
      policyId: `0x${"aa".repeat(32)}`,
      includePolicySpends: true,
      limit: 5,
    });
    expect(rpcSpy).toHaveBeenCalledWith({
      policyId: `0x${"aa".repeat(32)}`,
      includePolicySpends: true,
      limit: 5,
    });
    expect(result).toBe(response);
  });

  it("reads bridge route discovery from the dedicated API path", async () => {
    const response = {
      schemaVersion: 1,
      limit: 5,
      routes: [{
        routeId: "eth-usdc-mainnet",
        bridge: "ThirdParty Light Client",
        asset: "USDC",
        sourceChain: "ethereum",
        destinationChain: "monolythium",
        verifier: {
          model: "zk-light-client",
          participantCount: 12,
          threshold: 8,
        },
        drainCapAtomic: "250000000000",
        finalityBlocks: 64,
        cooldownSeconds: 7200,
        adminControl: "consensusOnly",
        circuitBreaker: "armed",
        insuranceAtomic: "500000000000",
      }],
      source: { routeProvider: "bridge_routes" },
    };
    const apiSpy = vi
      .spyOn(ApiClient.prototype, "get")
      .mockResolvedValue(apiEnvelope(response));
    const rpcSpy = vi.spyOn(RpcClient.prototype, "call");

    const result = await fetchBridgeRouteDisclosures(5);

    expect(apiSpy).toHaveBeenCalledWith("/bridge/routes", { limit: 5 });
    expect(rpcSpy).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result?.[0].route.routeId).toBe("eth-usdc-mainnet");
    expect(result?.[0].source).toBe("bridgeRoutes[0]");
    expect(result?.[0].assessment.accepted).toBe(true);
  });

  it("reads mono-core BridgeRoutesResponse envelopes with discovery-only disclosures", async () => {
    const route = {
      routeId: "eth-usdc-mainnet",
      bridge: "ThirdParty Light Client",
      asset: "USDC",
      sourceChain: "ethereum",
      destinationChain: "monolythium",
      verifier: {
        model: "zk-light-client",
        participantCount: 12,
        threshold: 8,
      },
      drainCapAtomic: "250000000000",
      finalityBlocks: 64,
      cooldownSeconds: 7200,
      adminControl: "consensusOnly",
      circuitBreaker: "armed",
      insuranceAtomic: "500000000000",
    };
    const bridgeDisclosureOnlyRoute = {
      ...route,
      routeId: "arb-usdc-mainnet",
      bridgeId: "catalogue-bridge-arb-usdc",
      wrappedAsset: "mrc:wrapped-usdc",
      sourceChain: "arbitrum",
      finalityBlocks: 32,
    };
    const response = {
      selection: {
        selected: null,
        candidates: [],
        blockedReasons: ["bridge route selection requires transfer intent"],
      },
      routeSelectionReady: false,
      quoteReady: false,
      submitReady: false,
      blockedReasons: ["bridge route selection requires transfer intent"],
      warnings: [],
      routes: [route],
      bridgeRouteDisclosures: [route, bridgeDisclosureOnlyRoute],
      source: {
        routeCount: 2,
        globalRouteIndexAvailable: false,
        routeDisclosureSource: "request.routeDisclosures_or_indexer.tokenBalances",
      },
    };
    const apiSpy = vi
      .spyOn(ApiClient.prototype, "get")
      .mockResolvedValue(apiEnvelope(response));

    const result = await fetchBridgeRouteDisclosures(5);

    expect(apiSpy).toHaveBeenCalledWith("/bridge/routes", { limit: 5 });
    expect(result).toHaveLength(2);
    const routeIds = new Set(result?.map((row) => row.route.routeId));
    expect(routeIds).toEqual(new Set(["eth-usdc-mainnet", "arb-usdc-mainnet"]));
    expect(result?.find((row) => row.route.routeId === "eth-usdc-mainnet")?.source)
      .toBe("bridgeRoutes[0]");
    expect(result?.find((row) => row.route.routeId === "arb-usdc-mainnet")?.source)
      .toBe("bridgeRoutes.bridgeRouteDisclosures[1]");
    expect(result?.find((row) => row.route.routeId === "arb-usdc-mainnet")?.route.bridgeId)
      .toBe("catalogue-bridge-arb-usdc");
    expect(result?.find((row) => row.route.routeId === "arb-usdc-mainnet")?.route.wrappedAsset)
      .toBe("mrc:wrapped-usdc");
    expect(result?.find((row) => row.route.routeId === "arb-usdc-mainnet")?.readiness).toMatchObject({
      routeSelectionReady: false,
      quoteReady: false,
      submitReady: false,
      blockedReasons: ["bridge route selection requires transfer intent"],
    });
    expect(result?.every((row) => row.assessment.accepted)).toBe(true);
  });

  it("reads bridgeRouteDisclosures-only discovery responses from API envelopes", async () => {
    const response = {
      routeSelectionReady: false,
      quoteReady: false,
      submitReady: false,
      bridgeRouteDisclosures: [{
        routeId: "base-usdc-mainnet",
        bridge: "Committee Relay",
        asset: "USDC",
        sourceChain: "base",
        destinationChain: "monolythium",
        verifier: {
          model: "committee",
          participantCount: 9,
          threshold: 6,
        },
        drainCapAtomic: "250000000000",
        finalityBlocks: 48,
        cooldownSeconds: 7200,
        adminControl: "none",
        circuitBreaker: "armed",
        insuranceAtomic: "500000000000",
      }],
    };
    vi.spyOn(ApiClient.prototype, "get").mockResolvedValue(apiEnvelope(response));

    const result = await fetchBridgeRouteDisclosures(5);

    expect(result).toHaveLength(1);
    expect(result?.[0].route.routeId).toBe("base-usdc-mainnet");
    expect(result?.[0].source).toBe("bridgeRoutes.bridgeRouteDisclosures[0]");
    expect(result?.[0].assessment.accepted).toBe(true);
  });

  it("falls back to lyth_bridgeRoutes when bridge route discovery API is unavailable", async () => {
    const response = {
      routes: [{
        route_id: "sol-usdt-mainnet",
        bridge_name: "Consensus Relay",
        asset_id: "USDT",
        from_chain: "solana",
        to_chain: "monolythium",
        verifier_config: {
          type: "committee",
          signer_count: 9,
          required_signers: 6,
        },
        drain_cap_atomic: "9000000000",
        finality_delay_blocks: 32,
        cooldown_seconds: 3600,
        mono_admin_control: "none",
        breaker: "armed",
        slashable_insurance_atomic: "1000000000",
      }],
    };
    const apiSpy = vi
      .spyOn(ApiClient.prototype, "get")
      .mockRejectedValue(new Error("api unavailable"));
    const rpcSpy = vi
      .spyOn(RpcClient.prototype, "call")
      .mockResolvedValue(response);

    const result = await fetchBridgeRouteDisclosures(5);

    expect(apiSpy).toHaveBeenCalledWith("/bridge/routes", { limit: 5 });
    expect(rpcSpy).toHaveBeenCalledWith("lyth_bridgeRoutes", [{ limit: 5 }]);
    expect(result?.[0].route.routeId).toBe("sol-usdt-mainnet");
    expect(result?.[0].route.bridge).toBe("Consensus Relay");
    expect(result?.[0].assessment.accepted).toBe(true);
  });

  it("keeps the typed agent reputation response available to UI hooks", () => {
    const response: AgentReputationResponse = {
      schemaVersion: 1,
      provider: "mono1zg69v7y6hn00qyfzxdz92enh3zv64w7vajvdc4",
      categoryId: 0,
      categoryScope: "global",
      record: {
        provider: "mono1zg69v7y6hn00qyfzxdz92enh3zv64w7vajvdc4",
        categoryId: 0,
        blockHeight: 123,
        speedSumX10: 460,
        qualitySumX10: 450,
        communicationSumX10: 440,
        accuracySumX10: 430,
        sampleCount: 5,
        avgSpeedX10: 92,
        avgQualityX10: 90,
        avgCommunicationX10: 88,
        avgAccuracyX10: 86,
      },
    };

    expect(response.record?.sampleCount).toBe(5);
    expect(response.record?.avgAccuracyX10).toBe(86);
  });

  it("normalizes native redemption queue tickets without inventing amounts", () => {
    const queue = normalizeRedemptionQueueResponse({
      wallet: "mono1zg69v7y6hn00qyfzxdz92enh3zv64w7vajvdc4",
      tickets: [
        {
          index: 0,
          cluster: 7,
          weightBps: 2500,
          createdHeight: 10,
          maturityHeight: 20,
          mature: false,
        },
        {
          index: 1,
          cluster: 8,
          weight_bps: "500",
          created_height: "11",
          maturity_height: "12",
          mature: "true",
          amountLythoshi: "999",
        },
      ],
      count: 2,
      returned: 2,
      block: 20,
    });

    expect(queue).toEqual({
      wallet: "mono1zg69v7y6hn00qyfzxdz92enh3zv64w7vajvdc4",
      tickets: [
        {
          index: 0,
          cluster: 7,
          weightBps: 2500,
          createdHeight: 10,
          maturityHeight: 20,
          mature: false,
        },
        {
          index: 1,
          cluster: 8,
          weightBps: 500,
          createdHeight: 11,
          maturityHeight: 12,
          mature: true,
        },
      ],
      count: 2,
      returned: 2,
      block: 20,
    });
  });

  it("drops malformed native redemption queue ticket rows", () => {
    const queue = normalizeRedemptionQueueResponse({
      data: {
        wallet: "mono1bad",
        tickets: [
          { index: 0, cluster: 1, weightBps: 100, createdHeight: 1, maturityHeight: 9 },
          { index: 1, cluster: 2, weightBps: 100, createdHeight: 1 },
        ],
      },
    });

    expect(queue?.tickets).toEqual([
      {
        index: 0,
        cluster: 1,
        weightBps: 100,
        createdHeight: 1,
        maturityHeight: 9,
        mature: null,
      },
    ]);
    expect(queue?.count).toBe(1);
    expect(normalizeRedemptionQueueResponse(null)).toBeNull();
  });
});

describe("MRC token-balance metadata enrichment", () => {
  const assetId = `0x${"aa".repeat(32)}`;
  const tokenId = `0x${"bb".repeat(32)}`;

  it("maps bounded MRC balance rows to native metadata responses", async () => {
    const calls: Array<[string, string | null | undefined]> = [];
    const rpc = {
      async lythMrcMetadata(asset: string, token?: string | null) {
        calls.push([asset, token]);
        return {
          schemaVersion: 1,
          assetId: asset,
          tokenId: token ?? null,
          metadata: {
            standard: "mrc1155",
            assetId: asset,
            tokenId: token ?? null,
            name: "Artifact #1",
            symbol: "ART",
            decimals: 0,
            uri: "ipfs://artifact/1",
            updatedAtBlock: 91,
          },
        };
      },
    };

    const metadata = await fetchMrcMetadataForTokenBalances([
      { tokenId: "balance-a", mrc: { assetId, tokenId } },
      { tokenId: "balance-a-duplicate", mrc: { assetId, tokenId } },
      { tokenId: "balance-b", mrc: { assetId: `0x${"cc".repeat(32)}` } },
      { tokenId: "balance-c", mrc: { assetId: `0x${"dd".repeat(32)}` } },
    ], rpc, 2);

    expect(calls).toEqual([
      [assetId, tokenId],
      [`0x${"cc".repeat(32)}`, null],
    ]);
    expect(Object.keys(metadata)).toEqual(["balance-a", "balance-b"]);
    expect(metadata["balance-a"].metadata?.name).toBe("Artifact #1");
    expect(metadata["balance-a"].metadata?.symbol).toBe("ART");
    expect(metadata["balance-a"].metadata?.decimals).toBe(0);
    expect(metadata["balance-a"].metadata?.uri).toBe("ipfs://artifact/1");
  });

  it("omits non-MRC rows, null metadata rows, and failed lookups so display can fall back", async () => {
    const calls: string[] = [];
    const rpc = {
      async lythMrcMetadata(asset: string) {
        calls.push(asset);
        if (asset.endsWith("02")) throw new Error("method unavailable");
        return {
          schemaVersion: 1,
          assetId: asset,
          tokenId: null,
          metadata: null,
        };
      },
    };

    const rows = [
      { tokenId: "plain" },
      { tokenId: "missing-asset", mrc: { tokenId } },
      { tokenId: "no-row", mrc: { assetId: `0x${"01".repeat(32)}` } },
      { tokenId: "failed", mrc: { assetId: `0x${"02".repeat(32)}` } },
    ];

    expect(mrcMetadataBalanceQueryKeys(rows)).toEqual([
      `${`0x${"01".repeat(32)}`}::no-row`,
      `${`0x${"02".repeat(32)}`}::failed`,
    ]);
    await expect(fetchMrcMetadataForTokenBalances(rows, rpc)).resolves.toEqual({});
    expect(calls).toEqual([`0x${"01".repeat(32)}`, `0x${"02".repeat(32)}`]);
  });

  it("falls back to raw lyth_mrcMetadata when the installed SDK wrapper is absent", async () => {
    const calls: Array<[string, unknown]> = [];
    const rpc = {
      async call<T>(method: string, params?: unknown): Promise<T> {
        calls.push([method, params]);
        return {
          schemaVersion: 1,
          assetId,
          tokenId: null,
          metadata: {
            standard: "mrc20",
            assetId,
            tokenId: null,
            name: "Native Coin",
            symbol: "NAT",
            decimals: 8,
            uri: null,
            updatedAtBlock: 12,
          },
        } as T;
      },
    };

    const metadata = await fetchMrcMetadataForTokenBalances([
      { tokenId: "balance-a", mrc: { assetId } },
    ], rpc);

    expect(calls).toEqual([["lyth_mrcMetadata", [assetId]]]);
    expect(metadata["balance-a"].metadata?.symbol).toBe("NAT");
  });

  it("treats MRC-4626 vault share balances as asset-scoped metadata rows", async () => {
    const vaultId = `0x${"46".repeat(32)}`;
    const calls: Array<[string, string | null | undefined]> = [];
    const rpc = {
      async lythMrcMetadata(asset: string, token?: string | null) {
        calls.push([asset, token]);
        return {
          schemaVersion: 1,
          assetId: asset,
          tokenId: token ?? null,
          metadata: {
            standard: "mrc4626",
            assetId: asset,
            tokenId: token ?? null,
            name: "Vault Shares",
            symbol: "vLYTH",
            decimals: 8,
            uri: null,
            updatedAtBlock: 146,
          },
        };
      },
    };

    const rows = [
      { tokenId: vaultId, mrc: { standard: "mrc4626", assetId: vaultId } },
    ];

    expect(mrcMetadataBalanceQueryKeys(rows)).toEqual([`${vaultId}::${vaultId}`]);
    const metadata = await fetchMrcMetadataForTokenBalances(rows, rpc);

    expect(calls).toEqual([[vaultId, null]]);
    expect(metadata[vaultId].tokenId).toBeNull();
    expect(metadata[vaultId].metadata?.standard).toBe("mrc4626");
  });
});

describe("MRC token-balance holder enrichment", () => {
  const assetId = `0x${"aa".repeat(32)}`;
  const tokenId = `0x${"bb".repeat(32)}`;
  const otherAssetId = `0x${"cc".repeat(32)}`;
  const otherTokenId = `0x${"dd".repeat(32)}`;

  it("maps bounded native MRC-721 and MRC-1155 token identities through the REST route", async () => {
    const calls: Array<[string, unknown]> = [];
    const api = {
      async get<T>(path: string, query?: unknown): Promise<T> {
        calls.push([path, query]);
        const standard = path.includes("/mrc1155/") ? "mrc1155" : "mrc721";
        return {
          schemaVersion: 1,
          standard,
          assetId: standard === "mrc1155" ? otherAssetId : assetId,
          tokenId: standard === "mrc1155" ? otherTokenId : tokenId,
          limit: 2,
          holders: [{
            rank: 1,
            address: "0x1111111111111111111111111111111111111111",
            balance: "1",
            updatedAtBlock: 99,
          }],
        } as T;
      },
    };
    const rpc = {
      async call() {
        throw new Error("RPC fallback should not run");
      },
    };

    const rows = [
      { tokenId: "balance-a", mrc: { standard: "mrc721", assetId, tokenId } },
      { tokenId: "balance-a-duplicate", mrc: { standard: "mrc721", assetId, tokenId } },
      { tokenId: "balance-b", mrc: { standard: "mrc1155", assetId: otherAssetId, tokenId: otherTokenId } },
      { tokenId: "balance-c", mrc: { standard: "mrc20", assetId: `0x${"ee".repeat(32)}` } },
    ];

    expect(mrcHoldersBalanceQueryKeys(rows)).toEqual([
      `mrc721:${assetId}:${tokenId}:balance-a`,
      `mrc1155:${otherAssetId}:${otherTokenId}:balance-b`,
    ]);

    const holders = await fetchMrcHoldersForTokenBalances(rows, { api, rpc }, 2);

    expect(calls).toEqual([
      [`/mrc/mrc721/${assetId}/${tokenId}/holders`, { limit: 2 }],
      [`/mrc/mrc1155/${otherAssetId}/${otherTokenId}/holders`, { limit: 2 }],
    ]);
    expect(Object.keys(holders)).toEqual(["balance-a", "balance-b"]);
    expect(holders["balance-a"].holders[0].address).toBe("0x1111111111111111111111111111111111111111");
  });

  it("maps MRC-4626 vault share balances through the asset-scoped REST holder route", async () => {
    const vaultId = `0x${"46".repeat(32)}`;
    const calls: Array<[string, unknown]> = [];
    const api = {
      async get<T>(path: string, query?: unknown): Promise<T> {
        calls.push([path, query]);
        return {
          schemaVersion: 1,
          standard: "mrc4626",
          assetId: vaultId,
          tokenId: null,
          limit: 3,
          holders: [{
            rank: 1,
            address: "0x2222222222222222222222222222222222222222",
            balance: "100000000",
            updatedAtBlock: 146,
          }],
        } as T;
      },
    };
    const rpc = {
      async call() {
        throw new Error("RPC fallback should not run");
      },
    };

    const rows = [
      { tokenId: vaultId, mrc: { standard: "mrc4626", assetId: vaultId } },
      { tokenId: "duplicate-vault-row", mrc: { standard: "mrc4626", assetId: vaultId } },
      { tokenId: "collection", mrc: { standard: "mrc721", assetId } },
    ];

    expect(mrcHoldersBalanceQueryKeys(rows)).toEqual([
      `mrc4626:${vaultId}:null:${vaultId}`,
    ]);

    const holders = await fetchMrcHoldersForTokenBalances(rows, { api, rpc }, 3);

    expect(calls).toEqual([
      [`/mrc/mrc4626/${vaultId}/holders`, { limit: 3 }],
    ]);
    expect(Object.keys(holders)).toEqual([vaultId]);
    expect(holders[vaultId].tokenId).toBeNull();
    expect(holders[vaultId].holders[0].balance).toBe("100000000");
  });

  it("falls back to lyth_mrcHolders JSON-RPC when REST is unavailable", async () => {
    const calls: Array<[string, unknown]> = [];
    const api = {
      async get() {
        throw new Error("not found");
      },
    };
    const rpc = {
      async call<T>(method: string, params?: unknown): Promise<T> {
        calls.push([method, params]);
        return {
          schemaVersion: 1,
          standard: "mrc721",
          assetId,
          tokenId,
          limit: 6,
          holders: [],
        } as T;
      },
    };

    const holders = await fetchMrcHoldersForTokenBalances([
      { tokenId: "balance-a", mrc: { standard: "mrc721", assetId, tokenId } },
    ], { api, rpc });

    expect(calls).toEqual([["lyth_mrcHolders", ["mrc721", assetId, tokenId, 6]]]);
    expect(holders["balance-a"].standard).toBe("mrc721");
  });

  it("falls back to lyth_mrcHolders JSON-RPC with null token id for MRC-4626", async () => {
    const vaultId = `0x${"46".repeat(32)}`;
    const calls: Array<[string, unknown]> = [];
    const api = {
      async get() {
        throw new Error("not found");
      },
    };
    const rpc = {
      async call<T>(method: string, params?: unknown): Promise<T> {
        calls.push([method, params]);
        return {
          schemaVersion: 1,
          standard: "mrc4626",
          assetId: vaultId,
          tokenId: null,
          limit: 6,
          holders: [],
        } as T;
      },
    };

    const holders = await fetchMrcHoldersForTokenBalances([
      { tokenId: vaultId, mrc: { standard: "mrc4626", assetId: vaultId } },
    ], { api, rpc });

    expect(calls).toEqual([["lyth_mrcHolders", ["mrc4626", vaultId, null, 6]]]);
    expect(holders[vaultId].tokenId).toBeNull();
  });

  it("ignores non-native, collection-scope, and failed holder lookups", async () => {
    const calls: string[] = [];
    const api = {
      async get(path: string) {
        calls.push(path);
        throw new Error("method unavailable");
      },
    };
    const rpc = {};
    const rows = [
      { tokenId: "plain" },
      { tokenId: "mrc20", mrc: { standard: "mrc20", assetId } },
      { tokenId: "collection", mrc: { standard: "mrc721", assetId } },
      { tokenId: "failed", mrc: { standard: "mrc1155", assetId: otherAssetId, tokenId: otherTokenId } },
    ];

    await expect(fetchMrcHoldersForTokenBalances(rows, { api, rpc })).resolves.toEqual({});
    expect(calls).toEqual([`/mrc/mrc1155/${otherAssetId}/${otherTokenId}/holders`]);
  });
});

describe("MRC account lookup", () => {
  const account = "monos1effvdw0d05a35j69wwxplhmctpcclx382n60yf";
  const controller = "mono1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqnzz75d";
  const recovery = "mono1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9e3uzy";
  const assetId = `0x${"aa".repeat(32)}`;
  const policyHash = `0x${"44".repeat(32)}`;

  function mrcAccountPayload(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      account,
      spendLimit: 2,
      smartAccount: {
        kind: "smart_account",
        account,
        controller,
        recovery,
        policyHash,
        nonce: "7",
        updatedAtBlock: 100,
      },
      policyAccount: null,
      policySpends: [{
        account,
        assetId,
        window: "9",
        amount: "1000",
        spent: "125",
        updatedAtBlock: 101,
      }],
      ...overrides,
    };
  }

  it("normalizes direct and envelope MRC account payloads", () => {
    const result = normalizeMrcAccountResponse(apiEnvelope({
      schema_version: 1,
      account,
      spend_limit: "3",
      smart_account: {
        kind: "smart_account",
        account,
        controller,
        recovery: null,
        policy_hash: policyHash,
        nonce: 9,
        updated_at_block: "100",
      },
      policy_account: {
        kind: "policy_account",
        account,
        controller: null,
        recovery,
        policy_hash: policyHash,
        policy: {
          enabled: true,
          per_action_limit: 20n,
          window_limit: "100",
          allowed_assets: [assetId],
        },
        nonce: null,
        updated_at_block: 99,
      },
      policy_spends: [
        {
          account,
          asset_id: assetId,
          window: 86400,
          amount: 5000n,
          spent: "1200",
          updated_at_block: "101",
        },
        { account, asset_id: assetId, amount: "missing-window" },
      ],
    }));

    expect(result).toEqual({
      schemaVersion: 1,
      account,
      spendLimit: 3,
      smartAccount: {
        kind: "smart_account",
        account,
        controller,
        recovery: null,
        policyHash,
        policy: null,
        nonce: "9",
        updatedAtBlock: 100,
      },
      policyAccount: {
        kind: "policy_account",
        account,
        controller: null,
        recovery,
        policyHash,
        policy: {
          enabled: true,
          perActionLimit: "20",
          windowLimit: "100",
          allowedAssets: [assetId],
        },
        nonce: null,
        updatedAtBlock: 99,
      },
      policySpends: [{
        account,
        assetId,
        window: "86400",
        amount: "5000",
        spent: "1200",
        updatedAtBlock: 101,
      }],
    });
  });

  it("tolerates legacy policy-account rows without policy bodies", () => {
    const result = normalizeMrcAccountResponse(mrcAccountPayload({
      smartAccount: null,
      policyAccount: {
        kind: "policy_account",
        account,
        controller,
        recovery: null,
        policyHash,
        policy: null,
        nonce: null,
        updatedAtBlock: 200,
      },
      policySpends: [],
    }));

    expect(result?.policyAccount).toEqual({
      kind: "policy_account",
      account,
      controller,
      recovery: null,
      policyHash,
      policy: null,
      nonce: null,
      updatedAtBlock: 200,
    });
    expect(result?.policySpends).toEqual([]);
  });

  it("reads MRC account data from the REST path before RPC fallback", async () => {
    const calls: Array<[string, unknown]> = [];
    const api = {
      async get<T>(path: string, query?: unknown): Promise<T> {
        calls.push([path, query]);
        return apiEnvelope(mrcAccountPayload()) as T;
      },
    };
    const rpc = {
      async call() {
        throw new Error("RPC fallback should not run");
      },
    };

    const result = await fetchMrcAccount(account, 2, { api, rpc });

    expect(calls).toEqual([[`/mrc/accounts/${account}`, { limit: 2 }]]);
    expect(result?.smartAccount?.controller).toBe(controller);
    expect(result?.policySpends[0].assetId).toBe(assetId);
  });

  it("falls back to lyth_mrcAccount JSON-RPC when REST is unavailable", async () => {
    const calls: Array<[string, unknown]> = [];
    const api = {
      async get() {
        throw new Error("not found");
      },
    };
    const rpc = {
      async call<T>(method: string, params?: unknown): Promise<T> {
        calls.push([method, params]);
        return mrcAccountPayload({
          smartAccount: null,
          policyAccount: {
            kind: "policy_account",
            account,
            controller,
            recovery: null,
            policyHash,
            nonce: null,
            updatedAtBlock: 200,
          },
        }) as T;
      },
    };

    const result = await fetchMrcAccount(account, 4, { api, rpc });

    expect(calls).toEqual([["lyth_mrcAccount", [account, 4]]]);
    expect(result?.smartAccount).toBeNull();
    expect(result?.policyAccount?.kind).toBe("policy_account");
    expect(result?.policySpends).toHaveLength(1);
  });

  it("uses an installed lythMrcAccount wrapper when present", async () => {
    const calls: Array<[string, number | undefined]> = [];
    const api = {
      async get() {
        throw new Error("not found");
      },
    };
    const rpc = {
      async lythMrcAccount(accountArg: string, limitArg?: number) {
        calls.push([accountArg, limitArg]);
        return mrcAccountPayload({ policySpends: [] });
      },
    };

    const result = await fetchMrcAccount(account, 5, { api, rpc });

    expect(calls).toEqual([[account, 5]]);
    expect(result?.policySpends).toEqual([]);
    expect(result?.spendLimit).toBe(2);
  });
});

describe("bridge trust disclosure normalization", () => {
  const validDisclosure = {
    routeId: "eth-usdc-mainnet",
    bridge: "ThirdParty Light Client",
    asset: "USDC",
    sourceChain: "ethereum",
    destinationChain: "monolythium",
    verifier: {
      model: "zk-light-client",
      participantCount: 12,
      threshold: 8,
    },
    drainCapAtomic: "250000000000",
    finalityBlocks: 64,
    cooldownSeconds: 7200,
    adminControl: "consensusOnly",
    circuitBreaker: "armed",
    insuranceAtomic: "500000000000",
  };

  it("normalizes and assesses a valid upstream route disclosure", () => {
    const rows = bridgeTrustDisclosuresFromAddressData({
      address: "mono1bridgeuser",
      bridgeRouteDisclosures: [validDisclosure],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].route.bridge).toBe("ThirdParty Light Client");
    expect(rows[0].route.verifier.threshold).toBe(8);
    expect(rows[0].route.drainCapAtomic).toBe("250000000000");
    expect(rows[0].route.finalityBlocks).toBe(64);
    expect(rows[0].route.cooldownSeconds).toBe(7200);
    expect(rows[0].route.circuitBreaker).toBe("armed");
    expect(rows[0].route.insuranceAtomic).toBe("500000000000");
    expect(rows[0].assessment.accepted).toBe(true);
    expect(rows[0].assessment.riskTier).toBe("low");
  });

  it("normalizes catalogue binding fields and discovery-only readiness flags", () => {
    const route = normalizeBridgeRouteDisclosure({
      route_id: "catalogue-usdc-mainnet",
      bridge_name: "Catalogue Relay",
      bridge_id: "bridge-catalogue-1",
      wrapped_asset: "mrc:wrapped-usdc",
      from_chain: "ethereum",
      to_chain: "monolythium",
      verifier_config: {
        type: "committee",
        signer_count: 9,
        required_signers: 6,
      },
      drain_cap_atomic: "250000000000",
      finality_delay_blocks: 64,
      cooldown_seconds: 7200,
      admin_control: "consensus_only",
      breaker: "armed",
      insurance_pool_atomic: "500000000000",
      route_selection_ready: false,
      quote_ready: false,
      submit_ready: false,
      blocked_reasons: ["bridge route selection requires transfer intent"],
    });

    expect(route?.routeId).toBe("catalogue-usdc-mainnet");
    expect(route?.bridgeId).toBe("bridge-catalogue-1");
    expect(route?.asset).toBe("mrc:wrapped-usdc");
    expect(route?.wrappedAsset).toBe("mrc:wrapped-usdc");
    expect(route?.adminControl).toBe("consensusOnly");
    expect(route?.insuranceAtomic).toBe("500000000000");
    expect(route?.routeSelectionReady).toBe(false);
    expect(route?.quoteReady).toBe(false);
    expect(route?.submitReady).toBe(false);
    expect(route?.readinessBlockedReasons).toEqual(["bridge route selection requires transfer intent"]);
  });

  it("collects direct and listed route disclosures from token-balance records", () => {
    const directBalanceDisclosure = {
      ...validDisclosure,
      routeId: "balance-direct",
      bridge: "Balance Direct Bridge",
    };
    const listedBalanceDisclosure = {
      ...validDisclosure,
      routeId: "balance-listed",
      bridge: "Balance Listed Bridge",
      sourceChain: "solana",
    };

    const rows = bridgeTrustDisclosuresFromAddressData({
      address: "mono1bridgeuser",
      tokenBalances: [{
        tokenId: "profile-token",
        balance: "1",
        updatedAtBlock: 1,
        bridgeRouteDisclosure: directBalanceDisclosure,
      }],
    }, [{
      tokenId: "api-token",
      balance: "2",
      updatedAtBlock: 2,
      bridgeRouteDisclosures: [listedBalanceDisclosure],
    }]);

    const direct = rows.find((row) => row.route.routeId === "balance-direct");
    const listed = rows.find((row) => row.route.routeId === "balance-listed");
    expect(rows).toHaveLength(2);
    expect(direct?.source).toBe("tokenBalance:profile-token");
    expect(listed?.source).toBe("tokenBalance:api-token[0]");
    expect(direct?.assessment.accepted).toBe(true);
    expect(listed?.assessment.accepted).toBe(true);
  });

  it("keeps invalid disclosure data blocked instead of treating it as accepted", () => {
    const rows = assessBridgeTrustDisclosures([{
      source: "tokenBalance:bad",
      value: {
        ...validDisclosure,
        routeId: "bad-route",
        verifier: { model: "single-signer", participantCount: 1, threshold: 1 },
        drainCapAtomic: "0",
        cooldownSeconds: 0,
        circuitBreaker: "disabled",
        insuranceAtomic: "0",
      },
    }]);

    expect(rows).toHaveLength(1);
    expect(rows[0].assessment.accepted).toBe(false);
    expect(rows[0].assessment.riskTier).toBe("blocked");
    expect(rows[0].assessment.blockedReasons).toContain("verifier set must not be 1-of-1");
    expect(rows[0].assessment.blockedReasons).toContain("per-asset drain cap missing or zero");
    expect(rows[0].assessment.blockedReasons).toContain("route cooldown missing");
    expect(rows[0].assessment.blockedReasons).toContain("route circuit breaker missing");
    expect(rows[0].assessment.blockedReasons).toContain("slashable insurance pool missing or zero");
  });

  it("ranks disclosures deterministically and exposes a bounded preferred display slice", () => {
    const pausedDisclosure = {
      ...validDisclosure,
      routeId: "paused-route",
      circuitBreaker: "paused",
    };
    const shortCooldownDisclosure = {
      ...validDisclosure,
      routeId: "short-cooldown",
      cooldownSeconds: 60,
    };
    const healthyDisclosure = {
      ...validDisclosure,
      routeId: "healthy-route",
    };

    const rows = assessBridgeTrustDisclosures([
      { source: "addressProfile[0]", value: pausedDisclosure },
      { source: "addressProfile[1]", value: shortCooldownDisclosure },
      { source: "addressProfile[2]", value: healthyDisclosure },
    ]);
    const slice = bridgeTrustDisclosureDisplaySlice(rows, 2);

    expect(rows.map((row) => row.route.routeId)).toEqual([
      "healthy-route",
      "short-cooldown",
      "paused-route",
    ]);
    expect(slice.preferred?.route.routeId).toBe("healthy-route");
    expect(slice.rows.map((row) => row.route.routeId)).toEqual(["healthy-route", "short-cooldown"]);
    expect(slice.hiddenCount).toBe(1);
    expect(slice.totalCount).toBe(3);
  });

  it("merges address and route-discovery disclosures without duplicating routes", () => {
    const addressRows = assessBridgeTrustDisclosures([
      { source: "addressProfile[0]", value: validDisclosure },
    ]);
    const discoveryRows = assessBridgeTrustDisclosures([
      { source: "bridgeRoutes[0]", value: validDisclosure },
      {
        source: "bridgeRoutes[1]",
        value: {
          ...validDisclosure,
          routeId: "eth-usdc-slow",
          cooldownSeconds: 86_400,
        },
      },
    ]);

    const rows = mergeBridgeTrustDisclosures([...addressRows, ...discoveryRows]);

    expect(rows.map((row) => row.route.routeId)).toEqual(["eth-usdc-mainnet", "eth-usdc-slow"]);
    expect(rows[0].source).toBe("addressProfile[0]");
  });

  it("reports bridge cooldown, finality, circuit-breaker, and insurance failure details from disclosures", () => {
    const rows = assessBridgeTrustDisclosures([{
      source: "addressProfile[0]",
      value: {
        ...validDisclosure,
        routeId: "bad-controls",
        finalityBlocks: 0,
        cooldownSeconds: 0,
        circuitBreaker: "disabled",
        insuranceAtomic: "0",
      },
    }]);

    expect(bridgeRouteDisclosureFailureDetails(rows[0])).toEqual([
      "cooldown missing (0s)",
      "finality missing (0 blocks)",
      "circuit breaker disabled",
      "insurance missing or zero (0)",
    ]);
  });

  it("does not synthesize a route when upstream disclosure metadata is absent", () => {
    expect(normalizeBridgeRouteDisclosure({ bridge: true })).toBeNull();
    expect(bridgeTrustDisclosuresFromAddressData({
      address: "mono1plain",
      tokenBalances: [{ tokenId: "plain", balance: "1", updatedAtBlock: 1 }],
    })).toEqual([]);
  });
});

describe("API execution-unit transformations", () => {
  it("maps new API block fields to the RPC header shape", () => {
    const header = apiBlockToRpcHeader({
      height: 42,
      blockHash: "0xblock",
      parentHash: "0xparent",
      stateRoot: "0xstate",
      timestamp: 1_700_000_000,
      executionUnitsUsed: 123_456,
      executionUnitLimit: 30_000_000,
      basePricePerCycleLythoshi: "4",
    } as any);

    expect(header.executionUnitsUsed).toBe(123_456n);
    expect(header.executionUnitLimit).toBe(30_000_000n);
  });

  it("maps new API transaction and receipt lythoshi fields to the RPC detail shape", () => {
    const tx = apiTxToRpcTx({
      txHash: "0xtx",
      blockHash: "0xblock",
      blockHeight: 42,
      txIndex: 3,
      from: "0xfrom",
      to: "0xto",
      nonce: 9,
      valueLythoshi: "1234",
      maxExecutionFeeLythoshi: "55",
      priorityTipLythoshi: "7",
      executionUnitLimit: 42_000,
      fee: { total_lythoshi: "77" },
      input: "0xabcdef",
      signedEnvelope: "0xsigned",
    } as any, 69_420);
    const receipt = apiReceiptToRpcReceipt({
      txHash: "0xtx",
      blockHash: "0xblock",
      blockHeight: 42,
      txIndex: 3,
      status: 1,
      executionUnitsUsed: 21_111,
      logs: [],
    } as any);

    expect(tx.value).toBe("0x4d2");
    expect(tx.gas).toBe("0xa410");
    expect(tx.maxFeePerGas).toBe("0x37");
    expect(tx.maxPriorityFeePerGas).toBe("0x7");
    expect(receipt.executionUnitsUsed).toBe(21_111n);
  });

  it("maps new decoded transaction fields with older payload fallbacks", () => {
    const decoded = {
      txHash: "0xtx",
      blockHash: "0xblock",
      blockNumber: 42n,
      txIndex: 3,
      from: "0xfrom",
      to: null,
      valueLythoshi: "1234",
      nonce: 9n,
      executionUnitLimit: 42_000n,
      maxExecutionFeeLythoshi: "55",
      priorityTipLythoshi: "7",
      executionUnitsUsed: 21_111n,
      fee: { total_lythoshi: "77" },
      decodedCalldata: { rawCalldata: "0xabcdef" },
      memo: null,
      logs: [],
      status: "success",
      errorCode: null,
    };

    expect(decodedTxToRpcTx(decoded as any).gas).toBe("0xa410");
    expect(decodedTxToRpcReceipt(decoded as any).executionUnitsUsed).toBe(21_111n);

    expect(decodedTxToRpcTx({ ...decoded, valueLythoshi: undefined, executionUnitLimit: undefined, value: "0x2a", gasLimit: 21_000n } as any).value).toBe("0x2a");
  });

  it("normalizes recent transaction rows from API pages and tx feeds", () => {
    const fee = nativeFee();
    const pageRows = apiBlockTransactionsToRows({
      block: { timestamp: 1_700_000_000 },
      transactions: [{
        txHash: "0xtx",
        blockHash: "0xblock",
        blockHeight: 42,
        txIndex: 3,
        from: "0xfrom",
        to: "0xto",
        valueLythoshi: "1234",
        executionUnitLimit: 42_000,
        fee,
        input: "0x",
      }],
    } as any);
    const feedRows = txFeedToRows({
      transactions: [{
        txHash: "0xfeed",
        blockHash: "0xblock",
        blockNumber: 43,
        blockTimestamp: null,
        txIndex: 0,
        from: "0xfrom",
        to: null,
        value: "999",
        executionUnitLimit: 21_000,
        fee,
        input: "0x",
      }],
    } as any);

    expect(pageRows[0]).toMatchObject({ value: "1234", executionUnitLimit: 42_000, fee });
    expect(pageRows[0]?.feeDisplay?.totalLythoshi).toBe("7700000000");
    expect(feedRows[0]).toMatchObject({ value: "999", executionUnitLimit: 21_000, fee });
    expect(feedRows[0]?.feeDisplay?.defaultFeeText).toBe("Network fee: 77 LYTH");
  });

  it("does not accept legacy embedded fee keys as valid ADR-0039 fees", () => {
    const legacyFee = nativeFee({ gasUsed: "21000" });
    const fee = structuredNativeReceiptFee(legacyFee);
    const feedRows = txFeedToRows({
      transactions: [{
        txHash: "0xfeed",
        blockHash: "0xblock",
        blockNumber: 43,
        blockTimestamp: null,
        txIndex: 0,
        from: "0xfrom",
        to: null,
        value: "999",
        executionUnitLimit: 21_000,
        fee: legacyFee,
        input: "0x",
      }],
    } as any);

    expect(fee).toBeNull();
    expect(feedRows[0]?.fee).toBeNull();
    expect(feedRows[0]?.feeDisplay).toBeNull();
  });

  it("maps native RISC-V receipt events into transaction-detail display rows", () => {
    const receipt = {
      txHash: `0x${"22".repeat(32)}`,
      blockHash: `0x${"33".repeat(32)}`,
      blockHeight: 100,
      txIndex: 0,
      schema: "riscv.receipt.v1",
      artifactHash: `0x${"aa".repeat(32)}`,
      receiptCommitment: `0x${"bb".repeat(32)}`,
      counters: { cycles: 44, syscallUnits: 3, stateIoUnits: 2 },
      fee: {
        total_lythoshi: "440000000000",
        total_lyth: "4,400",
        cycles_used: 44,
        base_price_per_cycle_lythoshi: "10000000000",
        state_io_units: 2,
        state_io_price_per_unit_lythoshi: "0",
        priority_tip_lythoshi: "0",
      },
      reverted: false,
      nativeDeltaCount: 0,
      eventCount: 1,
      events: [
        {
          blockHeight: 100,
          txIndex: 0,
          logIndex: 0,
          address: "monoc1nativeeventemitter",
          eventTopic: `0x${"11".repeat(32)}`,
          decoded: null,
          decodedJson: JSON.stringify({
            block_height: 100,
            tx_index: 0,
            sequence: 0,
            family: "mrc",
            event_name: "mrc4626.deposit",
            payload_hash: `0x${"44".repeat(32)}`,
            amount_lythoshi: "440000000000",
            share_amount: "120000000",
            contract_address: "monoc1escrowcontract",
          }),
        },
      ],
      source: {
        chainProvider: "mock_chain",
        indexerProvider: "native_events",
        metadataLogIndex: 0xffff_ffff,
      },
    };
    const rows = nativeReceiptEventRows(receipt);

    expect(rows).toEqual([
      {
        logIndex: 0,
        address: "monoc1nativeeventemitter",
        eventTopic: `0x${"11".repeat(32)}`,
        family: "mrc",
        eventName: "mrc4626.deposit",
        payloadHash: `0x${"44".repeat(32)}`,
        decodedFields: [
          ["amount_lythoshi", "440000000000"],
          ["share_amount", "120000000"],
          ["contract_address", "monoc1escrowcontract"],
        ],
      },
    ]);
    expect(nativeReceiptMarketEventRows(receipt)).toEqual([]);
  });

  it("extracts native market events from decoded receipt fields", () => {
    const rows = nativeReceiptMarketEventRows({
      txHash: `0x${"22".repeat(32)}`,
      blockHash: `0x${"33".repeat(32)}`,
      blockHeight: 101,
      txIndex: 0,
      schema: "riscv.receipt.v1",
      artifactHash: `0x${"aa".repeat(32)}`,
      receiptCommitment: `0x${"bc".repeat(32)}`,
      counters: { cycles: 10, syscallUnits: 1, stateIoUnits: 0 },
      fee: {
        total_lythoshi: "1",
        total_lyth: "0.00000001",
        cycles_used: 10,
        base_price_per_cycle_lythoshi: "0",
        state_io_units: 0,
        state_io_price_per_unit_lythoshi: "0",
        priority_tip_lythoshi: "1",
      },
      reverted: false,
      nativeDeltaCount: 0,
      eventCount: 2,
      events: [
        {
          blockHeight: 101,
          txIndex: 0,
          logIndex: 0,
          address: "monoc1market",
          eventTopic: `0x${"12".repeat(32)}`,
          decoded: null,
          decodedJson: JSON.stringify({
            family: "native.market",
            event_name: "market.order.filled",
            payload_hash: `0x${"55".repeat(32)}`,
            market_id: `0x${"66".repeat(32)}`,
            price_lythoshi: "100000000",
          }),
        },
        {
          blockHeight: 101,
          txIndex: 0,
          logIndex: 1,
          address: "monoc1agent",
          eventTopic: `0x${"13".repeat(32)}`,
          decoded: null,
          decodedJson: JSON.stringify({
            family: "agent",
            event_name: "agent.updated",
          }),
        },
      ],
      source: {
        chainProvider: "mock_chain",
        indexerProvider: "native_events",
        metadataLogIndex: 0xffff_ffff,
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      address: "monoc1market",
      family: "native.market",
      eventName: "market.order.filled",
    });
    expect(rows[0].decodedFields).toContainEqual(["market_id", `0x${"66".repeat(32)}`]);
    expect(rows[0].decodedFields).toContainEqual(["price_lythoshi", "100000000"]);
  });

  it("extracts bounded MRV submitted, included, receipt, and explicit null-proof states without inventing proof", () => {
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"88".repeat(32)}`,
      blockNumber: 120n,
      status: "success",
      decodedCalldata: {
        kind: "mrv_deploy",
        nativeTx: {
          extensions: [{
            kind: MRV_NATIVE_TX_EXTENSION_KIND,
            bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
          }],
        },
      },
      pqAttestation: {
        checkpointHeight: 118n,
      },
      finalityProof: null,
    } as any, {
      txHash: `0x${"88".repeat(32)}`,
      blockHash: `0x${"33".repeat(32)}`,
      blockHeight: 120,
      txIndex: 0,
      schema: "riscv.receipt.v1",
      txType: MRV_NATIVE_RECEIPT_TX_TYPE,
      artifactHash: `0x${"aa".repeat(32)}`,
      receiptCommitment: `0x${"13".repeat(32)}`,
      noEvmProof: null,
      counters: { cycles: 44, syscallUnits: 3, stateIoUnits: 2 },
      fee: {
        total_lythoshi: "440000000000",
        total_lyth: "4,400",
        cycles_used: 44,
        base_price_per_cycle_lythoshi: "10000000000",
        state_io_units: 2,
        state_io_price_per_unit_lythoshi: "0",
        priority_tip_lythoshi: "0",
      },
      reverted: false,
      nativeDeltaCount: 2,
      eventCount: 1,
      events: [],
      source: {
        chainProvider: "mock_chain",
        indexerProvider: "native_events",
        metadataLogIndex: 0xffff_ffff,
      },
    } as any);

    expect(evidence).toMatchObject({
      operation: "mrv_deploy",
      submittedState: "present",
      includedState: "present",
      receiptState: "present",
      proofState: "missing",
      proofFieldSource: "native-receipt.noEvmProof",
      proofFieldState: "explicit-null",
      includedBlock: 120,
      receiptTxType: MRV_NATIVE_RECEIPT_TX_TYPE,
      artifactHash: `0x${"aa".repeat(32)}`,
      receiptCommitment: `0x${"13".repeat(32)}`,
      pqCheckpoint: "checkpoint #118",
    });
    expect(evidence?.proof).toBeNull();
    expect(evidence?.extension).toMatchObject({
      kind: MRV_NATIVE_TX_EXTENSION_KIND,
      bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
      validMrvV1: true,
    });
    expect(evidence?.blockers).toContain(
      "native-receipt.noEvmProof returned null; Monoscan treats the no-EVM receipt proof evidence as missing until a bounded receipts transcript or compact receipt inclusion proof is available.",
    );
  });

  it("marks no-EVM receipt proof present only when native receipt noEvmProof is a valid transcript", () => {
    const noEvmProof = noEvmReceiptProofTranscript({
      txHash: `0x${"77".repeat(32)}`,
      blockHash: `0x${"34".repeat(32)}`,
      blockHeight: 122,
      txIndex: 0,
      receiptCount: 2,
      receiptTranscript: ["0x01", "0x0203"],
    });
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"77".repeat(32)}`,
      blockNumber: 122n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
      finalityProof: { verifier: "finality-only" },
    } as any, {
      ...nativeReceiptFixture({
        txHash: `0x${"77".repeat(32)}`,
        blockHash: `0x${"34".repeat(32)}`,
        blockHeight: 122,
        txType: MRV_NATIVE_RECEIPT_TX_TYPE,
        noEvmProof,
      }),
    } as any);

    expect(evidence).toMatchObject({
      proofState: "present",
      proofFieldSource: "native-receipt.noEvmProof",
      proofFieldState: "present",
    });
    expect(evidence?.proof).toMatchObject({
      source: "native-receipt.noEvmProof",
      summary: "canonicalReceiptsTranscript · block 122 · tx 1/2 · 2 receipt blobs",
      transcript: noEvmProof,
      consistency: {
        state: "verified",
        computedReceiptsRoot: noEvmProof.receiptsRoot,
        computedTargetReceiptHash: noEvmProof.targetReceiptHash,
        receiptCountMatches: true,
        targetReceiptAvailable: true,
        mismatches: [],
      },
      validationErrors: [],
    });
    expect(evidence?.blockers).not.toContain(
      "native-receipt.noEvmProof must return a bounded receipts transcript or compact receipt inclusion proof before Monoscan can render no-EVM receipt proof evidence.",
    );
  });

  it("accepts compact no-EVM receipt proofs sourced from the indexer receipt archive", () => {
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      txHash: `0x${"78".repeat(32)}`,
      blockHash: `0x${"35".repeat(32)}`,
      blockHeight: 123,
    });
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"78".repeat(32)}`,
      blockNumber: 123n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      ...nativeReceiptFixture({
        txHash: `0x${"78".repeat(32)}`,
        blockHash: `0x${"35".repeat(32)}`,
        blockHeight: 123,
        txIndex: 0,
        txType: MRV_NATIVE_RECEIPT_TX_TYPE,
        noEvmProof,
      }),
    } as any);

    expect(evidence).toMatchObject({
      proofState: "present",
      proofFieldSource: "native-receipt.noEvmProof",
      proofFieldState: "present",
    });
    expect(evidence?.proof).toMatchObject({
      source: "native-receipt.noEvmProof",
      proofKind: "compactInclusion",
      historySource: "indexerReceiptArchive",
      materialLabel: "indexer receipt archive · compact inclusion proof",
      summary: "canonicalReceiptInclusion · indexer receipt archive · block 123 · tx 1/1 · compact Merkle path 0 sibling hashes",
      transcript: noEvmProof,
      consistency: {
        state: "verified",
        proofKind: "compactInclusion",
        historySource: "indexerReceiptArchive",
        computedReceiptsRoot: noEvmProof.receiptsRoot,
        computedTargetReceiptHash: noEvmProof.targetReceiptHash,
        receiptCountMatches: null,
        targetReceiptAvailable: true,
        compactPathMatches: true,
        mismatches: [],
      },
      validationErrors: [],
    });
    expect(evidence?.blockers).not.toContain(
      "native-receipt.noEvmProof must return a bounded receipts transcript or compact receipt inclusion proof before Monoscan can render no-EVM receipt proof evidence.",
    );
  });

  it("accepts non-empty archive proof signatures that match the snapshot signature envelope", () => {
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      txHash: `0x${"7b".repeat(32)}`,
      blockHash: `0x${"37".repeat(32)}`,
      blockHeight: 126,
      archiveProof: {
        schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
        source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
        manifestHash: `0x${"44".repeat(32)}`,
        contentHash: `0x${"55".repeat(32)}`,
        signatureDigest: validArchiveSignatureDigest,
        signatures: [validArchiveProofSignature],
      },
    });
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"7b".repeat(32)}`,
      blockNumber: 126n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      ...nativeReceiptFixture({
        txHash: `0x${"7b".repeat(32)}`,
        blockHash: `0x${"37".repeat(32)}`,
        blockHeight: 126,
        txIndex: 0,
        txType: MRV_NATIVE_RECEIPT_TX_TYPE,
        noEvmProof,
      }),
    } as any);

    expect(evidence).toMatchObject({
      proofState: "present",
      proofFieldSource: "native-receipt.noEvmProof",
    });
    expect(evidence?.proof?.validationErrors).toEqual([]);
    expect((evidence?.proof?.transcript as NoEvmCompactReceiptProofTranscript | null)?.archiveProof)
      .toMatchObject({
        signatureDigest: validArchiveSignatureDigest,
        signatures: [validArchiveProofSignature],
      });
  });

  it("accepts and preserves archive covering snapshot evidence", () => {
    const coveringSnapshot = validArchiveCoveringSnapshot();
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      txHash: `0x${"7f".repeat(32)}`,
      blockHash: `0x${"3c".repeat(32)}`,
      blockHeight: 126,
      archiveProof: {
        schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
        source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
        manifestHash: `0x${"44".repeat(32)}`,
        contentHash: `0x${"55".repeat(32)}`,
        signatureDigest: null,
        signatures: [],
        coveringSnapshot,
      } as any,
    });
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"7f".repeat(32)}`,
      blockNumber: 126n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      ...nativeReceiptFixture({
        txHash: `0x${"7f".repeat(32)}`,
        blockHash: `0x${"3c".repeat(32)}`,
        blockHeight: 126,
        txIndex: 0,
        txType: MRV_NATIVE_RECEIPT_TX_TYPE,
        noEvmProof,
      }),
    } as any);

    expect(evidence).toMatchObject({
      proofState: "present",
      proofFieldSource: "native-receipt.noEvmProof",
    });
    expect(evidence?.proof?.validationErrors).toEqual([]);
    expect((evidence?.proof?.transcript as NoEvmCompactReceiptProofTranscript | null)?.archiveProof)
      .toMatchObject({
        contentHash: `0x${"55".repeat(32)}`,
        signatures: [],
        coveringSnapshot,
      });
    expect((evidence?.proof?.transcript as NoEvmCompactReceiptProofTranscript | null)?.archiveProof)
      .not.toHaveProperty("signatureDigest");
  });

  it("marks parsed archive signatures unconfigured when trusted archive signers are absent", () => {
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      archiveProof: {
        schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
        source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
        manifestHash: `0x${"44".repeat(32)}`,
        contentHash: `0x${"55".repeat(32)}`,
        signatureDigest: validArchiveSignatureDigest,
        signatures: [validArchiveProofSignature],
      },
    });

    const verification = verifyNoEvmReceiptArchiveProofSignatures(noEvmProof, null);

    expect(verification).toMatchObject({
      state: "unconfigured",
      result: null,
      reason: "trusted archive signer config not configured",
      signatureSource: "exactHeight",
    });
  });

  it("verifies exact-height archive signatures with configured trusted ML-DSA signers", () => {
    const signature = signedArchiveProofSignature(verifiedArchiveSigner, validArchiveSignatureDigest);
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      txHash: `0x${"81".repeat(32)}`,
      blockHash: `0x${"3d".repeat(32)}`,
      blockHeight: 133,
      archiveProof: {
        schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
        source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
        manifestHash: `0x${"44".repeat(32)}`,
        contentHash: `0x${"55".repeat(32)}`,
        signatureDigest: validArchiveSignatureDigest,
        signatures: [signature],
      },
    });

    const verification = verifyNoEvmReceiptArchiveProofSignatures(noEvmProof, verifiedArchiveTrustOptions);
    expect(verification).toMatchObject({
      state: "verified",
      reason: null,
      signatureSource: "exactHeight",
      result: {
        verified: true,
        threshold: 1,
        validSigners: [verifiedArchiveSigner.getAddress()],
        checkedSignatures: 1,
        issues: [],
      },
    });

    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"81".repeat(32)}`,
      blockNumber: 133n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      ...nativeReceiptFixture({
        txHash: `0x${"81".repeat(32)}`,
        blockHash: `0x${"3d".repeat(32)}`,
        blockHeight: 133,
        txType: MRV_NATIVE_RECEIPT_TX_TYPE,
        noEvmProof,
      }),
    } as any, null, verifiedArchiveTrustOptions);

    expect(evidence?.proof?.archiveVerification).toMatchObject({
      state: "verified",
      reason: null,
      signatureSource: "exactHeight",
    });
  });

  it("verifies covering snapshot archive signatures when exact-height signatures are absent", () => {
    const signatureDigest = `0x${"62".repeat(32)}`;
    const signature = signedArchiveProofSignature(verifiedArchiveSigner, signatureDigest);
    const coveringSnapshot = validArchiveCoveringSnapshot({
      signatureDigest,
      signatures: [signature],
    });
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      blockHeight: 126,
      archiveProof: {
        schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
        source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
        manifestHash: `0x${"44".repeat(32)}`,
        contentHash: `0x${"55".repeat(32)}`,
        signatureDigest: null,
        signatures: [],
        coveringSnapshot,
      } as any,
    });

    const verification = verifyNoEvmReceiptArchiveProofSignatures(noEvmProof, verifiedArchiveTrustOptions);

    expect(verification).toMatchObject({
      state: "verified",
      reason: null,
      signatureSource: "coveringSnapshot",
      result: {
        verified: true,
        validSigners: [verifiedArchiveSigner.getAddress()],
        checkedSignatures: 1,
      },
    });
  });

  it("reports archive signature mismatch and malformed trusted archive config distinctly", () => {
    const wrongDigestSignature = signedArchiveProofSignature(verifiedArchiveSigner, `0x${"67".repeat(32)}`);
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      archiveProof: {
        schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
        source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
        manifestHash: `0x${"44".repeat(32)}`,
        contentHash: `0x${"55".repeat(32)}`,
        signatureDigest: validArchiveSignatureDigest,
        signatures: [wrongDigestSignature],
      },
    });

    expect(verifyNoEvmReceiptArchiveProofSignatures(noEvmProof, verifiedArchiveTrustOptions))
      .toMatchObject({
        state: "mismatch",
        signatureSource: "exactHeight",
        result: {
          verified: false,
        },
      });
    expect(verifyNoEvmReceiptArchiveProofSignatures(noEvmProof, {
      ...verifiedArchiveTrustOptions,
      threshold: 2,
    })).toMatchObject({
      state: "malformed",
      result: null,
      reason: "trusted archive signer config invalid: trusted archive threshold cannot exceed trusted public key count",
    });
  });

  it.each([
    {
      name: "manifest hash",
      patch: { manifestHash: `0x${"61".repeat(31)}` },
      error: "archiveProof.coveringSnapshot.manifestHash must be a 32-byte 0x hex value",
    },
    {
      name: "signature digest",
      patch: { signatureDigest: `0x${"62".repeat(31)}` },
      error: "archiveProof.coveringSnapshot.signatureDigest must be a 32-byte 0x hex value",
    },
    {
      name: "content hash",
      patch: { contentHash: `0x${"63".repeat(31)}` },
      error: "archiveProof.coveringSnapshot.contentHash must be a 32-byte 0x hex value",
    },
    {
      name: "checkpoint content hash",
      patch: { checkpointContentHash: `0x${"64".repeat(31)}` },
      error: "archiveProof.coveringSnapshot.checkpointContentHash must be a 32-byte 0x hex value",
    },
    {
      name: "checkpoint from",
      patch: { checkpointFrom: 1 },
      error: "archiveProof.coveringSnapshot.checkpointFrom must be 0",
    },
    {
      name: "checkpoint range",
      patch: { checkpointTo: 131 },
      error: "archiveProof.coveringSnapshot.checkpointTo must be <= snapshotHeight",
    },
    {
      name: "checkpoint height",
      patch: { checkpointTo: 125 },
      error: "archiveProof.coveringSnapshot.checkpointTo must match blockHeight",
    },
    {
      name: "checkpoint content mismatch",
      patch: { checkpointContentHash: `0x${"56".repeat(32)}` },
      error: "archiveProof.coveringSnapshot.checkpointContentHash must match archiveProof.contentHash",
    },
    {
      name: "empty signatures",
      patch: { signatures: [] },
      error: "archiveProof.coveringSnapshot.signatures must be non-empty",
    },
    {
      name: "malformed signature",
      patch: { signatures: [`mono.snapshot.sig.v1:0x${"ab".repeat(19)}:0x1234`] },
      error: "archiveProof.coveringSnapshot.signatures[0] signer id must be a 20-byte 0x hex value",
    },
  ])("fails closed for malformed archive covering snapshot $name", ({ patch, error }) => {
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"80".repeat(32)}`,
      blockNumber: 126n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      ...nativeReceiptFixture({
        txHash: `0x${"80".repeat(32)}`,
        blockHeight: 126,
        txType: MRV_NATIVE_RECEIPT_TX_TYPE,
        noEvmProof: compactNoEvmReceiptProofTranscript({
          txHash: `0x${"80".repeat(32)}`,
          blockHeight: 126,
          archiveProof: {
            schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
            source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
            manifestHash: `0x${"44".repeat(32)}`,
            contentHash: `0x${"55".repeat(32)}`,
            signatureDigest: null,
            signatures: [],
            coveringSnapshot: {
              ...validArchiveCoveringSnapshot(),
              ...patch,
            },
          } as any,
        }),
      }),
    } as any);

    expect(evidence).toMatchObject({
      proofState: "invalid",
      proofFieldSource: "native-receipt.noEvmProof",
      proofFieldState: "present",
    });
    expect(evidence?.proof?.transcript).toBeNull();
    expect(evidence?.proof?.validationErrors).toContain(error);
    expect(evidence?.blockers.some((blocker) => blocker.includes(error))).toBe(true);
  });

  it.each([
    { name: "absent", archiveProofPatch: {} },
    { name: "null", archiveProofPatch: { signatureDigest: null } },
  ])("accepts $name archive proof signatureDigest without preserving a digest", ({ archiveProofPatch }) => {
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      txHash: `0x${"7d".repeat(32)}`,
      blockHash: `0x${"38".repeat(32)}`,
      blockHeight: 128,
      archiveProof: {
        schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
        source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
        manifestHash: `0x${"44".repeat(32)}`,
        contentHash: `0x${"55".repeat(32)}`,
        signatures: [],
        ...archiveProofPatch,
      } as any,
    });
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"7d".repeat(32)}`,
      blockNumber: 128n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      ...nativeReceiptFixture({
        txHash: `0x${"7d".repeat(32)}`,
        blockHash: `0x${"38".repeat(32)}`,
        blockHeight: 128,
        txIndex: 0,
        txType: MRV_NATIVE_RECEIPT_TX_TYPE,
        noEvmProof,
      }),
    } as any);

    expect(evidence).toMatchObject({
      proofState: "present",
      proofFieldSource: "native-receipt.noEvmProof",
    });
    expect(evidence?.proof?.validationErrors).toEqual([]);
    expect((evidence?.proof?.transcript as NoEvmCompactReceiptProofTranscript | null)?.archiveProof)
      .not.toHaveProperty("signatureDigest");
  });

  it.each([
    { name: "wrong length", signatureDigest: `0x${"66".repeat(31)}` },
    { name: "non-hex", signatureDigest: `0x${"66".repeat(31)}zz` },
    { name: "non-string", signatureDigest: 66 },
  ])("fails closed for $name archive proof signatureDigest", ({ signatureDigest }) => {
    const error = "archiveProof.signatureDigest must be a 32-byte 0x hex value";
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"7e".repeat(32)}`,
      blockNumber: 129n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      ...nativeReceiptFixture({
        txHash: `0x${"7e".repeat(32)}`,
        blockHeight: 129,
        txType: MRV_NATIVE_RECEIPT_TX_TYPE,
        noEvmProof: compactNoEvmReceiptProofTranscript({
          txHash: `0x${"7e".repeat(32)}`,
          blockHeight: 129,
          archiveProof: {
            schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
            source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
            manifestHash: `0x${"44".repeat(32)}`,
            contentHash: `0x${"55".repeat(32)}`,
            signatureDigest,
            signatures: [],
          } as any,
        }),
      }),
    } as any);

    expect(evidence).toMatchObject({
      proofState: "invalid",
      proofFieldSource: "native-receipt.noEvmProof",
      proofFieldState: "present",
    });
    expect(evidence?.proof?.transcript).toBeNull();
    expect(evidence?.proof?.validationErrors).toContain(error);
    expect(evidence?.blockers).toContain(
      `native-receipt.noEvmProof returned an invalid compact receipt inclusion proof: ${error}.`,
    );
  });

  it.each([
    {
      name: "malformed prefix",
      signature: `mono.snapshot.sig.v0:0x${"ab".repeat(20)}:0x1234`,
      error: "archiveProof.signatures[0] prefix must be mono.snapshot.sig.v1",
    },
    {
      name: "field count",
      signature: `mono.snapshot.sig.v1:0x${"ab".repeat(20)}:0x1234:extra`,
      error: "archiveProof.signatures[0] must have 3 colon-separated fields",
    },
    {
      name: "signer id length",
      signature: `mono.snapshot.sig.v1:0x${"ab".repeat(19)}:0x1234`,
      error: "archiveProof.signatures[0] signer id must be a 20-byte 0x hex value",
    },
    {
      name: "signer id hex",
      signature: `mono.snapshot.sig.v1:0x${"ab".repeat(19)}zz:0x1234`,
      error: "archiveProof.signatures[0] signer id must be a 20-byte 0x hex value",
    },
    {
      name: "empty payload",
      signature: `mono.snapshot.sig.v1:0x${"ab".repeat(20)}:0x`,
      error: "archiveProof.signatures[0] payload must be a non-empty 0x hex byte blob",
    },
    {
      name: "payload hex",
      signature: `mono.snapshot.sig.v1:0x${"ab".repeat(20)}:0x123z`,
      error: "archiveProof.signatures[0] payload must be a non-empty 0x hex byte blob",
    },
  ])("fails closed for $name archive proof signatures", ({ signature, error }) => {
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"7c".repeat(32)}`,
      blockNumber: 127n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      ...nativeReceiptFixture({
        txHash: `0x${"7c".repeat(32)}`,
        blockHeight: 127,
        txType: MRV_NATIVE_RECEIPT_TX_TYPE,
        noEvmProof: compactNoEvmReceiptProofTranscript({
          txHash: `0x${"7c".repeat(32)}`,
          blockHeight: 127,
          archiveProof: {
            schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
            source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
            manifestHash: `0x${"44".repeat(32)}`,
            contentHash: `0x${"55".repeat(32)}`,
            signatures: [signature],
          },
        }),
      }),
    } as any);

    expect(evidence).toMatchObject({
      proofState: "invalid",
      proofFieldSource: "native-receipt.noEvmProof",
      proofFieldState: "present",
    });
    expect(evidence?.proof?.transcript).toBeNull();
    expect(evidence?.proof?.validationErrors).toContain(error);
    expect(evidence?.blockers).toContain(
      `native-receipt.noEvmProof returned an invalid compact receipt inclusion proof: ${error}.`,
    );
  });

  it("uses bundled registry archive and cluster finality trust when env and options are absent", () => {
    setTestnetReceiptProofTrust(registryReceiptProofTrustPolicy());
    const noEvmProof = compactVerifiedTrustProof();

    expect(verifyNoEvmReceiptArchiveProofSignatures(noEvmProof)).toMatchObject({
      state: "verified",
      reason: null,
      signatureSource: "exactHeight",
      result: {
        verified: true,
        validSigners: [verifiedArchiveSigner.getAddress()],
      },
    });
    expect(verifyNoEvmReceiptFinalityEvidence(noEvmProof)).toMatchObject({
      state: "verified",
      reason: null,
      result: {
        verified: true,
        acceptedSignatureCount: 1,
        requiredSignatureCount: 1,
      },
    });
  });

  it("keeps no-EVM proof trust unconfigured when the bundled registry policy is null", () => {
    setTestnetReceiptProofTrust(null);
    const noEvmProof = compactVerifiedTrustProof();

    expect(verifyNoEvmReceiptArchiveProofSignatures(noEvmProof)).toMatchObject({
      state: "unconfigured",
      result: null,
      reason: "trusted archive signer config not configured",
    });
    expect(verifyNoEvmReceiptFinalityEvidence(noEvmProof)).toMatchObject({
      state: "unverified",
      result: null,
      reason: "trusted BLS finality key not configured",
    });
  });

  it("lets explicit no-EVM trust options override the bundled registry policy", () => {
    setTestnetReceiptProofTrust(registryReceiptProofTrustPolicy({
      archiveSigner: untrustedArchiveSigner,
      finalityChainId: 69_421,
    }));
    const noEvmProof = compactVerifiedTrustProof();

    expect(verifyNoEvmReceiptArchiveProofSignatures(noEvmProof, verifiedArchiveTrustOptions))
      .toMatchObject({
        state: "verified",
        reason: null,
      });
    expect(verifyNoEvmReceiptFinalityEvidence(noEvmProof, verifiedBlsTrustOptions))
      .toMatchObject({
        state: "verified",
        reason: null,
      });
  });

  it("lets env no-EVM trust config override the bundled registry policy", () => {
    setTestnetReceiptProofTrust(registryReceiptProofTrustPolicy());
    vi.stubEnv("VITE_MONOSCAN_CHAIN_ID", "69421");
    vi.stubEnv("VITE_MONOSCAN_TRUSTED_BLS_CLUSTER_PUBKEY", verifiedBlsClusterPublicKey);
    vi.stubEnv("VITE_MONOSCAN_TRUSTED_BLS_COMMITTEE_SIZE", "7");
    vi.stubEnv("VITE_MONOSCAN_TRUSTED_BLS_THRESHOLD", "1");
    vi.stubEnv("VITE_MONOSCAN_TRUSTED_ARCHIVE_PUBKEYS", sdkBytesToHex(untrustedArchiveSigner.publicKey()));
    vi.stubEnv("VITE_MONOSCAN_TRUSTED_ARCHIVE_THRESHOLD", "1");
    const noEvmProof = compactVerifiedTrustProof();

    expect(verifyNoEvmReceiptArchiveProofSignatures(noEvmProof)).toMatchObject({
      state: "mismatch",
      signatureSource: "exactHeight",
      result: {
        verified: false,
        validSigners: [],
      },
    });
    expect(verifyNoEvmReceiptFinalityEvidence(noEvmProof)).toMatchObject({
      state: "mismatch",
      result: {
        verified: false,
        signatureValid: false,
      },
      reason: "BLS signature invalid",
    });
  });

  it("fails closed when the bundled registry finality policy uses multisig mode", () => {
    setTestnetReceiptProofTrust(registryReceiptProofTrustPolicy({ finalityMode: "multisig" }));
    const noEvmProof = compactVerifiedTrustProof();

    expect(verifyNoEvmReceiptFinalityEvidence(noEvmProof)).toMatchObject({
      state: "mismatch",
      result: null,
      reason: "registry BLS finality trust policy mode multisig is not supported by Monoscan threshold-cluster verification",
    });
  });

  it("accepts BLS finality evidence on compact no-EVM receipt proofs as certificate material", () => {
    const finalityEvidence = blsFinalityEvidence(57);
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      txHash: `0x${"79".repeat(32)}`,
      blockHash: `0x${"36".repeat(32)}`,
      blockHeight: 124,
      finalityEvidence,
      missingProofMaterial: [
        "signed archive or snapshot manifest binding receipt bytes to blockHash and receiptsRoot",
      ],
    });
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"79".repeat(32)}`,
      blockNumber: 124n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      ...nativeReceiptFixture({
        txHash: `0x${"79".repeat(32)}`,
        blockHash: `0x${"36".repeat(32)}`,
        blockHeight: 124,
        txIndex: 0,
        txType: MRV_NATIVE_RECEIPT_TX_TYPE,
        noEvmProof,
      }),
    } as any);

    expect(evidence).toMatchObject({
      proofState: "present",
      proofFieldSource: "native-receipt.noEvmProof",
      proofFieldState: "present",
    });
    expect(evidence?.proof?.transcript).toMatchObject({
      finalityEvidence,
      missingProofMaterial: [
        "signed archive or snapshot manifest binding receipt bytes to blockHash and receiptsRoot",
      ],
    });
    expect(evidence?.proof?.validationErrors).toEqual([]);
    expect(evidence?.proof?.finalityVerification).toMatchObject({
      state: "unverified",
      result: null,
      reason: "trusted BLS finality key not configured",
    });
    expect(evidence?.blockers).not.toContain(
      "native-receipt.noEvmProof must return a bounded receipts transcript or compact receipt inclusion proof before Monoscan can render no-EVM receipt proof evidence.",
    );
  });

  it("verifies BLS finality evidence when a trusted cluster key policy is supplied", () => {
    const finalityEvidence = verifiedBlsFinalityEvidence();
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      txHash: `0x${"7f".repeat(32)}`,
      blockHash: `0x${"39".repeat(32)}`,
      blockHeight: 130,
      finalityEvidence,
    });

    const verification = verifyNoEvmReceiptFinalityEvidence(noEvmProof, verifiedBlsTrustOptions);
    expect(verification).toMatchObject({
      state: "verified",
      reason: null,
      result: {
        verified: true,
        signatureValid: true,
        acceptedSignatureCount: 1,
        requiredSignatureCount: 1,
      },
    });

    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"7f".repeat(32)}`,
      blockNumber: 130n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      ...nativeReceiptFixture({
        txHash: `0x${"7f".repeat(32)}`,
        blockHash: `0x${"39".repeat(32)}`,
        blockHeight: 130,
        txIndex: 0,
        txType: MRV_NATIVE_RECEIPT_TX_TYPE,
        noEvmProof,
      }),
    } as any, verifiedBlsTrustOptions);

    expect(evidence?.proof?.finalityVerification).toMatchObject({
      state: "verified",
      reason: null,
      result: {
        verified: true,
        signerCountMatches: true,
        signerBitmapMatchesIndices: true,
        signerIndicesInRange: true,
        thresholdMet: true,
        signatureValid: true,
      },
    });
  });

  it("marks configured BLS finality evidence mismatched for the wrong chain id", () => {
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      txHash: `0x${"70".repeat(32)}`,
      blockHash: `0x${"3a".repeat(32)}`,
      blockHeight: 131,
      finalityEvidence: verifiedBlsFinalityEvidence(),
    });

    const verification = verifyNoEvmReceiptFinalityEvidence(noEvmProof, {
      ...verifiedBlsTrustOptions,
      chainId: 69_421,
    });

    expect(verification).toMatchObject({
      state: "mismatch",
      result: {
        verified: false,
        signatureValid: false,
      },
      reason: "BLS signature invalid",
    });
  });

  it("fails closed when configured BLS finality trust policy is malformed", () => {
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      txHash: `0x${"71".repeat(32)}`,
      blockHash: `0x${"3b".repeat(32)}`,
      blockHeight: 132,
      finalityEvidence: verifiedBlsFinalityEvidence(),
    });

    const verification = verifyNoEvmReceiptFinalityEvidence(noEvmProof, {
      ...verifiedBlsTrustOptions,
      clusterPublicKey: "0x12",
    });

    expect(verification).toMatchObject({
      state: "mismatch",
      result: null,
      reason: "trusted BLS finality config invalid: trusted BLS cluster public key must be 48 bytes",
    });
  });

  it("recomputes no-EVM receipt transcript hashes with the runtime receipts root algorithm", () => {
    const noEvmProof = noEvmReceiptProofTranscript();
    const consistency = verifyNoEvmReceiptProofConsistency(noEvmProof);

    expect(noEvmProof.receiptsRoot).toBe("0x814f52159bd2ab66f3b21a6d13332cc7b5fb6bd4418c193d1e8d5e1965dcb57c");
    expect(noEvmProof.targetReceiptHash).toBe("0x65b043cdd93fde12ee6629de2d9ce786ba7d5b4c514afecea4d1b4b2c740087c");
    expect(consistency).toMatchObject({
      state: "verified",
      computedReceiptsRoot: noEvmProof.receiptsRoot,
      computedTargetReceiptHash: noEvmProof.targetReceiptHash,
      receiptCountMatches: true,
      targetReceiptAvailable: true,
      mismatches: [],
    });
  });

  it("marks well-formed no-EVM receipt proof transcripts invalid when self-consistency fails", () => {
    const noEvmProof = noEvmReceiptProofTranscript({
      txHash: `0x${"75".repeat(32)}`,
      blockHeight: 124,
      receiptCount: 3,
      receiptsRoot: `0x${"44".repeat(32)}`,
    });
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"75".repeat(32)}`,
      blockNumber: 124n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      ...nativeReceiptFixture({
        txHash: `0x${"75".repeat(32)}`,
        blockHeight: 124,
        txType: MRV_NATIVE_RECEIPT_TX_TYPE,
        noEvmProof,
      }),
    } as any);

    expect(evidence).toMatchObject({
      proofState: "invalid",
      proofFieldSource: "native-receipt.noEvmProof",
      proofFieldState: "present",
    });
    expect(evidence?.proof?.transcript).toEqual(noEvmProof);
    expect(evidence?.proof?.validationErrors).toEqual([]);
    expect(evidence?.proof?.consistency).toMatchObject({
      state: "mismatch",
      receiptCountMatches: false,
      targetReceiptAvailable: true,
    });
    expect(evidence?.proof?.consistency?.mismatches).toContain("receiptCount 3 does not match 2 receipt blobs");
    expect(evidence?.proof?.consistency?.mismatches).toContain("receiptsRoot mismatch");
    expect(evidence?.blockers).toContain(
      "native-receipt.noEvmProof returned a bounded receipts transcript that failed self-consistency: receiptCount 3 does not match 2 receipt blobs; receiptsRoot mismatch.",
    );
  });

  it("marks malformed no-EVM receipt proof transcripts invalid without treating them as missing", () => {
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"76".repeat(32)}`,
      blockNumber: 123n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      ...nativeReceiptFixture({
        txHash: `0x${"76".repeat(32)}`,
        blockHeight: 123,
        txType: MRV_NATIVE_RECEIPT_TX_TYPE,
        noEvmProof: {
          ...noEvmReceiptProofTranscript({
            txHash: `0x${"76".repeat(32)}`,
            blockHeight: 123,
            txIndex: 2,
            receiptCount: 2,
          }),
          schema: "mono.no_evm_receipt_proof.v0",
          receiptTranscript: ["0x01", "not-hex"],
        },
      }),
    } as any);

    expect(evidence).toMatchObject({
      proofState: "invalid",
      proofFieldSource: "native-receipt.noEvmProof",
      proofFieldState: "present",
    });
    expect(evidence?.proof?.transcript).toBeNull();
    expect(evidence?.proof?.validationErrors).toContain(`schema must be ${NO_EVM_RECEIPT_PROOF_SCHEMA}`);
    expect(evidence?.proof?.validationErrors).toContain("receiptTranscript[1] must be a 0x byte blob");
    expect(evidence?.proof?.validationErrors).toContain("txIndex must be less than receiptCount");
    expect(evidence?.blockers).toContain(
      `native-receipt.noEvmProof returned an invalid bounded receipts transcript: schema must be ${NO_EVM_RECEIPT_PROOF_SCHEMA}; txIndex must be less than receiptCount; receiptTranscript[1] must be a 0x byte blob.`,
    );
  });

  it("marks malformed no-EVM finality evidence invalid without treating the proof as missing", () => {
    const malformedFinalityEvidence = {
      ...blsFinalityEvidence(58),
      source: "sevenNodeLiveFinalityProof",
    };
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"7a".repeat(32)}`,
      blockNumber: 125n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      ...nativeReceiptFixture({
        txHash: `0x${"7a".repeat(32)}`,
        blockHeight: 125,
        txType: MRV_NATIVE_RECEIPT_TX_TYPE,
        noEvmProof: compactNoEvmReceiptProofTranscript({
          txHash: `0x${"7a".repeat(32)}`,
          blockHeight: 125,
          finalityEvidence: malformedFinalityEvidence as NoEvmReceiptFinalityEvidence,
        }),
      }),
    } as any);

    expect(evidence).toMatchObject({
      proofState: "invalid",
      proofFieldSource: "native-receipt.noEvmProof",
      proofFieldState: "present",
    });
    expect(evidence?.proof?.transcript).toBeNull();
    expect(evidence?.proof?.validationErrors).toContain(
      `finalityEvidence.source must be ${NO_EVM_RECEIPT_FINALITY_EVIDENCE_SOURCE}`,
    );
    expect(evidence?.blockers).toContain(
      `native-receipt.noEvmProof returned an invalid compact receipt inclusion proof: finalityEvidence.source must be ${NO_EVM_RECEIPT_FINALITY_EVIDENCE_SOURCE}.`,
    );
  });

  it("reports the exact native-receipt route needed when only the MRV extension is exposed", () => {
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"99".repeat(32)}`,
      blockNumber: 121n,
      decodedCalldata: {
        txExtensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          body: [1],
        }],
      },
      finalityProof: { verifier: "fixture" },
    } as any, null);

    expect(evidence).toMatchObject({
      submittedState: "present",
      includedState: "present",
      receiptState: "missing",
      proofState: "missing",
      proofFieldSource: null,
      proofFieldState: "missing",
    });
    expect(evidence?.extension?.bodyHex).toBe(MRV_NATIVE_TX_EXTENSION_BODY_HEX);
    expect(evidence?.blockers).toContain(
      "GET /api/v1/transactions/{hash}/native-receipt or lyth_nativeReceipt(txHash) must return txType 0x41, artifactHash, counters, and events for MRV receipt evidence.",
    );
    expect(evidence?.blockers).toContain(
      "native-receipt.noEvmProof must return a bounded receipts transcript or compact receipt inclusion proof before Monoscan can render no-EVM receipt proof evidence.",
    );
  });

  it("omits MRV evidence for ordinary transaction-detail payloads", () => {
    expect(mrvNativeTransactionEvidence({
      txHash: `0x${"10".repeat(32)}`,
      blockNumber: 122n,
      decodedCalldata: { method: "transfer(address,uint256)" },
      finalityProof: null,
    } as any, null)).toBeNull();
  });
});
