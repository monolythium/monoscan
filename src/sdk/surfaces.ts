/**
 * Monoscan SDK seam — v5 explorer surfaces (PF-6, MB-6, PF-4, MB-5, MB-4, MB-2).
 *
 * `@monolythium/core-sdk` 0.3.10 ships the real read types + `lyth_*` methods
 * for every v5 surface, so this seam now re-exports the SDK's published shapes
 * and defines the explorer-facing **view-models** the page components render
 * from. The hooks in `data/hooks.ts` assemble these view-models from the live
 * SDK calls (`lyth_getClusterDiversity`, `lyth_oracleSigners`/`Writers`/
 * `LatestPrice`/`FeedConfig`, `lyth_getSpendingPolicy`, `lyth_clusterDirectory`/
 * `clusterStatus`, `lyth_getProofRequest`/`listProofRequests`/`getProverBids`/
 * `proverMarketStatus`, `lyth_operatorRouterConfig`/`operatorFeeConfig`,
 * `lyth_bridgeHealth`/`bridgeDrainStatus`), falling back to `data/fallback.ts`
 * fixtures or an empty/loading state when the chain or a projection is
 * unavailable.
 *
 * Reconciliation contract: where the SDK exports a type, the SDK wins. The
 * view-models below adapt the SDK response shapes into the aggregate the
 * components consume; the adapter functions live here so the swap is in one
 * place. Wire-level field names + units come from the SDK declarations:
 *
 *   - PF-6  ClusterDiversityView / OperatorNetworkMetadataView (flat camelCase,
 *           bps 0..=10000; hosting class wire string is snake_case).
 *   - MB-6  OracleSignersResponse / OracleWriters / OracleLatestPrice /
 *           OracleFeedConfig (per-feed split; `0x`-hex uint256 medians).
 *   - PF-4  SpendingPolicyView (`0x`-hex uint256 caps; `0x0` = no cap;
 *           timeOfDayWindow nullable; no spent counters in the read shape).
 *   - MB-5  ClusterDirectoryEntryResponse / ClusterDirectoryPageResponse +
 *           ClusterStatusResponse (no roster/anchor in the directory page).
 *   - MB-4  ProofRequestRow / ProofRequestView / ProverBidView /
 *           ProverMarketStatusResponse (`feeFloor` is on-chain `0x`-hex).
 *   - MB-2  BridgeHealthRecord / BridgeDrainStatus (paged global bridge set;
 *           per-route drain bucket is a separate call).
 */

/* ========================================================================== */
/* SDK type re-exports — the canonical wire shapes (SDK wins).                 */
/* ========================================================================== */

export type {
  // PF-6
  ClusterDiversity,
  ClusterDiversityView,
  OperatorNetworkMetadata,
  OperatorNetworkMetadataView,
  NodeHostingClass,
  // MB-6
  OracleSignerRow,
  OracleSignersResponse,
  OracleWriters,
  OracleLatestPrice,
  OracleFeedConfig,
  OracleEvent,
  // PF-4
  SpendingPolicyView,
  SpendingPolicyTimeWindow,
  // MB-5
  ClusterDirectoryEntryResponse,
  ClusterDirectoryPageResponse,
  ClusterStatusResponse,
  ClusterMemberResponse,
  ClusterFormedEvent,
  // MB-4
  ProverMarketState,
  ProofRequestView,
  ProofRequestRow,
  ListProofRequestsResponse,
  ProverBidView,
  ProverBidsResponse,
  ProverMarketStatusResponse,
  // operator router
  OperatorRouterConfig,
  OperatorFeeConfig,
  // MB-2
  BridgeHealthRecord,
  BridgeHealthResponse,
  BridgeCircuitBreakerFields,
  BridgeDrainStatus,
  BridgeDrainCap,
} from "@monolythium/core-sdk";

export { DIVERSITY_SCORE_MAX, SERVES_GPU_PROVE } from "@monolythium/core-sdk";

import type {
  ClusterDiversityView as SdkClusterDiversityView,
  OperatorNetworkMetadataView as SdkOperatorNetworkMetadataView,
  NodeHostingClass,
} from "@monolythium/core-sdk";

/* ========================================================================== */
/* PF-6 — Node diversity + operator network metadata (view-models)            */
/* ========================================================================== */

