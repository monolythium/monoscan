import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { keccak256 } from "ethers/crypto";
import type { ReactElement } from "react";
import {
  AgentReputationCard,
  BridgeTrustDisclosuresCard,
  MrvNativeEvidenceCard,
  NativeAgentActionsCard,
  NativeAgentStateCard,
  adr0039FeeDetailText,
  mrcPolicyAllowedAssetsSummary,
  mrcPolicyBodySummary,
  redemptionTicketStatusText,
  tokenBalanceMetadataLines,
  tokenBalancePrimaryWithMetadata,
  tokenBalanceStandardLabel,
  transactionFeeValueLabel,
  type IndexedTokenBalanceRow,
} from "./monoscan-extras";
import type { AgentReputationResponse } from "@monolythium/core-sdk";
import { MlDsa65Backend, bytesToHex as sdkBytesToHex } from "@monolythium/core-sdk/crypto";
import {
  bridgeTrustDisclosuresFromAddressData,
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
  verifyNoEvmReceiptProofConsistency,
  type NoEvmArchiveVerificationTrustOptions,
  type MrcMetadataResponse,
  type NativeAgentStateDisplayRows,
  type NativeAgentStateDisplayRow,
  type NoEvmFinalityVerificationTrustOptions,
  type NoEvmArchiveCoveringSnapshot,
  type NoEvmCompactReceiptProofTranscript,
  type NoEvmReceiptFinalityEvidence,
  type NoEvmReceiptProofTranscript,
} from "./data/hooks";

function nativeAgentRows(
  overrides: Partial<NativeAgentStateDisplayRows> = {},
): NativeAgentStateDisplayRows {
  return {
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
    ...overrides,
  };
}

function renderWithQueryClient(element: ReactElement): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  );
}

function noEvmReceiptProofTranscript(
  overrides: Partial<NoEvmReceiptProofTranscript> = {},
): NoEvmReceiptProofTranscript {
  const transcript: NoEvmReceiptProofTranscript = {
    schema: NO_EVM_RECEIPT_PROOF_SCHEMA,
    proofType: NO_EVM_RECEIPT_PROOF_TYPE,
    rootAlgorithm: NO_EVM_RECEIPTS_ROOT_ALGORITHM,
    receiptCodec: "rlp",
    blockHash: `0x${"cd".repeat(32)}`,
    txHash: `0x${"ab".repeat(32)}`,
    receiptsRoot: `0x${"00".repeat(32)}`,
    targetReceiptHash: `0x${"00".repeat(32)}`,
    blockHeight: 321,
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
    blockHash: `0x${"cd".repeat(32)}`,
    txHash: `0x${"ab".repeat(32)}`,
    receiptsRoot,
    targetReceiptHash,
    blockHeight: 321,
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

const validArchiveSignatureDigest = `0x${"66".repeat(32)}`;
const validArchiveProofSignature =
  `mono.snapshot.sig.v1:0x${"ab".repeat(20)}:0x${"12".repeat(64)}`;
const verifiedArchiveSigner = MlDsa65Backend.fromSeed(new Uint8Array(32).fill(12));
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
    snapshotHeight: 330,
    manifestHash: `0x${"61".repeat(32)}`,
    signatureDigest: `0x${"62".repeat(32)}`,
    contentHash: `0x${"63".repeat(32)}`,
    checkpointContentHash: `0x${"55".repeat(32)}`,
    checkpointFrom: 0,
    checkpointTo: 321,
    signatures: [validArchiveProofSignature],
    ...overrides,
  };
}

function renderMrvArchiveEvidenceHtml(
  noEvmProof: NoEvmCompactReceiptProofTranscript,
  archiveTrustOptions?: NoEvmArchiveVerificationTrustOptions | null,
): string {
  const evidence = mrvNativeTransactionEvidence({
    txHash: noEvmProof.txHash,
    blockNumber: BigInt(noEvmProof.blockHeight),
    decodedCalldata: {
      kind: "mrv_call",
      extensions: [{
        kind: MRV_NATIVE_TX_EXTENSION_KIND,
        bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
      }],
    },
  } as any, {
    txHash: noEvmProof.txHash,
    blockHash: noEvmProof.blockHash,
    blockHeight: noEvmProof.blockHeight,
    txIndex: noEvmProof.txIndex,
    schema: "riscv.receipt.v1",
    txType: MRV_NATIVE_RECEIPT_TX_TYPE,
    artifactHash: `0x${"ef".repeat(32)}`,
    receiptCommitment: `0x${"19".repeat(32)}`,
    noEvmProof,
    counters: { cycles: 12, syscallUnits: 2, stateIoUnits: 1 },
    fee: {
      total_lythoshi: "12",
      total_lyth: "0.00000012",
      cycles_used: 12,
      base_price_per_cycle_lythoshi: "1",
      state_io_units: 1,
      state_io_price_per_unit_lythoshi: "0",
      priority_tip_lythoshi: "0",
    },
    reverted: false,
    nativeDeltaCount: 1,
    eventCount: 2,
    events: [],
    source: {
      chainProvider: "mock_chain",
      indexerProvider: "native_events",
      metadataLogIndex: 0xffff_ffff,
    },
  } as any, null, archiveTrustOptions);

  return renderToStaticMarkup(<MrvNativeEvidenceCard evidence={evidence}/>);
}

