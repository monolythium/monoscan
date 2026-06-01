import { describe, expect, it } from "vitest";
import {
  addressToTypedBech32,
  buildNativeNftBuyListingForwarderInput,
  buildNativeNftCancelListingForwarderInput,
  buildNativeNftCreateListingForwarderInput,
  buildNativeNftPlaceAuctionBidForwarderInput,
  buildNativeNftSettleAuctionForwarderInput,
  buildNativeNftSweepExpiredListingsForwarderInput,
  buildNativeSpotLimitOrderForwarderInput,
  deriveClobMarketId,
  type CapabilitiesResponse,
} from "@monolythium/core-sdk";
import {
  buildMarketOrderWalletRequest,
  buildNftAuctionBidWalletRequest,
  buildNftAuctionSettleWalletRequest,
  buildNftListingBuyWalletRequest,
  buildNftListingCancelWalletRequest,
  buildNftListingCreateWalletRequest,
  buildNftListingSweepWalletRequest,
  liveMarketRowsFromNativeState,
  mkQuote,
  nativeMarketEventFieldSummary,
  nativeTradeRowsFromMarketEvents,
  nextNftListingNonceForSeller,
  nextSpotOrderNonceForOwner,
  ownerStateAccount,
  quoteUnitLabel,
} from "./monoscan-markets";

const typedContract = (address: string) => addressToTypedBech32("contract", address);

function capabilitiesWithMarketForwarder(
  requestBytes: number,
  contractAddress = "0x3333333333333333333333333333333333333333",
): CapabilitiesResponse {
  return {
    blockNumber: 1n,
    capabilities: {},
    nativeModuleForwarders: {
      market: [{
        module: "market",
        requestBytes,
        contractAddress,
        artifactProfile: "native-call-forwarder-v1",
        status: "configured",
        deploymentVerified: false,
      }],
    },
  };
}

describe("liveMarketRowsFromNativeState", () => {
  it("builds market-list rows from native-market-state spot markets", () => {
    const rows = liveMarketRowsFromNativeState([{
      marketId: `0x${"ab".repeat(32)}`,
      baseAssetId: `0x${"11".repeat(32)}`,
      quoteAssetId: `0x${"22".repeat(32)}`,
      lastPrice: "100",
      totalVolumeBase: "5",
      tradeCount: "1",
      tickSize: "1",
      lotSize: "1",
      createdAtBlock: 16261,
      updatedAtBlock: 16848,
    }], []);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sym: "CLOB-1",
      price: 100,
      // vol24h is now base volume only — price*baseVolume of unscaled tick/lot
      // integers is not a real quote notional, so it is no longer fabricated.
      vol24h: 5,
      tradeCount: 1,
      totalVolumeBase: 5,
      tickSize: 1,
      lotSize: 1,
      createdAtBlock: 16261,
      // Permissionless live CLOB — nothing verifies the market.
      verified: false,
      live: true,
      source: "native_market_state",
    });
    expect(rows[0].trades[0].round).toBe(16848);
  });
});

describe("mkQuote / quoteUnitLabel", () => {
  it("renders a live quote-tick value in quote-asset terms, never as fiat", () => {
    const out = mkQuote(100, `0x${"22".repeat(32)}`);
    expect(out).not.toContain("$");
    expect(out).toContain("quote ");
    // numeric portion is the integer 100 (>=100 -> 2 dp) with no decimal scaling
    expect(out.startsWith("100")).toBe(true);
  });

  it("falls back to a neutral quote label when no quote asset id is known", () => {
    expect(quoteUnitLabel(null)).toBe("quote");
    expect(quoteUnitLabel(undefined)).toBe("quote");
    expect(mkQuote(5, null)).toBe("5.000 quote");
  });

  it("returns an em dash for null / non-finite values", () => {
    expect(mkQuote(null)).toBe("—");
    expect(mkQuote(Number.NaN)).toBe("—");
  });

  it("derives a stable truncated label from the quote asset id", () => {
    const quote = `0x${"ab".repeat(32)}`;
    expect(quoteUnitLabel(quote)).toBe(`quote ${quote.slice(0, 10)}…${quote.slice(-6)}`);
  });
});

describe("nativeTradeRowsFromMarketEvents", () => {
  it("turns native settled-order events into market detail trade rows", () => {
    const rows = nativeTradeRowsFromMarketEvents([{
      blockHeight: 16848,
      txIndex: 0,
      logIndex: 1,
      eventName: "market.spot.order_settled",
      account: "mono1mg2ja9n9uusyjp0g9kraq23747a5clyxzsasq8",
      counterparty: null,
      decodedFields: [["amount", "5"]],
    } as any], { fallbackPrice: 100 });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      side: "fill",
      px: 100,
      sz: 5,
      value: 500,
      venue: "native",
      round: 16848,
      attest: "indexed",
    });
  });
});