/**
 * Hosting class as monoscan renders it — the SDK's camelCase
 * {@link NodeHostingClass} (`bareMetal` / `coLocation` / `cloud`). The live
 * `lyth_getOperatorNetworkMetadata` view emits the snake_case wire string;
 * {@link normalizeHostingClass} maps it to this.
 */
export type HostingClass = NodeHostingClass;

/** Map the snake_case `OperatorNetworkMetadataView.hostingClass` to camelCase. */
export function normalizeHostingClass(
  wire: SdkOperatorNetworkMetadataView["hostingClass"] | string,
): HostingClass {
  switch (wire) {
    case "bare_metal":
    case "bareMetal":
      return "bareMetal";
    case "co_location":
    case "coLocation":
      return "coLocation";
    default:
      return "cloud";
  }
}

/**
 * Per-axis diversity breakdown, each term in `0..=10000` bps (the SDK's
 * `ClusterDiversityView` carries these flat alongside the headline `score`).
 */
export interface DiversityBreakdown {
  asnVariance: number;
  geoVariance: number;
  hostingSpread: number;
}

/** Diversity score + breakdown for a single cluster roster (PF-6 view-model). */
export interface ClusterDiversityScore {
  /** Cluster id the score was computed over. */
  clusterId: number;
  /** Headline diversity score, `0..=10000` bps. */
  score: number;
  /** Per-axis breakdown. */
  breakdown: DiversityBreakdown;
  /** Roster members resolved when the score was computed. */
  resolvedMembers: number;
}

/**
 * One operator's network metadata as rendered (PF-6 view-model). Adapts the
 * SDK {@link SdkOperatorNetworkMetadataView}: `asn` null collapses to `0`,
 * `geoRegion` null collapses to `""`, and the snake_case hosting class is
 * normalized to camelCase.
 */
export interface OperatorNetworkMetadataRow {
  /** 32-byte hex operator id. */
  operatorId: string;
  /** Autonomous-system number; `0` when not declared. */
  asn: number;
  /** ISO-3166-1 alpha-3 geo region; empty when undeclared. */
  geoRegion: string;
  /** Hosting class — bare-metal / co-location / cloud. */
  hostingClass: HostingClass;
  /** keccak digest of the TPM PCR value set; all-zero when no quote. */
  pcrDigest: string;
}

/** Aggregate diversity view for a cluster: score + per-operator roster. */
export interface ClusterDiversityRollup {
  /** Diversity score + breakdown. */
  diversity: ClusterDiversityScore;
  /** Per-operator network metadata for the roster. */
  operators: OperatorNetworkMetadataRow[];
}

/** Build a {@link ClusterDiversityScore} from the SDK's flat diversity view. */
export function diversityScoreFromView(
  view: SdkClusterDiversityView,
  resolvedMembers: number,
): ClusterDiversityScore {
  return {
    clusterId: view.clusterId,
    score: view.score,
    breakdown: {
      asnVariance: view.asnVariance,
      geoVariance: view.geoVariance,
      hostingSpread: view.hostingSpread,
    },
    resolvedMembers,
  };
}

/* ========================================================================== */
/* MB-6 — Oracle (view-models)                                                */
/* ========================================================================== */

/**
 * One configured oracle feed as rendered (MB-6 view-model), assembled from
 * `lyth_oracleFeedConfig` + `lyth_oracleLatestPrice`.
 */
export interface OracleFeed {
  /** 32-byte hex feed id. */
  feedId: string;
  /** Human label when the indexer can resolve one; else `null`. */
  label: string | null;
  /** Price decimals. */
  decimals: number;
  /** Minimum signers (k) required to close a round. */
  minSigners: number;
  /** Total allowed writers (n) — the k-of-n denominator. */
  allowedWritersLen: number;
  /** Heartbeat: max observation age before a round is stale (s). */
  heartbeatSecs: number;
  /** Deviation circuit-breaker bound, basis points. */
  deviationBps: number;
  /** Latest finalized round id; `null` when no round has ever closed. */
  latestRoundId: number | null;
  /** Latest computed median price (`0x`-hex uint256). */
  latestMedian: string | null;
  /** Block at which the latest round finalized. */
  finalizedAtBlock: number | null;
  /** Observation count that contributed to the latest median, when known. */
  observationsLen: number | null;
}

