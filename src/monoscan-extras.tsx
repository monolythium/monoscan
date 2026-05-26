/* =====================================================
   Monoscan — Statistics, Wallets, Wallet detail, Tx detail
   Mounted by monoscan-app.tsx. Live data comes through `./data/hooks`;
   local fallback rows come through `./data/fallback`.
===================================================== */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState as useStateX, useMemo as useMemoX, useEffect as useEffectX } from "react";
import { Card } from "./primitives";
import { MONOSCAN_DATA, MARKETS, NETWORK_STATS, WALLETS, TXS } from "./data/fallback";
import {
  useAccountCode,
  useAccountHistory,
  useAddressFlow,
  useAddressActivityKind,
  useAddressLabel,
  useAddressProfile,
  useAgentReputation,
  useNativeAgentState,
  useActivePrecompiles,
  useBlsRoundCertificate,
  useBlockByHash,
  useBlockByNumber,
  useBlockTransactions,
  useBridgeRouteDisclosures,
  useCapabilities,
  useChainStats,
  useClusterResignations,
  useDagParents,
  useEncryptionKey,
  useFeeStats,
  useIndexerAvailability,
  useGapRecords,
  useLatestCheckpoint,
  useLatestTransactions,
  useMetricsRange,
  useMrcHoldersForTokenBalances,
  useMrcAccount,
  useMrcMetadataForTokenBalances,
  useNetworkStatus,
  useOperatorCapabilities,
  usePeerSummary,
  usePendingRewards,
  useRedemptionQueue,
  useRichList,
  useSearch,
  useTokenBalances,
  useTxByHashLive,
  useTxNativeReceipt,
  useTxStatus,
  useUpgradeStatus,
  useVerticesAtRound,
  useWalletDelegations,
  useWalletDelegationHistory,
  BRIDGE_ROUTE_DISCLOSURE_UPSTREAM_FIELD,
  bridgeRouteDisclosureFailureDetails,
  bridgeTrustDisclosureDisplaySlice,
  bridgeTrustDisclosuresFromAddressData,
  mergeBridgeTrustDisclosures,
  nativeAgentStateDisplayRowsAll,
  nativeAgentStateRows,
  type MrcMetadataResponse,
  type MrcHoldersResponse,
  type MrcAccountRecord,
  type MrcAccountResponse,
  type MrcPolicyRecord,
  type MrcPolicySpendRecord,
  type NativeAgentStateDisplayRows,
  type NativeAgentStateDisplayRow,
  type BridgeTrustDisclosureRow,
  type MrvNativeTransactionEvidence,
  type NoEvmCompactReceiptProofTranscript,
  type NoEvmReceiptProofTranscript,
  mrvNativeTransactionEvidence,
  nativeReceiptEventRows,
  nativeReceiptMarketEventRows,
  noEvmReceiptProofMaterialLabel,
  structuredNativeReceiptFee,
} from "./data/hooks";
import { getLythTokenId } from "./sdk/client";
import { getNativeAgentForwarderAddress } from "./sdk/client";
import {
  buildNativeAgentActionWalletRequest,
  nativeAgentActionIndexedNonce,
  nativeAgentActionDefinition,
  nativeAgentActionInitialValues,
  nativeAgentActionNonceAccount,
  NATIVE_AGENT_ACTIONS,
  type NativeAgentActionField,
  type NativeAgentActionKind,
} from "./monoscan-agent-actions";
import type { AgentReputationRecord, AgentReputationResponse, CapabilitiesResponse, NativeReceiptFeeDisplay } from "@monolythium/core-sdk";

/* Light helpers — keep local so this file is self-contained */
const _fmt  = (n: any) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const _fmtI = (n: any) => Math.round(n).toLocaleString();
const _abbr = (n: any) => n >= 1e9 ? `${(n/1e9).toFixed(2)}B` : n >= 1e6 ? `${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `${(n/1e3).toFixed(1)}K` : _fmt(n);
const _short = (a: any, n=10) => a && a.length > n*2+3 ? `${a.slice(0, n)}…${a.slice(-4)}` : a;
const _hexByte = (n: number) => `0x${n.toString(16).padStart(2, "0")}`;
const LYTHOSHI_PER_LYTH = 100_000_000n;
const _fmtLythoshiAmount = (lythoshi: bigint) => {
  const sign = lythoshi < 0n ? "-" : "";
  const abs = lythoshi < 0n ? -lythoshi : lythoshi;
  const whole = abs / LYTHOSHI_PER_LYTH;
  const frac = abs % LYTHOSHI_PER_LYTH;
  if (frac === 0n) return `${sign}${whole.toLocaleString()}`;
  const fracText = frac.toString().padStart(8, "0").replace(/0+$/, "");
  return `${sign}${whole.toLocaleString()}.${fracText}`;
};
const _fmtLyth = (lythoshi: bigint | null | undefined) => {
  if (lythoshi === null || lythoshi === undefined) return null;
  return `${_fmtLythoshiAmount(lythoshi)} LYTH`;
};
const _fmtLythRaw = (value: string | bigint | number | null | undefined) => {
  if (value === null || value === undefined || value === "") return null;
  try {
    return _fmtLyth(BigInt(value));
  } catch {
    return `${_fmtRawToken(value)} LYTH`;
  }
};
const _fmtRawToken = (value: string | bigint | number | null | undefined) => {
  if (value === null || value === undefined || value === "") return "—";
  try {
    const big = BigInt(value);
    return _fmtLythoshiAmount(big);
  } catch {
    return String(value);
  }
};

const _walletTxHash = (result: unknown): string | null => {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "txHash" in result && typeof (result as { txHash?: unknown }).txHash === "string") {
    return (result as { txHash: string }).txHash;
  }
  if (result && typeof result === "object" && "hash" in result && typeof (result as { hash?: unknown }).hash === "string") {
    return (result as { hash: string }).hash;
  }
  return null;
};
const _rawToLythNumber = (value: string | bigint | number | null | undefined) => {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value / Number(LYTHOSHI_PER_LYTH) : 0;
  try {
    const text = String(value);
    if (text.includes(".")) {
      const n = Number(text);
      return Number.isFinite(n) ? n : 0;
    }
    const big = BigInt(value);
    const whole = Number(big / LYTHOSHI_PER_LYTH);
    const frac = Number(big % LYTHOSHI_PER_LYTH) / Number(LYTHOSHI_PER_LYTH);
    return whole + frac;
  } catch {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
};
export function transactionFeeValueLabel(
  feeDisplay: NativeReceiptFeeDisplay | null | undefined,
  fallbackFee: number | null | undefined,
  fallbackDenom = "LYTH",
): string {
  if (feeDisplay) return `${feeDisplay.totalLyth} LYTH`;
  return typeof fallbackFee === "number" && Number.isFinite(fallbackFee)
    ? `${fallbackFee.toFixed(4)} ${fallbackDenom}`
    : "—";
}
export function adr0039FeeDetailText(detail: string | null | undefined): string {
  if (!detail) return "—";
  return detail
    .replace(/\bgas price\b/gi, "execution unit price")
    .replace(/\bgas used\b/gi, "execution units used")
    .replace(/\bgas limit\b/gi, "execution unit limit")
    .replace(/\bper gas\b/gi, "per execution unit")
    .replace(/\bgwei\b/gi, "lythoshi")
    .replace(/\bwei\b/gi, "lythoshi")
    .replace(/\bgas\b/gi, "execution units");
}
type MrcTokenBalanceIdentity = {
  standard?: string | null;
  assetId?: string | null;
  tokenId?: string | null;
};
export type IndexedTokenBalanceRow = {
  tokenId: string;
  balance: string | number | bigint;
  updatedAtBlock: string | number | bigint;
  mrc?: MrcTokenBalanceIdentity | null;
};
export function tokenBalanceStandardLabel(standard: string | null | undefined): string {
  switch (standard) {
    case "mrc20":
      return "MRC-20";
    case "mrc721":
      return "MRC-721";
    case "mrc1155":
      return "MRC-1155";
    case "mrc4626":
      return "MRC-4626 vault shares";
    default:
      return "Indexed";
  }
}
function tokenBalancePrimary(row: IndexedTokenBalanceRow): string {
  const mrc = row.mrc ?? null;
  if (!mrc) return _short(row.tokenId, 14);
  return `${tokenBalanceStandardLabel(mrc.standard)} · ${_short(mrc.assetId ?? row.tokenId, 10)}`;
}
function tokenBalanceSecondary(row: IndexedTokenBalanceRow): string | null {
  const mrc = row.mrc ?? null;
  if (!mrc) return null;
  const parts = [`balance key ${_short(row.tokenId, 8)}`];
  if (mrc.tokenId) parts.unshift(`token ${_short(mrc.tokenId, 8)}`);
  return parts.join(" · ");
}
export function tokenBalancePrimaryWithMetadata(row: IndexedTokenBalanceRow, metadata: MrcMetadataResponse | undefined): string {
  const meta = metadata?.metadata ?? null;
  if (!meta) return tokenBalancePrimary(row);
  const name = meta.name?.trim();
  const symbol = meta.symbol?.trim();
  const label = name || symbol;
  if (!label) return tokenBalancePrimary(row);
  return symbol && name && symbol !== name
    ? `${name} (${symbol})`
    : label;
}
export function tokenBalanceMetadataLines(row: IndexedTokenBalanceRow, metadata: MrcMetadataResponse | undefined): string[] {
  const fallback = tokenBalanceSecondary(row);
  const meta = metadata?.metadata ?? null;
  if (!meta) return fallback ? [fallback] : [];
  const parts = [
    tokenBalanceStandardLabel(meta.standard),
    meta.decimals !== null ? `${meta.decimals} decimals` : null,
    meta.uri,
  ].filter((part): part is string => Boolean(part));
  if (fallback) parts.push(fallback);
  return parts;
}
function tokenBalanceHolderLines(holders: MrcHoldersResponse | undefined): string[] {
  if (!holders || holders.holders.length === 0) return [];
  return holders.holders.slice(0, holders.limit).map((holder) => {
    const block = Number(holder.updatedAtBlock);
    const blockText = Number.isFinite(block) ? block.toLocaleString() : String(holder.updatedAtBlock);
    return `#${holder.rank} ${_short(holder.address, 10)} · ${holder.balance} · block ${blockText}`;
  });
}
function mrcAccountRecordSummary(record: MrcAccountRecord | null): string {
  if (!record) return "—";
  const parts = [
    record.kind,
    record.controller ? `controller ${_short(record.controller, 10)}` : "controller —",
    record.recovery ? `recovery ${_short(record.recovery, 10)}` : "recovery —",
    record.policyHash ? `policy ${_short(record.policyHash, 10)}` : "policy —",
    record.nonce !== null ? `nonce ${record.nonce}` : "nonce —",
    `block ${Number(record.updatedAtBlock).toLocaleString()}`,
  ];
  return parts.join(" · ");
}
export function mrcPolicyBodySummary(policy: MrcPolicyRecord | null): string {
  if (!policy) return "—";
  const assetCount = policy.allowedAssets.length;
  return [
    policy.enabled ? "enabled" : "disabled",
    `per-action ${policy.perActionLimit}`,
    `window ${policy.windowLimit}`,
    `${assetCount} allowed ${assetCount === 1 ? "asset" : "assets"}`,
  ].join(" · ");
}
export function mrcPolicyAllowedAssetsSummary(policy: MrcPolicyRecord | null, limit = 3): string {
  if (!policy) return "—";
  if (policy.allowedAssets.length === 0) return "none";
  const visible = policy.allowedAssets.slice(0, Math.max(1, limit)).map((asset) => _short(asset, 10));
  const remaining = policy.allowedAssets.length - visible.length;
  return remaining > 0 ? `${visible.join(", ")} +${remaining} more` : visible.join(", ");
}
function mrcAccountSummaryText(account: MrcAccountResponse | null): string {
  if (!account) return "—";
  const kinds = [
    account.smartAccount ? "smart" : null,
    account.policyAccount ? "policy" : null,
  ].filter((kind): kind is string => Boolean(kind));
  const prefix = kinds.length > 0 ? kinds.join(" + ") : "no MRC rows";
  return `${prefix} · ${account.policySpends.length}/${account.spendLimit} spend rows`;
}
function mrcPolicySpendKey(row: MrcPolicySpendRecord): string {
  return `${row.account}:${row.assetId}:${row.window}:${row.updatedAtBlock}`;
}
function reputationScopeLabel(reputation: AgentReputationResponse): string {
  return reputation.categoryScope === "category"
    ? `Category ${reputation.categoryId}`
    : "Global";
}
function reputationAverageLabel(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const score = value / 10;
  return `${score % 1 === 0 ? score.toFixed(0) : score.toFixed(1)} / 10`;
}

export function redemptionTicketStatusText(mature: boolean | null | undefined): string {
  if (mature === true) return "Cooldown complete · payout unavailable";
  if (mature === false) return "Cooldown active";
  return "Cooldown state pending";
}

