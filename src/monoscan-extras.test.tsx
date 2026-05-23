import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BridgeTrustDisclosuresCard, MrvNativeEvidenceCard, redemptionTicketStatusText } from "./monoscan-extras";
import {
  bridgeTrustDisclosuresFromAddressData,
  MRV_NATIVE_RECEIPT_TX_TYPE,
  MRV_NATIVE_TX_EXTENSION_BODY_HEX,
  MRV_NATIVE_TX_EXTENSION_KIND,
  NO_EVM_RECEIPT_PROOF_SCHEMA,
  NO_EVM_RECEIPT_PROOF_TYPE,
  mrvNativeTransactionEvidence,
  type NoEvmReceiptProofTranscript,
} from "./data/hooks";

function noEvmReceiptProofTranscript(
  overrides: Partial<NoEvmReceiptProofTranscript> = {},
): NoEvmReceiptProofTranscript {
  return {
    schema: NO_EVM_RECEIPT_PROOF_SCHEMA,
    proofType: NO_EVM_RECEIPT_PROOF_TYPE,
    rootAlgorithm: "merkle-patricia-trie",
    receiptCodec: "rlp",
    blockHash: `0x${"cd".repeat(32)}`,
    txHash: `0x${"ab".repeat(32)}`,
    receiptsRoot: `0x${"12".repeat(32)}`,
    targetReceiptHash: `0x${"34".repeat(32)}`,
    blockHeight: 321,
    txIndex: 1,
    receiptCount: 2,
    receiptTranscript: ["0x01", "0xaabb"],
    ...overrides,
  };
}

describe("redemptionTicketStatusText", () => {
  it("separates cooldown maturity from payout availability", () => {
    expect(redemptionTicketStatusText(true)).toBe("Cooldown complete · payout unavailable");
    expect(redemptionTicketStatusText(false)).toBe("Cooldown active");
    expect(redemptionTicketStatusText(null)).toBe("Cooldown state pending");
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

    expect(html).toContain("proof evidence present");
    expect(html).toContain("No-EVM receipt proof");
    expect(html).toContain("present · bounded receipts transcript · canonicalReceiptsTranscript · block 321 · tx 2/2 · 2 receipt blobs");
    expect(html).toContain("Proof codec");
    expect(html).toContain("merkle-patricia-trie · rlp");
    expect(html).toContain("Proof anchors");
    expect(html).toContain("block 0xcdcdcdcdcdcdcdcd");
    expect(html).toContain("tx 0xabababababababab");
    expect(html).toContain("Receipt root");
    expect(html).toContain("0x1212121212121212");
    expect(html).toContain("target 0x3434343434343434");
    expect(html).toContain("Receipt transcript");
    expect(html).toContain("2 receipt blobs · receiptCount 2 · txIndex 1");
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