/** One authorized oracle signer as rendered (MB-6 view-model). */
export interface OracleSigner {
  /** Writer address (bech32m). */
  address: string;
  /** `true` when the writer is in the global authorized writer set. */
  servesOracleWriter: boolean;
  /** Feed ids this writer is an allowed writer for. */
  feeds: string[];
  /** Bond balance mirror (raw lythoshi); `null` when not reported. */
  bond: string | null;
}

/** Aggregate oracle dashboard view-model (MB-6). */
export interface OracleDashboard {
  /** Authorized signer roster. */
  signers: OracleSigner[];
  /** Configured feeds. */
  feeds: OracleFeed[];
  /** Oracle admin address (foundation-controlled); `null` when unset. */
  admin: string | null;
}

/* ========================================================================== */
/* PF-4 — Spending-policy dimensions (§18.8) (view-model)                     */
/* ========================================================================== */

/**
 * Time-of-day window as rendered (§18.8). Mirrors the SDK
 * `SpendingPolicyTimeWindow`.
 */
export interface TimeOfDayWindow {
  enabled: boolean;
  /** UTC start hour, 0..23. */
  startHour: number;
  /** UTC end hour, 0..23. */
  endHour: number;
}

/**
 * §18.8 spending-policy dimensions for one agent sub-account (PF-4 view-model).
 * Adapts the SDK `SpendingPolicyView`: caps are `0x`-hex uint256 strings where
 * `0x0` means "no cap" (collapsed to `null`); the read shape carries no spent
 * counters (the indexer-projected per-window spend lives elsewhere), so the
 * spent fields are `null` on the live path and only populated by the fixture.
 */
export interface SpendingPolicyDimensions {
  /** Agent sub-account the policy governs (bech32m). */
  subAccount: string;
  /** `true` once a policy has been installed for the sub-account. */
  configured: boolean;
  /** `true` when the policy is explicitly disabled. */
  disabled: boolean;
  /** Per-tx cap (raw lythoshi); `null` when no cap is configured. */
  perTxCapLythoshi: string | null;
  /** Daily rolling cap (raw lythoshi); `null` when unconfigured. */
  dailyCapLythoshi: string | null;
  /** Weekly rolling cap (raw lythoshi); `null` when unconfigured. */
  weeklyCapLythoshi: string | null;
  /** Monthly rolling cap (raw lythoshi); `null` when unconfigured. */
  monthlyCapLythoshi: string | null;
  /** Spent in the current day window; `null` when not reported. */
  dailySpentLythoshi: string | null;
  /** Spent in the current week window; `null` when not reported. */
  weeklySpentLythoshi: string | null;
  /** Spent in the current month window; `null` when not reported. */
  monthlySpentLythoshi: string | null;
  /** Category allow-root; `null` (or all-zero) = any category. */
  categoryAllowRoot: string | null;
  /** Destination allow-root; `null` (or all-zero) = any destination. */
  destinationAllowRoot: string | null;
  /** Time-of-day window; `null` = any hour. */
  timeWindow: TimeOfDayWindow | null;
  /** Explicit policy expiry (unix seconds); `null` = never expires. */
  expiryUnixSecs: number | null;
  /** Monotonic policy version. */
  policyVersion: number;
}

/* ========================================================================== */
/* MB-5 — Cluster directory (view-model)                                      */
/* ========================================================================== */

/** Lifecycle status of a directory cluster (MB-5). */
export type ClusterFormationStatus = "forming" | "active" | "draining" | "retired";

/**
 * One cluster directory entry as rendered (MB-5 view-model). The SDK's
 * `ClusterDirectoryEntryResponse` is a compact descriptor (id, size, threshold,
 * aggregateHealth, regionDiversity, active); the richer fields below
 * (anchorAddress, roster, effectiveEpoch, liveMembers, formedAtBlock) are
 * joined from `lyth_clusterStatus` + decoded `ClusterFormed` events, falling
 * back to fixture values when the chain does not retain them.
 */
export interface ClusterDirectoryEntry {
  /** Cluster id. */
  clusterId: number;
  /** Epoch at which the cluster became (or becomes) effective. */
  effectiveEpoch: number;
  /** Cluster primary network anchor address (bech32m cluster HRP). */
  anchorAddress: string;
  /** Compressed 48-byte BLS pubkeys of the roster (hex). */
  roster: string[];
  /** Live signing operators. */
  liveMembers: number;
  /** Roster size. */
  size: number;
  /** BFT signing threshold (k of size). */
  threshold: number;
  /** Lifecycle status. */
  status: ClusterFormationStatus;
  /** Block at which the cluster was first observed forming. */
  formedAtBlock: number | null;
}

