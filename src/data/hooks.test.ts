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
import { HEAD_POLL_MS, queryClient } from "./hooks";
import { isWebSocketEnabled, resetRpcClient } from "../sdk/client";

afterEach(() => {
  // Clear the singletons + RQ cache so tests don't leak state.
  queryClient.clear();
  resetRpcClient();
  vi.restoreAllMocks();
});

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
    expect(typeof apiProto.transaction).toBe("function");
    expect(typeof apiProto.addressActivity).toBe("function");
    expect(typeof apiProto.clusters).toBe("function");
    expect(typeof apiProto.operator).toBe("function");
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
    expect(typeof proto.lythGetAddressLabel).toBe("function");
    expect(typeof proto.lythGetDelegationHistory).toBe("function");
    expect(typeof proto.lythGetAddressActivity).toBe("function");
    expect(typeof proto.lythCapabilities).toBe("function");
    expect(typeof proto.lythGetLatestCheckpoint).toBe("function");
    expect(typeof proto.lythGetClusterResignations).toBe("function");
    expect(typeof proto.lythGetBlsRoundCertificate).toBe("function");
    expect(typeof proto.lythGetLeaderCertificate).toBe("function");
    expect(typeof proto.lythGetDacCertificate).toBe("function");
    // The `protocore_*` names should NOT exist on the new SDK — if they
    // re-appear it means a downstream regression dragged the v0 names
    // back. Treat as a hard fail.
    expect((proto as Record<string, unknown>).protocoreCurrentRound).toBeUndefined();
  });
});