describe("redemptionTicketStatusText", () => {
  it("separates cooldown maturity from payout availability", () => {
    expect(redemptionTicketStatusText(true)).toBe("Cooldown complete · payout unavailable");
    expect(redemptionTicketStatusText(false)).toBe("Cooldown active");
    expect(redemptionTicketStatusText(null)).toBe("Cooldown state pending");
  });
});

describe("transactionFeeValueLabel", () => {
  it("renders SDK structured fee display without converting through number", () => {
    expect(transactionFeeValueLabel({
      defaultFeeText: "Network fee: 123,456,789,012.34567891 LYTH",
      detailTexts: [],
      totalLythoshi: "12345678901234567891",
      totalLyth: "123,456,789,012.34567891",
    }, 0.0001)).toBe("123,456,789,012.34567891 LYTH");
  });

  it("falls back to fixture fee text only when no structured fee display exists", () => {
    expect(transactionFeeValueLabel(null, 0.012345, "LYTH")).toBe("0.0123 LYTH");
    expect(transactionFeeValueLabel(null, null)).toBe("—");
  });
});

describe("adr0039FeeDetailText", () => {
  it("relabels inherited fee terms before rendering explorer fee details", () => {
    expect(adr0039FeeDetailText("gas price 10 gwei · gas used 42 · gas limit 100 · base fee per gas · total 1 wei"))
      .toBe("execution unit price 10 lythoshi · execution units used 42 · execution unit limit 100 · base fee per execution unit · total 1 lythoshi");
  });

  it("keeps ADR-0039-native fee detail text unchanged", () => {
    expect(adr0039FeeDetailText("cycles 42, state I/O 8, total 50000 lythoshi"))
      .toBe("cycles 42, state I/O 8, total 50000 lythoshi");
  });
});

describe("token-balance MRC display labels", () => {
  const vaultId = `0x${"46".repeat(32)}`;
  const addressProfileVaultBalance: IndexedTokenBalanceRow = {
    tokenId: vaultId,
    balance: "700",
    updatedAtBlock: 92,
    mrc: {
      standard: "mrc4626",
      assetId: vaultId,
      tokenId: null,
    },
  };

  it("labels address-profile MRC-4626 balances as vault shares without metadata", () => {
    const primary = tokenBalancePrimaryWithMetadata(addressProfileVaultBalance, undefined);

    expect(tokenBalanceStandardLabel(addressProfileVaultBalance.mrc?.standard)).toBe("MRC-4626 vault shares");
    expect(primary).toContain("MRC-4626 vault shares");
    expect(primary).not.toContain("Indexed");
    expect(primary).not.toContain("Unknown");
  });

  it("keeps the MRC-4626 vault-share standard visible when metadata is present", () => {
    const metadata: MrcMetadataResponse = {
      schemaVersion: 1,
      assetId: vaultId,
      tokenId: null,
      metadata: {
        standard: "mrc4626",
        assetId: vaultId,
        tokenId: null,
        name: "Vault Shares",
        symbol: "vLYTH",
        decimals: 8,
        uri: null,
        updatedAtBlock: 146,
      },
    };

    expect(tokenBalancePrimaryWithMetadata(addressProfileVaultBalance, metadata)).toBe("Vault Shares (vLYTH)");
    expect(tokenBalanceMetadataLines(addressProfileVaultBalance, metadata)).toContain("MRC-4626 vault shares");
  });
});

describe("MRC policy-account display labels", () => {
  it("summarizes policy bodies and legacy null bodies", () => {
    const policy = {
      enabled: true,
      perActionLimit: "20",
      windowLimit: "100",
      allowedAssets: [`0x${"aa".repeat(32)}`, `0x${"bb".repeat(32)}`],
    };

    expect(mrcPolicyBodySummary(policy)).toBe("enabled · per-action 20 · window 100 · 2 allowed assets");
    expect(mrcPolicyAllowedAssetsSummary(policy, 1)).toBe(`0x${"aa".repeat(4)}…${"aa".repeat(2)} +1 more`);
    expect(mrcPolicyBodySummary(null)).toBe("—");
    expect(mrcPolicyAllowedAssetsSummary(null)).toBe("—");
  });
});

describe("NativeAgentStateCard", () => {
  it("renders live native agent rows without placeholder state", () => {
    const policyRow: NativeAgentStateDisplayRow = {
      kind: "spendingPolicy",
      primaryId: `0x${"aa".repeat(32)}`,
      account: "mono1agentowner",
      counterparty: "mono1agentcontroller",
      nonce: "6",
      assetId: `0x${"cc".repeat(32)}`,
      status: "enabled",
      amount: "500",
      blockHeight: 42,
      fields: [],
    };
    const serviceRow: NativeAgentStateDisplayRow = {
      kind: "service",
      primaryId: `0x${"bb".repeat(32)}`,
      account: "mono1agentprovider",
      counterparty: null,
      nonce: "4",
      assetId: null,
      status: "active",
      amount: null,
      blockHeight: 43,
      fields: [],
    };

    const html = renderToStaticMarkup(
      <NativeAgentStateCard
        rows={nativeAgentRows({ spendingPolicies: [policyRow], services: [serviceRow] })}
        loading={false}
      />,
    );

    expect(html).toContain("Native agent state");
    expect(html).toContain("Policy");
    expect(html).toContain("Service");
    expect(html).toContain("mono1agentowner");
    expect(html).toContain("mono1agentprovider");
    expect(html).toContain("6");
    expect(html).toContain("4");
    expect(html).not.toContain("No native agent state rows");
  });

  it("renders an explicit empty state when the node returns no rows", () => {
    const html = renderToStaticMarkup(
      <NativeAgentStateCard
        rows={nativeAgentRows()}
        loading={false}
      />,
    );

    expect(html).toContain("No native agent state rows reported for this account.");
  });
});