export const AgentReputationCard = ({
  reputation,
  provider,
  categoryId = 0,
  loading = false,
  checked = true,
}: {
  reputation: AgentReputationResponse | null;
  provider?: string | null;
  categoryId?: number;
  loading?: boolean;
  checked?: boolean;
}) => {
  if (!reputation && !loading && !checked) return null;

  const record: AgentReputationRecord | null = reputation?.record ?? null;
  const hasSamples = Boolean(record && record.sampleCount > 0);
  const normalizedCategoryId = Number.isFinite(categoryId) && categoryId >= 0 ? Math.trunc(categoryId) : 0;
  const categoryLabel = reputation
    ? reputationScopeLabel(reputation)
    : normalizedCategoryId > 0
      ? `Category ${normalizedCategoryId}`
      : "Global";
  const providerLabel = reputation?.provider ?? provider ?? null;
  const ratings = record
    ? [
        ["Speed", record.avgSpeedX10],
        ["Quality", record.avgQualityX10],
        ["Communication", record.avgCommunicationX10],
        ["Accuracy", record.avgAccuracyX10],
      ] as const
    : [];

  return (
    <Card
      title="Agent reputation"
      right={<span className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>lyth_agentReputation</span>}
    >
      <div className="tx-kv">
        <KV label="Category scope" value={categoryLabel} mono/>
        <KV label="Samples" value={hasSamples && record ? record.sampleCount.toLocaleString() : reputation ? "0" : "—"} mono/>
        <KV label="Provider" value={providerLabel ? _short(providerLabel, 18) : "—"} mono/>
        <KV label="Block height" value={record ? Number(record.blockHeight).toLocaleString() : "—"} mono/>
      </div>
      {loading ? (
        <p className="mono" style={{color:"var(--fg-500)",fontSize:11,margin:"12px 16px 0"}}>
          Reading /api/v1/agents/{providerLabel ? encodeURIComponent(providerLabel) : "provider"}/reputation...
        </p>
      ) : hasSamples ? (
        <table className="ms-table ms-table--tight">
          <thead><tr><th>Rating</th><th style={{textAlign:"right"}}>Average</th></tr></thead>
          <tbody>
            {ratings.map(([label, avg])=>(
              <tr key={label}>
                <td>{label}</td>
                <td className="mono num" style={{textAlign:"right",color:"var(--gold)"}}>{reputationAverageLabel(avg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : reputation ? (
        <p className="mono" style={{color:"var(--fg-500)",fontSize:11,margin:"12px 16px 0"}}>
          No reputation records reported for this provider category.
        </p>
      ) : (
        <div style={{display:"grid",gap:8,margin:"12px 16px 0"}}>
          <span className="pill err" style={{width:"fit-content"}}>Reputation unavailable</span>
          <p className="mono" style={{color:"var(--fg-500)",fontSize:11,margin:0}}>
            No lyth_agentReputation aggregate returned for this provider category.
          </p>
        </div>
      )}
    </Card>
  );
};

function nativeAgentKindLabel(kind: NativeAgentStateDisplayRow["kind"]): string {
  if (kind === "issuer") return "Issuer";
  if (kind === "attestation") return "Attestation";
  if (kind === "consent") return "Consent";
  if (kind === "service") return "Service";
  if (kind === "availability") return "Availability";
  if (kind === "arbiter") return "Arbiter";
  if (kind === "reputationReview") return "Review";
  if (kind === "spendingPolicy") return "Policy";
  if (kind === "policySpend") return "Spend";
  return "Escrow";
}

const NativeAgentStateCard = ({
  rows,
  loading,
}: {
  rows: NativeAgentStateDisplayRows;
  loading: boolean;
}) => {
  const allRows = nativeAgentStateDisplayRowsAll(rows);
  return (
    <Card
      title="Native agent state"
      right={<span className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>lyth_nativeAgentState</span>}
    >
      {allRows.length > 0 ? (
        <table className="ms-table ms-table--tight">
          <thead>
            <tr>
              <th>Type</th>
              <th>ID</th>
              <th>Account</th>
              <th>Counterparty</th>
              <th style={{textAlign:"right"}}>Nonce</th>
              <th>Status</th>
              <th style={{textAlign:"right"}}>Amount</th>
              <th style={{textAlign:"right"}}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {allRows.map((row, index) => (
              <tr key={`${row.kind}-${row.primaryId ?? index}-${row.blockHeight ?? "pending"}`}>
                <td>{nativeAgentKindLabel(row.kind)}</td>
                <td className="mono" title={row.primaryId ?? ""}>{row.primaryId ? _short(row.primaryId, 10) : "—"}</td>
                <td className="mono" title={row.account ?? ""}>{row.account ? _short(row.account, 12) : "—"}</td>
                <td className="mono" title={row.counterparty ?? ""}>{row.counterparty ? _short(row.counterparty, 12) : "—"}</td>
                <td className="mono num" style={{textAlign:"right"}}>{row.nonce ?? "—"}</td>
                <td className="mono">{row.status ?? "—"}</td>
                <td className="mono num" style={{textAlign:"right"}}>{row.amount ?? "—"}</td>
                <td className="mono num" style={{textAlign:"right"}}>
                  {row.blockHeight === null ? "—" : row.blockHeight.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mono" style={{color:"var(--fg-500)",fontSize:11,margin:"12px 16px 0"}}>
          {loading ? "Reading /api/v1/native-agent-state..." : "No native agent state rows reported for this account."}
        </p>
      )}
    </Card>
  );
};

function bridgeRiskTone(tier: string): string {
  switch (tier) {
    case "low":
      return "ok";
    case "medium":
    case "high":
      return "warn";
    default:
      return "err";
  }
}

function bridgeSecondsLabel(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0s";
  if (seconds > 0 && seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds > 0 && seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds > 0 && seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function bridgeRouteIssueText(row: BridgeTrustDisclosureRow): string | null {
  const issues = row.assessment.blockedReasons.length > 0
    ? row.assessment.blockedReasons
    : row.assessment.warnings;
  return issues.length > 0 ? issues.join(" · ") : null;
}

function bridgeRouteBindingText(row: BridgeTrustDisclosureRow): string | null {
  const parts: string[] = [];
  if (row.route.protocol) parts.push(`protocol ${row.route.protocol}`);
  if (row.route.feeToken) parts.push(`fee ${row.route.feeToken}`);
  if (row.route.bridgeId) parts.push(`bridgeId ${_short(row.route.bridgeId, 12)}`);
  if (row.route.wrappedAsset) parts.push(`wrappedAsset ${_short(row.route.wrappedAsset, 12)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function bridgeRouteReadinessText(row: BridgeTrustDisclosureRow): string | null {
  const readiness = row.readiness;
  if (!readiness) return null;
  return [
    `selection ${readiness.routeSelectionReady ? "ready" : "blocked"}`,
    `quote ${readiness.quoteReady ? "ready" : "disabled"}`,
    `submit ${readiness.submitReady ? "ready" : "disabled"}`,
  ].join(" · ");
}

function bridgeRouteReadinessIssueText(row: BridgeTrustDisclosureRow): string | null {
  const readiness = row.readiness;
  if (!readiness) return null;
  const issues = readiness.blockedReasons.length > 0 ? readiness.blockedReasons : readiness.warnings;
  return issues.length > 0 ? issues.join(" · ") : null;
}

function bridgeRouteRowKey(row: BridgeTrustDisclosureRow): string {
  return [
    row.source,
    row.route.routeId,
    row.route.bridge,
    row.route.asset,
    row.route.sourceChain,
    row.route.destinationChain,
  ].join("|");
}

const BridgeTrustDisclosuresCard = ({
  disclosures,
  unavailable = false,
}: {
  disclosures: readonly BridgeTrustDisclosureRow[];
  unavailable?: boolean;
}) => {
  if (disclosures.length === 0) {
    if (!unavailable) return null;
    return (
      <Card
        title="Bridge trust disclosures"
        right={<span className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>unavailable</span>}
      >
        <div style={{display:"grid",gap:8,padding:"2px 0"}}>
          <span className="pill err" style={{width:"fit-content"}}>Disclosure unavailable</span>
          <p className="mono" style={{fontSize:11,color:"var(--fg-500)",margin:0,lineHeight:1.6}}>
            No bridgeRouteDisclosure, bridgeRouteDisclosures, or bridge route discovery metadata was returned by upstream data.
            Monoscan will not mark any bridge route as safe without {BRIDGE_ROUTE_DISCLOSURE_UPSTREAM_FIELD}.
          </p>
        </div>
      </Card>
    );
  }

  const disclosureSlice = bridgeTrustDisclosureDisplaySlice(disclosures);
  const preferred = disclosureSlice.preferred;
  const preferredBinding = preferred ? bridgeRouteBindingText(preferred) : null;
  const preferredReadinessText = preferred ? bridgeRouteReadinessText(preferred) : null;
  const preferredReadinessIssueText = preferred ? bridgeRouteReadinessIssueText(preferred) : null;
  const multipleDisclosures = disclosures.length > 1;
  const failureRows = multipleDisclosures
    ? disclosureSlice.rows
      .map((row) => ({ row, details: bridgeRouteDisclosureFailureDetails(row) }))
      .filter((row) => row.details.length > 0)
    : [];

  return (
    <Card
      title="Bridge trust disclosures"
      right={<span className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>ranked {disclosureSlice.rows.length}/{disclosureSlice.totalCount}</span>}
    >
      {preferred && (
        <div style={{display:"grid",gap:10,marginBottom:12}}>
          <div style={{display:"grid",gap:6,padding:"10px 12px",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,background:"rgba(255,255,255,0.025)"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <span className={`pill ${preferred.assessment.accepted ? bridgeRiskTone(preferred.assessment.riskTier) : "err"}`}>
                {preferred.assessment.accepted ? "Preferred route" : "No accepted route"}
              </span>
              <span className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>
                {preferred.assessment.accepted ? `score ${preferred.assessment.score}` : "top-ranked disclosure is blocked"}
              </span>
            </div>
            <div className="mono" style={{fontSize:12,color:"var(--fg-100)"}}>
              {preferred.route.bridge || "Unnamed bridge"} · route {preferred.route.routeId || "missing"}
            </div>
            <div className="mono" style={{fontSize:10,color:"var(--fg-500)",lineHeight:1.6}}>
              {preferred.route.sourceChain || "unknown"} → {preferred.route.destinationChain || "unknown"} · {preferred.route.asset || "asset missing"} · fee {preferred.route.feeToken || "missing"}
            </div>
            {preferredBinding && (
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)",lineHeight:1.6}}>
                {preferredBinding}
              </div>
            )}
            <div className="mono" style={{fontSize:10,color:"var(--fg-500)",lineHeight:1.6}}>
              finality {preferred.route.finalityBlocks} blocks · cooldown {bridgeSecondsLabel(preferred.route.cooldownSeconds)} · admin {preferred.route.adminControl} · breaker {preferred.route.circuitBreaker} · insurance {preferred.route.insuranceAtomic}
            </div>
            {preferredReadinessText && (
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginTop:2}}>
                <span className={`pill ${preferred?.readiness?.routeSelectionReady ? "ok" : "warn"}`}>
                  {preferred?.readiness?.routeSelectionReady ? "Selection ready" : "Discovery only"}
                </span>
                <button type="button" disabled style={{fontSize:10,padding:"4px 8px",borderRadius:6,border:"1px solid rgba(255,255,255,0.12)",background:"rgba(255,255,255,0.04)",color:"var(--fg-500)"}}>
                  Quote
                </button>
                <button type="button" disabled style={{fontSize:10,padding:"4px 8px",borderRadius:6,border:"1px solid rgba(255,255,255,0.12)",background:"rgba(255,255,255,0.04)",color:"var(--fg-500)"}}>
                  Submit
                </button>
                <span className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>
                  {preferredReadinessText}
                </span>
              </div>
            )}
            {preferredReadinessIssueText && (
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)",lineHeight:1.6}}>
                {preferredReadinessIssueText}
              </div>
            )}
          </div>

          {failureRows.length > 0 && (
            <div style={{display:"grid",gap:6,padding:"0 2px"}}>
              <div className="mono" style={{fontSize:10,color:"var(--fg-400)"}}>Disclosure failures</div>
              {failureRows.map(({ row, details }) => (
                <div key={`failure-${bridgeRouteRowKey(row)}`} className="mono" style={{fontSize:10,color:"var(--fg-500)",lineHeight:1.6}}>
                  route {row.route.routeId || "missing"} · {details.join(" · ")}
                </div>
              ))}
            </div>
          )}

          {disclosureSlice.hiddenCount > 0 && (
            <p className="mono" style={{fontSize:10,color:"var(--fg-500)",margin:0,lineHeight:1.6}}>
              Showing top {disclosureSlice.rows.length} of {disclosureSlice.totalCount} ranked disclosures; {disclosureSlice.hiddenCount} lower-ranked disclosures omitted.
            </p>
          )}
        </div>
      )}

      <table className="ms-table ms-table--tight">
        <thead>
          <tr>
            <th>Route</th>
            <th>Verifier</th>
            <th style={{textAlign:"right"}}>Drain cap</th>
            <th>Finality</th>
            <th>Controls</th>
            <th style={{textAlign:"right"}}>Insurance</th>
            <th>Risk</th>
          </tr>
        </thead>
        <tbody>
          {disclosureSlice.rows.map((row) => {
            const issueText = bridgeRouteIssueText(row);
            const bindingText = bridgeRouteBindingText(row);
            const readinessText = bridgeRouteReadinessText(row);
            return (
              <tr key={bridgeRouteRowKey(row)}>
                <td className="mono" style={{fontSize:11}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",color:"var(--fg-100)"}}>
                    <span>{row.route.bridge || "Unnamed bridge"}</span>
                    {preferred && bridgeRouteRowKey(row) === bridgeRouteRowKey(preferred) && (
                      <span className={`pill ${row.assessment.accepted ? "gold" : "err"}`} style={{fontSize:9,padding:"2px 6px"}}>
                        {row.assessment.accepted ? "preferred" : "top ranked"}
                      </span>
                    )}
                  </div>
                  <div style={{fontSize:10,color:"var(--fg-500)",marginTop:2}}>
                    {row.route.sourceChain || "unknown"} → {row.route.destinationChain || "unknown"} · {row.route.asset || "asset missing"} · fee {row.route.feeToken || "missing"}
                  </div>
                  {bindingText && (
                    <div style={{fontSize:10,color:"var(--fg-500)",marginTop:2}}>{bindingText}</div>
                  )}
                  <div style={{fontSize:10,color:"var(--fg-500)",marginTop:2}}>route {row.route.routeId || "missing"} · {row.source}</div>
                </td>
                <td className="mono" style={{fontSize:11}}>
                  {row.route.verifier.model || "missing"}
                  <div style={{fontSize:10,color:"var(--fg-500)",marginTop:2}}>
                    threshold {row.route.verifier.threshold}/{row.route.verifier.participantCount}
                  </div>
                </td>
                <td className="mono num" style={{textAlign:"right"}}>{row.route.drainCapAtomic}</td>
                <td className="mono" style={{fontSize:11}}>
                  {row.route.finalityBlocks} blocks
                  <div style={{fontSize:10,color:"var(--fg-500)",marginTop:2}}>cooldown {bridgeSecondsLabel(row.route.cooldownSeconds)}</div>
                </td>
                <td className="mono" style={{fontSize:11}}>
                  breaker {row.route.circuitBreaker}
                  <div style={{fontSize:10,color:"var(--fg-500)",marginTop:2}}>admin {row.route.adminControl}</div>
                </td>
                <td className="mono num" style={{textAlign:"right"}}>{row.route.insuranceAtomic}</td>
                <td>
                  <span className={`pill ${bridgeRiskTone(row.assessment.riskTier)}`}>
                    {row.assessment.riskTier}
                  </span>
                  <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:4}}>
                    {row.assessment.accepted ? `score ${row.assessment.score}` : "not accepted"}
                  </div>
                  {issueText && (
                    <div style={{fontSize:10,color:"var(--fg-500)",marginTop:4,maxWidth:260}}>
                      {issueText}
                    </div>
                  )}
                  {readinessText && (
                    <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:4,maxWidth:260}}>
                      {readinessText}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
};
export function executionUnitPriceValueLabel(price: bigint | null | undefined): string | null {
  const lyth = _fmtLyth(price);
  return lyth === null ? null : `${lyth} / execution unit`;
}
const _ageFromTs = (timestamp: number | null | undefined) => {
  if (!timestamp) return "—";
  const ms = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000;
  const diff = Math.max(0, Date.now() - ms);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

/* Tiny sparkline for stat cards */
const MiniSpark = ({ data, w=120, h=32, stroke="var(--gold)", fill="rgba(242,180,65,0.12)" }: any) => {
  if (!data || !data.length) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const rng = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((v,i) => `${(i*step).toFixed(1)},${(h - ((v-min)/rng)*h*0.9 - h*0.05).toFixed(1)}`);
  const d = `M${pts.join(" L")}`;
  const area = `${d} L${w},${h} L0,${h} Z`;
  return (
    <svg width={w} height={h} style={{display:"block"}}>
      <path d={area} fill={fill}/>
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5"/>
    </svg>
  );
};

/* Bar sparkline — used for slashing history (mostly zeros with occasional spikes) */
const MiniBars = ({ data, w=120, h=32, fill="var(--err, #ff6b6b)" }: any) => {
  if (!data || !data.length) return null;
  const max = Math.max(...data, 1);
  const step = w / data.length;
  return (
    <svg width={w} height={h} style={{display:"block"}}>
      {data.map((v,i) => v > 0 && (
        <rect key={i} x={i*step} y={h - (v/max)*h*0.9} width={step*0.7} height={(v/max)*h*0.9} fill={fill}/>
      ))}
    </svg>
  );
};

/* =====================================================
   STATISTICS PAGE
===================================================== */
const LIVE_METRIC_SELECTORS = [
  "committed_round",
  "mempool_depth",
  "gas_used_per_block",
  "p2p_bandwidth_in",
  "p2p_bandwidth_out",
  "finality_lag",
  "proposer_latency",
  "attestation_rate",
] as const;

const StatsPage = ({ go }: any) => {
  const S = NETWORK_STATS;
  const t = S.totals;
  // Live counters are best-effort. When the node is reachable, head round and
  // cluster count come from live RPC; local rows cover aggregate counters that
  // require retained indexer data.
  const live = useNetworkStatus();
  const chainStats = useChainStats();
  const feeStats = useFeeStats();
  const precompiles = useActivePrecompiles();
  const peerSummary = usePeerSummary();
  const metrics = useMetricsRange(LIVE_METRIC_SELECTORS);
  const indexerAvailability = useIndexerAvailability();
  // Static fallback values when the live network-status query has no data.
  // The live hook polls on its own cadence; do not drive UI numbers from
  // setInterval + Math.random.
  const round = t.vertices;
  const txLast24 = t.txLast24;

  const liveRound = live.data?.round ?? null;
  const liveClusters = live.data?.clusterCount ?? null;
  const livePeers = live.data?.peerCount ?? null;
  const liveHealthyClusters = live.data?.healthyClusterCount ?? null;
  const liveSyncState = live.data?.syncState ?? null;
  const liveSyncLag = live.data?.syncLag ?? null;
  const liveMempoolReady = live.data?.mempoolReady ?? null;
  const liveMempoolPending = live.data?.mempoolPending ?? null;
  const liveLatestBlock = chainStats.data?.latestHeight ?? live.data?.blockNumber ?? null;
  const liveChainId = chainStats.data?.chainId ?? null;
  const liveGenesisHash = chainStats.data?.genesisHash ?? null;
  const liveGenesisShort = liveGenesisHash
    ? `${liveGenesisHash.slice(0, 10)}…${liveGenesisHash.slice(-6)}`
    : null;
  const liveClusterTotal = chainStats.data?.clusters.total ?? liveClusters;
  const livePeerTotal = chainStats.data?.peerCount ?? livePeers;
  const headRound = liveRound ?? round;
  const activePrecompiles = precompiles.data?.filter(p => (p as any).active ?? (p as any).enabled).length ?? null;
  const peerData = peerSummary.data;
  const peerHealth = peerData?.healthSummary ?? null;
  const peerTotal = peerData?.peerCount ?? livePeerTotal;
  const metricSeries = metrics.data?.series ?? [];
  const availableMetricCount = metricSeries.filter((s:any) => s.status === "available").length;
  const sampledMetricCount = metricSeries.filter((s:any) => Array.isArray(s.samples) && s.samples.length > 0).length;
  const latestMetricSample = (selector: string) => {
    const series = metricSeries.find((s:any) => s.selector === selector);
    const sample = series?.samples?.at(-1) ?? null;
    return sample ? { ...sample, unit: series?.unit ?? null } : null;
  };
  const finalityLag = latestMetricSample("finality_lag");
  const attestationRate = latestMetricSample("attestation_rate");
  const proposerLatency = latestMetricSample("proposer_latency");
  const formatMetricValue = (sample: any) => sample
    ? `${Number(sample.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${sample.unit ? ` ${sample.unit}` : ""}`
    : "—";
  const executionUnitPrice = executionUnitPriceValueLabel(feeStats.data?.gasPrice);
  const feePriceSub = feeStats.data?.gasPriceSource === "lyth_executionUnitPrice"
    ? "native execution-unit quote"
    : feeStats.data?.gasPriceSource === "eth_feeHistory"
    ? "derived from fee history"
    : "live fee endpoint";

  return (
    <div className="ms-page ms-stats">
      {/* Hero */}
      <section className="stats-hero">
        <div className="stats-hero__left">
          <div className="mono stats-hero__tag">
            <span className="ov-livedot"/> NETWORK ·{" "}
            {liveGenesisShort
              ? `GENESIS ${liveGenesisShort} · ${liveLatestBlock !== null ? _fmtI(liveLatestBlock) : "?"} rounds`
              : `GENESIS ${S.network.genesisDate} · ${S.network.chainAge}`}
          </div>
          <h1 className="ov-hero__title">
            Monolythium<br/>
            <span style={{color:"var(--gold)"}}>in numbers.</span>
          </h1>
          <p className="ov-hero__desc">
            Network-wide counters, cumulative flows, and health vitals since genesis.
            Everything a researcher, auditor, or operator candidate needs before they commit capital.
          </p>
        </div>
        <div className="stats-hero__counter">
          <div className="stats-hero__round-label mono">CURRENT ROUND</div>
          <div className="stats-hero__round mono num">{headRound.toLocaleString()}</div>
          <div className="stats-hero__sub mono">
            {liveRound !== null
              ? `live · avg ${_fmtI(S.network.avgRoundsPerDay)} rounds/day`
              : `avg ${_fmtI(S.network.avgRoundsPerDay)} rounds/day`}
          </div>
        </div>
      </section>

      {/* Primary counters grid */}
      <section className="stats-counters">
        <StatCounter
          label="Transactions · all-time"
          value={indexerAvailability.disabled ? "—" : _abbr(t.txTotal)}
          sub={indexerAvailability.disabled
            ? "all-time tx aggregate requires an indexed peer"
            : `${_fmt(txLast24)} in the last 24h`}
          trend={indexerAvailability.disabled ? undefined : S.series.tx30d}
          tone="gold"
          onClick={()=>{}}
        />
        <StatCounter
          label="Active wallets"
          value={indexerAvailability.disabled ? "—" : _fmt(t.walletsTotal)}
          sub={indexerAvailability.disabled
            ? "wallet aggregate requires an indexed peer"
            : `${_fmt(t.walletsActive24h)} active in 24h`}
          tone="neutral"
          onClick={()=>go("#/wallets")}
          clickable
        />
        <StatCounter
          label="Clusters"
          value={liveClusterTotal !== null ? `${liveClusterTotal}` : `${t.clustersActive}/${t.clustersTotal}`}
          sub={
            liveHealthyClusters !== null
              ? `${liveHealthyClusters} healthy · sync ${liveSyncState ?? "unknown"}${liveSyncLag !== null ? ` · lag ${liveSyncLag}` : ""}`
              : livePeerTotal !== null
              ? `${livePeerTotal} peers · ${liveMempoolReady ?? 0} ready in mempool`
              : `${t.operators} unique operators`
          }
          tone="neutral"
          onClick={()=>go("#/clusters")}
          clickable
        />
        <StatCounter
          label="Latest block"
          value={liveLatestBlock !== null ? _fmtI(liveLatestBlock) : "—"}
          sub={liveChainId !== null ? `chain ${liveChainId} · lyth_chainStats` : "lyth_chainStats"}
          tone="neutral"
        />
        <StatCounter
          label="Smart contracts deployed"
          value={indexerAvailability.disabled ? "—" : _fmt(t.contracts)}
          sub={indexerAvailability.disabled
            ? "deploy counter requires an indexed peer"
            : `${t.tokensListed} listed tokens`}
          tone="neutral"
        />
        <StatCounter label="Execution price" value={executionUnitPrice ?? "—"} sub={feeStats.data?.baseFeePerGas.length ? `${feePriceSub} · ${feeStats.data.baseFeePerGas.length} samples` : feePriceSub} tone="neutral"/>
        <StatCounter label="Protocol surfaces" value={activePrecompiles !== null ? `${activePrecompiles}` : "—"} sub={precompiles.data ? `${precompiles.data.length} precompiles reported` : "live precompile registry"} tone="neutral"/>
        <StatCounter
          label="Peer health"
          value={peerHealth ? `${peerHealth.synced}/${peerTotal ?? peerData?.peerCount ?? 0}` : peerTotal !== null ? _fmtI(peerTotal) : "—"}
          sub={peerData ? `${peerData.inboundCount ?? 0} inbound · ${peerData.outboundCount ?? 0} outbound · block ${_fmtI(peerData.asOfBlock)}` : "lyth_peerSummary"}
          tone="neutral"
        />
        <StatCounter
          label="Retained metrics"
          value={metricSeries.length ? `${availableMetricCount}/${metricSeries.length}` : "—"}
          sub={metrics.data ? `${sampledMetricCount} sampled · ${metrics.data.tracking}` : "lyth_metricsRange"}
          tone="neutral"
        />
        <StatCounter
          label="Finality lag"
          value={formatMetricValue(finalityLag)}
          sub={finalityLag ? `sampled at block ${_fmtI(finalityLag.blockNumber)}` : "finality_lag metric"}
          tone="neutral"
        />
        <StatCounter
          label="Attestation rate"
          value={formatMetricValue(attestationRate)}
          sub={attestationRate ? `sampled at block ${_fmtI(attestationRate.blockNumber)}` : "attestation_rate metric"}
          tone="neutral"
        />
        <StatCounter
          label="Mempool"
          value={liveMempoolReady !== null ? _fmtI(liveMempoolReady) : "—"}
          sub={liveMempoolPending !== null ? `${_fmtI(liveMempoolPending)} pending · ${chainStats.data ? "chain stats" : "mempool RPC"}` : "ready queue"}
          tone="neutral"
        />
        <StatCounter
          label="Private vs public txs"
          value={indexerAvailability.disabled ? "—" : `${((t.privateTxs/t.txTotal)*100).toFixed(1)}%`}
          sub={indexerAvailability.disabled
            ? "privacy split requires an indexed peer"
            : `${_abbr(t.privateTxs)} private · ${_abbr(t.publicTxs)} public`}
          tone="neutral"
        />
        <StatCounter
          label="Chain age"
          value={liveLatestBlock !== null ? `${_fmtI(liveLatestBlock)} rounds` : S.network.chainAge}
          sub={liveGenesisShort ? `genesis ${liveGenesisShort}` : `genesis ${S.network.genesisDate}`}
          tone="neutral"
        />
      </section>

      {/* Economy row */}
      <section>
        <h3 className="ov-section-title">Economy · issuance, rewards, slashing</h3>
        <p className="ov-section-desc">MONO minted as staking rewards, burned via base fees, slashed for operator misbehavior, and still waiting to be claimed.</p>
        {indexerAvailability.disabled ? (
          <div className="ms-card" style={{padding:"18px 20px"}}>
            <div className="mono" style={{color:"var(--fg-300)",fontSize:13,lineHeight:1.55}}>
              {indexerAvailability.reason ?? "Indexer is unavailable on the connected node"}.
              Economy aggregates (net inflation, accrued rewards, all-time slashing) are computed by the indexer; the cards will populate once an indexed peer is reachable.
            </div>
          </div>
        ) : (
        <div className="stats-econ-grid">
          <StatBig
            label="Net inflation · since genesis"
            value={_fmt(S.inflation.net)}
            unit="LYTH"
            tone="gold"
            annotation={`+${_fmt(S.inflation.sinceGenesis)} minted · −${_fmt(S.inflation.burn)} burned`}
            chart={<MiniSpark data={S.series.inflation365d} w={260} h={56} stroke="var(--gold)" fill="rgba(242,180,65,0.10)"/>}
            footer={`${(S.inflation.annualizedRate*100).toFixed(2)}% annualized`}
          />
          <StatBig
            label="Rewards · accrued to stakers"
            value={_fmt(S.rewards.accrued)}
            unit="LYTH"
            tone="gold"
            annotation={`${_fmt(S.rewards.claimed)} claimed · ${_fmt(S.rewards.unclaimed)} unclaimed`}
            chart={<MiniSpark data={S.series.rewards30d} w={260} h={56} stroke="var(--gold)" fill="rgba(242,180,65,0.10)"/>}
            footer={`${((S.rewards.unclaimed/S.rewards.accrued)*100).toFixed(1)}% unclaimed (sitting in reward accounts)`}
          />
          <StatBig
            label="Slashed · all-time"
            value={_fmt(S.slashing.totalMono)}
            unit="LYTH"
            tone="err"
            annotation={`${S.slashing.events} slashing events`}
            chart={<MiniBars data={S.series.slash30d} w={260} h={56}/>}
            footer={S.slashing.lastEvent}
          />
        </div>
        )}
      </section>

      {/* Secondary tables */}
      <section className="stats-split">
        <div>
          <h3 className="ov-section-title">Activity · last 30 days</h3>
          <Card title="">
            {indexerAvailability.disabled ? (
              <div className="mono" style={{color:"var(--fg-400)",fontSize:12,lineHeight:1.55,padding:"14px 8px"}}>
                {indexerAvailability.reason ?? "Indexer is unavailable on the connected node"}.
                30-day activity rollups (transactions, rewards paid, slashing, new contracts, new wallets) come from the indexer.
              </div>
            ) : (
            <table className="ms-table stats-table">
              <thead><tr><th>Metric</th><th style={{textAlign:"right"}}>30d total</th><th style={{textAlign:"right"}}>Daily avg</th><th style={{textAlign:"right"}}>Trend</th></tr></thead>
              <tbody>
                <tr>
                  <td>Transactions</td>
                  <td className="mono num" style={{textAlign:"right"}}>{_fmt(S.series.tx30d.reduce((a,v)=>a+v,0))}</td>
                  <td className="mono num" style={{textAlign:"right"}}>{_fmt(Math.floor(S.series.tx30d.reduce((a,v)=>a+v,0)/30))}</td>
                  <td style={{textAlign:"right"}}><MiniSpark data={S.series.tx30d} w={80} h={24}/></td>
                </tr>
                <tr>
                  <td>Staking rewards paid</td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--gold)"}}>{_fmt(S.series.rewards30d.reduce((a,v)=>a+v,0))} LYTH</td>
                  <td className="mono num" style={{textAlign:"right"}}>{_fmt(Math.floor(S.series.rewards30d.reduce((a,v)=>a+v,0)/30))}</td>
                  <td style={{textAlign:"right"}}><MiniSpark data={S.series.rewards30d} w={80} h={24}/></td>
                </tr>
                <tr>
                  <td>Slashing</td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--err)"}}>{_fmt(S.series.slash30d.reduce((a,v)=>a+v,0))} LYTH</td>
                  <td className="mono num" style={{textAlign:"right"}}>{S.series.slash30d.filter(v=>v>0).length} events</td>
                  <td style={{textAlign:"right"}}><MiniBars data={S.series.slash30d} w={80} h={24}/></td>
                </tr>
                <tr>
                  <td>New contracts</td>
                  <td className="mono num" style={{textAlign:"right"}}>43</td>
                  <td className="mono num" style={{textAlign:"right"}}>1.4</td>
                  <td className="mono" style={{textAlign:"right",color:"var(--fg-500)",fontSize:11}}>+3.5% vs prev 30d</td>
                </tr>
                <tr>
                  <td>New wallets</td>
                  <td className="mono num" style={{textAlign:"right"}}>8,142</td>
                  <td className="mono num" style={{textAlign:"right"}}>271</td>
                  <td className="mono" style={{textAlign:"right",color:"var(--fg-500)",fontSize:11}}>+12% vs prev 30d</td>
                </tr>
              </tbody>
            </table>
            )}
          </Card>
        </div>
        <div>
          <h3 className="ov-section-title">Health · right now</h3>
          <Card title="">
            <div className="stats-health">
              <HealthRow
                label="Rounds produced / day"
                value={liveLatestBlock !== null
                  ? `${_fmtI(liveLatestBlock)} total rounds`
                  : _fmtI(S.network.avgRoundsPerDay)}
                tone="ok"
              />
              <HealthRow
                label="Clusters in jail cooldown"
                value={indexerAvailability.disabled
                  ? "—"
                  : `${MONOSCAN_DATA.clusters.filter(c=>c.inactiveReason==="jailed").length}`}
                tone={indexerAvailability.disabled ? "neutral" : "warn"}
              />
              <HealthRow
                label="Clusters recruiting ops"
                value={indexerAvailability.disabled
                  ? "—"
                  : `${MONOSCAN_DATA.clusters.filter(c=>c.recruiting && c.active).length}`}
                tone="neutral"
              />
              <HealthRow
                label="Proposer latency (p95)"
                value={proposerLatency
                  ? formatMetricValue(proposerLatency)
                  : indexerAvailability.disabled ? "—" : "342ms"}
                tone="ok"
              />
              <HealthRow
                label="Attestation rate"
                value={attestationRate
                  ? formatMetricValue(attestationRate)
                  : indexerAvailability.disabled ? "—" : "97.8%"}
                tone="ok"
              />
              <HealthRow
                label="Last slashing event"
                value={indexerAvailability.disabled ? "—" : "3 rounds ago"}
                tone={indexerAvailability.disabled ? "neutral" : "warn"}
              />
              <HealthRow label="Last halted (emergency)" value="never" tone="ok"/>
              <HealthRow
                label="Private tx DAC coverage"
                value={indexerAvailability.disabled ? "—" : "91.4%"}
                tone={indexerAvailability.disabled ? "neutral" : "ok"}
              />
              <HealthRow
                label="Bridge queue · CCIP"
                value={indexerAvailability.disabled ? "—" : "41 pending"}
                tone="neutral"
              />
              <HealthRow
                label="Bridge fees · LINK"
                value={indexerAvailability.disabled ? "—" : "ready"}
                tone={indexerAvailability.disabled ? "neutral" : "ok"}
              />
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
};

const StatCounter = ({ label, value, sub, trend, tone, onClick, clickable }: any) => (
  <div className={`stats-counter ${clickable?"is-clickable":""} stats-counter--${tone||"neutral"}`} onClick={onClick}>
    <div className="mono stats-counter__label">{label}</div>
    <div className="mono num stats-counter__value">{value}</div>
    <div className="mono stats-counter__sub">{sub}</div>
    {trend && <div className="stats-counter__spark"><MiniSpark data={trend} w={140} h={28}/></div>}
  </div>
);

const StatBig = ({ label, value, unit, tone, annotation, chart, footer }: any) => (
  <div className={`stats-big stats-big--${tone||"neutral"}`}>
    <div className="mono stats-big__label">{label}</div>
    <div className="stats-big__row">
      <div>
        <div className="mono num stats-big__value">{value} <span className="stats-big__unit">{unit}</span></div>
        <div className="mono stats-big__anno">{annotation}</div>
      </div>
      <div className="stats-big__chart">{chart}</div>
    </div>
    <div className="mono stats-big__foot">{footer}</div>
  </div>
);

const HealthRow = ({ label, value, tone }: any) => (
  <div className="stats-health__row">
    <span className={`stats-health__dot stats-health__dot--${tone}`}/>
    <span className="stats-health__label">{label}</span>
    <span className="mono num stats-health__value">{value}</span>
  </div>
);

/* =====================================================
   WALLETS PAGE — rich list + pie
===================================================== */
const WalletsPage = ({ go }: any) => {
  const richList = useRichList(getLythTokenId(), 30);
  const indexerAvailability = useIndexerAvailability();
  const liveHolders = richList.data?.holders ?? [];
  const wallets = WALLETS;
  const [hover, setHover] = useStateX(null);
  const topSum = wallets.slice(0, 30).reduce((a,w)=>a+w.bal, 0);
  const usingLiveRichList = liveHolders.length > 0;
  // When the node confirms its indexer is disabled, the rich list will never
  // resolve. Switch the page into an explanatory empty state instead of
  // silently rendering the 50-row demo fixture.
  const richListUnavailable = indexerAvailability.disabled;

  return (
    <div className="ms-page ms-wallets">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"end",gap:24,marginBottom:24}}>
        <div style={{maxWidth:620}}>
          <h1 className="ms-h1">Wallets · rich list</h1>
          <p className="mono" style={{fontSize:12,color:"var(--fg-400)",lineHeight:1.6,marginTop:6}}>
            Top LYTH holders on the public chain. Private LYTH holdings are opaque by design and not shown here. Tagged addresses (exchanges, bridges, treasury) are labeled inline; anonymous whales are shown by address.
          </p>
        </div>
        <div className="mono" style={{fontSize:11,color:"var(--fg-500)",textAlign:"right"}}>
          <div>{usingLiveRichList
            ? `${liveHolders.length} live holders`
            : richListUnavailable
              ? "rich list unavailable"
              : `${_fmt(NETWORK_STATS.totals.walletsTotal)} total wallets`}</div>
          <div style={{color:"var(--fg-400)"}}>
            {usingLiveRichList
              ? `token ${_short(richList.data?.tokenId, 12)}`
              : richListUnavailable
                ? (indexerAvailability.reason ?? "indexer disabled")
                : `top 30 hold ${_abbr(topSum)} LYTH`}
          </div>
        </div>
      </div>

      <section className="wl-grid">
        {/* LEFT: pie chart */}
        <Card title="Distribution · top 30 vs. the long tail">
          {richListUnavailable ? (
            <div className="mono" style={{color:"var(--fg-400)",fontSize:12,lineHeight:1.55,padding:"14px 8px"}}>
              {indexerAvailability.reason ?? "Indexer is unavailable on the connected node"}.
              Holder distribution is computed by the indexer; the chart will populate once an indexed peer is reachable.
            </div>
          ) : (
          <div style={{padding:"10px 4px 4px"}}>
            <SupplyPie slices={wallets.pie} hover={hover} setHover={setHover}/>
            <div className="wl-legend">
              {wallets.pie.map((s,i)=>(
                <div key={i} className={`wl-legend__row ${hover===i?"is-hover":""}`} onMouseEnter={()=>setHover(i)} onMouseLeave={()=>setHover(null)}>
                  <span className="wl-legend__dot" style={{background: PIE_COLORS[i % PIE_COLORS.length]}}/>
                  <span className="wl-legend__label">{s.label}</span>
                  <span className="mono num wl-legend__pct">{s.pct.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </div>
          )}
        </Card>

        {/* RIGHT: rich list */}
        <Card title="">
          <table className="ms-table wl-table">
            <thead><tr>
              <th style={{width:44}}>#</th>
              <th>Address</th>
              <th style={{textAlign:"right"}}>Balance</th>
              <th style={{textAlign:"right"}}>% of supply</th>
              <th style={{textAlign:"right"}}>Tx count</th>
            </tr></thead>
            <tbody>
              {richListUnavailable ? (
                <tr>
                  <td colSpan={5}>
                    <div className="mono" style={{color:"var(--fg-400)",fontSize:12,lineHeight:1.55,padding:"14px 8px"}}>
                      {indexerAvailability.reason ?? "Indexer is disabled on the connected node"}.
                      Rich list will populate once an indexed peer is reachable.
                    </div>
                  </td>
                </tr>
              ) : usingLiveRichList ? liveHolders.map((h:any)=>(
                <tr key={h.address} onClick={()=>go(`#/wallet/${encodeURIComponent(h.address)}`)}>
                  <td className="mono" style={{color:h.rank<=3?"var(--gold)":"var(--fg-400)",fontWeight:h.rank<=3?600:400}}>#{h.rank}</td>
                  <td>
                    <div style={{fontWeight:500,fontSize:13,color:"var(--fg-200)",fontFamily:"var(--f-mono)"}}>{_short(h.address,14)}</div>
                    <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:1}}>live rich list · updated block {Number(h.updatedAtBlock).toLocaleString()}</div>
                  </td>
                  <td className="mono num" style={{textAlign:"right"}}>{_fmtRawToken(h.balance)} <span style={{color:"var(--fg-500)",fontSize:10}}>LYTH</span></td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-500)"}}>—</td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-500)"}}>—</td>
                </tr>
              )) : wallets.map((w)=>(
                <tr key={w.addr} onClick={()=>go(`#/wallet/${encodeURIComponent(w.addr)}`)}>
                  <td className="mono" style={{color:w.rank<=3?"var(--gold)":"var(--fg-400)",fontWeight:w.rank<=3?600:400}}>#{w.rank}</td>
                  <td>
                    {w.tag
                      ? <div style={{fontWeight:500,fontSize:13,color:"var(--fg-100)"}}>{w.tag}</div>
                      : <div style={{fontWeight:500,fontSize:13,color:"var(--fg-200)",fontFamily:"var(--f-mono)"}}>{_short(w.addr,14)}</div>}
                    <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:1}}>{w.tag ? _short(w.addr,18) : (w.note || "unlabeled")}</div>
                  </td>
                  <td className="mono num" style={{textAlign:"right"}}>{_fmt(w.bal)} <span style={{color:"var(--fg-500)",fontSize:10}}>LYTH</span></td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--gold)"}}>{w.pct.toFixed(2)}%</td>
                  <td className="mono num" style={{textAlign:"right"}}>{_fmt(w.txCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
};

const PIE_COLORS = [
  "#f2b441", "#e79820", "#c47a0a", "#a66008",
  "#8a84c9", "#6f6ab3", "#544e97", "#3e3974",
  "#5a6b7a", "#414d57",
  "#2a2a3a", "#1a1a24",
];

const SupplyPie = ({ slices, hover, setHover }: any) => {
  const total = slices.reduce((a,s)=>a+s.pct, 0);
  const size = 240;
  const cx = size/2, cy = size/2;
  const r = size*0.42;
  const rInner = r*0.55;
  let acc = 0;
  const paths = slices.map((s,i) => {
    const startA = (acc/total) * Math.PI*2 - Math.PI/2;
    acc += s.pct;
    const endA = (acc/total) * Math.PI*2 - Math.PI/2;
    const large = (endA - startA) > Math.PI ? 1 : 0;
    const isHover = hover === i;
    const exp = isHover ? 6 : 0;
    const mid = (startA + endA) / 2;
    const dx = Math.cos(mid) * exp;
    const dy = Math.sin(mid) * exp;
    const x1 = cx + dx + Math.cos(startA)*r;
    const y1 = cy + dy + Math.sin(startA)*r;
    const x2 = cx + dx + Math.cos(endA)*r;
    const y2 = cy + dy + Math.sin(endA)*r;
    const xi2 = cx + dx + Math.cos(endA)*rInner;
    const yi2 = cy + dy + Math.sin(endA)*rInner;
    const xi1 = cx + dx + Math.cos(startA)*rInner;
    const yi1 = cy + dy + Math.sin(startA)*rInner;
    const d = `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${xi2},${yi2} A${rInner},${rInner} 0 ${large} 0 ${xi1},${yi1} Z`;
    return (
      <path key={i} d={d}
        fill={PIE_COLORS[i % PIE_COLORS.length]}
        opacity={hover===null || isHover ? 1 : 0.4}
        stroke="var(--bg-0, #0d0c18)" strokeWidth="1.5"
        style={{cursor:"pointer", transition:"opacity 180ms"}}
        onMouseEnter={()=>setHover(i)}
        onMouseLeave={()=>setHover(null)}
      />
    );
  });
  const hoverSlice = hover !== null ? slices[hover] : null;
  return (
    <div style={{position:"relative",width:size,height:size,margin:"0 auto"}}>
      <svg width={size} height={size}>{paths}</svg>
      <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",pointerEvents:"none",textAlign:"center",padding:"0 24px"}}>
        {hoverSlice ? (
          <>
            <div className="mono" style={{fontSize:9.5,color:"var(--fg-500)",letterSpacing:"0.1em",textTransform:"uppercase"}}>{hoverSlice.label}</div>
            <div className="mono num" style={{fontSize:22,color:"var(--gold)",marginTop:4}}>{hoverSlice.pct.toFixed(2)}%</div>
          </>
        ) : (
          <>
            <div className="mono" style={{fontSize:9.5,color:"var(--fg-500)",letterSpacing:"0.1em"}}>TOTAL SUPPLY</div>
            <div className="mono num" style={{fontSize:22,color:"var(--fg-100)",marginTop:4}}>870M LYTH</div>
            <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:4}}>(public chain)</div>
          </>
        )}
      </div>
    </div>
  );
};

/* =====================================================
   WALLET DETAIL PAGE
===================================================== */
const WalletPage = ({ addr, go }: any) => {
  const indexerAvailability = useIndexerAvailability();
  const live = useAccountHistory(addr);
  const profile = useAddressProfile(addr);
  const addressFlow = useAddressFlow(addr, 250);
  const activityKind = useAddressActivityKind(addr);
  const delegations = useWalletDelegations(addr);
  const pendingRewards = usePendingRewards(addr);
  const redemptionQueue = useRedemptionQueue(addr);
  const delegationHistory = useWalletDelegationHistory(addr, 20);
  const tokenBalances = useTokenBalances(addr);
  const addressLabel = useAddressLabel(addr);
  const code = useAccountCode(addr);
  const agentReputation = useAgentReputation(addr);
  const nativeAgentState = useNativeAgentState({ account: addr, includePolicySpends: true, limit: 25 });
  const mrcAccount = useMrcAccount(addr, 6);
  const fallbackWallet = WALLETS.find(w => w.addr === addr);
  const profileAccount = profile.data?.account ?? null;
  const profileBalance = profileAccount?.nativeBalance ?? null;
  const liveBalanceNumber = profileBalance
    ? _rawToLythNumber(profileBalance)
    : live.data?.balance
      ? _rawToLythNumber(live.data.balance)
      : 0;
  const zeroFlow = Array.from({ length: 30 }, (_, day) => ({ day, in: 0, out: 0, stake: 0, reward: 0 }));
  const w = fallbackWallet ?? {
    rank: "live",
    addr,
    tag: null,
    bal: liveBalanceNumber,
    pct: 0,
    extras: [],
    txs: [],
    flow30d: zeroFlow,
    firstSeenAgo: "live RPC",
    stakedTo: null,
    txCount: live.data?.nonce ?? 0,
  };
  const totalIn  = w.flow30d.reduce((a,d)=>a+d.in, 0);
  const totalOut = w.flow30d.reduce((a,d)=>a+d.out, 0);
  const totalRw  = w.flow30d.reduce((a,d)=>a+d.reward, 0);
  const flowTotals = addressFlow.data?.totals ?? null;
  const flowIn = flowTotals ? _rawToLythNumber(flowTotals.inbound) : totalIn;
  const flowOut = flowTotals ? _rawToLythNumber(flowTotals.outbound) : totalOut;
  const flowStake = flowTotals ? _rawToLythNumber(flowTotals.stake) : w.flow30d.reduce((a,d)=>a+d.stake,0);
  const flowRewards = totalRw;
  const displayedNet = flowIn - flowOut;
  const liveBalance = _fmtLythRaw(profileBalance) ?? _fmtLyth(live.data?.balance);
  const liveNonce = profileAccount?.nonce ?? live.data?.nonce ?? null;
  const livePolicy = live.data?.policy ?? null;
  const liveActivity = live.data?.activity ?? [];
  const liveDelegations = delegations.data?.rows ?? [];
  const livePendingRewards = pendingRewards.data ?? null;
  const livePendingRewardRows = livePendingRewards?.rows ?? [];
  const liveRedemptionQueue = redemptionQueue.data ?? null;
  const liveRedemptionTickets = liveRedemptionQueue?.tickets ?? [];
  const liveCooldownCompleteRedemptions = liveRedemptionTickets.filter((row) => row.mature === true).length;
  const liveDelegationHistory = delegationHistory.data ?? [];
  const liveTokenBalances = (profile.data?.tokenBalances?.length
    ? profile.data.tokenBalances
    : (tokenBalances.data ?? [])) as IndexedTokenBalanceRow[];
  const tokenBalanceMetadata = useMrcMetadataForTokenBalances(liveTokenBalances);
  const tokenBalanceHolders = useMrcHoldersForTokenBalances(liveTokenBalances);
  const bridgeRouteDiscovery = useBridgeRouteDisclosures();
  const bridgeTrustDisclosures = useMemoX(
    () => mergeBridgeTrustDisclosures([
      ...bridgeTrustDisclosuresFromAddressData(profile.data, tokenBalances.data ?? []),
      ...(bridgeRouteDiscovery.data ?? []),
    ]),
    [profile.data, tokenBalances.data, bridgeRouteDiscovery.data],
  );
  const bridgeTrustDisclosureChecked = profile.isFetched && tokenBalances.isFetched && bridgeRouteDiscovery.isFetched;
  const liveLabel = profile.data?.label ?? addressLabel.data ?? null;
  const liveAgentReputation = agentReputation.data ?? null;
  const agentReputationChecked = agentReputation.isFetched && !agentReputation.isLoading;
  const showAgentReputation = Boolean(liveAgentReputation) || agentReputation.isLoading || agentReputationChecked;
  const liveNativeAgentRows = nativeAgentStateRows(nativeAgentState.data);
  const hasLiveNativeAgentState =
    nativeAgentStateDisplayRowsAll(liveNativeAgentRows).length > 0
    || nativeAgentState.isLoading
    || nativeAgentState.isFetched;
  const liveMrcAccount = mrcAccount.data ?? null;
  const liveMrcSpendRows = liveMrcAccount?.policySpends ?? [];
  const liveMrcPolicy = liveMrcAccount?.policyAccount?.policy ?? null;
  const profileActivityKind = profile.data?.activity?.kind ?? null;
  const liveActivityKind = profileActivityKind ? { kind: profileActivityKind, retention: profile.data?.activity?.retention ?? null } : (activityKind.data ?? null);
  const liveRetention = liveActivityKind?.retention && typeof liveActivityKind.retention === "object"
    ? liveActivityKind.retention as Record<string, unknown>
    : null;
  const earliestRetained = liveRetention?.earliestRetained;
  const codeValue = code.data ?? null;
  const isContract = profileAccount?.isContract ?? Boolean(codeValue && codeValue !== "0x");

  return (
    <div className="ms-page ms-wallet-detail">
      {/* Hero */}
      <section className="wd-hero">
        <div className="wd-hero__meta">
          <div className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.1em"}}>
            WALLET{fallbackWallet ? ` · #${w.rank} OF ${WALLETS.length}` : indexerAvailability.disabled ? " · live · rank requires indexer" : " · live"}
          </div>
          <h1 className="wd-hero__title">{liveLabel?.displayName || w.tag || "Unlabeled wallet"}</h1>
          <div className="mono wd-hero__addr">{w.addr}</div>
          <div className="wd-hero__facts mono">
            <span>
              {fallbackWallet
                ? `First seen · ${w.firstSeenAgo}`
                : indexerAvailability.disabled
                  ? "First seen · indexer required"
                  : `First seen · ${w.firstSeenAgo}`}
            </span>
            <span className="sep"/>
            <span>{liveNonce !== null ? `${liveNonce} confirmed sends` : `${_fmt(w.txCount)} transactions`}</span>
            {liveActivityKind && <><span className="sep"/><span>Activity · {liveActivityKind.kind}</span></>}
            {liveLabel && <><span className="sep"/><span>{liveLabel.category}</span></>}
            {livePolicy && <><span className="sep"/><span>Policy · {livePolicy.mode}{livePolicy.explicit ? " explicit" : ""}</span></>}
            {(codeValue !== null || profileAccount) && <><span className="sep"/><span>{isContract ? "Contract account" : "Externally-owned account"}</span></>}
            {w.stakedTo && <><span className="sep"/><span>Delegating to <a onClick={()=>go(`#/cluster/${w.stakedTo.replace("C-","").replace(/^0+/,"")}`)} style={{color:"var(--gold)",cursor:"pointer"}}>{w.stakedTo}</a></span></>}
          </div>
        </div>
        <div className="wd-hero__balances">
          <div className="wd-bal wd-bal--primary">
            <div className="mono wd-bal__label">MONO · public</div>
            <div className="mono num wd-bal__value">{liveBalance ?? _fmt(w.bal)}</div>
            <div className="mono wd-bal__sub">
              {liveBalance
                ? "live RPC balance"
                : fallbackWallet
                  ? `${w.pct.toFixed(3)}% of supply`
                  : indexerAvailability.disabled
                    ? "% of supply requires indexer"
                    : "—"}
            </div>
          </div>
          {w.extras.map((e,i)=>(
            <div key={i} className="wd-bal">
              <div className="mono wd-bal__label">{e.denom}</div>
              <div className="mono num wd-bal__value">{typeof e.bal === "number" ? _fmt(e.bal) : e.bal}</div>
            </div>
          ))}
        </div>
      </section>

      {(livePolicy || liveActivityKind || liveDelegations.length > 0 || livePendingRewards || liveRedemptionQueue || codeValue !== null || profileAccount || showAgentReputation || hasLiveNativeAgentState || liveMrcAccount) && (
        <section className="tx-split">
          <Card title="Live account">
            <div className="tx-kv">
              <KV label="Balance" value={liveBalance ?? "—"} mono/>
              <KV label="Nonce" value={liveNonce !== null ? `${liveNonce}` : "—"} mono/>
              <KV
                label="Pending rewards"
                value={livePendingRewards ? `${_fmtLythRaw(livePendingRewards.totalAmountLythoshi)}${livePendingRewards.autoCompound ? " · auto-compound" : ""}` : "—"}
                mono
              />
              <KV
                label="Redemption queue"
                value={liveRedemptionQueue ? `${liveRedemptionTickets.length}/${liveRedemptionQueue.count} tickets${liveCooldownCompleteRedemptions ? ` · ${liveCooldownCompleteRedemptions} cooldown complete` : ""}` : "—"}
                mono
              />
              <KV label="Activity index" value={liveActivityKind ? `${liveActivityKind.kind}${earliestRetained ? ` · retained from block ${Number(earliestRetained).toLocaleString()}` : ""}` : "—"}/>
              <KV label="Policy" value={livePolicy ? `${livePolicy.mode}${livePolicy.explicit ? " · explicit" : ""}` : "—"}/>
              <KV label="MRC account" value={mrcAccountSummaryText(liveMrcAccount)} mono/>
              <KV label="Label" value={liveLabel ? `${liveLabel.category}${liveLabel.displayName ? ` · ${liveLabel.displayName}` : ""}` : "—"}/>
              <KV label="Code" value={codeValue === null ? "—" : isContract ? `${codeValue.length} chars` : "0x"} mono/>
            </div>
          </Card>
          {liveMrcAccount && (
            <Card title="MRC account" right={<span className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>lyth_mrcAccount</span>}>
              <div className="tx-kv">
                <KV label="Smart account" value={mrcAccountRecordSummary(liveMrcAccount.smartAccount)} mono/>
                <KV label="Policy account" value={mrcAccountRecordSummary(liveMrcAccount.policyAccount)} mono/>
                <KV label="Policy body" value={mrcPolicyBodySummary(liveMrcPolicy)} mono/>
                <KV label="Allowed assets" value={mrcPolicyAllowedAssetsSummary(liveMrcPolicy)} mono/>
                <KV label="Spend rows" value={`${liveMrcSpendRows.length}/${liveMrcAccount.spendLimit}`} mono/>
              </div>
              {liveMrcSpendRows.length > 0 ? (
                <table className="ms-table ms-table--tight">
                  <thead><tr><th>Asset</th><th>Window</th><th style={{textAlign:"right"}}>Spent / amount</th><th style={{textAlign:"right"}}>Updated</th></tr></thead>
                  <tbody>
                    {liveMrcSpendRows.map((row)=>(
                      <tr key={mrcPolicySpendKey(row)}>
                        <td className="mono" title={row.assetId}>{_short(row.assetId, 10)}</td>
                        <td className="mono">{row.window}</td>
                        <td className="mono num" style={{textAlign:"right"}}>{row.spent} / {row.amount}</td>
                        <td className="mono num" style={{textAlign:"right"}}>{Number(row.updatedAtBlock).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="mono" style={{color:"var(--fg-500)",fontSize:11,margin:"12px 16px 0"}}>
                  No MRC policy spend rows reported for this account.
                </p>
              )}
            </Card>
          )}
          <Card title="Live delegations">
            {liveDelegations.length > 0 ? (
              <table className="ms-table">
                <thead><tr><th>Cluster</th><th style={{textAlign:"right"}}>Weight</th>{livePendingRewards && <th style={{textAlign:"right"}}>Pending</th>}</tr></thead>
                <tbody>
                  {liveDelegations.map((row:any)=>{
                    const rewardRow = livePendingRewardRows.find((reward:any)=>Number(reward.cluster) === Number(row.cluster));
                    return (
                      <tr key={row.cluster} onClick={()=>go(`#/cluster/${Number(row.cluster)+1}`)}>
                        <td className="mono">C-{String(Number(row.cluster)+1).padStart(3,"0")}</td>
                        <td className="mono num" style={{textAlign:"right"}}>{row.weightBps} bps</td>
                        {livePendingRewards && (
                          <td className="mono num" style={{textAlign:"right",color:"var(--gold)"}}>
                            {rewardRow ? _fmtLythRaw(rewardRow.unsettledAmountLythoshi) : "0 LYTH"}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="mono" style={{color:"var(--fg-500)",fontSize:11,margin:0}}>
                No live delegation rows reported for this address.
              </p>
            )}
          </Card>
          {livePendingRewards && (
            <Card title="Pending rewards" right={<span className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>pending-rewards</span>}>
              <div className="tx-kv">
                <KV label="Claimable" value={_fmtLythRaw(livePendingRewards.totalAmountLythoshi)} mono/>
                <KV label="Settled" value={_fmtLythRaw(livePendingRewards.settledPendingLythoshi)} mono/>
                <KV label="Unsettled" value={_fmtLythRaw(livePendingRewards.unsettledAmountLythoshi)} mono/>
                <KV label="Auto-compound" value={livePendingRewards.autoCompound ? "Enabled" : "Disabled"}/>
              </div>
              {livePendingRewardRows.length > 0 ? (
                <table className="ms-table">
                  <thead><tr><th>Cluster</th><th style={{textAlign:"right"}}>Weight</th><th style={{textAlign:"right"}}>Unsettled</th></tr></thead>
                  <tbody>
                    {livePendingRewardRows.map((row:any)=>(
                      <tr key={row.cluster} onClick={()=>go(`#/cluster/${Number(row.cluster)+1}`)}>
                        <td className="mono">C-{String(Number(row.cluster)+1).padStart(3,"0")}</td>
                        <td className="mono num" style={{textAlign:"right"}}>{row.weightBps} bps</td>
                        <td className="mono num" style={{textAlign:"right",color:"var(--gold)"}}>{_fmtLythRaw(row.unsettledAmountLythoshi)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="mono" style={{color:"var(--fg-500)",fontSize:11,margin:"12px 16px 0"}}>
                  No unsettled cluster reward rows reported.
                </p>
              )}
            </Card>
          )}
          {liveRedemptionQueue && (
            <Card title="Redemption queue" right={<span className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>redemption-queue</span>}>
              <div className="tx-kv">
                <KV label="Tickets" value={`${liveRedemptionTickets.length}/${liveRedemptionQueue.count}`} mono/>
                <KV label="Cooldown complete" value={`${liveCooldownCompleteRedemptions}`} mono/>
                <KV label="Block" value={liveRedemptionQueue.block === null ? "—" : String(liveRedemptionQueue.block)} mono/>
              </div>
              {liveRedemptionTickets.length > 0 ? (
                <table className="ms-table">
                  <thead><tr><th>Cluster</th><th style={{textAlign:"right"}}>Weight</th><th style={{textAlign:"right"}}>Queued</th><th style={{textAlign:"right"}}>Cooldown ends</th><th>Status</th></tr></thead>
                  <tbody>
                    {liveRedemptionTickets.map((row)=>(
                      <tr key={`${row.index}-${row.cluster}-${row.maturityHeight}`} onClick={()=>go(`#/cluster/${Number(row.cluster)+1}`)}>
                        <td className="mono">C-{String(Number(row.cluster)+1).padStart(3,"0")}</td>
                        <td className="mono num" style={{textAlign:"right"}}>{row.weightBps} bps</td>
                        <td className="mono num" style={{textAlign:"right"}}>{row.createdHeight.toLocaleString()}</td>
                        <td className="mono num" style={{textAlign:"right"}}>{row.maturityHeight.toLocaleString()}</td>
                        <td className="mono" style={{color:row.mature === true ? "var(--gold)" : "var(--fg-500)"}}>
                          {redemptionTicketStatusText(row.mature)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="mono" style={{color:"var(--fg-500)",fontSize:11,margin:"12px 16px 0"}}>
                  No pending redemption tickets reported for this address.
                </p>
              )}
            </Card>
          )}
          {showAgentReputation && (
            <AgentReputationCard
              reputation={liveAgentReputation}
              provider={addr}
              categoryId={0}
              loading={agentReputation.isLoading}
              checked={agentReputationChecked}
            />
          )}
          {hasLiveNativeAgentState && <NativeAgentStateCard rows={liveNativeAgentRows} loading={nativeAgentState.isLoading}/>}
        </section>
      )}

      {(bridgeTrustDisclosures.length > 0 || bridgeTrustDisclosureChecked) && (
        <section>
          <BridgeTrustDisclosuresCard
            disclosures={bridgeTrustDisclosures}
            unavailable={bridgeTrustDisclosures.length === 0 && bridgeTrustDisclosureChecked}
          />
        </section>
      )}

      {(liveTokenBalances.length > 0 || liveDelegationHistory.length > 0) && (
        <section className="tx-split">
          <Card title="Indexed token balances">
            {liveTokenBalances.length > 0 ? (
              <table className="ms-table">
                <thead><tr><th>Asset</th><th style={{textAlign:"right"}}>Balance</th><th style={{textAlign:"right"}}>Updated</th></tr></thead>
                <tbody>
                  {liveTokenBalances.map((row: IndexedTokenBalanceRow)=>{
                    const metadata = tokenBalanceMetadata.data?.[row.tokenId];
                    const metadataLines = tokenBalanceMetadataLines(row, metadata);
                    const holderLines = tokenBalanceHolderLines(tokenBalanceHolders.data?.[row.tokenId]);
                    return (
                    <tr key={row.tokenId}>
                      <td className="mono" style={{fontSize:11}}>
                        {tokenBalancePrimaryWithMetadata(row, metadata)}
                        {metadataLines.map((line) => (
                          <div key={line} style={{fontSize:10,color:"var(--fg-500)",marginTop:2}}>{line}</div>
                        ))}
                        {holderLines.length > 0 && (
                          <div style={{fontSize:10,color:"var(--fg-400)",marginTop:6}}>
                            <div style={{color:"var(--gold)"}}>Native holders</div>
                            {holderLines.map((line) => <div key={line}>{line}</div>)}
                          </div>
                        )}
                      </td>
                      <td className="mono num" style={{textAlign:"right"}}>{String(row.balance)}</td>
                      <td className="mono num" style={{textAlign:"right"}}>{Number(row.updatedAtBlock).toLocaleString()}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="mono" style={{color:"var(--fg-500)",fontSize:11,margin:0}}>No indexed token-balance rows reported.</p>
            )}
          </Card>
          <Card title="Delegation history">
            {liveDelegationHistory.length > 0 ? (
              <table className="ms-table">
                <thead><tr><th>Kind</th><th>Cluster</th><th style={{textAlign:"right"}}>Weight</th><th style={{textAlign:"right"}}>Block</th></tr></thead>
                <tbody>
                  {liveDelegationHistory.map((row:any)=>(
                    <tr key={`${row.blockHeight}-${row.txIndex}-${row.logIndex}`}>
                      <td>{row.kind}</td>
                      <td className="mono">
                        C-{String(Number(row.cluster)+1).padStart(3,"0")}
                        {row.toCluster !== null && row.toCluster !== undefined ? ` → C-${String(Number(row.toCluster)+1).padStart(3,"0")}` : ""}
                      </td>
                      <td className="mono num" style={{textAlign:"right"}}>{row.weightBps} bps</td>
                      <td className="mono num" style={{textAlign:"right"}}>{Number(row.blockHeight).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mono" style={{color:"var(--fg-500)",fontSize:11,margin:0}}>No indexed delegation events reported.</p>
            )}
          </Card>
        </section>
      )}

      {/* Flow diagram */}
      <section>
        <h3 className="ov-section-title">30-day flow</h3>
        {indexerAvailability.disabled && !fallbackWallet ? (
          <div className="ms-card" style={{padding:"16px 18px"}}>
            <div className="mono" style={{color:"var(--fg-300)",fontSize:13,lineHeight:1.55}}>
              {indexerAvailability.reason ?? "Indexer is unavailable on the connected node"}.
              30-day inflow/outflow, staking activity, and rewards-earned aggregates require an indexed peer.
            </div>
          </div>
        ) : (
          <>
            <p className="ov-section-desc">
              {flowTotals ? `Indexed sample flow from ${addressFlow.data?.sampleSize ?? 0} retained rows.` : "Inflow, outflow, staking delegations, and rewards earned."}
              {" "}Net position {displayedNet >= 0 ? "grew" : "shrank"} by {_fmt(Math.abs(displayedNet))} LYTH over the period.
            </p>
            <div className="wd-flow-grid">
              <FlowCard label="In" value={flowIn} unit="LYTH" tone="ok" series={w.flow30d.map(d=>d.in)}/>
              <FlowCard label="Out" value={flowOut} unit="LYTH" tone="err" series={w.flow30d.map(d=>d.out)}/>
              <FlowCard label="Staked" value={flowStake} unit="LYTH" tone="neutral" series={w.flow30d.map(d=>d.stake)}/>
              <FlowCard label="Rewards" value={flowRewards} unit="LYTH" tone="gold" series={w.flow30d.map(d=>d.reward)}/>
            </div>
            <FlowDiagram wallet={w} totalIn={flowIn} totalOut={flowOut} totalRw={flowRewards}/>
          </>
        )}
      </section>

      {(addressFlow.data?.topCounterparties?.length ?? 0) > 0 && (
        <section>
          <h3 className="ov-section-title">Indexed counterparties</h3>
          <Card title="">
            <table className="ms-table">
              <thead><tr><th>Address</th><th style={{textAlign:"right"}}>Events</th><th style={{textAlign:"right"}}>Inbound</th><th style={{textAlign:"right"}}>Outbound</th></tr></thead>
              <tbody>
                {addressFlow.data?.topCounterparties.map((row:any)=>(
                  <tr key={row.address} onClick={()=>go(`#/wallet/${encodeURIComponent(row.address)}`)}>
                    <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>{_short(row.address, 16)}</td>
                    <td className="mono num" style={{textAlign:"right"}}>{Number(row.eventCount).toLocaleString()}</td>
                    <td className="mono num" style={{textAlign:"right",color:"var(--ok)"}}>{_fmtRawToken(row.inbound)}</td>
                    <td className="mono num" style={{textAlign:"right",color:"var(--err)"}}>{_fmtRawToken(row.outbound)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}

      {/* Recent transactions */}
      <section>
        <h3 className="ov-section-title">{liveActivity.length > 0 ? "Live address activity" : "Recent transactions"}</h3>
        <Card title="">
          <table className="ms-table wd-tx-table">
            <thead><tr>
              <th style={{width:40}}></th>
              <th>Hash · kind</th>
              <th>Counterparty</th>
              <th style={{textAlign:"right"}}>Amount</th>
              <th style={{textAlign:"right"}}>Fee</th>
              <th style={{textAlign:"right"}}>When</th>
            </tr></thead>
            <tbody>
              {/* AddressActivityEntry is keyed by block:txIndex:logIndex.
                  The row→tx-detail link waits on the SDK adding a txHash
                  field; until then we link block + counterparty + cluster. */}
              {liveActivity.length > 0 ? liveActivity.map((row:any)=>{
                const blockHeight = Number(row.blockHeight);
                const counterpartyAddress = row.counterparty as string | null;
                const clusterSlot = row.cluster !== null && row.cluster !== undefined
                  ? `C-${String(Number(row.cluster) + 1).padStart(3, "0")}`
                  : null;
                return (
                <tr key={`${row.blockHeight}-${row.txIndex}-${row.logIndex}`}>
                  <td>
                    <span className={`wd-dir wd-dir--${row.direction === "out" ? "out" : "in"}`}>
                      {row.direction === "out" ? "↗" : "↙"}
                    </span>
                  </td>
                  <td>
                    <div className="mono" style={{fontSize:12,color:"var(--fg-100)"}}>
                      {row.kind}{row.subKind ? ` · ${row.subKind}` : ""}
                    </div>
                    <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:1}}>
                      tx {row.txIndex} · log {row.logIndex}
                    </div>
                  </td>
                  <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>
                    {counterpartyAddress ? (
                      <a
                        onClick={()=>go(`#/wallet/${encodeURIComponent(counterpartyAddress)}`)}
                        style={{cursor:"pointer",color:"var(--fg-300)"}}
                      >
                        {_short(counterpartyAddress, 14)}
                      </a>
                    ) : clusterSlot ? (
                      <a
                        onClick={()=>go(`#/cluster/${Number(row.cluster) + 1}`)}
                        style={{cursor:"pointer",color:"var(--gold)"}}
                      >
                        {clusterSlot}
                      </a>
                    ) : "—"}
                  </td>
                  <td className="mono num" style={{textAlign:"right",color: row.direction==="out" ? "var(--err, #ff6b6b)" : "var(--ok, #73d13d)"}}>
                    {row.amount ? `${row.direction==="out" ? "−" : "+"}${row.amount}` : row.weightBps !== null && row.weightBps !== undefined ? `${row.weightBps} bps` : "—"}
                  </td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-400)",fontSize:11}}>—</td>
                  <td className="mono" style={{textAlign:"right",fontSize:11,color:"var(--fg-400)"}}>
                    <a
                      onClick={()=>go(`#/round/${blockHeight}`)}
                      style={{cursor:"pointer",color:"var(--gold)"}}
                    >
                      block {blockHeight.toLocaleString()}
                    </a>
                  </td>
                </tr>
                );
              }) : w.txs.map(t=>(
                <tr key={t.hash} onClick={()=>go(`#/tx/${encodeURIComponent(t.hash)}`)} className={t.status==="failed"?"wd-tx-failed":""}>
                  <td>
                    <span className={`wd-dir wd-dir--${t.direction}`}>
                      {t.direction === "out" ? "↗" : "↙"}
                    </span>
                  </td>
                  <td>
                    <div className="mono" style={{fontSize:12,color:"var(--fg-100)"}}>{_short(t.hash, 12)}</div>
                    <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:1}}>
                      {t.kind}
                      {t.status === "failed" && <span style={{color:"var(--err)",marginLeft:6}}>· failed</span>}
                    </div>
                  </td>
                  <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>{_short(t.counterparty, 14)}</td>
                  <td className="mono num" style={{textAlign:"right",color: t.direction==="out" ? "var(--err, #ff6b6b)" : "var(--ok, #73d13d)"}}>
                    {t.direction==="out" ? "−" : "+"}{_fmt(t.amount)} <span style={{color:"var(--fg-500)",fontSize:10}}>{t.denom}</span>
                  </td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-400)",fontSize:11}}>{t.fee.toFixed(4)}</td>
                  <td className="mono" style={{textAlign:"right",fontSize:11,color:"var(--fg-400)"}}>{t.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
};

const FlowCard = ({ label, value, unit, tone, series }: any) => (
  <div className={`wd-flow-card wd-flow-card--${tone}`}>
    <div className="mono wd-flow-card__label">{label}</div>
    <div className="mono num wd-flow-card__value">{_fmt(value)} <span>{unit}</span></div>
    <MiniSpark
      data={series}
      w={180} h={30}
      stroke={tone==="ok" ? "var(--ok, #73d13d)" : tone==="err" ? "var(--err, #ff6b6b)" : tone==="gold" ? "var(--gold)" : "var(--fg-400)"}
      fill={tone==="ok" ? "rgba(115,209,61,0.10)" : tone==="err" ? "rgba(255,107,107,0.10)" : tone==="gold" ? "rgba(242,180,65,0.10)" : "rgba(255,255,255,0.04)"}
    />
  </div>
);

/* A simple Sankey-ish diagram: inflows → wallet → outflows + stake/reward */
const FlowDiagram = ({ wallet, totalIn, totalOut, totalRw }: any) => {
  // Aggregate top 4 counterparties by volume per direction
  const inParties: Record<string, number> = {};
  const outParties: Record<string, number> = {};
  wallet.txs.forEach((t: any) => {
    const bucket = t.direction === "out" ? outParties : inParties;
    bucket[t.counterparty] = (bucket[t.counterparty] || 0) + t.amount;
  });
  const topIn  = Object.entries(inParties).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const topOut = Object.entries(outParties).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const stake = wallet.flow30d.reduce((a: number, d: any) => a + d.stake, 0);
  const maxIn  = Math.max(...topIn.map(r=>r[1]), 1);
  const maxOut = Math.max(...topOut.map(r=>r[1]), 1);

  return (
    <div className="wd-flow-diagram">
      <div className="wd-flow-col wd-flow-col--in">
        <div className="mono wd-flow-col__title">Top inflows</div>
        {topIn.map(([addr, amt])=>(
          <div key={addr} className="wd-flow-node">
            <div className="wd-flow-node__bar" style={{width:`${(amt/maxIn)*100}%`, background:"var(--ok, #73d13d)"}}/>
            <div className="mono wd-flow-node__addr">{_short(addr, 12)}</div>
            <div className="mono num wd-flow-node__amt">+{_fmt(amt)}</div>
          </div>
        ))}
      </div>

      <div className="wd-flow-center">
        <div className="wd-flow-center__arrows">
          <svg width="100%" height="120" viewBox="0 0 200 120" preserveAspectRatio="none">
            {/* in arrow */}
            <path d="M0,60 Q60,60 100,60" stroke="var(--ok, #73d13d)" strokeWidth="2" fill="none" opacity="0.6"/>
            <path d="M100,60 L200,60" stroke="var(--err, #ff6b6b)" strokeWidth="2" fill="none" opacity="0.6"/>
            {/* stake/reward branches */}
            <path d="M100,60 Q130,20 180,20" stroke="var(--fg-400)" strokeWidth="1.5" fill="none" strokeDasharray="3,3" opacity="0.5"/>
            <path d="M100,60 Q130,100 180,100" stroke="var(--gold)" strokeWidth="1.5" fill="none" strokeDasharray="3,3" opacity="0.6"/>
          </svg>
        </div>
        <div className="wd-flow-center__hub">
          <div className="mono wd-flow-center__label">WALLET</div>
          <div className="mono num wd-flow-center__value">{_abbr(wallet.bal)}</div>
          <div className="mono wd-flow-center__sub">LYTH</div>
        </div>
        <div className="wd-flow-center__badge mono">
          Net · {(totalIn-totalOut) >= 0 ? "+" : "−"}{_fmt(Math.abs(totalIn-totalOut))} LYTH
        </div>
      </div>

      <div className="wd-flow-col wd-flow-col--out">
        <div className="mono wd-flow-col__title">Top outflows</div>
        {topOut.map(([addr, amt])=>(
          <div key={addr} className="wd-flow-node">
            <div className="wd-flow-node__bar" style={{width:`${(amt/maxOut)*100}%`, background:"var(--err, #ff6b6b)"}}/>
            <div className="mono wd-flow-node__addr">{_short(addr, 12)}</div>
            <div className="mono num wd-flow-node__amt">−{_fmt(amt)}</div>
          </div>
        ))}
        {stake > 0 && (
          <div className="wd-flow-node" style={{marginTop:12,borderTop:"1px solid var(--fg-700)",paddingTop:10}}>
            <div className="wd-flow-node__bar" style={{width:`60%`, background:"var(--gold)", opacity:0.6}}/>
            <div className="mono wd-flow-node__addr" style={{color:"var(--gold)"}}>→ staking</div>
            <div className="mono num wd-flow-node__amt">{_fmt(stake)}</div>
          </div>
        )}
        {totalRw > 0 && (
          <div className="wd-flow-node">
            <div className="wd-flow-node__bar" style={{width:`40%`, background:"var(--gold)"}}/>
            <div className="mono wd-flow-node__addr" style={{color:"var(--gold)"}}>← rewards</div>
            <div className="mono num wd-flow-node__amt">+{_fmt(totalRw)}</div>
          </div>
        )}
      </div>
    </div>
  );
};

/* =====================================================
   TRANSACTIONS INDEX
   Live recent transactions via `lyth_txFeed`, with block-window scanning
   as the compatibility fallback for older nodes.
===================================================== */
const TransactionsPage = ({ go }: any) => {
  const [query, setQuery] = useStateX("");
  const live = useLatestTransactions(60, 32);
  const hasLiveDigest = live.data !== undefined && live.data !== null;
  const fallbackRows = useMemoX(() =>
    Object.values(TXS)
      .sort((a: any, b: any) => (b.round ?? 0) - (a.round ?? 0))
      .slice(0, 80)
      .map((tx: any) => ({
        hash: tx.hash,
        blockNumber: tx.round,
        blockLabel: `round ${Number(tx.round ?? 0).toLocaleString()}`,
        when: tx.when,
        from: tx.from,
        to: tx.to,
        valueLabel: `${_fmt(tx.amount)} ${tx.denom}`,
        feeLabel: transactionFeeValueLabel(null, tx.fee, tx.feeDenom ?? "LYTH"),
        executionLabel: tx.gasUsed ? _fmt(tx.gasUsed) : "—",
        methodLabel: tx.kindLabel ?? tx.kind ?? "transaction",
        status: tx.status ?? "ok",
        source: "fallback",
      })),
    [],
  );
  const liveRows = (live.data?.rows ?? []).map((tx: any) => {
    const input = tx.input ?? "0x";
    const receipt = tx.receipt ?? null;
    const limit = Number(tx.executionUnitLimit ?? tx.gasLimit ?? 0);
    const used = receipt && Number.isFinite(Number(receipt.executionUnitsUsed))
      ? Number(receipt.executionUnitsUsed)
      : null;
    const status = receipt
      ? receipt.status === 1 ? "ok" : "failed"
      : "pending";
    return {
      hash: tx.hash,
      blockNumber: tx.blockNumber,
      blockLabel: `block ${Number(tx.blockNumber).toLocaleString()}`,
      when: _ageFromTs(tx.blockTimestamp),
      from: tx.from,
      to: tx.to ?? "contract creation",
      valueLabel: `${_fmtRawToken(tx.value)} LYTH`,
      feeLabel: transactionFeeValueLabel(tx.feeDisplay ?? null, null),
      executionLabel: used !== null
        ? `${_fmt(used)} / ${_fmt(limit)}`
        : _fmt(limit),
      methodLabel: input && input !== "0x" ? `${input.slice(0, 10)} call` : "transfer",
      status,
      source: "live",
    };
  });
  const rows = hasLiveDigest ? liveRows : fallbackRows;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? rows.filter((row: any) =>
        `${row.hash} ${row.from} ${row.to} ${row.methodLabel} ${row.blockLabel}`.toLowerCase().includes(q),
      )
    : rows;
  const sourceText = hasLiveDigest
    ? live.data?.source === "lyth_txFeed"
      ? `lyth_txFeed · cursor ${live.data.nextCursor ? "available" : "head"}`
      : `live API · scanned ${live.data?.scannedBlocks ?? 0} blocks`
    : live.isLoading
      ? "checking live API"
      : "local fallback";

  return (
    <div className="ms-page ms-transactions">
      <section style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:18,flexWrap:"wrap"}}>
        <div>
          <div className="cap" style={{color:"var(--gold)"}}>Transactions</div>
          <h1 className="ms-h1" style={{margin:"4px 0 0"}}>Latest transactions</h1>
          <p className="mono" style={{color:"var(--fg-400)",margin:"8px 0 0",fontSize:13,maxWidth:720,lineHeight:1.55}}>
            Recent public transactions flattened from the newest block window. Private transfer amounts remain hidden by protocol rules.
          </p>
        </div>
        <button className="ov-cta ov-cta--ghost" onClick={()=>live.refetch()}>
          {live.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </section>

      <section className="stats-counters">
        <StatCounter
          label="Rows shown"
          value={_fmtI(filtered.length)}
          sub={`${rows.length.toLocaleString()} loaded`}
          tone="gold"
        />
        <StatCounter
          label="Latest block"
          value={hasLiveDigest ? _fmtI(live.data?.latestBlock ?? 0) : "—"}
          sub={sourceText}
          tone="neutral"
        />
        <StatCounter
          label="Scanned txs"
          value={hasLiveDigest ? _fmtI(live.data?.scannedTransactions ?? 0) : _fmtI(Object.keys(TXS).length)}
          sub={hasLiveDigest ? (live.data?.source === "lyth_txFeed" ? "reported by transaction feed" : "reported by block pages") : "fallback rows"}
          tone="neutral"
        />
        <StatCounter
          label="Filter"
          value={q ? "active" : "all"}
          sub={q ? _short(q, 18) : "hash, address, method, block"}
          tone="neutral"
        />
      </section>

      <Card
        title="Transaction feed"
        right={
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <span className={`pill ${hasLiveDigest ? "ok" : "warn"}`} style={{fontSize:10}}>
              {hasLiveDigest ? "live" : live.isLoading ? "loading" : "fallback"}
            </span>
            <input
              value={query}
              onChange={(e)=>setQuery(e.target.value)}
              placeholder="Filter hash, address, method"
              style={{
                width:240,
                padding:"6px 10px",
                border:"1px solid var(--fg-700)",
                borderRadius:8,
                background:"rgba(255,255,255,0.03)",
                color:"var(--fg-100)",
                fontSize:12,
              }}
            />
          </div>
        }
      >
        {filtered.length === 0 ? (
          <p className="mono" style={{color:"var(--fg-500)",fontSize:12,margin:0}}>
            {hasLiveDigest ? "No transactions found in the scanned block window." : "No fallback transactions matched the filter."}
          </p>
        ) : (
          <div style={{overflowX:"auto"}}>
          <table className="ms-table ms-table--tight">
            <thead>
              <tr>
                <th>Status</th>
                <th>Hash · method</th>
                <th>Block</th>
                <th>From</th>
                <th>To</th>
                <th style={{textAlign:"right"}}>Value</th>
                <th style={{textAlign:"right"}}>Fee</th>
                <th style={{textAlign:"right"}}>Used / Limit</th>
                <th style={{textAlign:"right"}}>Age</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tx: any) => (
                <tr key={`${tx.source}-${tx.hash}`} onClick={()=>go(`#/tx/${encodeURIComponent(tx.hash)}`)}>
                  <td>
                    <span
                      className={`pill ${tx.status === "failed" ? "err" : tx.status === "pending" ? "warn" : "ok"}`}
                      style={{fontSize:9.5,padding:"2px 7px"}}
                    >
                      {tx.status === "failed" ? "failed" : tx.status === "pending" ? "pending" : "ok"}
                    </span>
                  </td>
                  <td>
                    <div className="mono" style={{fontSize:12,color:"var(--fg-100)"}}>{_short(tx.hash, 14)}</div>
                    <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:1}}>{tx.methodLabel}</div>
                  </td>
                  <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>
                    <a onClick={(e)=>{ e.stopPropagation(); go(`#/round/${tx.blockNumber}`); }} style={{color:"var(--gold)",cursor:"pointer"}}>
                      {tx.blockLabel}
                    </a>
                  </td>
                  <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>
                    <a onClick={(e)=>{ e.stopPropagation(); go(`#/wallet/${encodeURIComponent(tx.from)}`); }} style={{cursor:"pointer"}}>
                      {_short(tx.from, 13)}
                    </a>
                  </td>
                  <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>
                    <a onClick={(e)=>{ e.stopPropagation(); go(`#/wallet/${encodeURIComponent(tx.to)}`); }} style={{cursor:"pointer"}}>
                      {_short(tx.to, 13)}
                    </a>
                  </td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-100)"}}>{tx.valueLabel}</td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-400)",fontSize:11}}>{tx.feeLabel}</td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-400)",fontSize:11}}>{tx.executionLabel}</td>
                  <td className="mono" style={{textAlign:"right",fontSize:11,color:"var(--fg-400)"}}>{tx.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>
    </div>
  );
};

/* =====================================================
   TRANSACTION DETAIL PAGE
   Reads live transaction, receipt, native receipt, and status fields first;
   local rows fill retained trace fields when they are not available.
===================================================== */
const TxPage = ({ hash, go }: any) => {
  const live = useTxByHashLive(hash);
  const nativeReceipt = useTxNativeReceipt(hash);
  const txStatus = useTxStatus(hash);
  const liveTx = live.data?.tx ?? null;
  const liveReceipt = live.data?.receipt ?? null;
  const liveDecoded: any = live.data?.decoded ?? null;
  const liveNativeReceipt = nativeReceipt.data ?? null;
  const liveNativeFee = liveNativeReceipt
    ? structuredNativeReceiptFee(liveNativeReceipt.fee, { label: "native receipt fee" })
    : null;
  const nativeEventRows = nativeReceiptEventRows(liveNativeReceipt);
  const nativeMarketEventRows = nativeReceiptMarketEventRows(liveNativeReceipt);
  const mrvEvidence = mrvNativeTransactionEvidence(liveDecoded, liveNativeReceipt);
  const indexedStatus = txStatus.data ?? null;
  const fallback = TXS[hash];
  const decodedCalldata = liveDecoded?.decodedCalldata && typeof liveDecoded.decodedCalldata === "object"
    ? liveDecoded.decodedCalldata as Record<string, any>
    : null;
  const decodedMethod = decodedCalldata?.method ?? decodedCalldata?.methodName ?? decodedCalldata?.signature ?? null;
  const decodedInputText = decodedCalldata
    ? JSON.stringify(decodedCalldata, null, 2)
    : liveDecoded?.memo
      ? liveDecoded.memo
      : null;
  const liveLogs = Array.isArray(liveDecoded?.logs)
    ? liveDecoded.logs.map((log:any, i:number) => ({
        topic: log.topics?.[0] ?? `log ${i + 1}`,
        args: {
          address: log.address,
          topics: (log.topics ?? []).join(", "),
          data: log.data,
        },
      }))
    : [];
  const liveBlockNumber = liveReceipt?.block_number !== undefined
    ? Number(liveReceipt.block_number)
    : liveTx?.blockNumber
      ? Number(BigInt(liveTx.blockNumber))
      : liveNativeReceipt?.blockHeight ?? null;

  // Merge live receipt over the fallback so the UI always renders a complete
  // shape. `lyth_decodeTx` now provides decoded calldata, logs, status,
  // execution-unit usage, and PQ-finality metadata; the signature timing chart
  // remains fallback-only until the chain exposes per-signer timing.
  const tx = liveTx || liveReceipt || liveNativeReceipt
    ? {
        ...(fallback ?? {
          // Bare minimum so the page has something to render when there's
          // no fallback for the hash but the chain has confirmed it.
          hash,
          round: 0,
          roundLabel: "round —",
          when: "live",
          kind: "transfer",
          kindLabel: "Transfer",
          from: "—",
          to: "—",
          amount: 0,
          denom: "LYTH",
          fee: 0,
          feeDenom: "LYTH",
          cluster: "C-001",
          clusterName: "—",
          inputNote: "",
          nonce: 0,
          quorumSigners: 7,
          quorumRequired: 5,
          dacCoverage: 1,
          signatures: [],
          contractInput: null,
          logs: [],
          gasLimit: 0,
        }),
        // Live overrides — keep the node fields as the source of truth.
        hash: liveTx?.hash ?? liveReceipt?.tx_hash ?? liveNativeReceipt?.txHash ?? fallback?.hash ?? hash,
        from: liveTx?.from ?? fallback?.from ?? "—",
        to: liveTx?.to ?? fallback?.to ?? "—",
        amount: liveTx?.value ? _rawToLythNumber(liveTx.value) : (fallback?.amount ?? 0),
        fee: fallback?.fee ?? 0,
        feeDenom: fallback?.feeDenom ?? "LYTH",
        feeLabel: liveNativeReceipt
          ? liveNativeFee
            ? transactionFeeValueLabel(liveNativeFee.display, null)
            : "invalid structured native fee object"
          : transactionFeeValueLabel(null, fallback?.fee ?? 0, fallback?.feeDenom ?? "LYTH"),
        feeDetailTexts: liveNativeFee?.display.detailTexts ?? [],
        gasLimit: liveTx?.gas ? Number(BigInt(liveTx.gas)) : (fallback?.gasLimit ?? 0),
        nonce: liveTx?.nonce ? Number(BigInt(liveTx.nonce)) : (fallback?.nonce ?? 0),
        kindLabel: decodedMethod ?? fallback?.kindLabel ?? "Transfer",
        inputNote: liveDecoded?.memo ?? fallback?.inputNote ?? "",
        contractInput: decodedInputText ?? (liveTx?.input && liveTx.input !== "0x" ? liveTx.input : (fallback?.contractInput ?? null)),
        logs: liveLogs.length ? liveLogs : (fallback?.logs ?? []),
        status:
          (liveDecoded?.status
            ? (liveDecoded.status === "success" ? "ok" : liveDecoded.status === "unknown" ? "pending" : "failed")
            : typeof liveReceipt?.status === "number"
            ? (liveReceipt.status === 1 ? "ok" : liveReceipt.status === -1 ? "pending" : "failed")
            : liveNativeReceipt
            ? (liveNativeReceipt.reverted ? "failed" : "ok")
            : (fallback?.status ?? "ok")),
        gasUsed: Number(
          liveReceipt?.executionUnitsUsed ?? liveNativeReceipt?.counters.cycles ?? fallback?.gasUsed ?? 0,
        ),
        round: liveBlockNumber ?? fallback?.round ?? 0,
        roundLabel:
          liveBlockNumber !== null
            ? `block ${liveBlockNumber.toLocaleString()}`
            : (fallback?.roundLabel ?? "round —"),
      }
    : fallback;

  if (!tx) return (
    <div className="ms-page">
      <h1 className="ms-h1">Transaction not found</h1>
      <p className="mono" style={{color:"var(--fg-400)"}}>No tx with hash: <code>{hash}</code></p>
      {live.isLoading && (
        <p className="mono" style={{color:"var(--fg-500)",fontSize:11,marginTop:6}}>
          checking live receipt…
        </p>
      )}
      {indexedStatus?.status === "not_found" && (
        <p className="mono" style={{color:"var(--fg-400)",fontSize:12,lineHeight:1.55,maxWidth:680}}>
          Indexer searched through block #{indexedStatus.latestHeight.toLocaleString()} on {indexedStatus.providerKind};
          indexer is {indexedStatus.indexerEnabled ? "enabled" : "disabled"}.
        </p>
      )}
      {indexedStatus?.status === "found" && (
        <p className="mono" style={{color:"var(--fg-400)",fontSize:12,lineHeight:1.55,maxWidth:680}}>
          The indexer sees this transaction in block #{indexedStatus.blockNumber.toLocaleString()} at index {indexedStatus.txIndex},
          but the receipt/detail RPC did not return a full payload.
        </p>
      )}
      {!indexedStatus && txStatus.isLoading && (
        <p className="mono" style={{color:"var(--fg-500)",fontSize:12,marginTop:6}}>
          checking transaction index…
        </p>
      )}
      <button className="ov-cta" onClick={()=>go("#/")}>← Back to overview</button>
    </div>
  );

  return (
    <div className="ms-page ms-tx-detail">
      {/* Hero */}
      <section className="tx-hero">
        <div className="tx-hero__top">
          <div>
            <div className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.1em"}}>TRANSACTION</div>
            <div className="mono tx-hero__hash">{tx.hash}</div>
          </div>
          <div className="tx-hero__status">
            <span className={`tx-status tx-status--${tx.status}`}>
              {tx.status === "ok" ? "✓ Confirmed" : tx.status === "pending" ? "◐ Receipt pending" : "✗ Failed"}
            </span>
          </div>
        </div>
        <div className="tx-hero__amount">
          <div className="mono" style={{fontSize:11,color:"var(--fg-500)",letterSpacing:"0.08em",textTransform:"uppercase"}}>{tx.kindLabel}</div>
          <div className="mono num tx-hero__big">{_fmt(tx.amount)} <span>{tx.denom}</span></div>
          <div className="mono" style={{fontSize:12,color:"var(--fg-400)"}}>
            {tx.roundLabel} · {tx.when} · in cluster <a onClick={()=>go(`#/cluster/${tx.cluster.replace("C-","").replace(/^0+/,"")}`)} style={{color:"var(--gold)",cursor:"pointer"}}>{tx.clusterName} ({tx.cluster})</a>
          </div>
        </div>
      </section>

      {/* From → To */}
      <section>
        <div className="tx-flow">
          <div className="tx-flow__end" onClick={()=>go(`#/wallet/${encodeURIComponent(tx.from)}`)}>
            <div className="mono tx-flow__label">FROM</div>
            <div className="mono tx-flow__addr">{_short(tx.from, 16)}</div>
            <div className="mono tx-flow__note">
              <LiveAddressLabel addr={tx.from} fallback={tagFor(tx.from)}/>
            </div>
          </div>
          <div className="tx-flow__arrow">
            <svg width="100%" height="24" viewBox="0 0 100 24" preserveAspectRatio="none">
              <path d="M0,12 L92,12" stroke="var(--gold)" strokeWidth="2" fill="none"/>
              <path d="M86,6 L92,12 L86,18" stroke="var(--gold)" strokeWidth="2" fill="none"/>
            </svg>
            <div className="mono tx-flow__arrow-label">{_fmt(tx.amount)} {tx.denom}</div>
          </div>
          <div className="tx-flow__end" onClick={()=>go(`#/wallet/${encodeURIComponent(tx.to)}`)}>
            <div className="mono tx-flow__label">TO</div>
            <div className="mono tx-flow__addr">{_short(tx.to, 16)}</div>
            <div className="mono tx-flow__note">
              <LiveAddressLabel addr={tx.to} fallback={tagFor(tx.to)}/>
            </div>
          </div>
        </div>
      </section>

      {/* Details grid */}
      <section className="tx-split">
        <Card title="Transaction">
          <div className="tx-kv">
            <KV label="Hash" value={tx.hash} mono/>
            <KV label="Status" value={tx.status === "ok" ? "Confirmed" : tx.status === "pending" ? "Receipt pending" : "Failed"}/>
            <KV
              label="Indexer status"
              value={
                indexedStatus?.status === "found"
                  ? `found · block ${indexedStatus.blockNumber.toLocaleString()} · index ${indexedStatus.txIndex}`
                  : indexedStatus?.status === "not_found"
                    ? `not found · latest ${indexedStatus.latestHeight.toLocaleString()} · ${indexedStatus.providerKind}`
                    : txStatus.isLoading
                      ? "checking…"
                      : "—"
              }
              mono
            />
            <KV label="Kind" value={tx.kindLabel}/>
            <KV label="Round" value={tx.roundLabel} link={()=>{}} linkLabel="view round →"/>
            <KV label="Timestamp" value={tx.when}/>
            <KV label="Cluster" value={`${tx.clusterName} (${tx.cluster})`} link={()=>go(`#/cluster/${tx.cluster.replace("C-","").replace(/^0+/,"")}`)}/>
            <KV label="Nonce" value={tx.nonce.toString()}/>
            {tx.inputNote && <KV label="Input note" value={tx.inputNote}/>}
          </div>
        </Card>
        <Card title="Fees & execution">
          <div className="tx-kv">
            <KV label="Fee" value={tx.feeLabel ?? transactionFeeValueLabel(null, tx.fee, tx.feeDenom)} mono/>
            {(tx.feeDetailTexts ?? []).map((detail: string, index: number) => (
              <KV key={`${index}-${detail}`} label={index === 0 ? "Fee detail" : "Fee rates"} value={adr0039FeeDetailText(detail)} mono/>
            ))}
            <KV label="Execution units" value={`${_fmt(tx.gasUsed)} / ${_fmt(tx.gasLimit)}`}/>
            <KV label="Execution utilization" value={tx.gasLimit > 0 ? `${((tx.gasUsed/tx.gasLimit)*100).toFixed(1)}%` : "—"}/>
            <KV label="Effective rate" value={liveNativeFee ? "—" : tx.amount > 0 ? `${((tx.fee/tx.amount)*10000).toFixed(2)} bp` : "—"} />
            {liveDecoded?.errorCode && <KV label="Error code" value={liveDecoded.errorCode} mono/>}
          </div>
        </Card>
      </section>

      {liveDecoded && (
        <section className="tx-split">
          <Card title="Decoded by RPC">
            <div className="tx-kv">
              <KV label="Method" value={decodedMethod ?? "raw transfer / memo"} mono/>
              <KV label="Memo" value={liveDecoded.memo ?? "—"}/>
              <KV label="Round" value={liveDecoded.round !== null ? Number(liveDecoded.round).toLocaleString() : "—"} mono/>
              <KV label="Cluster" value={liveDecoded.clusterId !== null ? `C-${String(Number(liveDecoded.clusterId)+1).padStart(3,"0")}` : "—"} mono/>
              <KV label="Logs" value={`${liveDecoded.logs?.length ?? 0}`} mono/>
            </div>
          </Card>
          <Card title="Finality">
            <div className="tx-kv">
              <KV label="BLS attestation" value={liveDecoded.blsAttestation ? "present" : "—"}/>
              <KV label="PQ checkpoint" value={liveDecoded.pqAttestation ? `#${Number(liveDecoded.pqAttestation.checkpointHeight).toLocaleString()}` : "—"} mono/>
              <KV label="PQ signer" value={liveDecoded.pqAttestation?.signerId ? _short(liveDecoded.pqAttestation.signerId, 18) : "—"} mono/>
              <KV label="Finality proof" value={liveDecoded.finalityProof ? "present" : "—"}/>
            </div>
          </Card>
        </section>
      )}

      {liveNativeReceipt && (
        <section className="tx-split">
          <Card title="Native RISC-V receipt">
            <div className="tx-kv">
              <KV label="Schema" value={liveNativeReceipt.schema} mono/>
              <KV label="Artifact hash" value={_short(liveNativeReceipt.artifactHash, 18)} mono/>
              <KV label="Result" value={liveNativeReceipt.reverted ? "Reverted" : "Committed"}/>
              <KV label="Events" value={`${liveNativeReceipt.eventCount}`} mono/>
              <KV label="Native deltas" value={`${liveNativeReceipt.nativeDeltaCount}`} mono/>
              <KV label="Source" value={`${liveNativeReceipt.source.chainProvider} · ${liveNativeReceipt.source.indexerProvider}`} mono/>
            </div>
          </Card>
          <Card title="Native execution">
            <div className="tx-kv">
              <KV label="Cycles" value={_fmt(liveNativeReceipt.counters.cycles)} mono/>
              <KV label="Syscall units" value={_fmt(liveNativeReceipt.counters.syscallUnits)} mono/>
              <KV label="State I/O units" value={_fmt(liveNativeReceipt.counters.stateIoUnits)} mono/>
              {liveNativeFee ? (
                <>
                  <KV label="Total fee" value={transactionFeeValueLabel(liveNativeFee.display, null)} mono/>
                  <KV label="Fee detail" value={adr0039FeeDetailText(liveNativeFee.display.detailTexts[0])} mono/>
                  <KV label="Fee rates" value={adr0039FeeDetailText(liveNativeFee.display.detailTexts[1])} mono/>
                </>
              ) : (
                <KV label="Fee" value="invalid structured native fee object" mono/>
              )}
            </div>
          </Card>
        </section>
      )}

      {mrvEvidence && (
        <section>
          <MrvNativeEvidenceCard evidence={mrvEvidence}/>
        </section>
      )}

      {/* Attestation */}
      <section>
        <h3 className="ov-section-title">Attestation · who signed what</h3>
        <Card title="">
          <div className="tx-attest">
            <div className="tx-attest__summary">
              <div className="tx-attest__badge">
                <div className="mono" style={{fontSize:9.5,color:"var(--fg-500)",letterSpacing:"0.1em"}}>BFT QUORUM</div>
                <div className="mono num" style={{fontSize:22,color:"var(--gold)"}}>{tx.signatures.length}/{tx.quorumSigners}</div>
                <div className="mono" style={{fontSize:10,color:"var(--fg-400)"}}>threshold {tx.quorumRequired}-of-{tx.quorumSigners}</div>
              </div>
              <div className="tx-attest__badge">
                <div className="mono" style={{fontSize:9.5,color:"var(--fg-500)",letterSpacing:"0.1em"}}>DAC COVERAGE</div>
                <div className="mono num" style={{fontSize:22,color:"var(--gold)"}}>{(tx.dacCoverage*100).toFixed(1)}%</div>
                <div className="mono" style={{fontSize:10,color:"var(--fg-400)"}}>erasure-coded shards</div>
              </div>
            </div>
            <div className="tx-attest__sigs">
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.1em",marginBottom:8}}>SIGNATURE TIMELINE · ms after block assembly</div>
              {tx.signatures.map((s,i)=>(
                <div key={i} className="tx-sig-row">
                  <span className="tx-sig-row__dot"/>
                  <span className="mono tx-sig-row__op">{s.op}</span>
                  <div className="tx-sig-row__bar">
                    <div className="tx-sig-row__fill" style={{width:`${(s.ms/30)*100}%`}}/>
                  </div>
                  <span className="mono num tx-sig-row__ms">+{s.ms}ms</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </section>

      {/* Logs + input */}
      {(tx.logs.length > 0 || tx.contractInput) && (
        <section className="tx-split">
          {tx.contractInput && (
            <Card title="Input data">
              <div className="tx-input mono">{tx.contractInput}</div>
            </Card>
          )}
          {tx.logs.length > 0 && (
            <Card title="Events">
              {tx.logs.map((log,i)=>(
                <div key={i} className="tx-log">
                  <div className="mono tx-log__topic">{log.topic}</div>
                  <div className="tx-kv" style={{marginTop:8}}>
                    {Object.entries(log.args).map(([k,v])=>(
                      <KV key={k} label={k} value={typeof v === "number" ? _fmt(v) : String(v)} mono={typeof v === "string"}/>
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          )}
        </section>
      )}

      {nativeEventRows.length > 0 && (
        <section>
          <Card title="Native events">
            {nativeEventRows.map((event)=>(
              <div key={`${event.logIndex}-${event.eventTopic}`} className="tx-log">
                <div className="mono tx-log__topic">
                  {event.eventName ?? event.eventTopic}
                </div>
                <div className="tx-kv" style={{marginTop:8}}>
                  <KV label="Address" value={event.address} mono/>
                  <KV label="Topic" value={event.eventTopic} mono/>
                  <KV label="Family" value={event.family ?? "—"} mono/>
                  <KV label="Payload hash" value={event.payloadHash ?? "—"} mono/>
                  {event.decodedFields.map(([k,v])=>(
                    <KV key={k} label={k} value={v} mono/>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        </section>
      )}

      {nativeMarketEventRows.length > 0 && (
        <section>
          <Card title="Native market events" right={<span className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>decoded receipt</span>}>
            {nativeMarketEventRows.map((event)=>(
              <div key={`${event.logIndex}-${event.eventTopic}-market`} className="tx-log">
                <div className="mono tx-log__topic">
                  {event.eventName ?? event.eventTopic}
                </div>
                <div className="tx-kv" style={{marginTop:8}}>
                  <KV label="Emitter" value={event.address} mono/>
                  <KV label="Family" value={event.family ?? "—"} mono/>
                  {event.decodedFields.map(([k,v])=>(
                    <KV key={k} label={k} value={v} mono/>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
};

const mrvEvidenceStateText = (state: "present" | "missing" | "invalid") => (
  state === "present" ? "present" : state === "invalid" ? "invalid" : "missing"
);

const mrvEvidencePillClass = (evidence: MrvNativeTransactionEvidence) => (
  evidence.proofState === "present"
    ? "pill ok"
    : evidence.receiptState === "present"
      ? "pill warn"
      : "pill"
);

const receiptBlobCountLabel = (count: number) => `${count.toLocaleString()} receipt blob${count === 1 ? "" : "s"}`;

const archiveSignatureSourceLabel = (source: "exactHeight" | "coveringSnapshot" | "none") => {
  switch (source) {
    case "exactHeight":
      return "exact-height archive digest";
    case "coveringSnapshot":
      return "covering snapshot fallback";
    case "none":
      return "no archive signature material";
  }
};

export const MrvNativeEvidenceCard = ({ evidence }: { evidence: MrvNativeTransactionEvidence | null }) => {
  if (!evidence) return null;

  const extension = evidence.extension;
  const proofTranscript = evidence.proof?.transcript ?? null;
  const proofConsistency = evidence.proof?.consistency ?? null;
  const proofKind = evidence.proof?.proofKind ?? proofConsistency?.proofKind ?? null;
  const compactProofTranscript = proofKind === "compactInclusion" && proofTranscript
    ? proofTranscript as NoEvmCompactReceiptProofTranscript
    : null;
  const boundedProofTranscript = proofKind !== "compactInclusion" && proofTranscript
    ? proofTranscript as NoEvmReceiptProofTranscript
    : null;
  const proofMaterialValue = evidence.proof?.materialLabel
    ?? (proofTranscript ? noEvmReceiptProofMaterialLabel(proofTranscript) : null);
  const proofEvidenceLabel = proofKind === "compactInclusion" ? "compact receipt inclusion" : "bounded receipts transcript";
  const submittedValue = extension
    ? `${mrvEvidenceStateText(evidence.submittedState)} · kind ${_hexByte(extension.kind)} · body ${extension.bodyHex ?? "not exposed"} · ${extension.source}`
    : "missing · extension not exposed";
  const includedValue = evidence.includedBlock !== null
    ? `${mrvEvidenceStateText(evidence.includedState)} · block ${evidence.includedBlock.toLocaleString()}`
    : "missing · no block height in detail payload";
  const receiptValue = evidence.receiptState === "present"
    ? `${mrvEvidenceStateText(evidence.receiptState)} · txType ${evidence.receiptTxType === null ? "not exposed" : _hexByte(evidence.receiptTxType)} · ${evidence.artifactHash ? _short(evidence.artifactHash, 18) : "artifact hash missing"}`
    : "missing · native MRV receipt not returned";
  const receiptCommitmentValue = evidence.receiptCommitment
    ? `present · ${_short(evidence.receiptCommitment, 18)} · native-receipt.receiptCommitment`
    : null;
  const resultValue = evidence.receiptState === "present"
    ? `${evidence.reverted ? "reverted" : "committed"} · events ${evidence.eventCount ?? "—"} · native deltas ${evidence.nativeDeltaCount ?? "—"}`
    : "—";
  const proofValue = evidence.proof
    ? proofTranscript
      ? `${proofConsistency?.state ?? "mismatch"} · ${proofEvidenceLabel} · ${evidence.proof.summary} · ${evidence.proof.source}`
      : `invalid · ${proofEvidenceLabel} · ${evidence.proof.summary} · ${evidence.proof.source}`
    : evidence.proofFieldState === "explicit-null"
      ? `missing · ${evidence.proofFieldSource} returned null; no-EVM receipt proof evidence not rendered`
      : "missing · native-receipt.noEvmProof not returned; no-EVM receipt proof evidence not rendered";
  const proofPillText = evidence.proofState === "present"
    ? compactProofTranscript ? "compact inclusion verified" : "transcript verified"
    : proofConsistency?.state === "mismatch"
      ? compactProofTranscript ? "compact inclusion mismatch" : "transcript mismatch"
    : evidence.proofState === "invalid"
      ? "proof evidence invalid"
      : "proof evidence blocked";
  const proofCodecValue = proofTranscript
    ? `${proofTranscript.rootAlgorithm} · ${proofTranscript.receiptCodec}`
    : null;
  const proofAnchorValue = proofTranscript
    ? `block ${_short(proofTranscript.blockHash, 18)} · tx ${_short(proofTranscript.txHash, 18)}`
    : null;
  const proofReceiptRootValue = proofTranscript
    ? `${_short(proofTranscript.receiptsRoot, 18)} · target ${_short(proofTranscript.targetReceiptHash, 18)}`
    : null;
  const proofTranscriptValue = boundedProofTranscript
    ? `${receiptBlobCountLabel(boundedProofTranscript.receiptTranscript.length)} · receiptCount ${boundedProofTranscript.receiptCount.toLocaleString()} · txIndex ${boundedProofTranscript.txIndex.toLocaleString()}`
    : null;
  const compactInclusionValue = compactProofTranscript
    ? `root ${_short(compactProofTranscript.compactInclusionProof.root, 18)} · leaf ${_short(compactProofTranscript.compactInclusionProof.leafHash, 18)} · ${compactProofTranscript.compactInclusionProof.siblingHashes.length.toLocaleString()} sibling hashes`
    : null;
  const compactTargetValue = compactProofTranscript
    ? `${_short(compactProofTranscript.targetReceiptBytes, 18)} · target hash ${_short(compactProofTranscript.targetReceiptHash, 18)}`
    : null;
  const archiveProof = compactProofTranscript?.archiveProof ?? null;
  const archiveCoveringSnapshot = archiveProof?.coveringSnapshot ?? null;
  const archiveVerification = evidence.proof?.archiveVerification ?? null;
  const archiveVerificationSource = archiveVerification
    ? archiveSignatureSourceLabel(archiveVerification.signatureSource)
    : "no archive signature material";
  const archiveVerificationValue = archiveProof
    ? archiveVerification
      ? archiveVerification.state === "verified"
        ? `verified · configured trusted archive signers · ${archiveVerificationSource} · accepted ${archiveVerification.result?.validSigners.length.toLocaleString() ?? "—"}/${archiveVerification.result?.threshold.toLocaleString() ?? "—"} signatures · not validator finality or availability proof`
        : archiveVerification.state === "unconfigured"
          ? `unconfigured · ${archiveVerification.reason ?? "trusted archive signer config not configured"}; parsed only · not validator finality or availability proof`
          : `${archiveVerification.state} · configured trusted archive signers · ${archiveVerificationSource} · ${archiveVerification.reason ?? "trusted archive verification unavailable"} · not validator finality or availability proof`
      : "unconfigured · trusted archive signer config not configured; parsed only · not validator finality or availability proof"
    : null;
  const archiveBindingValue = archiveProof
    ? `${archiveProof.source} · manifest ${_short(archiveProof.manifestHash, 18)} · content ${_short(archiveProof.contentHash, 18)}`
    : compactProofTranscript?.historySource === "indexerReceiptArchive"
      ? "absent · archive binding not returned"
      : null;
  const archiveSignatureCount = archiveProof?.signatures.length ?? 0;
  const archiveSignatureDigestValue = archiveProof?.signatureDigest
    ? `${_short(archiveProof.signatureDigest, 18)} · snapshot archive signature digest material · not validator finality or availability proof`
    : null;
  const archiveSignaturesValue = compactProofTranscript?.historySource === "indexerReceiptArchive"
    ? archiveSignatureCount > 0
      ? `present · ${archiveSignatureCount.toLocaleString()} archive signature${archiveSignatureCount === 1 ? "" : "s"} · validator finality not asserted`
      : "absent · validator finality not asserted"
    : null;
  const archiveCoveringSnapshotVerification = archiveVerification?.signatureSource === "coveringSnapshot"
    ? archiveVerification.state === "verified"
      ? "trusted archive signature verified"
      : archiveVerification.state === "unconfigured"
        ? "explorer verification not configured"
        : `trusted archive signature ${archiveVerification.state}`
    : archiveVerification?.signatureSource === "exactHeight"
      ? "exact-height signatures selected"
      : "explorer verification not configured";
  const archiveCoveringSnapshotValue = archiveCoveringSnapshot
    ? `parsed · snapshot ${archiveCoveringSnapshot.snapshotHeight.toLocaleString()} covers blocks ${archiveCoveringSnapshot.checkpointFrom.toLocaleString()}-${archiveCoveringSnapshot.checkpointTo.toLocaleString()} · ${archiveCoveringSnapshotVerification}`
    : null;
  const archiveCoveringSnapshotHashesValue = archiveCoveringSnapshot
    ? `manifest ${_short(archiveCoveringSnapshot.manifestHash, 18)} · content ${_short(archiveCoveringSnapshot.contentHash, 18)} · checkpoint content ${_short(archiveCoveringSnapshot.checkpointContentHash, 18)} · digest ${_short(archiveCoveringSnapshot.signatureDigest, 18)}`
    : null;
  const archiveCoveringSnapshotSignaturesValue = archiveCoveringSnapshot
    ? `parsed · ${archiveCoveringSnapshot.signatures.length.toLocaleString()} covering snapshot signature${archiveCoveringSnapshot.signatures.length === 1 ? "" : "s"} · not validator finality or availability proof`
    : null;
  const finalityEvidence = proofTranscript?.finalityEvidence ?? null;
  const finalityVerification = evidence.proof?.finalityVerification ?? null;
  const finalityVerificationValue = finalityVerification
    ? finalityVerification.state === "verified"
      ? `verified · configured trusted BLS cluster key · accepted ${finalityVerification.result?.acceptedSignatureCount.toLocaleString() ?? "—"}/${finalityVerification.result?.requiredSignatureCount.toLocaleString() ?? "—"} signatures`
      : `${finalityVerification.state} · ${finalityVerification.reason ?? "trusted BLS finality verification unavailable"}`
    : null;
  const finalityEvidenceValue = proofTranscript
    ? finalityEvidence
      ? `present · BLS round certificate material · round ${finalityEvidence.round.toLocaleString()} · cert round ${finalityEvidence.certificate.round.toLocaleString()} · signers ${finalityEvidence.certificate.signerCount.toLocaleString()} · signature ${_short(finalityEvidence.certificate.signature, 18)} · bitmap ${_short(finalityEvidence.certificate.signersBitmap, 18)}${finalityVerificationValue ? ` · ${finalityVerificationValue}` : " · trusted BLS finality key not configured"}`
      : "absent · BLS round certificate not returned; no live finality proof asserted"
    : null;
  const missingProofMaterial = proofTranscript?.missingProofMaterial ?? [];
  const missingProofMaterialValue = missingProofMaterial.length > 0
    ? missingProofMaterial.join("; ")
    : null;
  const proofConsistencyValue = proofConsistency
    ? proofConsistency.state === "verified"
      ? compactProofTranscript
        ? `verified · compact path verified · computed ${_short(proofConsistency.computedReceiptsRoot, 18)} · target ${proofConsistency.computedTargetReceiptHash ? _short(proofConsistency.computedTargetReceiptHash, 18) : "missing"}`
        : `verified · computed ${_short(proofConsistency.computedReceiptsRoot, 18)} · target ${proofConsistency.computedTargetReceiptHash ? _short(proofConsistency.computedTargetReceiptHash, 18) : "missing"}`
      : `mismatch · ${proofConsistency.mismatches.join("; ")} · computed ${_short(proofConsistency.computedReceiptsRoot, 18)}`
    : null;

  return (
    <Card
      title="MRV native evidence"
      right={<span className={mrvEvidencePillClass(evidence)}>{proofPillText}</span>}
    >
      <div className="tx-kv">
        {evidence.operation && <KV label="Operation" value={evidence.operation} mono/>}
        {evidence.txHash && <KV label="Transaction" value={_short(evidence.txHash, 18)} mono/>}
        <KV label="Submitted" value={submittedValue} mono/>
        <KV label="Included" value={includedValue} mono/>
        <KV label="Receipt" value={receiptValue} mono/>
        {evidence.receiptSchema && <KV label="Receipt schema" value={evidence.receiptSchema} mono/>}
        {receiptCommitmentValue && <KV label="Receipt commitment" value={receiptCommitmentValue} mono/>}
        <KV label="Execution result" value={resultValue} mono/>
        {evidence.pqCheckpoint && <KV label="PQ checkpoint" value={evidence.pqCheckpoint} mono/>}
        <KV label="No-EVM receipt proof" value={proofValue} mono/>
        {proofMaterialValue && <KV label="Proof material" value={proofMaterialValue} mono/>}
        {proofConsistencyValue && <KV label={compactProofTranscript ? "Compact proof check" : "Transcript check"} value={proofConsistencyValue} mono/>}
        {proofCodecValue && <KV label={compactProofTranscript ? "Proof codec" : "Transcript codec"} value={proofCodecValue} mono/>}
        {proofAnchorValue && <KV label={compactProofTranscript ? "Proof anchors" : "Transcript anchors"} value={proofAnchorValue} mono/>}
        {proofReceiptRootValue && <KV label="Receipt root" value={proofReceiptRootValue} mono/>}
        {compactInclusionValue && <KV label="Compact inclusion" value={compactInclusionValue} mono/>}
        {compactTargetValue && <KV label="Target receipt" value={compactTargetValue} mono/>}
        {archiveBindingValue && <KV label="Archive binding" value={archiveBindingValue} mono/>}
        {archiveVerificationValue && <KV label="Archive signature verification" value={archiveVerificationValue} mono/>}
        {archiveSignatureDigestValue && <KV label="Archive signature digest" value={archiveSignatureDigestValue} mono/>}
        {archiveSignaturesValue && <KV label="Archive signatures" value={archiveSignaturesValue} mono/>}
        {archiveCoveringSnapshotValue && <KV label="Archive covering snapshot" value={archiveCoveringSnapshotValue} mono/>}
        {archiveCoveringSnapshotHashesValue && <KV label="Covering snapshot hashes" value={archiveCoveringSnapshotHashesValue} mono/>}
        {archiveCoveringSnapshotSignaturesValue && <KV label="Covering snapshot signatures" value={archiveCoveringSnapshotSignaturesValue} mono/>}
        {finalityEvidenceValue && <KV label="Finality evidence" value={finalityEvidenceValue} mono/>}
        {missingProofMaterialValue && <KV label="Missing proof material" value={missingProofMaterialValue} mono/>}
        {proofTranscriptValue && <KV label="Receipt transcript" value={proofTranscriptValue} mono/>}
      </div>
      {evidence.blockers.length > 0 && (
        <div className="tx-log" style={{marginTop:12,borderColor:"rgba(255,204,102,0.28)"}}>
          <div className="mono tx-log__topic" style={{color:"var(--warn)"}}>Blocked evidence</div>
          <div style={{marginTop:8,display:"grid",gap:6}}>
            {evidence.blockers.map((blocker)=>(
              <div key={blocker} className="mono" style={{fontSize:11,lineHeight:1.45,color:"var(--fg-300)"}}>
                {blocker}
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
};

const KV = ({ label, value, mono, link, linkLabel }: any) => (
  <div className="tx-kv__row">
    <span className="mono tx-kv__k">{label}</span>
    <span className={`${mono?"mono":""} tx-kv__v`}>
      {value}
      {link && <a onClick={link} style={{marginLeft:10,color:"var(--gold)",cursor:"pointer",fontSize:11}}>{linkLabel || "→"}</a>}
    </span>
  </div>
);

/* =====================================================
   ROUND DETAIL — search-entered round number lands here.
   Looks up the vertex list for that round across all clusters.
===================================================== */
const RoundPage = ({ round, go }: any) => {
  const r = parseInt(round, 10);
  const roundNumber = Number.isFinite(r) ? r : undefined;
  const liveBlock = useBlockByNumber(roundNumber);
  const blockTransactions = useBlockTransactions(roundNumber, 0, 25);
  const roundCert = useBlsRoundCertificate(roundNumber);
  const dagParents = useDagParents(roundNumber);
  const verticesAtRound = useVerticesAtRound(roundNumber);
  const chainStats = useChainStats();
  const liveLatestHeight = chainStats.data?.latestHeight ?? null;
  const cur = liveLatestHeight !== null
    ? Number(liveLatestHeight)
    : (MONOSCAN_DATA?.consensus?.round || 0);
  const curIsLive = liveLatestHeight !== null;
  const verts = (MONOSCAN_DATA?.recentVertices || []).filter(v => v.round === r);
  const liveHeader: any = liveBlock.data ?? null;
  const liveCert: any = roundCert.data ?? null;
  const liveParents = dagParents.data?.parents ?? null;
  const liveVertices = verticesAtRound.data?.vertices ?? [];
  const signerIndices = liveCert?.signer_indices ?? liveCert?.signerIndices ?? [];
  const signerCount = Number(liveCert?.signer_count ?? liveCert?.signerCount ?? signerIndices.length ?? 0);
  const liveHeaderTimestamp = (() => {
    const raw = liveHeader?.timestamp;
    if (raw === null || raw === undefined) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const liveHeaderTimestampDisplay = (() => {
    if (liveHeaderTimestamp === null) return null;
    const ms = liveHeaderTimestamp > 1_000_000_000_000
      ? liveHeaderTimestamp
      : liveHeaderTimestamp * 1000;
    const iso = new Date(ms).toISOString().replace(".000Z", "Z");
    const age = _ageFromTs(liveHeaderTimestamp);
    return age && age !== "—" ? `${iso} · ${age}` : iso;
  })();
  const found = liveHeader || liveVertices.length > 0 || (liveParents?.length ?? 0) > 0 || verts.length > 0 || (r > 0 && r <= cur);
  return (
    <div className="ms-page">
      <button className="ov-cta ov-cta--ghost" onClick={()=>go("#/")} style={{marginBottom:16}}>← Overview</button>
      <h1 className="ms-h1" style={{marginBottom:6}}>Round <span style={{color:"var(--gold)"}}>#{isNaN(r)?round:r.toLocaleString()}</span></h1>
      {!found ? (
        <p className="mono" style={{color:"var(--fg-400)"}}>
          {liveBlock.isLoading || chainStats.isLoading
            ? "Checking live block…"
            : curIsLive
              ? `Round not found. Current head is ${cur.toLocaleString()} · live.`
              : "Round not found and no live head available."}
        </p>
      ) : (
        <>
          {liveHeader ? (
            <div className="ms-card" style={{padding:"14px 18px",marginBottom:14}}>
              <div className="cap" style={{marginBottom:10,color:"var(--gold)"}}>Live block · header API</div>
              <div className="tx-kv">
                <div className="tx-kv__row">
                  <span className="mono tx-kv__k">Hash</span>
                  <span className="mono tx-kv__v">{liveHeader.hash}</span>
                </div>
                <div className="tx-kv__row">
                  <span className="mono tx-kv__k">Parent</span>
                  <span className="mono tx-kv__v">{liveHeader.parent_hash ?? liveHeader.parentHash ?? "—"}</span>
                </div>
                <div className="tx-kv__row">
                  <span className="mono tx-kv__k">State root</span>
                  <span className="mono tx-kv__v">{liveHeader.state_root ?? liveHeader.stateRoot ?? "—"}</span>
                </div>
                <div className="tx-kv__row">
                  <span className="mono tx-kv__k">Execution units used / limit</span>
                  <span className="mono tx-kv__v">
                    {Number(liveHeader.executionUnitsUsed ?? liveHeader.gas_used ?? liveHeader.gasUsed ?? 0).toLocaleString()}
                    {" / "}
                    {Number(liveHeader.executionUnitLimit ?? liveHeader.gas_limit ?? liveHeader.gasLimit ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="tx-kv__row">
                  <span className="mono tx-kv__k">Timestamp</span>
                  <span className="mono tx-kv__v">
                    {liveHeaderTimestampDisplay ?? (liveHeader.timestamp ?? "—")}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <p className="mono" style={{color:"var(--fg-400)",marginBottom:20}}>
              {verts.length > 0
                ? `${verts.length} cluster vertex${verts.length===1?"":"es"} committed at this round.`
                : curIsLive && r > 0 && r <= cur
                  ? `Round committed ~${Math.max(0, cur - r).toLocaleString()} rounds ago.`
                  : "Round retained but no live header is exposed for it."}
            </p>
          )}
          {(liveCert || roundCert.isLoading || roundCert.isFetched) && (
            <div className="ms-card" style={{padding:"14px 18px",marginBottom:14}}>
              <div className="cap" style={{marginBottom:10,color:"var(--gold)"}}>
                BLS round certificate · lyth_getBlsRoundCertificate
              </div>
              {liveCert ? (
                <div className="tx-kv">
                  <KV label="Round" value={Number(liveCert.round ?? r).toLocaleString()} mono/>
                  <KV label="Operators signed" value={`${signerCount}${signerIndices.length ? ` · [${signerIndices.join(", ")}]` : ""}`} mono/>
                  <KV label="Operator bitmap" value={_short(liveCert.signers_bitmap ?? liveCert.signersBitmap ?? "—", 28)} mono/>
                  <KV label="Aggregate signature" value={_short(liveCert.signature ?? "—", 28)} mono/>
                </div>
              ) : (
                <p className="mono" style={{color:"var(--fg-500)",fontSize:12,margin:0}}>
                  {roundCert.isLoading ? "checking live certificate…" : "RPC returned null; no persisted certificate is exposed for this round yet"}
                </p>
              )}
            </div>
          )}
          {(liveParents || dagParents.isLoading || dagParents.isFetched) && (
            <div className="ms-card" style={{padding:"14px 18px",marginBottom:14}}>
              <div className="cap" style={{marginBottom:10,color:"var(--gold)"}}>
                DAG parents · lyth_dagParents
              </div>
              {liveParents && liveParents.length > 0 ? (
                <table className="ms-table">
                  <thead><tr><th>Parent vertex</th><th style={{textAlign:"right"}}>Round</th></tr></thead>
                  <tbody>
                    {liveParents.map((p:any)=>(
                      <tr key={p.vertexHash}>
                        <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>{_short(p.vertexHash, 24)}</td>
                        <td className="mono num" style={{textAlign:"right"}}>{Number(p.round).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="mono" style={{color:"var(--fg-500)",fontSize:12,margin:0}}>
                  {dagParents.isLoading ? "checking DAG parents…" : "No retained parent vertices reported for this round."}
                </p>
              )}
            </div>
          )}
          {(blockTransactions.data || blockTransactions.isLoading || blockTransactions.isFetched) && (
            <div className="ms-card" style={{padding:"14px 18px",marginBottom:14}}>
              <div className="cap" style={{marginBottom:10,color:"var(--gold)"}}>
                Transactions in this block · /api/v1/blocks/{roundNumber}/transactions
              </div>
              {blockTransactions.data && blockTransactions.data.transactions.length > 0 ? (
                <>
                  <table className="ms-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Hash</th>
                        <th>From</th>
                        <th>To</th>
                        <th style={{textAlign:"right"}}>Value</th>
                        <th style={{textAlign:"right"}}>Execution limit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {blockTransactions.data.transactions.map((tx:any) => (
                        <tr
                          key={tx.txHash}
                          onClick={()=>go(`#/tx/${encodeURIComponent(tx.txHash)}`)}
                          style={{cursor:"pointer"}}
                        >
                          <td className="mono num" style={{color:"var(--fg-400)"}}>{tx.txIndex}</td>
                          <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>{_short(tx.txHash, 14)}</td>
                          <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>{_short(tx.from, 13)}</td>
                          <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>
                            {tx.to ? _short(tx.to, 13) : "contract creation"}
                          </td>
                          <td className="mono num" style={{textAlign:"right",color:"var(--fg-100)"}}>
                            {_fmtRawToken(tx.valueLythoshi ?? "0")} LYTH
                          </td>
                          <td className="mono num" style={{textAlign:"right",color:"var(--fg-400)",fontSize:11}}>
                            {_fmt(Number(tx.executionUnitLimit ?? 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {blockTransactions.data.totalTransactions > blockTransactions.data.transactions.length && (
                    <p className="mono" style={{color:"var(--fg-500)",fontSize:11,margin:"8px 0 0"}}>
                      Showing {blockTransactions.data.transactions.length} of {blockTransactions.data.totalTransactions} transactions.
                    </p>
                  )}
                </>
              ) : (
                <p className="mono" style={{color:"var(--fg-500)",fontSize:12,margin:0}}>
                  {blockTransactions.isLoading
                    ? "checking block transactions…"
                    : "No transactions reported for this block."}
                </p>
              )}
            </div>
          )}
          {(liveVertices.length > 0 || verticesAtRound.isLoading || verticesAtRound.isFetched) && (
            <div className="ms-card" style={{padding:"14px 18px",marginBottom:14}}>
              <div className="cap" style={{marginBottom:10,color:"var(--gold)"}}>
                Vertices · lyth_verticesAtRound
              </div>
              {liveVertices.length > 0 ? (
                <table className="ms-table">
                  <thead><tr><th>Author</th><th>Vertex hash</th></tr></thead>
                  <tbody>
                    {liveVertices.map((v:any)=>(
                      <tr key={v.vertexHash}>
                        <td className="mono">operator {Number(v.author).toLocaleString()}</td>
                        <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>{_short(v.vertexHash, 24)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="mono" style={{color:"var(--fg-500)",fontSize:12,margin:0}}>
                  {verticesAtRound.isLoading ? "checking live vertices…" : "No retained vertices reported for this round."}
                </p>
              )}
            </div>
          )}
          <div className="ms-card" style={{padding:0}}>
            <table className="ms-table">
              <thead><tr><th>Cluster</th><th>Txs</th><th>BLS agg</th><th>DAC</th><th></th></tr></thead>
              <tbody>
                {(verts.length ? verts : (MONOSCAN_DATA?.recentVertices || []).slice(0,6)).map((v,i)=>(
                  <tr key={i} onClick={()=>go(`#/cluster/${v.clusterSlot}`)} style={{cursor:"pointer"}}>
                    <td className="mono">C-{String(v.clusterSlot).padStart(3,"0")}</td>
                    <td className="mono">{v.txCount} settled</td>
                    <td className="mono">{v.blsAggMs.toFixed(1)}ms</td>
                    <td><span className={`pill ${v.dac?"ok":"warn"}`}>{v.dac?"committed":"pending"}</span></td>
                    <td className="mono" style={{color:"var(--fg-500)"}}>→</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

/* =====================================================
   SEARCH RESULTS — freeform query, groups matching clusters,
   operators, wallets, and markets.
===================================================== */
const SearchPage = ({ q, go }: any) => {
  const ql = (q || "").toLowerCase();
  const looksLikeHash = /^0x[0-9a-fA-F]{64}$/.test(q || "");
  const looksLikeAddress = /^0x[0-9a-fA-F]{40}$/.test(q || "");
  const looksLikeRound = /^\d+$/.test(q || "");
  const liveBlockByHash = useBlockByHash(looksLikeHash ? q : undefined);
  const liveTx = useTxByHashLive(looksLikeHash ? q : undefined);
  const liveSearch = useSearch(q, 12);
  const liveRichList = useRichList(getLythTokenId(), 30);
  const D: any = MONOSCAN_DATA || {};
  const markets = (MARKETS || []).filter(m =>
    m.sym.toLowerCase().includes(ql) || (m.name||"").toLowerCase().includes(ql)
  );
  const clusters = (D.clusters || []).filter(c =>
    (`C-${String(c.slot).padStart(3,"0")}`).toLowerCase().includes(ql) ||
    (c.name||"").toLowerCase().includes(ql)
  );
  const operators = (D.topOperators || D.operators || []).filter(o =>
    (o.handle||"").toLowerCase().includes(ql) || (o.addrShort||"").toLowerCase().includes(ql)
  );
  const liveHolders = liveRichList.data?.holders ?? [];
  const liveWalletHits = ql
    ? liveHolders
        .filter((h: any) => (h.address || "").toLowerCase().includes(ql))
        .map((h: any) => ({
          addr: h.address as string,
          tag: `live rich list · rank #${h.rank}`,
          source: "live" as const,
        }))
    : [];
  const liveWalletAddrs = new Set(liveWalletHits.map((w) => w.addr.toLowerCase()));
  const fixtureWalletHits = ql
    ? WALLETS
        .filter((w: any) =>
          ((w.addr||"").toLowerCase().includes(ql) || (w.tag||"").toLowerCase().includes(ql))
          && !liveWalletAddrs.has((w.addr || "").toLowerCase()),
        )
        .map((w: any) => ({ addr: w.addr, tag: w.tag, source: "fixture" as const }))
    : [];
  const wallets = [...liveWalletHits, ...fixtureWalletHits];
  const rpcHits = liveSearch.data?.hits ?? [];
  const liveHits = (liveBlockByHash.data ? 1 : 0) + (liveTx.data ? 1 : 0) + (looksLikeAddress ? 1 : 0) + (looksLikeRound ? 1 : 0);
  const total = rpcHits.length + liveHits + markets.length + clusters.length + operators.length + wallets.length;
  const hitRoute = (route: string | null | undefined) => {
    if (!route) return "#/";
    if (route.startsWith("#")) return route;
    return `#${route.startsWith("/") ? route : `/${route}`}`;
  };

  const Section = ({ title, items, render }: any) =>
    items.length === 0 ? null : (
      <div className="ms-card" style={{padding:"14px 18px",marginBottom:14}}>
        <div className="cap" style={{marginBottom:10,color:"var(--gold)"}}>{title} · {items.length}</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {items.slice(0,8).map(render)}
        </div>
      </div>
    );

  return (
    <div className="ms-page">
      <button className="ov-cta ov-cta--ghost" onClick={()=>go("#/")} style={{marginBottom:16}}>← Overview</button>
      <h1 className="ms-h1" style={{marginBottom:6}}>Search · <span style={{color:"var(--gold)"}}>"{q}"</span></h1>
      <p className="mono" style={{color:"var(--fg-400)",marginBottom:20}}>
        {total === 0
          ? liveSearch.isLoading
            ? "Checking live search index…"
            : "No matches. Try a round number, C-NNN cluster id, typed mono1 address, tx hash, or ticker."
          : `${total} result${total===1?"":"s"}`}
      </p>

      {(rpcHits.length > 0 || liveSearch.isLoading) && (
        <div className="ms-card" style={{padding:"14px 18px",marginBottom:14}}>
          <div className="cap" style={{marginBottom:10,color:"var(--gold)"}}>Live search · lyth_search</div>
          {rpcHits.length > 0 ? (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {rpcHits.map((hit:any)=>(
                <div key={`${hit.type}-${hit.id}`} className="ov-moverow" onClick={()=>go(hitRoute(hit.route))}>
                  <span className="mono" style={{color:"var(--gold)",minWidth:100}}>{hit.type}</span>
                  <span className="mono" style={{flex:1}}>{_short(hit.id, 18)}</span>
                  <span style={{color:"var(--fg-400)"}}>{hit.label}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mono" style={{fontSize:11,color:"var(--fg-500)"}}>checking indexed search…</div>
          )}
        </div>
      )}

      {(looksLikeRound || looksLikeAddress || liveBlockByHash.data || liveTx.data || liveBlockByHash.isLoading || liveTx.isLoading) && (
        <div className="ms-card" style={{padding:"14px 18px",marginBottom:14}}>
          <div className="cap" style={{marginBottom:10,color:"var(--gold)"}}>Live lookup</div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {looksLikeRound && (
              <div className="ov-moverow" onClick={()=>go(`#/round/${q}`)}>
                <span className="mono" style={{color:"var(--gold)",minWidth:120}}>round</span>
                <span style={{flex:1}}>Open block/round #{Number(q).toLocaleString()}</span>
              </div>
            )}
            {looksLikeAddress && (
              <div className="ov-moverow" onClick={()=>go(`#/wallet/${encodeURIComponent(q)}`)}>
                <span className="mono" style={{color:"var(--gold)",minWidth:120}}>address</span>
                <span className="mono" style={{flex:1}}>{q}</span>
              </div>
            )}
            {liveTx.data && (
              <div className="ov-moverow" onClick={()=>go(`#/tx/${encodeURIComponent(q)}`)}>
                <span className="mono" style={{color:"var(--gold)",minWidth:120}}>transaction</span>
                <span className="mono" style={{flex:1}}>{q}</span>
              </div>
            )}
            {liveBlockByHash.data && (
              <div className="ov-moverow" onClick={()=>go(`#/round/${Number((liveBlockByHash.data as any).number)}`)}>
                <span className="mono" style={{color:"var(--gold)",minWidth:120}}>block hash</span>
                <span style={{flex:1}}>Block #{Number((liveBlockByHash.data as any).number).toLocaleString()}</span>
              </div>
            )}
            {(liveBlockByHash.isLoading || liveTx.isLoading) && (
              <div className="mono" style={{fontSize:11,color:"var(--fg-500)"}}>checking live RPC…</div>
            )}
          </div>
        </div>
      )}

      <Section title="Markets" items={markets} render={(m)=>(
        <div key={m.sym} className="ov-moverow" onClick={()=>go(`#/market/${m.sym}`)}>
          <span className="mono" style={{color:"var(--gold)",minWidth:70}}>{m.sym}</span>
          <span style={{flex:1}}>{m.name}</span>
          <span className="mono" style={{color:"var(--fg-400)"}}>${m.price?.toFixed?.(3)}</span>
        </div>
      )}/>

      <Section title="Clusters" items={clusters} render={(c)=>(
        <div key={c.slot} className="ov-moverow" onClick={()=>go(`#/cluster/${c.slot}`)}>
          <span className="mono" style={{color:"var(--gold)",minWidth:70}}>C-{String(c.slot).padStart(3,"0")}</span>
          <span style={{flex:1}}>{c.name}</span>
          <span className="mono" style={{color:"var(--fg-400)"}}>{c.members}/{c.size} live</span>
        </div>
      )}/>

      <Section title="Operators" items={operators} render={(o)=>(
        <div key={o.addrShort} className="ov-moverow" onClick={()=>go(`#/operator/${o.addrShort}`)}>
          <span className="mono" style={{color:"var(--gold)",minWidth:120}}>{o.addrShort}</span>
          <span style={{flex:1}}>{o.handle}</span>
        </div>
      )}/>

      <Section title="Wallets" items={wallets} render={(w: any)=>(
        <div key={`${w.source}-${w.addr}`} className="ov-moverow" onClick={()=>go(`#/wallet/${encodeURIComponent(w.addr)}`)}>
          <span className="mono" style={{color:"var(--gold)",minWidth:200,fontSize:11}}>{_short(w.addr, 18)}</span>
          <span style={{flex:1}}>{w.tag || "—"}</span>
          <span className="mono" style={{color:w.source==="live"?"var(--gold)":"var(--fg-500)",fontSize:10}}>{w.source}</span>
        </div>
      )}/>
    </div>
  );
};

type NativeAgentActionSubmit =
  | { state: "idle" }
  | { state: "submitting"; message: string }
  | { state: "success"; message: string; txHash: string | null }
  | { state: "error"; message: string };

const NativeAgentActionsCard = ({
  capabilities,
}: {
  capabilities: CapabilitiesResponse | null | undefined;
}) => {
  const [kind, setKind] = useStateX<NativeAgentActionKind>(NATIVE_AGENT_ACTIONS[0].kind);
  const [values, setValues] = useStateX<Record<string, string>>(() =>
    nativeAgentActionInitialValues(NATIVE_AGENT_ACTIONS[0].kind),
  );
  const [autoNonce, setAutoNonce] = useStateX<string | null>(null);
  const [submit, setSubmit] = useStateX<NativeAgentActionSubmit>({ state: "idle" });
  const action = useMemoX(() => nativeAgentActionDefinition(kind), [kind]);
  const nonceAccount = useMemoX(() => nativeAgentActionNonceAccount(kind, values), [kind, values]);
  const indexedNonceState = useNativeAgentState({
    account: nonceAccount ?? undefined,
    includePolicySpends: false,
    limit: 100,
    enabled: nonceAccount !== null,
  });
  const indexedNonce = useMemoX(
    () => nativeAgentActionIndexedNonce(kind, values, indexedNonceState.data),
    [kind, values, indexedNonceState.data],
  );
  const forwarderAddress = getNativeAgentForwarderAddress(capabilities);
  const forwarderRows = capabilities?.nativeModuleForwarders?.agent ?? [];
  const selectedForwarderLabel = forwarderRows.length > 0
    ? `${forwarderRows.length} capability rows`
    : forwarderAddress
      ? "env fallback"
      : "not configured";

  useEffectX(() => {
    setValues(nativeAgentActionInitialValues(kind));
    setAutoNonce(null);
    setSubmit({ state: "idle" });
  }, [kind]);

  useEffectX(() => {
    if (indexedNonce === null) return;
    if (!Object.prototype.hasOwnProperty.call(values, "nonce")) return;
    const currentNonce = (values.nonce ?? "").trim();
    if (currentNonce !== "" && currentNonce !== "0" && currentNonce !== autoNonce) return;
    setValues((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, "nonce")) return current;
      const nextCurrentNonce = (current.nonce ?? "").trim();
      if (nextCurrentNonce !== "" && nextCurrentNonce !== "0" && nextCurrentNonce !== autoNonce) {
        return current;
      }
      if (current.nonce === indexedNonce) return current;
      return { ...current, nonce: indexedNonce };
    });
    setAutoNonce(indexedNonce);
  }, [indexedNonce, values, autoNonce]);

  const updateValue = (field: NativeAgentActionField, value: string) => {
    if (field.key === "nonce") setAutoNonce(null);
    setValues((current) => ({ ...current, [field.key]: value }));
  };

  const submitAction = async () => {
    try {
      const provider = typeof window !== "undefined" ? window.monolythium : undefined;
      if (!provider?.request) throw new Error("Monolythium wallet provider not detected.");
      setSubmit({ state: "submitting", message: "awaiting wallet" });
      await provider.request({ method: "eth_requestAccounts", params: [] });
      const request = buildNativeAgentActionWalletRequest(kind, values, {
        forwarderContractAddress: forwarderAddress,
        capabilities,
      });
      setSubmit({ state: "submitting", message: "confirming native call" });
      const result = await provider.request(request);
      setSubmit({
        state: "success",
        message: "submitted",
        txHash: _walletTxHash(result),
      });
    } catch (error) {
      setSubmit({
        state: "error",
        message: error instanceof Error ? error.message : "native agent action failed",
      });
    }
  };

  const fieldInput = (field: NativeAgentActionField) => {
    const value = values[field.key] ?? field.defaultValue ?? "";
    if (field.kind === "boolean") {
      return (
        <select
          value={value}
          onChange={(event) => updateValue(field, event.currentTarget.value)}
          style={{width:"100%"}}
        >
          <option value="false">False</option>
          <option value="true">True</option>
        </select>
      );
    }
    if (field.kind === "select") {
      return (
        <select
          value={value}
          onChange={(event) => updateValue(field, event.currentTarget.value)}
          style={{width:"100%"}}
        >
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      );
    }
    return (
      <input
        value={value}
        inputMode={field.kind === "number" || field.kind === "amount" ? "numeric" : "text"}
        onChange={(event) => updateValue(field, event.currentTarget.value)}
        spellCheck={false}
        style={{width:"100%"}}
      />
    );
  };

  return (
    <Card
      title="Native agent actions"
      right={<span className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>monolythium_submitMrvNativeCall</span>}
    >
      <div style={{display:"grid",gridTemplateColumns:"minmax(220px,0.8fr) minmax(0,1.2fr)",gap:14}}>
        <div>
          <label className="mono" style={{display:"block",fontSize:10,color:"var(--fg-500)",marginBottom:6}}>Action</label>
          <select
            value={kind}
            onChange={(event) => setKind(event.currentTarget.value as NativeAgentActionKind)}
            style={{width:"100%"}}
          >
            {NATIVE_AGENT_ACTIONS.map((entry) => (
              <option key={entry.kind} value={entry.kind}>{entry.group} / {entry.label}</option>
            ))}
          </select>
          <div className="tx-kv" style={{marginTop:12}}>
            <KV label="Group" value={action.group}/>
            <KV label="Forwarder" value={selectedForwarderLabel} mono/>
            <KV label="Fallback" value={forwarderAddress ? _short(forwarderAddress, 12) : "—"} mono/>
          </div>
        </div>
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
            {action.fields.map((field) => (
              <label key={field.key} style={{display:"grid",gap:5}}>
                <span className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>{field.label}</span>
                {fieldInput(field)}
              </label>
            ))}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:12,flexWrap:"wrap"}}>
            <button
              className="ov-cta"
              disabled={submit.state === "submitting"}
              onClick={submitAction}
            >
              {submit.state === "submitting" ? submit.message : "Submit"}
            </button>
            {submit.state !== "idle" && (
              <span
                className="mono"
                style={{fontSize:11,color:submit.state === "error" ? "var(--err)" : submit.state === "success" ? "var(--ok)" : "var(--fg-400)"}}
              >
                {submit.state === "success" && submit.txHash
                  ? `${submit.message} ${_short(submit.txHash, 12)}`
                  : submit.message}
              </span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
};

const ProtocolPage = ({ go }: any) => {
  const precompiles = useActivePrecompiles();
  const capabilities = useCapabilities();
  const checkpoint = useLatestCheckpoint();
  const resignations = useClusterResignations(null, "all");
  const feeStats = useFeeStats();
  const encryptionKey = useEncryptionKey();
  const network = useNetworkStatus();
  const operatorCapabilities = useOperatorCapabilities();
  const upgradeStatus = useUpgradeStatus();
  const gapTo = network.data?.blockNumber ?? undefined;
  const gapFrom = gapTo !== undefined ? Math.max(0, gapTo - 64) : undefined;
  const gapRecords = useGapRecords(gapFrom, gapTo);
  const rows = precompiles.data ?? [];
  const capabilityRows = Object.values(capabilities.data?.capabilities ?? {}).filter(Boolean) as any[];
  const registryRows = capabilityRows.length
    ? capabilityRows
    : rows.map((p:any) => ({
        address: p.address,
        capabilityId: p.capabilityId ?? p.id ?? p.name,
        capabilityName: p.capabilityName ?? p.name,
        kind: p.kind ?? (p.gateable ? "gateable" : "non-gateable"),
        active: p.active ?? p.enabled,
        activationHeight: p.activationHeight ?? null,
      }));
  const activeCapabilityCount = capabilityRows.filter((c:any)=>c.active).length;
  const checkpointRows = checkpoint.data ?? [];
  const checkpointHeight = checkpointRows[0]?.blockHeight ?? null;
  const resignationRows = resignations.data?.rows ?? [];
  const recentGaps = gapRecords.data?.gapRecords ?? [];
  const surfaceRows = Object.entries(operatorCapabilities.data?.surfaces ?? {});
  const availableSurfaceCount = surfaceRows.filter(([, cap]: any) => cap.status === "available").length;
  const upgrade = upgradeStatus.data;
  const executionUnitPrice = executionUnitPriceValueLabel(feeStats.data?.gasPrice);
  const feePriceSub = feeStats.data?.gasPriceSource === "lyth_executionUnitPrice"
    ? "native execution-unit quote"
    : feeStats.data?.gasPriceSource === "eth_feeHistory"
    ? "derived from fee history"
    : "live fee endpoint";
  const indexerHeight = network.data?.indexerHeight ?? null;
  const key = encryptionKey.data;
  return (
    <div className="ms-page">
      <button className="ov-cta ov-cta--ghost" onClick={()=>go("#/stats")} style={{marginBottom:16}}>← Statistics</button>
      <h1 className="ms-h1">Protocol status</h1>
      <p className="mono" style={{color:"var(--fg-400)",marginBottom:20}}>
        Live execution fees, capability gates, PQ checkpoint rows, and operator exit ledger from the public testnet RPC.
      </p>
      <section className="stats-counters">
        <StatCounter label="Execution price" value={executionUnitPrice ?? "—"} sub={feePriceSub} tone="neutral"/>
        <StatCounter label="Fee samples" value={`${feeStats.data?.baseFeePerGas.length ?? 0}`} sub={feeStats.data?.oldestBlock ? `oldest ${feeStats.data.oldestBlock}` : "fee history"} tone="neutral"/>
        <StatCounter label="Active precompiles" value={`${rows.filter((p:any)=>p.active ?? p.enabled).length}`} sub={`${rows.length} reported`} tone="neutral"/>
        <StatCounter
          label="Capabilities"
          value={capabilityRows.length ? `${activeCapabilityCount}/${capabilityRows.length}` : "—"}
          sub={capabilities.data ? `sampled at block ${Number(capabilities.data.blockNumber).toLocaleString()}` : "lyth_capabilities"}
          tone="neutral"
        />
        <StatCounter
          label="Operator surfaces"
          value={surfaceRows.length ? `${availableSurfaceCount}/${surfaceRows.length}` : "—"}
          sub={operatorCapabilities.data ? `schema v${operatorCapabilities.data.schemaVersion}` : "lyth_operatorCapabilities"}
          tone="neutral"
        />
        <StatCounter
          label="Upgrade status"
          value={upgrade?.state ?? "—"}
          sub={upgrade ? (upgrade.configured ? `${upgrade.planCount} plans · ${upgrade.pendingCount} pending` : "no plan configured") : "lyth_upgradeStatus"}
          tone="neutral"
        />
        <StatCounter
          label="PQ checkpoint"
          value={checkpointHeight !== null && checkpointHeight !== undefined ? `#${Number(checkpointHeight).toLocaleString()}` : "—"}
          sub={checkpointRows.length ? `${checkpointRows.length} operator signature rows` : "lyth_getLatestCheckpoint"}
          tone="neutral"
        />
        <StatCounter
          label="Operator exits"
          value={`${resignationRows.length}`}
          sub={resignations.data ? "cluster resignation ledger" : "lyth_getClusterResignations"}
          tone="neutral"
        />
        <StatCounter
          label="Gap windows"
          value={`${recentGaps.length}`}
          sub={gapRecords.data ? `last ${Number(gapRecords.data.range.fromBlock).toLocaleString()}-${Number(gapRecords.data.range.toBlock).toLocaleString()}` : "lyth_gapRecords"}
          tone="neutral"
        />
        <StatCounter
          label="Indexer"
          value={indexerHeight !== null ? `#${indexerHeight.toLocaleString()}` : network.data ? "off" : "—"}
          sub={indexerHeight !== null ? "lyth_indexerStatus" : "disabled or not reporting"}
          tone="neutral"
        />
        <StatCounter label="Encryption epoch" value={key ? `${Number(key.epoch).toLocaleString()}` : "—"} sub={key?.algo ?? "lyth_getEncryptionKey"} tone="neutral"/>
      </section>
      {key && (
        <Card title="Live encryption key">
          <div className="tx-kv">
            <KV label="Algorithm" value={key.algo}/>
            <KV label="Epoch" value={Number(key.epoch).toLocaleString()} mono/>
            <KV label="Encapsulation key" value={_short(key.encapsulationKey, 28)} mono/>
          </div>
        </Card>
      )}
      <NativeAgentActionsCard capabilities={capabilities.data}/>
      <section className="tx-split">
        <Card title="Operator surfaces">
          {surfaceRows.length ? (
            <table className="ms-table">
              <thead><tr><th>Surface</th><th>Status</th><th>Tracking</th></tr></thead>
              <tbody>
                {surfaceRows.map(([surface, cap]: any) => (
                  <tr key={surface}>
                    <td className="mono">{surface}</td>
                    <td><span className={`pill ${cap.status === "available" ? "ok" : "warn"}`}>{cap.status}</span></td>
                    <td className="mono" style={{fontSize:11,color:"var(--fg-400)"}}>{cap.tracking ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mono" style={{color:"var(--fg-500)",fontSize:12,margin:0}}>
              {operatorCapabilities.isLoading ? "checking operator capability surfaces…" : "operator capability surface is not reporting on this peer"}
            </p>
          )}
        </Card>
        <Card title="Upgrade readiness">
          {upgrade ? (
            <div className="tx-kv">
              <KV label="State" value={upgrade.state} mono/>
              <KV label="Configured" value={upgrade.configured ? "yes" : "no"}/>
              <KV label="Sample block" value={`#${upgrade.blockNumber.toLocaleString()}`} mono/>
              <KV label="Chain" value={`${upgrade.chainId}`} mono/>
              <KV label="Plan count" value={`${upgrade.planCount}`} mono/>
              <KV label="Pending" value={`${upgrade.pendingCount}`} mono/>
              <KV
                label="Active plan"
                value={upgrade.active ? `${upgrade.active.upgradeId} · activates #${upgrade.active.activationHeight.toLocaleString()}` : "—"}
                mono
              />
              <KV
                label="Next pending"
                value={upgrade.pending[0] ? `${upgrade.pending[0].upgradeId} · ${upgrade.pending[0].requiredBinaryVersion}` : "—"}
                mono
              />
            </div>
          ) : (
            <p className="mono" style={{color:"var(--fg-500)",fontSize:12,margin:0}}>
              {upgradeStatus.isLoading ? "checking upgrade state…" : "upgrade status is not reporting on this peer"}
            </p>
          )}
        </Card>
      </section>
      <Card title="Latest PQ finality checkpoint">
        {checkpointRows.length ? (
          <table className="ms-table">
            <thead><tr><th>Block</th><th>State root</th><th>Operator key</th><th>Signature</th></tr></thead>
            <tbody>
              {checkpointRows.map((row:any, i:number)=>(
                <tr key={`${row.signerPubkeyHex ?? row.signer_pubkey_hex}-${i}`}>
                  <td className="mono">{Number(row.blockHeight ?? row.block_height).toLocaleString()}</td>
                  <td className="mono" style={{fontSize:11,color:"var(--fg-400)"}}>{_short(row.stateRoot ?? row.state_root, 18)}</td>
                  <td className="mono" style={{fontSize:11,color:"var(--fg-400)"}}>{_short(row.signerPubkeyHex ?? row.signer_pubkey_hex, 18)}</td>
                  <td className="mono" style={{fontSize:11,color:"var(--fg-400)"}}>{_short(row.signatureHex ?? row.signature_hex, 18)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mono" style={{color:"var(--fg-500)",fontSize:12,margin:0}}>
            {checkpoint.isLoading ? "checking live checkpoint rows…" : "RPC returned no checkpoint rows; checkpoint persistence is not live on this peer yet"}
          </p>
        )}
      </Card>
      <Card title="Capability registry">
        <table className="ms-table">
          <thead><tr><th>Capability</th><th>Address</th><th>Kind</th><th>Activation</th><th>Status</th></tr></thead>
          <tbody>
            {registryRows.map((p:any)=>(
              <tr key={p.address ?? p.capabilityId}>
                <td style={{fontWeight:500}}>{p.capabilityName ?? p.name}</td>
                <td className="mono" style={{fontSize:11,color:"var(--fg-400)"}}>{p.address}</td>
                <td className="mono" style={{fontSize:11,color:"var(--fg-400)"}}>{p.kind ?? "—"}</td>
                <td className="mono" style={{fontSize:11,color:"var(--fg-400)"}}>
                  {p.activationHeight !== null && p.activationHeight !== undefined ? Number(p.activationHeight).toLocaleString() : "genesis"}
                </td>
                <td><span className={`pill ${(p.active ?? p.enabled) ? "ok" : "warn"}`}>{(p.active ?? p.enabled) ? "active" : "disabled"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Recent gap records">
        {recentGaps.length ? (
          <table className="ms-table">
            <thead><tr><th>Blocks</th><th style={{textAlign:"right"}}>Count</th><th style={{textAlign:"right"}}>Duration</th><th>Reason</th></tr></thead>
            <tbody>
              {recentGaps.map((row:any)=>(
                <tr key={`${row.startBlock}-${row.endBlock}`}>
                  <td className="mono">{Number(row.startBlock).toLocaleString()} → {Number(row.endBlock).toLocaleString()}</td>
                  <td className="mono num" style={{textAlign:"right"}}>{Number(row.blockCount).toLocaleString()}</td>
                  <td className="mono num" style={{textAlign:"right"}}>{Number(row.durationSeconds).toLocaleString()}s</td>
                  <td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mono" style={{color:"var(--fg-500)",fontSize:12,margin:0}}>
            {gapRecords.isLoading ? "checking recent block window…" : "No gaps reported in the most recent sampled block window."}
          </p>
        )}
      </Card>
      <Card title="Operator exit ledger">
        {resignationRows.length ? (
          <table className="ms-table">
            <thead><tr><th>Operator key</th><th>Status</th><th>Submitted</th><th>Effective</th><th>Nonce</th></tr></thead>
            <tbody>
              {resignationRows.map((row:any, i:number)=>(
                <tr key={`${row.operator}-${row.nonce}-${i}`}>
                  <td className="mono" style={{fontSize:11,color:"var(--fg-400)"}}>{_short(row.operator, 18)}</td>
                  <td><span className={`pill ${row.status === "applied" ? "ok" : "warn"}`}>{row.status}</span></td>
                  <td className="mono">{row.submitted_at_height !== undefined ? Number(row.submitted_at_height).toLocaleString() : "—"}</td>
                  <td className="mono">{row.effective_at_height !== undefined ? Number(row.effective_at_height).toLocaleString() : "—"}</td>
                  <td className="mono">{Number(row.nonce).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mono" style={{color:"var(--fg-500)",fontSize:12,margin:0}}>
            {resignations.isLoading ? "checking exit ledger…" : "no operator exits reported by this peer"}
          </p>
        )}
      </Card>
    </div>
  );
};

const tagFor = (addr) => {
  const w = WALLETS && WALLETS.find(w => w.addr === addr);
  return w?.tag || null;
};

/**
 * Render an address label live (via lyth_getAddressLabel) with a fixture
 * fallback. Returns plain text — wrap in the caller's preferred element.
 */
const LiveAddressLabel = ({ addr, fallback }: { addr: string | null | undefined; fallback?: string | null }) => {
  const label = useAddressLabel(addr || undefined);
  const live = label.data;
  const liveText = live?.displayName ?? (live?.category ? live.category : null);
  return <>{liveText ?? fallback ?? "unlabeled"}</>;
};


/* Named exports — replaces the legacy window-attach pattern. */
export { StatsPage, WalletsPage, WalletPage, TransactionsPage, TxPage, RoundPage, SearchPage, ProtocolPage, BridgeTrustDisclosuresCard, NativeAgentActionsCard, NativeAgentStateCard };
