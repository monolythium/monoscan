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
} from "@monolythium/core-sdk";
import {
  buildMarketOrderWalletRequest,
  buildNftAuctionBidWalletRequest,
  buildNftAuctionSettleWalletRequest,
  buildNftListingBuyWalletRequest,
  buildNftListingCancelWalletRequest,
  buildNftListingCreateWalletRequest,
  buildNftListingSweepWalletRequest,
  nextSpotOrderNonceForOwner,
  ownerStateAccount,
} from "./monoscan-markets";

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

describe("buildNftListingBuyWalletRequest", () => {
  const listingId = `0x${"55".repeat(32)}`;
  const buyerAddress = "0xabcdef0123456789abcdef0123456789abcdef01";
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
      contractAddress: forwarderContractAddress,
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
  const sellerAddress = "0xabcdef0123456789abcdef0123456789abcdef01";
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
      contractAddress: forwarderContractAddress,
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
      contractAddress: forwarderContractAddress,
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
      contractAddress: forwarderContractAddress,
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
  const bidderAddress = "0xabcdef0123456789abcdef0123456789abcdef01";
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
      contractAddress: forwarderContractAddress,
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
      contractAddress: forwarderContractAddress,
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
      contractAddress: forwarderContractAddress,
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
