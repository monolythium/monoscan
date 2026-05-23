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
import {
  ApiClient,
  RpcClient,
  type AgentReputationResponse,
  type NativeReceiptResponse,
} from "@monolythium/core-sdk";
import {
  HEAD_POLL_MS,
  apiBlockToRpcHeader,
  apiBlockTransactionsToRows,
  apiReceiptToRpcReceipt,
  apiTxToRpcTx,
  assessBridgeTrustDisclosures,
  bridgeRouteDisclosureFailureDetails,
  bridgeTrustDisclosureDisplaySlice,
  bridgeTrustDisclosuresFromAddressData,
  decodedTxToRpcReceipt,
  decodedTxToRpcTx,
  fetchBridgeRouteDisclosures,
  fetchNativeMarketEvents,
  fetchTxNativeReceipt,
  fetchMrcMetadataForTokenBalances,
  mergeBridgeTrustDisclosures,
  MRV_NATIVE_RECEIPT_TX_TYPE,
  MRV_NATIVE_TX_EXTENSION_BODY_HEX,
  MRV_NATIVE_TX_EXTENSION_KIND,
  mrvNativeTransactionEvidence,
  mrcMetadataBalanceQueryKeys,
  normalizeBridgeRouteDisclosure,
  normalizeRedemptionQueueResponse,
  nativeReceiptEventRows,
  nativeMarketEventRows,
  nativeReceiptMarketEventRows,
  queryClient,
  txFeedToRows,
} from "./hooks";
import { isWebSocketEnabled, resetRpcClient } from "../sdk/client";

afterEach(() => {
  // Clear the singletons + RQ cache so tests don't leak state.
  queryClient.clear();
  resetRpcClient();
  vi.restoreAllMocks();
});

function nativeReceiptFixture(
  overrides: Partial<NativeReceiptResponse<unknown>> & Record<string, unknown> = {},
): NativeReceiptResponse<unknown> & Record<string, unknown> {
  return {
    txHash: `0x${"22".repeat(32)}`,
    blockHash: `0x${"33".repeat(32)}`,
    blockHeight: 100,
    txIndex: 0,
    schema: "riscv.receipt.v1",
    artifactHash: `0x${"aa".repeat(32)}`,
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
  };
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
    const receipt = nativeReceiptFixture({
      txHash,
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
    expect((result as Record<string, unknown> | null)?.noEvmProof).toBeNull();
  });

  it("falls back to lyth_nativeReceipt when the native receipt API is unavailable", async () => {
    const txHash = `0x${"66".repeat(32)}`;
    const receipt = nativeReceiptFixture({
      txHash,
      noEvmProof: { verifier: "fixture", digest: `0x${"77".repeat(32)}` },
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
    expect((result as Record<string, unknown> | null)?.noEvmProof)
      .toEqual({ verifier: "fixture", digest: `0x${"77".repeat(32)}` });
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
    const fee = { total_lythoshi: "77" };
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
    expect(feedRows[0]).toMatchObject({ value: "999", executionUnitLimit: 21_000, fee });
  });

  it("maps native RISC-V receipt events into transaction-detail display rows", () => {
    const receipt = {
      txHash: `0x${"22".repeat(32)}`,
      blockHash: `0x${"33".repeat(32)}`,
      blockHeight: 100,
      txIndex: 0,
      schema: "riscv.receipt.v1",
      artifactHash: `0x${"aa".repeat(32)}`,
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
            family: "agent",
            event_name: "agent.escrow.created",
            payload_hash: `0x${"44".repeat(32)}`,
            amount_lythoshi: "440000000000",
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
        family: "agent",
        eventName: "agent.escrow.created",
        payloadHash: `0x${"44".repeat(32)}`,
        decodedFields: [
          ["amount_lythoshi", "440000000000"],
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
      pqCheckpoint: "checkpoint #118",
    });
    expect(evidence?.extension).toMatchObject({
      kind: MRV_NATIVE_TX_EXTENSION_KIND,
      bodyHex: MRV_NATIVE_TX_EXTENSION_BODY_HEX,
      validMrvV1: true,
    });
    expect(evidence?.blockers).toContain(
      "native-receipt.noEvmProof returned null; Monoscan treats the no-EVM proof as missing until a verifier payload is available.",
    );
  });

  it("marks no-EVM proof present only when native receipt noEvmProof has a payload", () => {
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
        txType: MRV_NATIVE_RECEIPT_TX_TYPE,
        noEvmProof: { verifier: "native", digest: `0x${"12".repeat(32)}` },
      }),
    } as any);

    expect(evidence).toMatchObject({
      proofState: "present",
      proofFieldSource: "native-receipt.noEvmProof",
      proofFieldState: "present",
    });
    expect(evidence?.proof).toMatchObject({
      source: "native-receipt.noEvmProof",
      summary: "present",
    });
    expect(evidence?.blockers).not.toContain(
      "native-receipt.noEvmProof must return a verifier payload before Monoscan can render no-EVM proof evidence.",
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
      "native-receipt.noEvmProof must return a verifier payload before Monoscan can render no-EVM proof evidence.",
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
