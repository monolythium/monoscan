/**
 * Monoscan SDK seam — new-surface types (PF-6, MB-6, PF-4, MB-5, MB-4, MB-2).
 *
 * These are the explorer-facing shapes for the chain features landed this
 * session. The methods + types that back them ship in
 * `@monolythium/core-sdk` 0.3.10 (a separate in-flight SDK pass); monoscan
 * currently pins 0.3.9, so the shapes are defined HERE in the seam and the
 * components render from them.
 *
 * # Reconciliation contract
 *
 * When 0.3.10 lands, the end-pass swaps the bodies below to re-export the
 * real SDK types (e.g. `export type { ClusterDiversityResponse } from
 * "@monolythium/core-sdk"`), keeping the names stable. Every field here is
 * mirrored from the merged mono-core crates so the swap is field-for-field:
 *
 *   - PF-6  node diversity + operator metadata:
 *       `economics/node-registry/src/diversity.rs` (DiversityBreakdown,
 *       DIVERSITY_SCORE_MAX = 10_000), `registration.rs`
 *       (FIELD_ASN/GEO_REGION/HOSTING_CLASS/PCR_DIGEST, HostingClass).
 *   - MB-6  oracle:
 *       `precompiles/platform/oracle/src/storage.rs` (feed_field,
 *       round_field, writer/admin slots) + `events.rs` (FeedAdded,
 *       OracleRoundFinalized, OracleWriterAdded — IndexerEventRecord).
 *   - PF-4  spending-policy §18.8 dims:
 *       `agent-commerce/spending-policy/src/storage.rs`
 *       (daily/weekly/monthly cap, category allow-root, packed
 *       time-of-day window, policy expiry).
 *   - MB-5  cluster directory:
 *       `economics/node-registry/src/events.rs` ClusterFormed
 *       `(uint32 clusterId, uint64 effectiveEpoch, address anchorAddress,
 *        bytes operatorRoster)` + `lyth_clusterDirectory`/`lyth_clusterStatus`.
 *   - MB-4  prover market:
 *       `precompiles/platform/prover-market/src/core.rs` (ProofRequest,
 *       ProverMarketState Open/Assigned/Settled/Slashed/Expired, ProverBid)
 *       + `prover_tier.rs` (fee floor 0.1 LYTH, bond 250 LYTH) + `events.rs`.
 *   - MB-2  bridge health + circuit breaker:
 *       `precompiles/bridge/bridge/src/storage.rs` (DRAIN_FIELD_*,
 *       FIELD_PAUSED_AT_BLOCK, FIELD_RESUME_COOLDOWN_BLOCKS) + `events.rs`
 *       (BridgePaused, BridgeUnpaused, DrainCapSet).
 *
 * Do NOT import non-existent SDK exports into components; route everything
 * through the names exported here.
 */

/* ========================================================================== */
/* PF-6 — Node diversity + operator network metadata                          */
/* ========================================================================== */

/** Basis-point ceiling for every diversity term and the headline score. */
export const DIVERSITY_SCORE_MAX = 10_000;

/**
 * Hosting class as committed to a registration record (PF-6).
 *
 * Mirrors `node-registry::registration::HostingClass` (BareMetal = 0,
 * CoLocation = 1, Cloud = 2). An unparseable byte decodes to `cloud` on
 * chain so a malformed value never inflates a cluster's diversity score.
 */
export type HostingClass = "bareMetal" | "coLocation" | "cloud";

/**
 * Per-axis diversity breakdown, each term in `0..=10000` basis points
 * (normalised Shannon entropy of the roster distribution along that axis).
 *
 * Mirrors `diversity.rs::DiversityBreakdown`.
 */
export interface DiversityBreakdown {
  /** Normalised ASN-distribution entropy (0..10000 bps). */
  asnVariance: number;
  /** Normalised country-distribution entropy (0..10000 bps). */
  geoVariance: number;
  /** Normalised hosting-class-distribution entropy (0..10000 bps). */
  hostingSpread: number;
}

