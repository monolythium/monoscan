import { describe, expect, it } from "vitest";
import {
  buildNativeSpotLimitOrderForwarderInput,
  deriveClobMarketId,
} from "@monolythium/core-sdk";
import { buildMarketOrderWalletRequest } from "./monoscan-markets";

describe("buildMarketOrderWalletRequest", () => {
  const baseTokenId = `0x${"11".repeat(32)}`;
  const quoteTokenId = `0x${"22".repeat(32)}`;
  const marketId = deriveClobMarketId(baseTokenId, quoteTokenId);
  const ownerAddress = "0xabcdef0123456789abcdef0123456789abcdef01";
  const forwarderContractAddress = "0x2222222222222222222222222222222222222222";

  it("builds an MRV native forwarder call request for the wallet provider", () => {
    const request = buildMarketOrderWalletRequest({
      marketId,
      baseTokenId,
      quoteTokenId,
      ownerAddress,
      orderNonce: "7",
      forwarderContractAddress,
      side: "buy",
      price: "125",
      quantity: "50",
      expiryBlock: "999",
    });

    const expectedForwarder = buildNativeSpotLimitOrderForwarderInput({
      marketId,
      owner: ownerAddress,
      nonce: "7",
      side: "buy",
      price: "125",
      quantity: "50",
      expiresAtBlock: "999",
    }, "22000");

    expect(request.method).toBe("monolythium_submitMrvNativeCall");
    expect(request.params).toHaveLength(1);
    expect(request.params[0]).toMatchObject({
      contractAddress: forwarderContractAddress,
      input: expectedForwarder.input,
      executionUnitLimitHex: "0x200000",
      valueWeiHex: "0x0",
    });
    expect((request.params[0].input.length - 2) / 2).toBe(176);
  });

  it("requires live market metadata", () => {
    expect(() => buildMarketOrderWalletRequest({
      marketId: null,
      baseTokenId,
      quoteTokenId,
      ownerAddress,
      orderNonce: "7",
      forwarderContractAddress,
      side: "sell",
      price: "125",
      quantity: "50",
    })).toThrow("Live native market id");
  });

  it("requires a configured MRV forwarder address", () => {
    expect(() => buildMarketOrderWalletRequest({
      marketId,
      baseTokenId,
      quoteTokenId,
      ownerAddress,
      orderNonce: "7",
      forwarderContractAddress: null,
      side: "sell",
      price: "125",
      quantity: "50",
    })).toThrow("forwarder address is not configured");
  });
});
