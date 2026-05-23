import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BridgeTrustDisclosuresCard } from "./monoscan-extras";
import { bridgeTrustDisclosuresFromAddressData } from "./data/hooks";

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
