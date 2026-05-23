import { describe, expect, it } from "vitest";
import {
  CLOB_SELECTORS,
  PRECOMPILE_ADDRESSES,
  deriveClobMarketId,
} from "@monolythium/core-sdk";
import { buildMarketOrderWalletRequest } from "./monoscan-markets";

describe("buildMarketOrderWalletRequest", () => {
  const baseTokenId = `0x${"11".repeat(32)}`;
  const quoteTokenId = `0x${"22".repeat(32)}`;
  const marketId = deriveClobMarketId(baseTokenId, quoteTokenId);

  it("builds an eth_sendTransaction request that preserves the CLOB mempool class", () => {
    const request = buildMarketOrderWalletRequest({
      marketId,
      baseTokenId,
      quoteTokenId,
      side: "buy",
      price: "125",
      quantity: "50",
      expiryBlock: "999",
    });

    expect(request.method).toBe("eth_sendTransaction");
    expect(request.params).toHaveLength(1);
    expect(request.params[0]).toMatchObject({
      to: PRECOMPILE_ADDRESSES.CLOB,
      value: "0x0",
      mempoolClass: 3,
    });
    expect(request.params[0].data.startsWith(CLOB_SELECTORS.placeLimitOrder)).toBe(true);
  });

  it("requires live market metadata", () => {
    expect(() => buildMarketOrderWalletRequest({
      marketId: null,
      baseTokenId,
      quoteTokenId,
      side: "sell",
      price: "125",
      quantity: "50",
    })).toThrow("Live CLOB market metadata");
  });
});