describe("AgentReputationCard", () => {
  const provider = "mono1zg69v7y6hn00qyfzxdz92enh3zv64w7vajvdc4";

  it("renders category reputation evidence from the typed aggregate", () => {
    const reputation: AgentReputationResponse = {
      schemaVersion: 1,
      provider,
      categoryId: 7,
      categoryScope: "category",
      record: {
        provider,
        categoryId: 7,
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

    const html = renderToStaticMarkup(<AgentReputationCard reputation={reputation}/>);

    expect(html).toContain("Agent reputation");
    expect(html).toContain("lyth_agentReputation");
    expect(html).toContain("Category 7");
    expect(html).toContain("5");
    expect(html).toContain("123");
    expect(html).toContain("Speed");
    expect(html).toContain("9.2 / 10");
    expect(html).toContain("Accuracy");
    expect(html).toContain("8.6 / 10");
  });

  it("renders a no-record state when the aggregate is present without samples", () => {
    const reputation: AgentReputationResponse = {
      schemaVersion: 1,
      provider,
      categoryId: 0,
      categoryScope: "global",
      record: null,
    };

    const html = renderToStaticMarkup(<AgentReputationCard reputation={reputation}/>);

    expect(html).toContain("Global");
    expect(html).toContain("No reputation records reported for this provider category.");
    expect(html).not.toContain("Reputation unavailable");
  });

  it("renders an explicit unavailable state when no aggregate is returned", () => {
    const html = renderToStaticMarkup(
      <AgentReputationCard
        reputation={null}
        provider={provider}
        categoryId={12}
        checked
      />,
    );

    expect(html).toContain("Category 12");
    expect(html).toContain("Reputation unavailable");
    expect(html).toContain("No lyth_agentReputation aggregate returned for this provider category.");
    expect(html).toContain("mono1zg69v7y6hn00q…vdc4");
  });
});

describe("NativeAgentActionsCard", () => {
  it("renders the full native agent action catalogue", () => {
    const html = renderWithQueryClient(
      <NativeAgentActionsCard
        capabilities={{
          blockNumber: 12n,
          capabilities: {},
          nativeModuleForwarders: {
            agent: [{
              module: "agent",
              requestBytes: 196,
              contractAddress: "0x2222222222222222222222222222222222222222",
              artifactProfile: "native-call-forwarder-v1",
              status: "configured",
              deploymentVerified: false,
            }],
          },
        }}
      />,
    );

    expect(html).toContain("Native agent actions");
    expect(html).toContain("Issuer / Register issuer");
    expect(html).toContain("Attestation / Issue attestation");
    expect(html).toContain("Consent / Grant consent");
    expect(html).toContain("Discovery / List service");
    expect(html).toContain("Availability / Set availability");
    expect(html).toContain("Arbiter / Register arbiter");
    expect(html).toContain("Policy / Set spending policy");
    expect(html).toContain("Escrow / Resolve escrow");
    expect(html).toContain("Reputation / Record reputation");
    expect(html).toContain("1 capability rows");
    expect(html).toContain("monolythium_submitMrvNativeCall");
  });
});

describe("MrvNativeEvidenceCard", () => {
  it("renders MRV submitted, included, receipt, and blocked proof states honestly", () => {
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"ab".repeat(32)}`,
      blockNumber: 321n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
      finalityProof: null,
    } as any, {
      txHash: `0x${"ab".repeat(32)}`,
      blockHash: `0x${"cd".repeat(32)}`,
      blockHeight: 321,
      txIndex: 0,
      schema: "riscv.receipt.v1",
      txType: MRV_NATIVE_RECEIPT_TX_TYPE,
      artifactHash: `0x${"ef".repeat(32)}`,
      receiptCommitment: `0x${"19".repeat(32)}`,
      noEvmProof: null,
      counters: { cycles: 12, syscallUnits: 2, stateIoUnits: 1 },
      fee: {
        total_lythoshi: "12",
        total_lyth: "0.00000012",
        cycles_used: 12,
        base_price_per_cycle_lythoshi: "1",
        state_io_units: 1,
        state_io_price_per_unit_lythoshi: "0",
        priority_tip_lythoshi: "0",
      },
      reverted: false,
      nativeDeltaCount: 1,
      eventCount: 2,
      events: [],
      source: {
        chainProvider: "mock_chain",
        indexerProvider: "native_events",
        metadataLogIndex: 0xffff_ffff,
      },
    } as any);

    const html = renderToStaticMarkup(<MrvNativeEvidenceCard evidence={evidence}/>);

    expect(html).toContain("MRV native evidence");
    expect(html).toContain("Submitted");
    expect(html).toContain("kind 0x30");
    expect(html).toContain("body 0x01");
    expect(html).toContain("Included");
    expect(html).toContain("block 321");
    expect(html).toContain("Receipt");
    expect(html).toContain("txType 0x41");
    expect(html).toContain("Receipt commitment");
    expect(html).toContain("present · 0x1919191919191919");
    expect(html).toContain("native-receipt.receiptCommitment");
    expect(html).toContain("No-EVM receipt proof");
    expect(html).toContain("missing · native-receipt.noEvmProof returned null; no-EVM receipt proof evidence not rendered");
    expect(html).toContain("native-receipt.noEvmProof returned null");
    expect(html).not.toContain("proof evidence present");
  });

  it("renders compact bounded receipts transcript details for valid no-EVM receipt proof evidence", () => {
    const noEvmProof = noEvmReceiptProofTranscript();
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"ab".repeat(32)}`,
      blockNumber: 321n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      txHash: `0x${"ab".repeat(32)}`,
      blockHash: `0x${"cd".repeat(32)}`,
      blockHeight: 321,
      txIndex: 1,
      schema: "riscv.receipt.v1",
      txType: MRV_NATIVE_RECEIPT_TX_TYPE,
      artifactHash: `0x${"ef".repeat(32)}`,
      receiptCommitment: `0x${"19".repeat(32)}`,
      noEvmProof,
      counters: { cycles: 12, syscallUnits: 2, stateIoUnits: 1 },
      fee: {
        total_lythoshi: "12",
        total_lyth: "0.00000012",
        cycles_used: 12,
        base_price_per_cycle_lythoshi: "1",
        state_io_units: 1,
        state_io_price_per_unit_lythoshi: "0",
        priority_tip_lythoshi: "0",
      },
      reverted: false,
      nativeDeltaCount: 1,
      eventCount: 2,
      events: [],
      source: {
        chainProvider: "mock_chain",
        indexerProvider: "native_events",
        metadataLogIndex: 0xffff_ffff,
      },
    } as any);

    const html = renderToStaticMarkup(<MrvNativeEvidenceCard evidence={evidence}/>);

    expect(html).toContain("transcript verified");
    expect(html).toContain("No-EVM receipt proof");
    expect(html).toContain("verified · bounded receipts transcript · canonicalReceiptsTranscript · block 321 · tx 2/2 · 2 receipt blobs");
    expect(html).toContain("Transcript check");
    expect(html).toContain("verified · computed");
    expect(html).toContain(noEvmProof.receiptsRoot.slice(0, 18));
    expect(html).toContain(noEvmProof.targetReceiptHash.slice(0, 18));
    expect(html).toContain("Transcript codec");
    expect(html).toContain("keccak256(&quot;monolythium/v2/receipts_root/1&quot;");
    expect(html).toContain("rlp");
    expect(html).toContain("Transcript anchors");
    expect(html).toContain("block 0xcdcdcdcdcdcdcdcd");
    expect(html).toContain("tx 0xabababababababab");
    expect(html).toContain("Receipt root");
    expect(html).toContain(noEvmProof.receiptsRoot.slice(0, 18));
    expect(html).toContain(`target ${noEvmProof.targetReceiptHash.slice(0, 18)}`);
    expect(html).toContain("Receipt transcript");
    expect(html).toContain("2 receipt blobs · receiptCount 2 · txIndex 1");
    expect(html).not.toContain("Finality proof");
  });

  it("renders compact indexer archive receipt proof material without implying validator finality", () => {
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      archiveProof: {
        schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
        source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
        manifestHash: `0x${"44".repeat(32)}`,
        contentHash: `0x${"55".repeat(32)}`,
        signatureDigest: validArchiveSignatureDigest,
        signatures: [],
      },
    });
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"ab".repeat(32)}`,
      blockNumber: 321n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      txHash: `0x${"ab".repeat(32)}`,
      blockHash: `0x${"cd".repeat(32)}`,
      blockHeight: 321,
      txIndex: 0,
      schema: "riscv.receipt.v1",
      txType: MRV_NATIVE_RECEIPT_TX_TYPE,
      artifactHash: `0x${"ef".repeat(32)}`,
      receiptCommitment: `0x${"19".repeat(32)}`,
      noEvmProof,
      counters: { cycles: 12, syscallUnits: 2, stateIoUnits: 1 },
      fee: {
        total_lythoshi: "12",
        total_lyth: "0.00000012",
        cycles_used: 12,
        base_price_per_cycle_lythoshi: "1",
        state_io_units: 1,
        state_io_price_per_unit_lythoshi: "0",
        priority_tip_lythoshi: "0",
      },
      reverted: false,
      nativeDeltaCount: 1,
      eventCount: 2,
      events: [],
      source: {
        chainProvider: "mock_chain",
        indexerProvider: "native_events",
        metadataLogIndex: 0xffff_ffff,
      },
    } as any);

    const html = renderToStaticMarkup(<MrvNativeEvidenceCard evidence={evidence}/>);

    expect(html).toContain("compact inclusion verified");
    expect(html).toContain("verified · compact receipt inclusion · canonicalReceiptInclusion · indexer receipt archive · block 321 · tx 1/1 · compact Merkle path 0 sibling hashes");
    expect(html).toContain("Proof material");
    expect(html).toContain("indexer receipt archive · compact inclusion proof");
    expect(html).toContain("Compact proof check");
    expect(html).toContain("verified · compact path verified");
    expect(html).toContain("Compact inclusion");
    expect(html).toContain(`root ${noEvmProof.receiptsRoot.slice(0, 18)}`);
    expect(html).toContain("Archive binding");
    expect(html).toContain("indexerReceiptArchiveContentDigest");
    expect(html).toContain("manifest 0x4444444444444444");
    expect(html).toContain("content 0x5555555555555555");
    expect(html).toContain("Archive signature verification");
    expect(html).toContain("unconfigured · trusted archive signer config not configured; parsed only · not validator finality or availability proof");
    expect(html).toContain("Archive signature digest");
    expect(html).toContain("0x6666666666666666");
    expect(html).toContain("snapshot archive signature digest material");
    expect(html).toContain("not validator finality or availability proof");
    expect(html).toContain("Archive signatures");
    expect(html).toContain("absent · validator finality not asserted");
    expect(html).toContain("Finality evidence");
    expect(html).toContain("absent · BLS round certificate not returned; no live finality proof asserted");
    expect(html).toContain("Missing proof material");
    expect(html).toContain("BLS aggregate finality certificate for block round");
    expect(html).not.toContain("live block cache");
    expect(html).not.toContain("Finality proof");
  });

  it("renders archive covering snapshot evidence as parsed but not explorer verified", () => {
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      archiveProof: {
        schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
        source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
        manifestHash: `0x${"44".repeat(32)}`,
        contentHash: `0x${"55".repeat(32)}`,
        signatureDigest: null,
        signatures: [],
        coveringSnapshot: validArchiveCoveringSnapshot(),
      } as any,
    });
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"ab".repeat(32)}`,
      blockNumber: 321n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      txHash: `0x${"ab".repeat(32)}`,
      blockHash: `0x${"cd".repeat(32)}`,
      blockHeight: 321,
      txIndex: 0,
      schema: "riscv.receipt.v1",
      txType: MRV_NATIVE_RECEIPT_TX_TYPE,
      artifactHash: `0x${"ef".repeat(32)}`,
      receiptCommitment: `0x${"19".repeat(32)}`,
      noEvmProof,
      counters: { cycles: 12, syscallUnits: 2, stateIoUnits: 1 },
      fee: {
        total_lythoshi: "12",
        total_lyth: "0.00000012",
        cycles_used: 12,
        base_price_per_cycle_lythoshi: "1",
        state_io_units: 1,
        state_io_price_per_unit_lythoshi: "0",
        priority_tip_lythoshi: "0",
      },
      reverted: false,
      nativeDeltaCount: 1,
      eventCount: 2,
      events: [],
      source: {
        chainProvider: "mock_chain",
        indexerProvider: "native_events",
        metadataLogIndex: 0xffff_ffff,
      },
    } as any);

    const html = renderToStaticMarkup(<MrvNativeEvidenceCard evidence={evidence}/>);

    expect(html).toContain("Archive signature verification");
    expect(html).toContain("unconfigured · trusted archive signer config not configured; parsed only · not validator finality or availability proof");
    expect(html).toContain("Archive covering snapshot");
    expect(html).toContain("parsed · snapshot 330 covers blocks 0-321 · explorer verification not configured");
    expect(html).toContain("Covering snapshot hashes");
    expect(html).toContain("manifest 0x6161616161616161");
    expect(html).toContain("content 0x6363636363636363");
    expect(html).toContain("checkpoint content 0x5555555555555555");
    expect(html).toContain("digest 0x6262626262626262");
    expect(html).toContain("Covering snapshot signatures");
    expect(html).toContain("parsed · 1 covering snapshot signature · not validator finality or availability proof");
    expect(html).not.toContain("verified · configured trusted archive signer");
  });

  it("renders verified trusted archive signatures for exact-height archive proofs", () => {
    const signature = signedArchiveProofSignature(verifiedArchiveSigner, validArchiveSignatureDigest);
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      archiveProof: {
        schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
        source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
        manifestHash: `0x${"44".repeat(32)}`,
        contentHash: `0x${"55".repeat(32)}`,
        signatureDigest: validArchiveSignatureDigest,
        signatures: [signature],
      },
    });

    const html = renderMrvArchiveEvidenceHtml(noEvmProof, verifiedArchiveTrustOptions);

    expect(html).toContain("Archive signature verification");
    expect(html).toContain("verified · configured trusted archive signers · exact-height archive digest · accepted 1/1 signatures · not validator finality or availability proof");
    expect(html).toContain("Archive signatures");
    expect(html).toContain("present · 1 archive signature · validator finality not asserted");
    expect(html).not.toContain("trusted archive signer config not configured");
  });

  it("renders verified trusted archive signatures from the covering snapshot fallback", () => {
    const signatureDigest = `0x${"62".repeat(32)}`;
    const signature = signedArchiveProofSignature(verifiedArchiveSigner, signatureDigest);
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      archiveProof: {
        schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
        source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
        manifestHash: `0x${"44".repeat(32)}`,
        contentHash: `0x${"55".repeat(32)}`,
        signatureDigest: null,
        signatures: [],
        coveringSnapshot: validArchiveCoveringSnapshot({
          signatureDigest,
          signatures: [signature],
        }),
      } as any,
    });

    const html = renderMrvArchiveEvidenceHtml(noEvmProof, verifiedArchiveTrustOptions);

    expect(html).toContain("verified · configured trusted archive signers · covering snapshot fallback · accepted 1/1 signatures · not validator finality or availability proof");
    expect(html).toContain("parsed · snapshot 330 covers blocks 0-321 · trusted archive signature verified");
    expect(html).toContain("parsed · 1 covering snapshot signature · not validator finality or availability proof");
  });

  it("renders trusted archive signature mismatch and config-invalid status", () => {
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

    const mismatchHtml = renderMrvArchiveEvidenceHtml(noEvmProof, verifiedArchiveTrustOptions);
    expect(mismatchHtml).toContain("mismatch · configured trusted archive signers · exact-height archive digest");
    expect(mismatchHtml).toContain(`archive proof signature from ${verifiedArchiveSigner.getAddress()} is invalid`);

    const malformedHtml = renderMrvArchiveEvidenceHtml(noEvmProof, {
      ...verifiedArchiveTrustOptions,
      threshold: 2,
    });
    expect(malformedHtml).toContain("malformed · configured trusted archive signers · exact-height archive digest");
    expect(malformedHtml).toContain("trusted archive signer config invalid: trusted archive threshold cannot exceed trusted public key count");
  });

  it.each([
    { name: "absent", archiveProofPatch: {} },
    { name: "null", archiveProofPatch: { signatureDigest: null } },
  ])("omits archive signature digest row when signatureDigest is $name", ({ archiveProofPatch }) => {
    const noEvmProof = compactNoEvmReceiptProofTranscript({
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
      txHash: `0x${"ab".repeat(32)}`,
      blockNumber: 321n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      txHash: `0x${"ab".repeat(32)}`,
      blockHash: `0x${"cd".repeat(32)}`,
      blockHeight: 321,
      txIndex: 0,
      schema: "riscv.receipt.v1",
      txType: MRV_NATIVE_RECEIPT_TX_TYPE,
      artifactHash: `0x${"ef".repeat(32)}`,
      receiptCommitment: `0x${"19".repeat(32)}`,
      noEvmProof,
      counters: { cycles: 12, syscallUnits: 2, stateIoUnits: 1 },
      fee: {
        total_lythoshi: "12",
        total_lyth: "0.00000012",
        cycles_used: 12,
        base_price_per_cycle_lythoshi: "1",
        state_io_units: 1,
        state_io_price_per_unit_lythoshi: "0",
        priority_tip_lythoshi: "0",
      },
      reverted: false,
      nativeDeltaCount: 1,
      eventCount: 2,
      events: [],
      source: {
        chainProvider: "mock_chain",
        indexerProvider: "native_events",
        metadataLogIndex: 0xffff_ffff,
      },
    } as any);

    const html = renderToStaticMarkup(<MrvNativeEvidenceCard evidence={evidence}/>);

    expect(html).toContain("Archive binding");
    expect(html).not.toContain("Archive signature digest");
    expect(html).toContain("Archive signatures");
    expect(html).toContain("absent · validator finality not asserted");
  });

  it("renders malformed archive signatureDigest as invalid proof evidence", () => {
    const error = "archiveProof.signatureDigest must be a 32-byte 0x hex value";
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      archiveProof: {
        schema: NO_EVM_RECEIPT_ARCHIVE_BINDING_SCHEMA,
        source: NO_EVM_RECEIPT_ARCHIVE_BINDING_SOURCE,
        manifestHash: `0x${"44".repeat(32)}`,
        contentHash: `0x${"55".repeat(32)}`,
        signatureDigest: `0x${"66".repeat(31)}`,
        signatures: [],
      } as any,
    });
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"ab".repeat(32)}`,
      blockNumber: 321n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      txHash: `0x${"ab".repeat(32)}`,
      blockHash: `0x${"cd".repeat(32)}`,
      blockHeight: 321,
      txIndex: 0,
      schema: "riscv.receipt.v1",
      txType: MRV_NATIVE_RECEIPT_TX_TYPE,
      artifactHash: `0x${"ef".repeat(32)}`,
      receiptCommitment: `0x${"19".repeat(32)}`,
      noEvmProof,
      counters: { cycles: 12, syscallUnits: 2, stateIoUnits: 1 },
      fee: {
        total_lythoshi: "12",
        total_lyth: "0.00000012",
        cycles_used: 12,
        base_price_per_cycle_lythoshi: "1",
        state_io_units: 1,
        state_io_price_per_unit_lythoshi: "0",
        priority_tip_lythoshi: "0",
      },
      reverted: false,
      nativeDeltaCount: 1,
      eventCount: 2,
      events: [],
      source: {
        chainProvider: "mock_chain",
        indexerProvider: "native_events",
        metadataLogIndex: 0xffff_ffff,
      },
    } as any);

    const html = renderToStaticMarkup(<MrvNativeEvidenceCard evidence={evidence}/>);

    expect(html).toContain("proof evidence invalid");
    expect(html).toContain(error);
    expect(html).not.toContain("Archive signature digest");
  });

  it("renders BLS round certificate finality evidence without claiming full live finality", () => {
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      finalityEvidence: blsFinalityEvidence(57),
      missingProofMaterial: [
        "signed archive or snapshot manifest binding receipt bytes to blockHash and receiptsRoot",
      ],
    });
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"ab".repeat(32)}`,
      blockNumber: 321n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      txHash: `0x${"ab".repeat(32)}`,
      blockHash: `0x${"cd".repeat(32)}`,
      blockHeight: 321,
      txIndex: 0,
      schema: "riscv.receipt.v1",
      txType: MRV_NATIVE_RECEIPT_TX_TYPE,
      artifactHash: `0x${"ef".repeat(32)}`,
      receiptCommitment: `0x${"19".repeat(32)}`,
      noEvmProof,
      counters: { cycles: 12, syscallUnits: 2, stateIoUnits: 1 },
      fee: {
        total_lythoshi: "12",
        total_lyth: "0.00000012",
        cycles_used: 12,
        base_price_per_cycle_lythoshi: "1",
        state_io_units: 1,
        state_io_price_per_unit_lythoshi: "0",
        priority_tip_lythoshi: "0",
      },
      reverted: false,
      nativeDeltaCount: 1,
      eventCount: 2,
      events: [],
      source: {
        chainProvider: "mock_chain",
        indexerProvider: "native_events",
        metadataLogIndex: 0xffff_ffff,
      },
    } as any);

    const html = renderToStaticMarkup(<MrvNativeEvidenceCard evidence={evidence}/>);

    expect(html).toContain("Finality evidence");
    expect(html).toContain("present · BLS round certificate material · round 57 · cert round 57 · signers 2");
    expect(html).toContain("signature 0x1234");
    expect(html).toContain("bitmap 0xabcd");
    expect(html).toContain("unverified · trusted BLS finality key not configured");
    expect(html).toContain("Archive signatures");
    expect(html).toContain("absent · validator finality not asserted");
    expect(html).not.toContain("Finality proof");
  });

  it("renders verified BLS round certificate finality evidence only with configured trust", () => {
    const noEvmProof = compactNoEvmReceiptProofTranscript({
      finalityEvidence: verifiedBlsFinalityEvidence(),
    });
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"ae".repeat(32)}`,
      blockNumber: 322n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      txHash: `0x${"ae".repeat(32)}`,
      blockHash: `0x${"ce".repeat(32)}`,
      blockHeight: 322,
      txIndex: 0,
      schema: "riscv.receipt.v1",
      txType: MRV_NATIVE_RECEIPT_TX_TYPE,
      artifactHash: `0x${"ef".repeat(32)}`,
      receiptCommitment: `0x${"1a".repeat(32)}`,
      noEvmProof,
      counters: { cycles: 12, syscallUnits: 2, stateIoUnits: 1 },
      fee: {
        total_lythoshi: "12",
        total_lyth: "0.00000012",
        cycles_used: 12,
        base_price_per_cycle_lythoshi: "1",
        state_io_units: 1,
        state_io_price_per_unit_lythoshi: "0",
        priority_tip_lythoshi: "0",
      },
      reverted: false,
      nativeDeltaCount: 1,
      eventCount: 2,
      events: [],
      source: {
        chainProvider: "mock_chain",
        indexerProvider: "native_events",
        metadataLogIndex: 0xffff_ffff,
      },
    } as any, verifiedBlsTrustOptions);

    const html = renderToStaticMarkup(<MrvNativeEvidenceCard evidence={evidence}/>);

    expect(html).toContain("present · BLS round certificate material · round 58 · cert round 58 · signers 1");
    expect(html).toContain("verified · configured trusted BLS cluster key · accepted 1/1 signatures");
    expect(html).not.toContain("trusted BLS finality key not configured");
  });

  it("renders compact mismatch details for a well-formed no-EVM receipt transcript", () => {
    const noEvmProof = noEvmReceiptProofTranscript({
      receiptCount: 3,
      receiptsRoot: `0x${"12".repeat(32)}`,
    });
    const evidence = mrvNativeTransactionEvidence({
      txHash: `0x${"ab".repeat(32)}`,
      blockNumber: 321n,
      decodedCalldata: {
        kind: "mrv_call",
        extensions: [{
          kind: MRV_NATIVE_TX_EXTENSION_KIND,
          bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
        }],
      },
    } as any, {
      txHash: `0x${"ab".repeat(32)}`,
      blockHash: `0x${"cd".repeat(32)}`,
      blockHeight: 321,
      txIndex: 1,
      schema: "riscv.receipt.v1",
      txType: MRV_NATIVE_RECEIPT_TX_TYPE,
      artifactHash: `0x${"ef".repeat(32)}`,
      receiptCommitment: `0x${"19".repeat(32)}`,
      noEvmProof,
      counters: { cycles: 12, syscallUnits: 2, stateIoUnits: 1 },
      fee: {
        total_lythoshi: "12",
        total_lyth: "0.00000012",
        cycles_used: 12,
        base_price_per_cycle_lythoshi: "1",
        state_io_units: 1,
        state_io_price_per_unit_lythoshi: "0",
        priority_tip_lythoshi: "0",
      },
      reverted: false,
      nativeDeltaCount: 1,
      eventCount: 2,
      events: [],
      source: {
        chainProvider: "mock_chain",
        indexerProvider: "native_events",
        metadataLogIndex: 0xffff_ffff,
      },
    } as any);

    const html = renderToStaticMarkup(<MrvNativeEvidenceCard evidence={evidence}/>);

    expect(html).toContain("transcript mismatch");
    expect(html).toContain("mismatch · bounded receipts transcript");
    expect(html).toContain("Transcript check");
    expect(html).toContain("mismatch · receiptCount 3 does not match 2 receipt blobs; receiptsRoot mismatch");
    expect(html).toContain("computed");
    expect(html).not.toContain("Finality proof");
  });

  it("renders nothing when no MRV evidence exists", () => {
    expect(renderToStaticMarkup(<MrvNativeEvidenceCard evidence={null}/>)).toBe("");
  });
});

describe("BridgeTrustDisclosuresCard", () => {
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

  it("renders verifier, cap, finality, breaker, insurance, and risk metadata for a valid disclosure", () => {
    const rows = bridgeTrustDisclosuresFromAddressData({
      bridgeRouteDisclosures: [validDisclosure],
    });

    const html = renderToStaticMarkup(<BridgeTrustDisclosuresCard disclosures={rows}/>);

    expect(html).toContain("Bridge trust disclosures");
    expect(html).toContain("ThirdParty Light Client");
    expect(html).toContain("zk-light-client");
    expect(html).toContain("threshold 8/12");
    expect(html).toContain("250000000000");
    expect(html).toContain("64 blocks");
    expect(html).toContain("cooldown 2h");
    expect(html).toContain("breaker armed");
    expect(html).toContain("admin consensusOnly");
    expect(html).toContain("500000000000");
    expect(html).toContain("low");
    expect(html).toContain("score 100");
  });

  it("renders route binding metadata and keeps discovery-only bridge actions disabled", () => {
    const rows = bridgeTrustDisclosuresFromAddressData({
      routeSelectionReady: false,
      quoteReady: false,
      submitReady: false,
      blockedReasons: ["bridge route selection requires transfer intent"],
      bridgeRouteDisclosures: [{
        ...validDisclosure,
        routeId: "catalogue-usdc-mainnet",
        bridgeId: "bridge-catalogue-1",
        wrappedAsset: "mrc:wrapped-usdc",
      }],
    });

    const html = renderToStaticMarkup(<BridgeTrustDisclosuresCard disclosures={rows}/>);

    expect(html).toContain("bridgeId bridge-catalogue-1");
    expect(html).toContain("wrappedAsset mrc:wrapped-usdc");
    expect(html).toContain("Discovery only");
    expect(html).toContain("selection blocked · quote disabled · submit disabled");
    expect(html).toContain("bridge route selection requires transfer intent");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Quote<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Submit<\/button>/);
  });

  it("renders deterministic preferred route and bounded failure details when multiple disclosures are present", () => {
    const rows = bridgeTrustDisclosuresFromAddressData({
      bridgeRouteDisclosures: [
        {
          ...validDisclosure,
          routeId: "disabled-controls",
          finalityBlocks: 0,
          cooldownSeconds: 0,
          circuitBreaker: "disabled",
          insuranceAtomic: "0",
        },
        {
          ...validDisclosure,
          routeId: "zz-hidden-controls",
          circuitBreaker: "disabled",
          insuranceAtomic: "0",
        },
        {
          ...validDisclosure,
          routeId: "short-cooldown",
          cooldownSeconds: 60,
        },
        {
          ...validDisclosure,
          routeId: "healthy-route",
        },
        {
          ...validDisclosure,
          routeId: "paused-controls",
          circuitBreaker: "paused",
        },
        {
          ...validDisclosure,
          routeId: "short-finality",
          finalityBlocks: 1,
        },
      ],
    });

    const html = renderToStaticMarkup(<BridgeTrustDisclosuresCard disclosures={rows}/>);

    expect(html).toContain("ranked 5/6");
    expect(html).toContain("Preferred route");
    expect(html).toContain("healthy-route");
    expect(html).toContain("Disclosure failures");
    expect(html).toContain("route short-finality · finality below two blocks (1 blocks)");
    expect(html).toContain("route short-cooldown · cooldown under one hour (60s)");
    expect(html).toContain("route disabled-controls · cooldown missing (0s) · finality missing (0 blocks) · circuit breaker disabled · insurance missing or zero (0)");
    expect(html).toContain("route paused-controls · circuit breaker paused");
    expect(html).toContain("Showing top 5 of 6 ranked disclosures");
    expect(html).not.toContain("zz-hidden-controls");
  });

  it("renders invalid disclosures as blocked, never as accepted low risk", () => {
    const rows = bridgeTrustDisclosuresFromAddressData({
      bridgeRouteDisclosures: [{
        ...validDisclosure,
        routeId: "bad-route",
        verifier: { model: "single-signer", participantCount: 1, threshold: 1 },
        drainCapAtomic: "0",
        cooldownSeconds: 0,
        circuitBreaker: "disabled",
        insuranceAtomic: "0",
      }],
    });

    const html = renderToStaticMarkup(<BridgeTrustDisclosuresCard disclosures={rows}/>);

    expect(html).toContain("blocked");
    expect(html).toContain("not accepted");
    expect(html).toContain("verifier set must not be 1-of-1");
    expect(html).not.toContain("score 100");
  });

  it("renders unavailable state when upstream data was checked without disclosures", () => {
    const html = renderToStaticMarkup(<BridgeTrustDisclosuresCard disclosures={[]} unavailable/>);

    expect(html).toContain("Bridge trust disclosures");
    expect(html).toContain("Disclosure unavailable");
    expect(html).toContain("No bridgeRouteDisclosure, bridgeRouteDisclosures, or bridge route discovery metadata");
    expect(html).toContain("will not mark any bridge route as safe");
  });

  it("renders nothing before upstream disclosure data has been checked", () => {
    expect(renderToStaticMarkup(<BridgeTrustDisclosuresCard disclosures={[]}/>)).toBe("");
  });
});
