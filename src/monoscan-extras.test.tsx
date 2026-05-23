import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BridgeTrustDisclosuresCard, MrvNativeEvidenceCard, redemptionTicketStatusText } from "./monoscan-extras";
import {
  bridgeTrustDisclosuresFromAddressData,
  MRV_NATIVE_RECEIPT_TX_TYPE,
  MRV_NATIVE_TX_EXTENSION_BODY_HEX,
  MRV_NATIVE_TX_EXTENSION_KIND,
  mrvNativeTransactionEvidence,
} from "./data/hooks";

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
    expect(html).toContain("No-EVM proof");
    expect(html).toContain("missing · native-receipt.noEvmProof returned null; no proof rendered");
    expect(html).toContain("native-receipt.noEvmProof returned null");
    expect(html).not.toContain("proof present");
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

  it("renders nothing when no upstream disclosure exists", () => {
    expect(renderToStaticMarkup(<BridgeTrustDisclosuresCard disclosures={[]}/>)).toBe("");
  });
});