/**
 * Diversity score + breakdown for a single cluster roster (PF-6).
 *
 * Mirrors the `(u16 score, DiversityBreakdown)` returned by
 * `diversity.rs::compute_cluster_diversity_score` plus the cluster id the
 * score was computed over.
 */
export interface ClusterDiversityScore {
  /** Cluster id the score was computed over. */
  clusterId: number;
  /** Unweighted mean of the three breakdown terms, 0..10000 bps. */
  score: number;
  /** Per-axis breakdown. */
  breakdown: DiversityBreakdown;
  /** Roster members resolved when the score was computed. */
  resolvedMembers: number;
}

/**
 * One operator's on-chain network metadata, resolved from its
 * registration record (PF-6).
 *
 * Mirrors the diversity-relevant subset of
 * `registration.rs::Registration`: FIELD_ASN (u16), FIELD_GEO_REGION
 * (3-byte ISO-3166-1 alpha-3), FIELD_HOSTING_CLASS (HostingClass), and
 * FIELD_PCR_DIGEST (keccak of the TPM PCR value set). The raw IP never
 * lives on-chain — only its keccak digest.
 */
export interface OperatorNetworkMetadata {
  /** 32-byte hex operator id (the addressable identity). */
  operatorId: string;
  /** Autonomous-system number. `0` when not declared. */
  asn: number;
  /** ISO-3166-1 alpha-3 geo region (e.g. `"NLD"`). Empty when undeclared. */
  geoRegion: string;
  /** Hosting class — bare-metal / co-location / cloud. */
  hostingClass: HostingClass;
  /**
   * keccak digest of the TPM PCR value set committed at register time.
   * `0x000…0` (all-zero) when no quote was attached.
   */
  pcrDigest: string;
}

/** Aggregate diversity view for a cluster: score + per-operator roster. */
export interface ClusterDiversityView {
  /** Diversity score + breakdown. */
  diversity: ClusterDiversityScore;
  /** Per-operator network metadata for the roster. */
  operators: OperatorNetworkMetadata[];
}

/* ========================================================================== */
/* MB-6 — Oracle                                                              */
/* ========================================================================== */

/**
 * One configured oracle feed (MB-6).
 *
 * Mirrors `oracle::storage::feed_field` (METADATA packs decimals +
 * min_signers + aggregation kind; CIRCUIT_BREAKER_BPS is the deviation
 * bound; ALLOWED_WRITERS_LEN is the k-of-n denominator) plus the latest
 * finalized round from `round_field` (COMPUTED_MEDIAN + FINALIZED_AT_BLOCK).
 * `FeedAdded(bytes32 feedId, uint8 decimals, uint16 minSigners, uint32
 * circuitBreakerBps, uint32 allowedWritersLen)`.
 */
export interface OracleFeed {
  /** 32-byte hex feed id (`keccak`-derived, e.g. from `"BTC/USD"`). */
  feedId: string;
  /** Human label when the indexer can resolve one (e.g. `"BTC/USD"`). */
  label: string | null;
  /** Price decimals. */
  decimals: number;
  /** Minimum signers (k) required to close a round. */
  minSigners: number;
  /** Total allowed writers (n) — the k-of-n denominator. */
  allowedWritersLen: number;
  /** Heartbeat: max observation age before a round is considered stale (s). */
  heartbeatSecs: number;
  /** Deviation circuit-breaker bound, basis points. */
  deviationBps: number;
  /** Latest finalized round id; `null` when no round has ever closed. */
  latestRoundId: number | null;
  /** Latest computed median price (raw, scaled by `decimals`). */
  latestMedian: string | null;
  /** Block at which the latest round finalized. */
  finalizedAtBlock: number | null;
  /** Observation count that contributed to the latest median. */
  observationsLen: number | null;
}

/**
 * One authorized oracle signer (MB-6).
 *
 * `servesOracleWriter` mirrors the global on-chain writer-set sentinel
 * (`oracle::storage::slot_writer_authorized`). `feeds` lists the feed ids
 * this writer is in the per-feed allowed-writers list for
 * (`oracle::storage::slot_feed_writer`).
 */
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

