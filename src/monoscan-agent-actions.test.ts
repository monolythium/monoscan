import { describe, expect, it } from "vitest";
import {
  buildNativeAgentCreateEscrowForwarderInput,
  buildNativeAgentRecordReputationForwarderInput,
  buildNativeAgentSetSpendingPolicyForwarderInput,
  type CapabilitiesResponse,
} from "@monolythium/core-sdk";
import {
  buildNativeAgentCreateEscrowWalletRequest,
  buildNativeAgentRecordReputationWalletRequest,
  buildNativeAgentSetSpendingPolicyWalletRequest,
} from "./monoscan-agent-actions";

function capabilitiesWithAgentForwarder(
  requestBytes: number,
  contractAddress = "0x3333333333333333333333333333333333333333",
): CapabilitiesResponse {
  return {
    blockNumber: 1n,
    capabilities: {},
    nativeModuleForwarders: {
      agent: [{
        module: "agent",
        requestBytes,
        contractAddress,
        artifactProfile: "native-call-forwarder-v1",
        status: "configured",
        deploymentVerified: false,
      }],
    },
  };
}

describe("native agent wallet request builders", () => {
  const forwarderContractAddress = "0x2222222222222222222222222222222222222222";

  it("builds spending-policy MRV native forwarder requests", () => {
    const args = {
      owner: "0x1111111111111111111111111111111111111111",
      controller: "0x2222222222222222222222222222222222222222",
      nonce: "7",
      assetId: `0x${"33".repeat(32)}`,
      perActionLimit: "125",
      windowLimit: "500",
      windowSecs: 3600,
    };
    const expectedForwarder = buildNativeAgentSetSpendingPolicyForwarderInput(args, "22000");

    const request = buildNativeAgentSetSpendingPolicyWalletRequest({
      ...args,
      forwarderContractAddress,
    });

    expect(request.method).toBe("monolythium_submitMrvNativeCall");
    expect(request.params[0]).toMatchObject({
      contractAddress: forwarderContractAddress,
      input: expectedForwarder.input,
      executionUnitLimitHex: "0x200000",
      valueWeiHex: "0x0",
    });
    expect((request.params[0].input.length - 2) / 2).toBe(196);
  });

  it("uses capability-disclosed agent forwarders matching request byte length", () => {
    const args = {
      buyer: "0x1111111111111111111111111111111111111111",
      provider: "0x2222222222222222222222222222222222222222",
      arbiter: "0x3333333333333333333333333333333333333333",
      nonce: 9,
      assetId: `0x${"44".repeat(32)}`,
      amount: "123",
      termsHash: `0x${"55".repeat(32)}`,
    };
    const expectedForwarder = buildNativeAgentCreateEscrowForwarderInput(args, "22000");
    const request = buildNativeAgentCreateEscrowWalletRequest({
      ...args,
      forwarderContractAddress: null,
      capabilities: capabilitiesWithAgentForwarder(expectedForwarder.requestBytes),
    });

    expect(request.params[0]).toMatchObject({
      contractAddress: "0x3333333333333333333333333333333333333333",
      input: expectedForwarder.input,
    });
    expect((request.params[0].input.length - 2) / 2).toBe(228);
  });

  it("builds reputation requests and rejects missing or mismatched forwarders", () => {
    const args = {
      reviewer: "0x6666666666666666666666666666666666666666",
      subject: "0x7777777777777777777777777777777777777777",
      categoryId: 42,
      scores: { speed: 5, quality: 4, communication: 3, accuracy: 2 },
      payloadHash: `0x${"88".repeat(32)}`,
    };
    const expectedForwarder = buildNativeAgentRecordReputationForwarderInput(args, "22000");

    const request = buildNativeAgentRecordReputationWalletRequest({
      ...args,
      forwarderContractAddress,
      executionUnitLimitHex: "0x1234",
    });
    expect(request.params[0]).toMatchObject({
      contractAddress: forwarderContractAddress,
      input: expectedForwarder.input,
      executionUnitLimitHex: "0x1234",
    });

    expect(() =>
      buildNativeAgentRecordReputationWalletRequest({
        ...args,
        forwarderContractAddress: null,
        capabilities: capabilitiesWithAgentForwarder(expectedForwarder.requestBytes + 1),
      }),
    ).toThrow("MRV native agent forwarder for 156 request bytes is not configured");

    expect(() =>
      buildNativeAgentRecordReputationWalletRequest({
        ...args,
        forwarderContractAddress: null,
      }),
    ).toThrow("MRV native agent forwarder address is not configured");
  });
});