describe("nativeMarketEventFieldSummary", () => {
  it("prioritizes readable trade fields and hides raw ids/noisy scores", () => {
    const fields = nativeMarketEventFieldSummary({
      decodedFields: [
        ["account", "mono1mg2ja9n9uusyjp0g9kraq23747a5clyxzsasq8"],
        ["market_order_id", `0x${"33".repeat(32)}`],
        ["accuracy_score", "—"],
        ["price", "100"],
        ["quantity", "5"],
        ["side", "bid"],
        ["status", "filled"],
      ],
    } as any);

    expect(fields.map((field) => field.key)).toEqual(["side", "quantity", "price", "status", "account"]);
    expect(fields.map((field) => `${field.label}:${field.value}`)).toContain("qty:5");
  });
});

describe("buildMarketOrderWalletRequest", () => {
  const baseTokenId = `0x${"11".repeat(32)}`;
  const quoteTokenId = `0x${"22".repeat(32)}`;
  const marketId = deriveClobMarketId(baseTokenId, quoteTokenId);
  const ownerAddress = addressToTypedBech32("user", "0xabcdef0123456789abcdef0123456789abcdef01");
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
      contractAddress: typedContract(forwarderContractAddress),
      input: expectedForwarder.input,
      executionUnitLimitHex: "0x200000",
      valueWeiHex: "0x0",
    });
    expect((request.params[0].input.length - 2) / 2).toBe(176);
  });

  it("uses the capability-disclosed forwarder matching request byte length", () => {
    const expectedForwarder = buildNativeSpotLimitOrderForwarderInput({
      marketId,
      owner: ownerAddress,
      nonce: "7",
      side: "buy",
      price: "125",
      quantity: "50",
      expiresAtBlock: "999",
    }, "22000");
    const capabilityAddress = "0x3333333333333333333333333333333333333333";

    const request = buildMarketOrderWalletRequest({
      marketId,
      baseTokenId,
      quoteTokenId,
      ownerAddress,
      orderNonce: "7",
      forwarderContractAddress: null,
      capabilities: capabilitiesWithMarketForwarder(expectedForwarder.requestBytes, capabilityAddress),
      side: "buy",
      price: "125",
      quantity: "50",
      expiryBlock: "999",
    });

    expect(request.params[0].contractAddress).toBe(typedContract(capabilityAddress));
    expect(request.params[0].input).toBe(expectedForwarder.input);
  });

  it("rejects capability-disclosed forwarders with the wrong request byte length", () => {
    const expectedForwarder = buildNativeSpotLimitOrderForwarderInput({
      marketId,
      owner: ownerAddress,
      nonce: "7",
      side: "buy",
      price: "125",
      quantity: "50",
      expiresAtBlock: "999",
    }, "22000");

    expect(() => buildMarketOrderWalletRequest({
      marketId,
      baseTokenId,
      quoteTokenId,
      ownerAddress,
      orderNonce: "7",
      forwarderContractAddress,
      capabilities: capabilitiesWithMarketForwarder(expectedForwarder.requestBytes + 1),
      side: "buy",
      price: "125",
      quantity: "50",
      expiryBlock: "999",
    })).toThrow("request bytes is not configured");
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

describe("buildNftListingBuyWalletRequest", () => {
  const listingId = `0x${"55".repeat(32)}`;
  const buyerAddress = addressToTypedBech32("user", "0xabcdef0123456789abcdef0123456789abcdef01");
  const forwarderContractAddress = "0x2222222222222222222222222222222222222222";

  it("builds an MRV native NFT buy request for the wallet provider", () => {
    const request = buildNftListingBuyWalletRequest({
      listingId,
      buyerAddress,
      currentBlock: 777,
      forwarderContractAddress,
    });

    const expectedForwarder = buildNativeNftBuyListingForwarderInput({
      listingId,
      buyer: buyerAddress,
      currentBlock: 777,
    }, "22000");

    expect(request.method).toBe("monolythium_submitMrvNativeCall");
    expect(request.params).toHaveLength(1);
    expect(request.params[0]).toMatchObject({
      contractAddress: typedContract(forwarderContractAddress),
      input: expectedForwarder.input,
      executionUnitLimitHex: "0x200000",
      valueWeiHex: "0x0",
    });
  });

  it("requires a live listing id, chain head, and configured forwarder", () => {
    expect(() => buildNftListingBuyWalletRequest({
      listingId: null,
      buyerAddress,
      currentBlock: 777,
      forwarderContractAddress,
    })).toThrow("listing id");

    expect(() => buildNftListingBuyWalletRequest({
      listingId,
      buyerAddress,
      currentBlock: null,
      forwarderContractAddress,
    })).toThrow("Live chain head");

    expect(() => buildNftListingBuyWalletRequest({
      listingId,
      buyerAddress,
      currentBlock: 777,
      forwarderContractAddress: null,
    })).toThrow("forwarder address is not configured");
  });
});

describe("native NFT listing create/cancel wallet requests", () => {
  const sellerAddress = addressToTypedBech32("user", "0xabcdef0123456789abcdef0123456789abcdef01");
  const listingId = `0x${"55".repeat(32)}`;
  const collectionId = `0x${"22".repeat(32)}`;
  const tokenId = `0x${"33".repeat(32)}`;
  const paymentAsset = `0x${"44".repeat(32)}`;
  const forwarderContractAddress = "0x2222222222222222222222222222222222222222";

  it("builds fixed-price create-listing forwarder requests", () => {
    const request = buildNftListingCreateWalletRequest({
      sellerAddress,
      listingNonce: 7,
      standard: "mrc721",
      collectionId,
      tokenId,
      quantity: "1",
      paymentAsset,
      price: "123",
      expiresAtBlock: 999,
      forwarderContractAddress,
    });

    const expectedForwarder = buildNativeNftCreateListingForwarderInput({
      seller: sellerAddress,
      nonce: 7,
      standard: "mrc721",
      collectionId,
      tokenId,
      quantity: "1",
      paymentAsset,
      price: "123",
      kind: "fixed-price",
      expiresAtBlock: 999,
    }, "22000");

    expect(request.params[0]).toMatchObject({
      contractAddress: typedContract(forwarderContractAddress),
      input: expectedForwarder.input,
      executionUnitLimitHex: "0x200000",
      valueWeiHex: "0x0",
    });
  });

  it("builds cancel-listing forwarder requests", () => {
    const request = buildNftListingCancelWalletRequest({
      listingId,
      callerAddress: sellerAddress,
      forwarderContractAddress,
    });

    const expectedForwarder = buildNativeNftCancelListingForwarderInput({
      listingId,
      caller: sellerAddress,
    }, "22000");

    expect(request.params[0]).toMatchObject({
      contractAddress: typedContract(forwarderContractAddress),
      input: expectedForwarder.input,
      executionUnitLimitHex: "0x200000",
      valueWeiHex: "0x0",
    });
  });

  it("builds English-auction create-listing forwarder requests", () => {
    const request = buildNftListingCreateWalletRequest({
      sellerAddress,
      listingNonce: 8,
      standard: "mrc1155",
      collectionId,
      tokenId,
      quantity: "10",
      paymentAsset,
      price: "250",
      kind: {
        english: {
          reserve: "300",
          endBlock: 1500,
          minBidIncrementBps: 500,
        },
      },
      expiresAtBlock: 1600,
      forwarderContractAddress,
    });

    const expectedForwarder = buildNativeNftCreateListingForwarderInput({
      seller: sellerAddress,
      nonce: 8,
      standard: "mrc1155",
      collectionId,
      tokenId,
      quantity: "10",
      paymentAsset,
      price: "250",
      kind: {
        english: {
          reserve: "300",
          endBlock: 1500,
          minBidIncrementBps: 500,
        },
      },
      expiresAtBlock: 1600,
    }, "22000");

    expect(request.params[0]).toMatchObject({
      contractAddress: typedContract(forwarderContractAddress),
      input: expectedForwarder.input,
      executionUnitLimitHex: "0x200000",
      valueWeiHex: "0x0",
    });
  });

  it("requires create-listing ids and a configured forwarder", () => {
    expect(() => buildNftListingCreateWalletRequest({
      sellerAddress,
      listingNonce: 7,
      standard: "mrc721",
      collectionId: "",
      tokenId,
      quantity: "1",
      paymentAsset,
      price: "123",
      expiresAtBlock: 999,
      forwarderContractAddress,
    })).toThrow("Collection id");

    expect(() => buildNftListingCancelWalletRequest({
      listingId,
      callerAddress: sellerAddress,
      forwarderContractAddress: null,
    })).toThrow("forwarder address is not configured");
  });
});

describe("native NFT auction wallet requests", () => {
  const listingId = `0x${"77".repeat(32)}`;
  const otherListingId = `0x${"88".repeat(32)}`;
  const bidderAddress = addressToTypedBech32("user", "0xabcdef0123456789abcdef0123456789abcdef01");
  const forwarderContractAddress = "0x2222222222222222222222222222222222222222";

  it("builds auction bid, settle, and sweep forwarder requests", () => {
    const bidRequest = buildNftAuctionBidWalletRequest({
      listingId,
      bidderAddress,
      amount: "321",
      currentBlock: 888,
      forwarderContractAddress,
    });
    const expectedBid = buildNativeNftPlaceAuctionBidForwarderInput({
      listingId,
      bidder: bidderAddress,
      amount: "321",
      currentBlock: 888,
    }, "22000");
    expect(bidRequest.params[0]).toMatchObject({
      contractAddress: typedContract(forwarderContractAddress),
      input: expectedBid.input,
      executionUnitLimitHex: "0x200000",
      valueWeiHex: "0x0",
    });

    const settleRequest = buildNftAuctionSettleWalletRequest({
      listingId,
      currentBlock: 999,
      forwarderContractAddress,
    });
    const expectedSettle = buildNativeNftSettleAuctionForwarderInput({
      listingId,
      currentBlock: 999,
    }, "22000");
    expect(settleRequest.params[0]).toMatchObject({
      contractAddress: typedContract(forwarderContractAddress),
      input: expectedSettle.input,
      executionUnitLimitHex: "0x200000",
      valueWeiHex: "0x0",
    });

    const sweepRequest = buildNftListingSweepWalletRequest({
      listingIds: [listingId, otherListingId],
      currentBlock: 777,
      forwarderContractAddress,
    });
    const expectedSweep = buildNativeNftSweepExpiredListingsForwarderInput({
      listingIds: [listingId, otherListingId],
      currentBlock: 777,
    }, "22000");
    expect(sweepRequest.params[0]).toMatchObject({
      contractAddress: typedContract(forwarderContractAddress),
      input: expectedSweep.input,
      executionUnitLimitHex: "0x200000",
      valueWeiHex: "0x0",
    });
  });

  it("requires auction ids, live chain head, amount, and configured forwarder", () => {
    expect(() => buildNftAuctionBidWalletRequest({
      listingId: null,
      bidderAddress,
      amount: "321",
      currentBlock: 888,
      forwarderContractAddress,
    })).toThrow("listing id");

    expect(() => buildNftAuctionBidWalletRequest({
      listingId,
      bidderAddress,
      amount: "",
      currentBlock: 888,
      forwarderContractAddress,
    })).toThrow("Auction bid amount");

    expect(() => buildNftAuctionSettleWalletRequest({
      listingId,
      currentBlock: null,
      forwarderContractAddress,
    })).toThrow("Live chain head");

    expect(() => buildNftListingSweepWalletRequest({
      listingIds: [],
      currentBlock: 777,
      forwarderContractAddress,
    })).toThrow("At least one");

    expect(() => buildNftListingSweepWalletRequest({
      listingIds: [listingId],
      currentBlock: 777,
      forwarderContractAddress: null,
    })).toThrow("forwarder address is not configured");
  });
});

describe("nextSpotOrderNonceForOwner", () => {
  const ownerAddress = "0xabcdef0123456789abcdef0123456789abcdef01";
  const ownerAccount = addressToTypedBech32("user", ownerAddress);
  const otherAccount = addressToTypedBech32(
    "user",
    "0x9999999999999999999999999999999999999999",
  );

  it("derives the next owner-local nonce from indexed spot order rows", () => {
    expect(ownerStateAccount(ownerAddress)).toBe(ownerAccount);
    expect(nextSpotOrderNonceForOwner([
      { account: ownerAccount, nonce: "7" },
      { account: otherAccount, nonce: "100" },
      { account: ownerAccount, nonce: "11" },
      { account: ownerAccount, nonce: null },
    ], ownerAddress)).toBe("12");
  });

  it("returns null when indexed rows do not carry an owner nonce", () => {
    expect(nextSpotOrderNonceForOwner([
      { account: ownerAccount, nonce: null },
      { account: otherAccount, nonce: "3" },
    ], ownerAddress)).toBeNull();
  });
});

describe("nextNftListingNonceForSeller", () => {
  const sellerAddress = "0xabcdef0123456789abcdef0123456789abcdef01";
  const sellerAccount = addressToTypedBech32("user", sellerAddress);
  const otherAccount = addressToTypedBech32(
    "user",
    "0x9999999999999999999999999999999999999999",
  );

  it("derives the next seller-local nonce from indexed NFT listing rows", () => {
    expect(nextNftListingNonceForSeller([
      { account: sellerAccount, nonce: "4" },
      { account: otherAccount, nonce: "100" },
      { account: sellerAddress, nonce: "9" },
      { account: sellerAccount, nonce: null },
    ], sellerAddress)).toBe("10");
  });

  it("returns null when indexed NFT listing rows do not expose nonce yet", () => {
    expect(nextNftListingNonceForSeller([
      { account: sellerAccount, nonce: null },
      { account: otherAccount, nonce: "3" },
    ], sellerAddress)).toBeNull();
  });
});