/** Aggregate oracle dashboard view. */
export interface OracleDashboard {
  /** Authorized signer roster. */
  signers: OracleSigner[];
  /** Configured feeds. */
  feeds: OracleFeed[];
  /** Oracle admin address (foundation-controlled); `null` when unset. */
  admin: string | null;
}

/* ========================================================================== */
/* PF-4 — Spending-policy dimensions (§18.8)                                  */
/* ========================================================================== */

/**
 * Packed time-of-day window (§18.8).
 *
 * Mirrors `spending-policy::storage::pack_time_window(enabled, start_hour,
 * end_hour)` — hours are `0..=23`. When `enabled` is false the on-chain
 * word is the all-zero "no window" sentinel.
 */
export interface TimeOfDayWindow {
  enabled: boolean;
  /** UTC start hour, 0..23. */
  startHour: number;
  /** UTC end hour, 0..23. */
  endHour: number;
}

/**
 * §18.8 spending-policy dimensions for one agent sub-account (PF-4).
 *
 * Mirrors the slot family in `spending-policy::storage`: per-tx +
 * daily/weekly/monthly caps (lythoshi; `null` = "no cap configured"),
 * category allow-root + destination allow-root (`Hash::ZERO` = "no list"),
 * packed time-of-day window, and explicit policy-expiry (unix seconds;
 * `null` = "never expires"). Spent counters are per-window indices.
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
  /** Spent in the current day window (raw lythoshi). */
  dailySpentLythoshi: string | null;
  /** Spent in the current week window (raw lythoshi). */
  weeklySpentLythoshi: string | null;
  /** Spent in the current month window (raw lythoshi). */
  monthlySpentLythoshi: string | null;
  /**
   * Category allow-root — keccak Merkle root of allowed category ids.
   * `null` (or all-zero) means "any category accepted".
   */
  categoryAllowRoot: string | null;
  /**
   * Destination allow-root — keccak Merkle root of allowed destinations.
   * `null` (or all-zero) means "any destination accepted".
   */
  destinationAllowRoot: string | null;
  /** Packed time-of-day window; `null` means "any hour accepted". */
  timeWindow: TimeOfDayWindow | null;
  /** Explicit policy expiry (unix seconds); `null` = never expires. */
  expiryUnixSecs: number | null;
  /** Monotonic policy version (bumped on every update). */
  policyVersion: number;
}

/* ========================================================================== */
/* MB-5 — Cluster directory                                                   */
/* ========================================================================== */

/** Lifecycle status of a directory cluster (MB-5). */
export type ClusterFormationStatus = "forming" | "active" | "draining" | "retired";

/**
 * One cluster directory entry (MB-5).
 *
 * Mirrors the `ClusterFormed(uint32 clusterId, uint64 effectiveEpoch,
 * address anchorAddress, bytes operatorRoster)` event
 * (`node-registry::events`) joined with `lyth_clusterStatus`. The
 * `operatorRoster` is a concatenation of compressed 48-byte BLS pubkeys
 * (up to 10 operators at full DVT topology); the indexer projects it into
 * `roster` entries.
 */