/** Aggregate cluster directory view-model (MB-5). */
export interface ClusterDirectory {
  /** Directory entries, newest-formed first. */
  clusters: ClusterDirectoryEntry[];
  /** Current epoch the directory was read at. */
  currentEpoch: number | null;
}

/* ========================================================================== */
/* MB-4 — Prover market (view-models)                                         */
/* ========================================================================== */

/** Prover-market display constants (monoscan UI copy; not SDK wire values). */
export const PROVER_FEE_FLOOR_LYTH = "0.1";
export const PROVER_BOND_MIN_LYTH = "250";

/**
 * One proof request as rendered (MB-4 view-model). Adapts the SDK
 * `ProofRequestRow` (indexer projection) / `ProofRequestView` (state-tree
 * read): both carry `deadlineUnixSeconds`, normalized to `deadline` here.
 */
export interface ProofRequest {
  /** 32-byte hex request id. */
  id: string;
  /** Buyer that escrowed `maxFee` (bech32m). */
  buyer: string;
  /** 32-byte hex verification-key hash. */
  vkeyHash: string;
  /** Max fee escrowed (raw lythoshi). */
  maxFee: string;
  /** Deadline (unix seconds). */
  deadline: number;
  /** Current state-machine state. */
  state: string;
  /** Assigned prover (bech32m); `null` while Open / Expired. */
  assignedProver: string | null;
  /** Winning fee bid (raw lythoshi); `null` while Open / Expired. */
  winningFee: string | null;
}

/** One fee bid against a proof request as rendered (MB-4 view-model). */
export interface ProverBid {
  /** Request the bid targets. */
  requestId: string;
  /** Bidding prover (bech32m). */
  prover: string;
  /** Fee bid (raw lythoshi). */
  fee: string;
}

/** One registered GPU prover as rendered (MB-4 view-model). */
export interface RegisteredProver {
  /** Prover address (bech32m). */
  address: string;
  /** Holds the GPU-prove capability (`SERVES_GPU_PROVE`). */
  servesGpuProve: boolean;
  /** Per-prover fee floor (raw lythoshi). */
  feeFloor: string;
  /** Locked bond (raw lythoshi). */
  bond: string;
}

/** Aggregate prover-market view-model (MB-4). */
export interface ProverMarket {
  /** Proof requests, newest first. */
  requests: ProofRequest[];
  /** Open bids keyed by request id. */
  bids: ProverBid[];
  /** Registered provers. */
  provers: RegisteredProver[];
}

/* ========================================================================== */
/* MB-2 — Bridge health + circuit breaker (view-model)                        */
/* ========================================================================== */

/** Circuit-breaker state for a bridge route (MB-2). */
export type BridgeBreakerState = "armed" | "paused" | "disabled";

/**
 * Per-route drain-cap + circuit-breaker health as rendered (MB-2 view-model).
 * Assembled from `lyth_bridgeHealth` (per-bridge circuit-breaker posture) +
 * `lyth_bridgeDrainStatus` (per-route live drain bucket). Amounts here are raw
 * atomic-unit strings (the bridge serves them as `0x`-hex uint256; the adapter
 * decimalizes them).
 */
export interface BridgeRouteHealth {
  /** 32-byte hex bridge id. */
  bridgeId: string;
  /** Wrapped asset the cap applies to (bech32m / symbol). */
  asset: string;
  /** Drained this window (raw atomic units). */
  drainedThisBucket: string;
  /** Cap per window (raw atomic units); `null` = no cap configured. */
  capPerWindow: string | null;
  /** Remaining headroom before the cap trips (raw atomic units). */
  remaining: string | null;
  /** Fraction of the cap consumed this window (0..1); `null` when no cap. */
  proximity: number | null;
  /** Length of the drain window in protocore blocks. */
  windowBlocks: number;
  /** Circuit-breaker state. */
  breaker: BridgeBreakerState;
  /** Block at which the breaker was paused; `null` when armed. */
  pausedAtBlock: number | null;
  /** Resume cooldown after a pause, in protocore blocks. */
  resumeCooldownBlocks: number;
  /** Reason hash carried by the last `BridgePaused` event; `null` if armed. */
  pausedReason: string | null;
}