export interface ClusterDirectoryEntry {
  /** Cluster id. */
  clusterId: number;
  /** Epoch at which the cluster became (or becomes) effective. */
  effectiveEpoch: number;
  /** Cluster primary network anchor address (Law §7.13, bech32m cluster HRP). */
  anchorAddress: string;
  /** Compressed 48-byte BLS pubkeys of the roster (hex). */
  roster: string[];
  /** Live signing operators (from `lyth_clusterStatus`). */
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

/** Aggregate cluster directory view (MB-5). */
export interface ClusterDirectory {
  /** Directory entries, newest-formed first. */
  clusters: ClusterDirectoryEntry[];
  /** Current epoch the directory was read at. */
  currentEpoch: number | null;
}

/* ========================================================================== */
/* MB-4 — Prover market                                                       */
/* ========================================================================== */

/**
 * Proof-request lifecycle state (MB-4).
 *
 * Mirrors `prover-market::core::ProverMarketState`
 * (Open=0 / Assigned=1 / Settled=2 / Slashed=3 / Expired=4).
 */
export type ProverMarketState = "open" | "assigned" | "settled" | "slashed" | "expired";

/** Prover-market protocol parameters (MB-4). */
export const PROVER_FEE_FLOOR_LYTH = "0.1";
export const PROVER_BOND_MIN_LYTH = "250";

/**
 * One open / settled proof request (MB-4).
 *
 * Mirrors `prover-market::core::ProofRequest`: vkey hash, escrowed
 * `max_fee`, `deadline` (unix seconds), state machine, assigned prover +
 * winning fee once closed. `ProofRequested(bytes32 id, address buyer,
 * bytes32 vkeyHash, uint128 maxFee, uint64 deadline)`.
 */
export interface ProofRequest {
  /** 32-byte hex request id. */
  id: string;
  /** Buyer that escrowed `maxFee` (bech32m). */
  buyer: string;
  /** 32-byte hex verification-key hash the proof must satisfy. */
  vkeyHash: string;
  /** Max fee escrowed (raw lythoshi). */
  maxFee: string;
  /** Deadline (unix seconds) after which the request is slashable/expirable. */
  deadline: number;
  /** Current state-machine state. */
  state: ProverMarketState;
  /** Assigned prover (bech32m); `null` while Open / Expired. */
  assignedProver: string | null;
  /** Winning fee bid (raw lythoshi); `null` while Open / Expired. */
  winningFee: string | null;
}

/**
 * One fee bid against a proof request (MB-4).
 *
 * Mirrors `prover-market::core::ProverBid`.
 * `BidSubmitted(bytes32 id, address prover, uint128 fee)`.
 */
export interface ProverBid {
  /** Request the bid targets. */
  requestId: string;
  /** Bidding prover (bech32m). */
  prover: string;
  /** Fee bid (raw lythoshi); must be `>= fee floor` and `<= maxFee`. */
  fee: string;
}

/**
 * One registered GPU prover (MB-4).
 *
 * Mirrors `prover-market::registry` — a prover that holds the
 * `SERVES_GPU_PROVE` capability bit, registered with a per-prover
 * fee floor (`>= PROVER_FEE_FLOOR_LYTH`) and a locked bond
 * (`>= PROVER_BOND_MIN_LYTH`).
 */
export interface RegisteredProver {
  /** Prover address (bech32m). */
  address: string;
  /** Holds the GPU-prove capability (`SERVES_GPU_PROVE`). */
  servesGpuProve: boolean;
  /** Per-prover fee floor the prover will accept (raw lythoshi). */
  feeFloor: string;
  /** Locked bond (raw lythoshi). */
  bond: string;
}

/** Aggregate prover-market view (MB-4). */
export interface ProverMarket {
  /** Proof requests, newest first. */
  requests: ProofRequest[];
  /** Open bids keyed by request id. */
  bids: ProverBid[];
  /** Registered provers. */
  provers: RegisteredProver[];
}

/* ========================================================================== */
/* MB-2 — Bridge health + circuit breaker                                     */
/* ========================================================================== */

/** Circuit-breaker state for a bridge route (MB-2). */
export type BridgeBreakerState = "armed" | "paused" | "disabled";

/**
 * Per-route drain-cap + circuit-breaker health (MB-2).
 *
 * Mirrors the bridge drain-cap slot family
 * (`bridge::storage::DRAIN_FIELD_CAP_PER_WINDOW / _WINDOW_BLOCKS /
 * _CURRENT_BUCKET / _DRAINED_THIS_BUCKET`) plus the breaker fields
 * (`FIELD_PAUSED_AT_BLOCK`, `FIELD_RESUME_COOLDOWN_BLOCKS`,
 * `FIELD_STATUS_AND_FLAGS`). `BridgePaused(bytes32 bridgeId, bytes32
 * reason)` / `BridgeUnpaused(bytes32 bridgeId)` /
 * `DrainCapSet(bytes32 bridgeId, address asset, uint256 cap, uint64 window)`.
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
