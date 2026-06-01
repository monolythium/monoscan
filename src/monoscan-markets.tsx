/* =====================================================
   Monoscan · MARKETS
   On-chain CLOB markets, each with a trading detail page
   (chart + side panel + trades table). When a node is
   reachable (liveChain) every surface renders live CLOB
   data or an honest empty state; the seeded fixture rows
   (Top-100, SuiVision-style demo) render only in the
   offline design preview when no node is reachable.
   ===================================================== */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect, useMemo } from "react";
import {
  addressToTypedBech32,
  buildNativeNftBuyListingForwarderInput,
  buildNativeNftCancelListingForwarderInput,
  buildNativeNftCreateListingForwarderInput,
  buildNativeNftPlaceAuctionBidForwarderInput,
  buildNativeNftSettleAuctionForwarderInput,
  buildNativeNftSweepExpiredListingsForwarderInput,
  buildNativeSpotLimitOrderForwarderInput,
  type CapabilitiesResponse,
  type NativeNftAssetStandard,
  type NativeNftListingKind,
  type SpotLimitOrderSide,
} from "@monolythium/core-sdk";
import { fmtAddr, fmtAddrShort, fmtHashShort } from "./sdk/format";
import { MARKETS } from "./data/fallback";
import {
  fetchNativeMarketState,
  nativeMarketEventRows,
  nativeMarketStateRows,
  type NativeMarketEventDisplayRow,
  type NativeMarketStateDisplayRow,
  useChainHead,
  useClobMarket,
  useClobMarkets,
  useClobOhlc,
  useClobTrades,
  useCapabilities,
  useIndexerAvailability,
  useNativeMarketEvents,
  useClobOrderBook,
  useNativeMarketOrderBook,
  useNativeMarketState,
} from "./data/hooks";
import {
  getApiBaseUrl,
  getMarketIdForSymbol,
  getNativeMarketForwarderAddress,
  normalizeNativeForwarderContractAddress,
} from "./sdk/client";

/* ----- formatters ----- */
const mkFmt = (n: any, dp?: any) => {
  if (n == null) return "—";
  const d = dp != null ? dp : n < 1 ? 6 : n < 100 ? 3 : 2;
  return n.toLocaleString(undefined, { minimumFractionDigits:d, maximumFractionDigits:d });
};
const mkMoney = (n: any) => n < 1 ? `$${n.toFixed(4)}` : n < 100 ? `$${n.toFixed(3)}` : `$${n.toLocaleString(undefined,{maximumFractionDigits:2})}`;
const mkUsd   = (n: any) => n>=1e9 ? `$${(n/1e9).toFixed(2)}B` : n>=1e6 ? `$${(n/1e6).toFixed(2)}M` : n>=1e3 ? `$${(n/1e3).toFixed(2)}K` : `$${n.toFixed(0)}`;
const mkNum   = (n: any) => n>=1e9 ? `${(n/1e9).toFixed(2)}B` : n>=1e6 ? `${(n/1e6).toFixed(2)}M` : n>=1e3 ? `${(n/1e3).toFixed(2)}K` : `${n.toFixed(0)}`;
const mkAgo   = (ts: any) => { const s = (Date.now()-ts)/1000; if (s<60) return `${s|0}s ago`; if (s<3600) return `${(s/60)|0}m ago`; if (s<86400) return `${(s/3600)|0}h ago`; return `${(s/86400)|0}d ago`; };
const mkDec = (value: any, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const _shortMarketId = (id: string) => `${id.slice(0, 10)}…${id.slice(-6)}`;

/**
 * Derive a short, human-readable label for a market's quote asset so a bare
 * on-chain quote-tick integer can be shown with the unit it is denominated in.
 * The chain has no ticker registry, so for an unnamed quote we fall back to a
 * truncated asset id ("quote 0xab…12") or a neutral "quote" placeholder.
 *
 * TODO(core-sdk): no quote-decimals / quote-symbol metadata on lyth_clobMarket —
 * once exposed, render the symbol and scale values by the quote token decimals.
 */
export const quoteUnitLabel = (quoteAssetId?: string | null): string =>
  quoteAssetId ? `quote ${_shortMarketId(quoteAssetId)}` : "quote";

/**
 * Shared quote-unit formatter for LIVE markets. Renders a numeric value in the
 * market's quote-asset terms WITHOUT a fiat "$" prefix — there is no USD oracle
 * and no decimal scaling on-chain, so the raw CLOB tick/lot integer is the
 * truth. Appends the quote-asset label when one is known. Use this everywhere a
 * live price / order-book level / trade value is shown; reserve mkMoney/mkUsd
 * for the offline (non-live) fixture preview path only.
 *
 * TODO(core-sdk): no USD price oracle and no quote-decimal metadata on CLOB
 * markets — live values are quote-tick/lot integers, never real fiat.
 */
export const mkQuote = (n: any, quoteAssetId?: string | null, dp?: any) => {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const unit = quoteUnitLabel(quoteAssetId);
  return `${mkFmt(Number(n), dp)} ${unit}`;
};

/**
 * Write `text` to the clipboard and flash a "copied" pill for one second.
 * Renders a no-op span when the browser does not expose navigator.clipboard.
 */
const CopyToClipboard = ({ text, title }: { text: string | null | undefined; title: string }) => {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  const onClick = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1000);
    } catch {
      // Browsers may refuse without a user gesture context; surface nothing.
    }
  };
  return (
    <span
      role="button"
      onClick={onClick}
      title={title}
      style={{cursor:"pointer",color:copied ? "var(--gold)" : "var(--fg-300)"}}
    >
      {copied ? "copied" : "⎘"}
    </span>
  );
};

/**
 * Anchor that opens the live indexer URL for the current market in a new
 * tab. Hidden when no API base or no live market id is available.
 */
const TryApiLink = ({ marketId }: { marketId: string | null | undefined }) => {
  if (!marketId) return null;
  const base = getApiBaseUrl();
  if (!base) return null;
  const href = `${base.replace(/\/+$/, "")}/markets/${encodeURIComponent(marketId)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      style={{cursor:"pointer",color:"var(--fg-300)",textDecoration:"none"}}
      title={href}
    >
      Try API ↗
    </a>
  );
};
const _shortAddr = (id: string, head = 8, tail = 4) =>
  id && id.length > head + tail + 3 ? `${id.slice(0, head)}…${id.slice(-tail)}` : id;
const _shortHash = (id: string | null | undefined, head = 10, tail = 6) =>
  id ? _shortAddr(id, head, tail) : "—";
const _marketRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const _marketString = (row: Record<string, unknown> | null, keys: string[]): string | null => {
  if (!row) return null;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    if (typeof value === "bigint") return value.toString();
  }
  return null;
};
const _marketNumber = (row: Record<string, unknown> | null, keys: string[], fallback = 0): number => {
  const value = _marketString(row, keys);
  if (value === null) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const _marketEventLabel = (eventName: string | null | undefined): string => {
  if (!eventName) return "Native market event";
  const label = eventName.replace(/^market\./, "");
  return label
    .split(/[._-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};
const MARKET_EVENT_FIELD_ORDER = [
  "side",
  "quantity",
  "amount",
  "price",
  "remaining",
  "status",
  "nonce",
  "account",
  "counterparty",
  "tick_size",
  "lot_size",
  "min_quantity",
  "min_notional",
  "expires_at_block",
  "market_surface",
];
const MARKET_EVENT_FIELD_LABELS: Record<string, string> = {
  expires_at_block: "expires",
  lot_size: "lot",
  market_surface: "surface",
  min_notional: "min notional",
  min_quantity: "min qty",
  quantity: "qty",
  tick_size: "tick",
};
const MARKET_EVENT_FIELD_HIDDEN = new Set([
  "accuracy_score",
  "category_id",
  "communication_score",
  "market_asset_id",
  "market_order_id",
  "market_related_asset_id",
  "market_related_order_id",
  "payload_hash",
  "primary_id",
  "quality_score",
  "related_id",
  "speed_score",
  "token_id",
]);
const _marketEventFieldValue = (key: string, value: string) => {
  if (key === "account" || key === "counterparty" || key === "owner" || key === "seller" || key === "buyer") {
    return fmtAddrShort(value, "user", 9, 5);
  }
  if (/(^|_)id$/.test(key) || key.endsWith("_hash")) return _shortHash(value, 9, 5);
  return value;
};
export function nativeMarketEventFieldSummary(
  event: Pick<NativeMarketEventDisplayRow, "decodedFields">,
  limit = 6,
): Array<{ key: string; label: string; value: string }> {
  return event.decodedFields
    .filter(([key, value]) => value !== "—" && !MARKET_EVENT_FIELD_HIDDEN.has(key))
    .sort(([a], [b]) => {
      const ai = MARKET_EVENT_FIELD_ORDER.indexOf(a);
      const bi = MARKET_EVENT_FIELD_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    })
    .slice(0, limit)
    .map(([key, value]) => ({
      key,
      label: MARKET_EVENT_FIELD_LABELS[key] ?? key.replace(/_/g, " "),
      value: _marketEventFieldValue(key, value),
    }));
}
const _nativeEventField = (event: Pick<NativeMarketEventDisplayRow, "decodedFields">, keys: readonly string[]) => {
  const wanted = new Set(keys);
  return event.decodedFields.find(([key]) => wanted.has(key))?.[1] ?? null;
};
export function nativeTradeRowsFromMarketEvents(
  events: readonly NativeMarketEventDisplayRow[],
  options: { fallbackPrice?: number | null; symbol?: string | null } = {},
) {
  const fallbackPrice = typeof options.fallbackPrice === "number" && Number.isFinite(options.fallbackPrice)
    ? options.fallbackPrice
    : 0;
  return events
    .filter((event) => {
      const name = event.eventName?.toLowerCase() ?? "";
      return name.includes("order_settled") || name.includes("trade") || name.includes("fill");
    })
    .map((event, i) => {
      const priceField = _nativeEventField(event, ["price", "price_lythoshi", "quote_price"]);
      const px = priceField === null ? fallbackPrice : mkDec(priceField, fallbackPrice);
      const sz = mkDec(_nativeEventField(event, ["quantity", "amount", "base_amount"]), 0);
      const maker = event.account ? fmtAddrShort(event.account, "user", 7, 4) : "—";
      const taker = event.counterparty ? fmtAddrShort(event.counterparty, "user", 7, 4) : maker;
      return {
        t: 0,
        live: true,
        side: "fill",
        px,
        sz,
        value: px * sz,
        maker,
        taker,
        venue: "native",
        round: event.blockHeight ?? 0,
        attest: "indexed",
        txIndex: event.txIndex ?? 0,
        logIndex: event.logIndex,
        key: `native-${event.blockHeight ?? 0}-${event.txIndex ?? 0}-${event.logIndex}-${i}`,
      };
    })
    .filter((row) => row.px > 0 || row.sz > 0);
}
export function liveMarketRowsFromNativeState(
  spotMarkets: readonly unknown[],
  fallbackMarkets: readonly any[] = [],
) {
  return spotMarkets
    .map((raw, i) => {
      const row = _marketRecord(raw);
      const marketId = _marketString(row, ["marketId", "market_id", "id"]);
      if (!marketId) return null;
      const fallback = fallbackMarkets.find((m: any) => getMarketIdForSymbol(m.sym) === marketId);
      const price = _marketNumber(row, ["lastPrice", "last_price", "price", "priceLythoshi", "price_lythoshi"], 0);
      const baseVolume = _marketNumber(row, ["totalVolumeBase", "total_volume_base", "volumeBase", "volume_base", "amount"], 0);
      const tradeCount = _marketNumber(row, ["tradeCount", "trade_count", "trades"], 0);
      const lastBlockHeight = _marketNumber(row, ["lastBlockHeight", "last_block_height", "updatedAtBlock", "updated_at_block", "createdAtBlock", "created_at_block"], 0);
      const createdAtBlock = _marketNumber(row, ["createdAtBlock", "created_at_block", "registeredAtBlock", "registered_at_block"], 0);
      const updatedAtBlock = _marketNumber(row, ["updatedAtBlock", "updated_at_block", "lastBlockHeight", "last_block_height"], lastBlockHeight);
      const tickSize = _marketNumber(row, ["tickSize", "tick_size"], 1);
      const lotSize = _marketNumber(row, ["lotSize", "lot_size"], 1);
      const minQuantity = _marketNumber(row, ["minQuantity", "min_quantity"], 0);
      const minNotional = _marketNumber(row, ["minNotional", "min_notional"], 0);
      const baseAssetId = _marketString(row, ["baseAssetId", "base_asset_id", "baseAsset", "base_asset"]);
      const quoteAssetId = _marketString(row, ["quoteAssetId", "quote_asset_id", "quoteAsset", "quote_asset"]);
      const owner = _marketString(row, ["owner", "account"]);
      return {
        rank: i + 1,
        sym: fallback?.sym ?? `CLOB-${i + 1}`,
        name: fallback?.name ?? `CLOB ${_shortMarketId(marketId)}`,
        kind: fallback?.kind ?? "native",
        price,
        chg24h: 0,
        sparkline: [price || 0, price || 0],
        tick: tickSize,
        // Base volume only. price*baseVolume multiplies two unscaled integers
        // (tick-int * lot-int) and is NOT a real quote notional, so we do not
        // present it as one — the list shows base units with the base label.
        // TODO(core-sdk): no quote-notional traded-volume aggregate endpoint.
        vol24h: baseVolume,
        liquidity: 0,
        mcap: 0,
        holders: 0,
        // Nothing verifies a permissionless live CLOB market — no listing
        // authority exists. The honest source pill carries provenance instead.
        verified: false,
        trades: lastBlockHeight > 0 ? [{ round: lastBlockHeight }] : [],
        marketId,
        tradeCount,
        totalVolumeBase: baseVolume,
        baseAssetId,
        quoteAssetId,
        owner,
        tickSize,
        lotSize,
        minQuantity,
        minNotional,
        createdAtBlock,
        updatedAtBlock,
        lastBlockHeight,
        hasFallback: false,
        live: true,
        source: "native_market_state",
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
}
const _positiveIntegerText = (value: unknown, fallback: string): string => {
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return String(Math.trunc(value));
  if (typeof value === "bigint" && value > 0n) return value.toString(10);
  return fallback;
};
const _decimalNonceValue = (value: string | null | undefined): bigint | null => {
  const text = value?.trim();
  if (!text || !/^(0|[1-9]\d*)$/.test(text)) return null;
  return BigInt(text);
};
const NATIVE_MARKET_FORWARDER_MAX_CYCLES = "22000";
const NATIVE_MARKET_MRV_EXECUTION_UNIT_LIMIT_HEX = "0x200000";
const _cumLevels = (rows: Array<{ price: string; size: string }>) => {
  let total = 0;
  return rows.map((row) => {
    const px = mkDec(row.price);
    const sz = mkDec(row.size);
    total += sz;
    return { px, sz, total };
  });
};

export function ownerStateAccount(ownerAddress: string | null | undefined): string | null {
  const trimmed = ownerAddress?.trim();
  if (!trimmed) return null;
  try {
    return addressToTypedBech32("user", trimmed);
  } catch {
    return trimmed;
  }
}

function _ownerAccountCandidates(ownerAddress: string | null | undefined): Set<string> {
  const candidates = new Set<string>();
  const trimmed = ownerAddress?.trim();
  if (!trimmed) return candidates;
  candidates.add(trimmed.toLowerCase());
  try {
    candidates.add(addressToTypedBech32("user", trimmed).toLowerCase());
  } catch {
    // Already-typed wallet accounts are still matched through the raw candidate.
  }
  return candidates;
}

export function nextSpotOrderNonceForOwner(
  rows: Array<Pick<NativeMarketStateDisplayRow, "account" | "nonce">>,
  ownerAddress: string | null | undefined,
): string | null {
  return _nextNonceForAccount(rows, ownerAddress);
}

export function nextNftListingNonceForSeller(
  rows: Array<Pick<NativeMarketStateDisplayRow, "account" | "nonce">>,
  sellerAddress: string | null | undefined,
): string | null {
  // NFT listing rows use the generic display-row nonce once the node exposes seller-local listing nonces.
  return _nextNonceForAccount(rows, sellerAddress);
}

function _nextNonceForAccount(
  rows: Array<Pick<NativeMarketStateDisplayRow, "account" | "nonce">>,
  ownerAddress: string | null | undefined,
): string | null {
  const candidates = _ownerAccountCandidates(ownerAddress);
  if (candidates.size === 0) return null;

  let maxNonce: bigint | null = null;
  for (const row of rows) {
    const account = row.account?.trim().toLowerCase();
    if (!account || !candidates.has(account)) continue;
    const nonce = _decimalNonceValue(row.nonce);
    if (nonce === null) continue;
    if (maxNonce === null || nonce > maxNonce) maxNonce = nonce;
  }
  return maxNonce === null ? null : (maxNonce + 1n).toString(10);
}

export interface MarketOrderNonceResolution {
  nonce: string;
  source: "indexed" | "fallback";
  ownerAccount: string | null;
}

export interface NftListingNonceResolution {
  nonce: string;
  source: "indexed" | "fallback";
  sellerAccount: string | null;
}

async function resolveMarketOrderNonce(args: {
  ownerAddress: string;
  fallbackNonce: string;
  spotOrders: NativeMarketStateDisplayRow[];
}): Promise<MarketOrderNonceResolution> {
  const ownerAccount = ownerStateAccount(args.ownerAddress);
  const ownerState = ownerAccount ? await fetchNativeMarketState({ account: ownerAccount }) : null;
  const ownerRows = nativeMarketStateRows(ownerState).spotOrders;
  const indexedNonce = nextSpotOrderNonceForOwner(
    [...ownerRows, ...args.spotOrders],
    args.ownerAddress,
  );
  if (indexedNonce !== null) {
    return { nonce: indexedNonce, source: "indexed", ownerAccount };
  }
  return {
    nonce: args.fallbackNonce.trim() || "0",
    source: "fallback",
    ownerAccount,
  };
}

async function resolveNftListingNonce(args: {
  sellerAddress: string;
  fallbackNonce: string;
  nftListings: NativeMarketStateDisplayRow[];
}): Promise<NftListingNonceResolution> {
  const sellerAccount = ownerStateAccount(args.sellerAddress);
  const sellerState = sellerAccount ? await fetchNativeMarketState({ account: sellerAccount }) : null;
  const sellerRows = nativeMarketStateRows(sellerState).nftListings;
  const indexedNonce = nextNftListingNonceForSeller(
    [...sellerRows, ...args.nftListings],
    args.sellerAddress,
  );
  if (indexedNonce !== null) {
    return { nonce: indexedNonce, source: "indexed", sellerAccount };
  }
  return {
    nonce: args.fallbackNonce.trim() || "0",
    source: "fallback",
    sellerAccount,
  };
}

export interface MarketOrderWalletRequestArgs {
  marketId: string | null | undefined;
  baseTokenId: string | null | undefined;
  quoteTokenId: string | null | undefined;
  ownerAddress: string | null | undefined;
  orderNonce: string | number | bigint;
  forwarderContractAddress: string | null | undefined;
  capabilities?: CapabilitiesResponse | null;
  side: SpotLimitOrderSide;
  price: string;
  quantity: string;
  expiryBlock?: string | number | bigint;
  maxCycles?: string | number | bigint;
  executionUnitLimitHex?: string;
}

export interface MarketOrderWalletRequest {
  method: "monolythium_submitMrvNativeCall";
  params: [{
    contractAddress: string;
    input: string;
    executionUnitLimitHex: string;
    valueWeiHex: "0x0";
  }];
}

export interface NftListingBuyWalletRequestArgs {
  listingId: string | null | undefined;
  buyerAddress: string | null | undefined;
  currentBlock: string | number | bigint | null | undefined;
  forwarderContractAddress: string | null | undefined;
  capabilities?: CapabilitiesResponse | null;
  maxCycles?: string | number | bigint;
  executionUnitLimitHex?: string;
}

export interface NftListingBuyWalletRequest {
  method: "monolythium_submitMrvNativeCall";
  params: [{
    contractAddress: string;
    input: string;
    executionUnitLimitHex: string;
    valueWeiHex: "0x0";
  }];
}

export interface NftListingCreateWalletRequestArgs {
  sellerAddress: string | null | undefined;
  listingNonce: string | number | bigint;
  standard: NativeNftAssetStandard;
  collectionId: string | null | undefined;
  tokenId: string | null | undefined;
  quantity: string;
  paymentAsset: string | null | undefined;
  price: string;
  kind?: NativeNftListingKind;
  expiresAtBlock: string | number | bigint;
  forwarderContractAddress: string | null | undefined;
  capabilities?: CapabilitiesResponse | null;
  maxCycles?: string | number | bigint;
  executionUnitLimitHex?: string;
}

export interface NftListingCancelWalletRequestArgs {
  listingId: string | null | undefined;
  callerAddress: string | null | undefined;
  forwarderContractAddress: string | null | undefined;
  capabilities?: CapabilitiesResponse | null;
  maxCycles?: string | number | bigint;
  executionUnitLimitHex?: string;
}

export interface NftAuctionBidWalletRequestArgs {
  listingId: string | null | undefined;
  bidderAddress: string | null | undefined;
  amount: string;
  currentBlock: string | number | bigint | null | undefined;
  forwarderContractAddress: string | null | undefined;
  capabilities?: CapabilitiesResponse | null;
  maxCycles?: string | number | bigint;
  executionUnitLimitHex?: string;
}

export interface NftAuctionSettleWalletRequestArgs {
  listingId: string | null | undefined;
  currentBlock: string | number | bigint | null | undefined;
  forwarderContractAddress: string | null | undefined;
  capabilities?: CapabilitiesResponse | null;
  maxCycles?: string | number | bigint;
  executionUnitLimitHex?: string;
}

export interface NftListingSweepWalletRequestArgs {
  listingIds: readonly string[];
  currentBlock: string | number | bigint | null | undefined;
  forwarderContractAddress: string | null | undefined;
  capabilities?: CapabilitiesResponse | null;
  maxCycles?: string | number | bigint;
  executionUnitLimitHex?: string;
}

export interface NftListingActionWalletRequest {
  method: "monolythium_submitMrvNativeCall";
  params: [{
    contractAddress: string;
    input: string;
    executionUnitLimitHex: string;
    valueWeiHex: "0x0";
  }];
}

function _resolveNativeMarketForwarderAddress(
  capabilities: CapabilitiesResponse | null | undefined,
  requestBytes: number,
  fallbackAddress: string | null | undefined,
): string {
  const resolved = getNativeMarketForwarderAddress(capabilities, requestBytes);
  if (resolved) return resolved;
  if ((capabilities?.nativeModuleForwarders?.market ?? []).length > 0) {
    throw new Error(`MRV native market forwarder for ${requestBytes} request bytes is not configured.`);
  }
  const fallback = normalizeNativeForwarderContractAddress(fallbackAddress);
  if (fallback) return fallback;
  throw new Error("MRV native market forwarder address is not configured.");
}

export function buildMarketOrderWalletRequest(args: MarketOrderWalletRequestArgs): MarketOrderWalletRequest {
  if (!args.marketId) {
    throw new Error("Live native market id is required before placing an order.");
  }
  const owner = args.ownerAddress?.trim();
  if (!owner) {
    throw new Error("Wallet account is required before placing an order.");
  }
  const forwarderInput = buildNativeSpotLimitOrderForwarderInput({
    marketId: args.marketId,
    owner,
    nonce: args.orderNonce,
    side: args.side,
    price: args.price.trim(),
    quantity: args.quantity.trim(),
    expiresAtBlock: args.expiryBlock ?? 0,
  }, args.maxCycles ?? NATIVE_MARKET_FORWARDER_MAX_CYCLES);
  const forwarder = _resolveNativeMarketForwarderAddress(
    args.capabilities,
    forwarderInput.requestBytes,
    args.forwarderContractAddress,
  );
  return {
    method: "monolythium_submitMrvNativeCall",
    params: [{
      contractAddress: forwarder,
      input: forwarderInput.input,
      executionUnitLimitHex:
        args.executionUnitLimitHex ?? NATIVE_MARKET_MRV_EXECUTION_UNIT_LIMIT_HEX,
      valueWeiHex: "0x0",
    }],
  };
}

export function buildNftListingBuyWalletRequest(
  args: NftListingBuyWalletRequestArgs,
): NftListingBuyWalletRequest {
  const listingId = args.listingId?.trim();
  if (!listingId) {
    throw new Error("Native NFT listing id is required before buying a listing.");
  }
  const buyer = args.buyerAddress?.trim();
  if (!buyer) {
    throw new Error("Wallet account is required before buying a listing.");
  }
  if (args.currentBlock === null || args.currentBlock === undefined) {
    throw new Error("Live chain head is required before buying a listing.");
  }
  const forwarderInput = buildNativeNftBuyListingForwarderInput({
    listingId,
    buyer,
    currentBlock: args.currentBlock,
  }, args.maxCycles ?? NATIVE_MARKET_FORWARDER_MAX_CYCLES);
  const forwarder = _resolveNativeMarketForwarderAddress(
    args.capabilities,
    forwarderInput.requestBytes,
    args.forwarderContractAddress,
  );
  return {
    method: "monolythium_submitMrvNativeCall",
    params: [{
      contractAddress: forwarder,
      input: forwarderInput.input,
      executionUnitLimitHex:
        args.executionUnitLimitHex ?? NATIVE_MARKET_MRV_EXECUTION_UNIT_LIMIT_HEX,
      valueWeiHex: "0x0",
    }],
  };
}

export function buildNftListingCreateWalletRequest(
  args: NftListingCreateWalletRequestArgs,
): NftListingActionWalletRequest {
  const seller = args.sellerAddress?.trim();
  if (!seller) {
    throw new Error("Wallet account is required before creating a listing.");
  }
  const collectionId = args.collectionId?.trim();
  if (!collectionId) {
    throw new Error("Collection id is required before creating a listing.");
  }
  const tokenId = args.tokenId?.trim();
  if (!tokenId) {
    throw new Error("Token id is required before creating a listing.");
  }
  const paymentAsset = args.paymentAsset?.trim();
  if (!paymentAsset) {
    throw new Error("Payment asset id is required before creating a listing.");
  }
  const forwarderInput = buildNativeNftCreateListingForwarderInput({
    seller,
    nonce: args.listingNonce,
    standard: args.standard,
    collectionId,
    tokenId,
    quantity: args.quantity.trim(),
    paymentAsset,
    price: args.price.trim(),
    kind: args.kind ?? "fixed-price",
    expiresAtBlock: args.expiresAtBlock,
  }, args.maxCycles ?? NATIVE_MARKET_FORWARDER_MAX_CYCLES);
  const forwarder = _resolveNativeMarketForwarderAddress(
    args.capabilities,
    forwarderInput.requestBytes,
    args.forwarderContractAddress,
  );
  return {
    method: "monolythium_submitMrvNativeCall",
    params: [{
      contractAddress: forwarder,
      input: forwarderInput.input,
      executionUnitLimitHex:
        args.executionUnitLimitHex ?? NATIVE_MARKET_MRV_EXECUTION_UNIT_LIMIT_HEX,
      valueWeiHex: "0x0",
    }],
  };
}

export function buildNftListingCancelWalletRequest(
  args: NftListingCancelWalletRequestArgs,
): NftListingActionWalletRequest {
  const listingId = args.listingId?.trim();
  if (!listingId) {
    throw new Error("Native NFT listing id is required before cancelling a listing.");
  }
  const caller = args.callerAddress?.trim();
  if (!caller) {
    throw new Error("Wallet account is required before cancelling a listing.");
  }
  const forwarderInput = buildNativeNftCancelListingForwarderInput({
    listingId,
    caller,
  }, args.maxCycles ?? NATIVE_MARKET_FORWARDER_MAX_CYCLES);
  const forwarder = _resolveNativeMarketForwarderAddress(
    args.capabilities,
    forwarderInput.requestBytes,
    args.forwarderContractAddress,
  );
  return {
    method: "monolythium_submitMrvNativeCall",
    params: [{
      contractAddress: forwarder,
      input: forwarderInput.input,
      executionUnitLimitHex:
        args.executionUnitLimitHex ?? NATIVE_MARKET_MRV_EXECUTION_UNIT_LIMIT_HEX,
      valueWeiHex: "0x0",
    }],
  };
}

export function buildNftAuctionBidWalletRequest(
  args: NftAuctionBidWalletRequestArgs,
): NftListingActionWalletRequest {
  const listingId = args.listingId?.trim();
  if (!listingId) {
    throw new Error("Native NFT listing id is required before placing an auction bid.");
  }
  const bidder = args.bidderAddress?.trim();
  if (!bidder) {
    throw new Error("Wallet account is required before placing an auction bid.");
  }
  if (args.currentBlock === null || args.currentBlock === undefined) {
    throw new Error("Live chain head is required before placing an auction bid.");
  }
  const amount = args.amount.trim();
  if (!amount) {
    throw new Error("Auction bid amount is required before placing an auction bid.");
  }
  const forwarderInput = buildNativeNftPlaceAuctionBidForwarderInput({
    listingId,
    bidder,
    amount,
    currentBlock: args.currentBlock,
  }, args.maxCycles ?? NATIVE_MARKET_FORWARDER_MAX_CYCLES);
  const forwarder = _resolveNativeMarketForwarderAddress(
    args.capabilities,
    forwarderInput.requestBytes,
    args.forwarderContractAddress,
  );
  return {
    method: "monolythium_submitMrvNativeCall",
    params: [{
      contractAddress: forwarder,
      input: forwarderInput.input,
      executionUnitLimitHex:
        args.executionUnitLimitHex ?? NATIVE_MARKET_MRV_EXECUTION_UNIT_LIMIT_HEX,
      valueWeiHex: "0x0",
    }],
  };
}

export function buildNftAuctionSettleWalletRequest(
  args: NftAuctionSettleWalletRequestArgs,
): NftListingActionWalletRequest {
  const listingId = args.listingId?.trim();
  if (!listingId) {
    throw new Error("Native NFT listing id is required before settling an auction.");
  }
  if (args.currentBlock === null || args.currentBlock === undefined) {
    throw new Error("Live chain head is required before settling an auction.");
  }
  const forwarderInput = buildNativeNftSettleAuctionForwarderInput({
    listingId,
    currentBlock: args.currentBlock,
  }, args.maxCycles ?? NATIVE_MARKET_FORWARDER_MAX_CYCLES);
  const forwarder = _resolveNativeMarketForwarderAddress(
    args.capabilities,
    forwarderInput.requestBytes,
    args.forwarderContractAddress,
  );
  return {
    method: "monolythium_submitMrvNativeCall",
    params: [{
      contractAddress: forwarder,
      input: forwarderInput.input,
      executionUnitLimitHex:
        args.executionUnitLimitHex ?? NATIVE_MARKET_MRV_EXECUTION_UNIT_LIMIT_HEX,
      valueWeiHex: "0x0",
    }],
  };
}

export function buildNftListingSweepWalletRequest(
  args: NftListingSweepWalletRequestArgs,
): NftListingActionWalletRequest {
  const listingIds = args.listingIds.map((id) => id.trim()).filter(Boolean);
  if (listingIds.length === 0) {
    throw new Error("At least one native NFT listing id is required before sweeping listings.");
  }
  if (args.currentBlock === null || args.currentBlock === undefined) {
    throw new Error("Live chain head is required before sweeping listings.");
  }
  const forwarderInput = buildNativeNftSweepExpiredListingsForwarderInput({
    listingIds,
    currentBlock: args.currentBlock,
  }, args.maxCycles ?? NATIVE_MARKET_FORWARDER_MAX_CYCLES);
  const forwarder = _resolveNativeMarketForwarderAddress(
    args.capabilities,
    forwarderInput.requestBytes,
    args.forwarderContractAddress,
  );
  return {
    method: "monolythium_submitMrvNativeCall",
    params: [{
      contractAddress: forwarder,
      input: forwarderInput.input,
      executionUnitLimitHex:
        args.executionUnitLimitHex ?? NATIVE_MARKET_MRV_EXECUTION_UNIT_LIMIT_HEX,
      valueWeiHex: "0x0",
    }],
  };
}

function _walletAccount(result: unknown): string {
  if (Array.isArray(result) && typeof result[0] === "string" && result[0].length > 0) {
    return result[0];
  }
  throw new Error("Monolythium wallet did not return an account.");
}

function _walletTxHash(result: unknown): string | null {
  if (typeof result === "string" && result.length > 0) return result;
  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.txHash === "string" && record.txHash.length > 0) return record.txHash;
    if (typeof record.hash === "string" && record.hash.length > 0) return record.hash;
  }
  return null;
}

const _nativeStateSource = (state: any) => {
  const source = state?.source;
  if (!source || typeof source !== "object") return "/api/v1/native-market-state";
  return Object.entries(source).map(([k, v]) => `${k}=${String(v)}`).join(" · ") || "/api/v1/native-market-state";
};

const NativeMarketEventsCard = ({ rows, latestBlock, loading, scope }: any) => (
  <div className="ms-card" style={{padding:0,overflow:"hidden"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"center",padding:"14px 16px",borderBottom:"1px solid var(--fg-700)"}}>
      <div>
        <div className="cap">Native market events</div>
        <h3 style={{margin:"3px 0 0",fontSize:14,fontWeight:500}}>Recent indexed events</h3>
      </div>
      <div className="mono" style={{fontSize:10,color:"var(--fg-500)",textAlign:"right"}}>
        {latestBlock === null ? "waiting for head" : `last 2,048 blocks · to ${latestBlock.toLocaleString()}`}
        {scope && <div style={{marginTop:3}}>{scope}</div>}
      </div>
    </div>
    {rows.length === 0 ? (
      <div className="mono" style={{padding:"16px",fontSize:12.5,color:"var(--fg-400)",lineHeight:1.55}}>
        {loading
          ? "Reading /api/v1/native-market-events…"
          : "No indexed native market events returned for this bounded block window."}
      </div>
    ) : (
      <div style={{overflowX:"auto"}}>
        <table className="ms-table ms-table--tight">
          <thead>
            <tr>
              <th>Block</th>
              <th>Event</th>
              <th>Primary id</th>
              <th>Emitter</th>
              <th>Fields</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((event: any, i: number)=>{
              const fields = nativeMarketEventFieldSummary(event, 6);
              return (
                <tr key={`${event.blockHeight ?? "x"}-${event.txIndex ?? "x"}-${event.logIndex}-${event.eventTopic}-${i}`}>
                  <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>
                    {event.blockHeight === null ? "—" : event.blockHeight.toLocaleString()}
                    <div style={{fontSize:10,color:"var(--fg-500)",marginTop:2}}>tx {event.txIndex ?? "—"} · log {event.logIndex}</div>
                  </td>
                  <td className="mono" style={{fontSize:11,color:"var(--fg-200)"}}>
                    <span className="pill gold" style={{fontSize:10,padding:"2px 7px",letterSpacing:"0.02em"}}>{_marketEventLabel(event.eventName)}</span>
                    <div style={{fontSize:10,color:"var(--fg-500)",marginTop:4}}>{event.eventName ?? _shortHash(event.eventTopic)}</div>
                  </td>
                  <td className="mono" title={event.primaryId ?? undefined} style={{fontSize:11,color:"var(--fg-300)"}}>
                    {_shortHash(event.primaryId)}
                    {event.relatedId && <div title={event.relatedId} style={{fontSize:10,color:"var(--fg-500)",marginTop:2}}>rel {_shortHash(event.relatedId, 8, 4)}</div>}
                  </td>
                  <td className="mono" title={fmtAddr(event.address, "contract")} style={{fontSize:11,color:"var(--fg-300)"}}>
                    {fmtAddrShort(event.address, "contract", 9, 5)}
                    {event.account && <div title={fmtAddr(event.account, "user")} style={{fontSize:10,color:"var(--fg-500)",marginTop:2}}>actor {fmtAddrShort(event.account, "user", 8, 4)}</div>}
                  </td>
                  <td className="mono" style={{fontSize:10.5,color:"var(--fg-400)",maxWidth:420,whiteSpace:"normal"}}>
                    {fields.length > 0 ? (
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {fields.map((field) => (
                          <span key={`${field.key}-${field.value}`} style={{display:"inline-flex",gap:4,alignItems:"baseline",padding:"2px 7px",borderRadius:6,background:"rgba(255,255,255,0.035)",border:"1px solid var(--fg-700)"}}>
                            <span style={{color:"var(--fg-500)"}}>{field.label}</span>
                            <span style={{color:"var(--fg-200)"}}>{field.value}</span>
                          </span>
                        ))}
                      </div>
                    ) : "decoded payload unavailable"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
  </div>
);

/**
 * Render decoded native-market-state key/value fields as labeled chips,
 * matching the events table (no raw "k=v · k=v" text). Keys are humanized via
 * the shared field-label map and id/hash/address values are truncated.
 */
const MarketFieldChips = ({ fields, limit = 3 }: { fields: Array<[string, string]>; limit?: number }) => {
  const shown = (fields ?? []).slice(0, limit);
  if (shown.length === 0) return <>—</>;
  return (
    <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
      {shown.map(([key, value]) => (
        <span key={`${key}-${value}`} style={{display:"inline-flex",gap:4,alignItems:"baseline",padding:"2px 7px",borderRadius:6,background:"rgba(255,255,255,0.035)",border:"1px solid var(--fg-700)"}}>
          <span style={{color:"var(--fg-500)"}}>{MARKET_EVENT_FIELD_LABELS[key] ?? key.replace(/_/g, " ")}</span>
          <span style={{color:"var(--fg-200)"}}>{_marketEventFieldValue(key, value)}</span>
        </span>
      ))}
    </div>
  );
};

const NativeMarketStateTable = ({ title, rows, empty }: any) => (
  <div style={{overflowX:"auto"}}>
    <div className="cap" style={{padding:"12px 16px 6px"}}>{title}</div>
    {rows.length === 0 ? (
      <div className="mono" style={{padding:"0 16px 14px",fontSize:12,color:"var(--fg-500)"}}>{empty}</div>
    ) : (
      <table className="ms-table ms-table--tight">
        <thead>
          <tr>
            <th>Id</th>
            <th>Market / collection</th>
            <th>Account</th>
            <th>Side</th>
            <th style={{textAlign:"right"}}>Price</th>
            <th style={{textAlign:"right"}}>Amount</th>
            <th>Status</th>
            <th>Fields</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row: any, i: number)=>(
            <tr key={`${row.kind}-${row.primaryId ?? row.marketId ?? row.collectionId ?? i}`}>
              <td className="mono" title={row.primaryId ?? undefined} style={{fontSize:11,color:"var(--fg-300)"}}>{_shortHash(row.primaryId, 8, 5)}</td>
              <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>
                {row.marketId ? <span title={row.marketId}>{_shortHash(row.marketId, 8, 5)}</span> : row.collectionId ? <span title={row.collectionId}>{_shortHash(row.collectionId, 8, 5)}</span> : "—"}
                {row.tokenId && <div title={row.tokenId} style={{fontSize:10,color:"var(--fg-500)",marginTop:2}}>token {_shortHash(row.tokenId, 7, 4)}</div>}
              </td>
              <td className="mono" title={row.account ? fmtAddr(row.account, "user") : undefined} style={{fontSize:11,color:"var(--fg-300)"}}>{fmtAddrShort(row.account, "user", 8, 5)}</td>
              <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>{row.side ?? "—"}</td>
              {/* Price is a raw quote-tick integer (no USD oracle / decimals) —
                  render in quote-asset terms via the shared formatter, never "$". */}
              <td className="mono num" style={{textAlign:"right",fontSize:11,color:"var(--fg-200)"}}>{row.price == null ? "—" : mkQuote(mkDec(row.price), row.quoteAsset)}</td>
              {/* Amount is a raw base-lot integer — show base count with the base label. */}
              <td className="mono num" style={{textAlign:"right",fontSize:11,color:"var(--fg-300)"}}>{row.amount == null ? "—" : `${mkNum(mkDec(row.amount))}${row.baseAsset ? ` ${_shortMarketId(row.baseAsset)}` : ""}`}</td>
              <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>{row.status ?? "—"}</td>
              <td className="mono" style={{fontSize:10.5,color:"var(--fg-500)",maxWidth:300,whiteSpace:"normal"}}>
                <MarketFieldChips fields={row.fields} limit={3}/>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

const _nativeNftListingKindText = (row: NativeMarketStateDisplayRow): string => {
  const field = row.fields.find(([key]) =>
    key === "listingKind" || key === "listing_kind" || key === "kind"
  );
  return field?.[1]?.toLowerCase() ?? "";
};

const _isNativeNftAuctionListing = (row: NativeMarketStateDisplayRow): boolean => {
  const kind = _nativeNftListingKindText(row);
  return kind.includes("auction") || kind.includes("english");
};

const NativeNftListingsTable = ({
  rows,
  empty,
  latestBlock,
  forwarderAddress,
  capabilities,
  go,
}: {
  rows: NativeMarketStateDisplayRow[];
  empty: string;
  latestBlock: number | null;
  forwarderAddress: string | null;
  capabilities?: CapabilitiesResponse | null;
  go?: (to: string) => void;
}) => {
  const [buySubmit, setBuySubmit] = useState<{
    listingId: string | null;
    state: "idle" | "submitting" | "success" | "error";
    message?: string;
    txHash?: string | null;
  }>({ listingId: null, state: "idle" });
  const [createForm, setCreateForm] = useState({
    standard: "mrc721" as NativeNftAssetStandard,
    collectionId: "",
    tokenId: "",
    quantity: "1",
    paymentAsset: `0x${"00".repeat(32)}`,
    price: "1",
    listingKind: "fixed-price" as "fixed-price" | "english-auction",
    auctionReserve: "1",
    auctionEndBlock: "0",
    minBidIncrementBps: "500",
    nonce: "0",
    expiresAtBlock: "0",
  });
  const [createSubmit, setCreateSubmit] = useState<{
    state: "idle" | "submitting" | "success" | "error";
    message?: string;
    txHash?: string | null;
  }>({ state: "idle" });
  const [auctionBidAmount, setAuctionBidAmount] = useState("1");

  const updateCreateForm = (key: keyof typeof createForm, value: string) => {
    setCreateForm((current) => ({ ...current, [key]: value }));
    setCreateSubmit({ state: "idle" });
  };

  const submitCreate = async () => {
    let nonceResolution: NftListingNonceResolution | null = null;
    try {
      const provider = typeof window !== "undefined" ? window.monolythium : undefined;
      if (!provider?.request) {
        throw new Error("Monolythium wallet provider not detected.");
      }
      setCreateSubmit({ state: "submitting", message: "awaiting wallet" });
      const accounts = await provider.request({ method: "eth_requestAccounts", params: [] });
      const sellerAddress = _walletAccount(accounts);
      setCreateSubmit({ state: "submitting", message: "resolving seller nonce" });
      nonceResolution = await resolveNftListingNonce({
        sellerAddress,
        fallbackNonce: createForm.nonce.trim() || "0",
        nftListings: rows,
      });
      const nonceMessage = nonceResolution.source === "indexed"
        ? `using indexed listing nonce ${nonceResolution.nonce}`
        : `using fallback listing nonce ${nonceResolution.nonce}; indexed seller nonce unavailable`;
      setCreateSubmit({
        state: "submitting",
        message: nonceMessage,
      });
      const listingKind: NativeNftListingKind = createForm.listingKind === "english-auction"
        ? {
            english: {
              reserve: createForm.auctionReserve.trim() || createForm.price.trim(),
              endBlock: createForm.auctionEndBlock.trim(),
              minBidIncrementBps: createForm.minBidIncrementBps.trim() || "0",
            },
          }
        : "fixed-price";
      const request = buildNftListingCreateWalletRequest({
        sellerAddress,
        listingNonce: nonceResolution.nonce,
        standard: createForm.standard,
        collectionId: createForm.collectionId,
        tokenId: createForm.tokenId,
        quantity: createForm.quantity,
        paymentAsset: createForm.paymentAsset,
        price: createForm.price,
        kind: listingKind,
        expiresAtBlock: createForm.expiresAtBlock.trim() || "0",
        forwarderContractAddress: forwarderAddress,
        capabilities,
      });
      const result = await provider.request(request);
      const txHash = _walletTxHash(result);
      setCreateSubmit({
        state: "success",
        txHash,
        message: txHash
          ? `submitted ${_shortHash(txHash, 10, 6)}; ${nonceMessage}`
          : `submitted; ${nonceMessage}`,
      });
      window.__msToast?.(txHash ? `NFT listing submitted ${_shortHash(txHash, 10, 6)}` : "NFT listing submitted");
    } catch (err) {
      const failureMessage = err instanceof Error ? err.message : "NFT listing creation failed.";
      const nonceMessage = nonceResolution
        ? nonceResolution.source === "indexed"
          ? `using indexed listing nonce ${nonceResolution.nonce}`
          : `using fallback listing nonce ${nonceResolution.nonce}; indexed seller nonce unavailable`
        : null;
      const message = nonceMessage ? `${failureMessage}; ${nonceMessage}` : failureMessage;
      setCreateSubmit({ state: "error", message });
      if (typeof window !== "undefined") window.__msToast?.(message);
    }
  };

  const submitBuy = async (row: NativeMarketStateDisplayRow) => {
    try {
      const provider = typeof window !== "undefined" ? window.monolythium : undefined;
      if (!provider?.request) {
        throw new Error("Monolythium wallet provider not detected.");
      }
      setBuySubmit({ listingId: row.primaryId, state: "submitting", message: "awaiting wallet" });
      const accounts = await provider.request({ method: "eth_requestAccounts", params: [] });
      const buyerAddress = _walletAccount(accounts);
      const request = buildNftListingBuyWalletRequest({
        listingId: row.primaryId,
        buyerAddress,
        currentBlock: latestBlock,
        forwarderContractAddress: forwarderAddress,
        capabilities,
      });
      const result = await provider.request(request);
      const txHash = _walletTxHash(result);
      setBuySubmit({
        listingId: row.primaryId,
        state: "success",
        txHash,
        message: txHash ? `submitted ${_shortHash(txHash, 10, 6)}` : "submitted",
      });
      window.__msToast?.(txHash ? `NFT listing buy submitted ${_shortHash(txHash, 10, 6)}` : "NFT listing buy submitted");
    } catch (err) {
      const message = err instanceof Error ? err.message : "NFT listing buy failed.";
      setBuySubmit({ listingId: row.primaryId, state: "error", message });
      if (typeof window !== "undefined") window.__msToast?.(message);
    }
  };

  const submitCancel = async (row: NativeMarketStateDisplayRow) => {
    try {
      const provider = typeof window !== "undefined" ? window.monolythium : undefined;
      if (!provider?.request) {
        throw new Error("Monolythium wallet provider not detected.");
      }
      setBuySubmit({ listingId: row.primaryId, state: "submitting", message: "awaiting wallet" });
      const accounts = await provider.request({ method: "eth_requestAccounts", params: [] });
      const callerAddress = _walletAccount(accounts);
      const request = buildNftListingCancelWalletRequest({
        listingId: row.primaryId,
        callerAddress,
        forwarderContractAddress: forwarderAddress,
        capabilities,
      });
      const result = await provider.request(request);
      const txHash = _walletTxHash(result);
      setBuySubmit({
        listingId: row.primaryId,
        state: "success",
        txHash,
        message: txHash ? `cancel submitted ${_shortHash(txHash, 10, 6)}` : "cancel submitted",
      });
      window.__msToast?.(txHash ? `NFT listing cancel submitted ${_shortHash(txHash, 10, 6)}` : "NFT listing cancel submitted");
    } catch (err) {
      const message = err instanceof Error ? err.message : "NFT listing cancel failed.";
      setBuySubmit({ listingId: row.primaryId, state: "error", message });
      if (typeof window !== "undefined") window.__msToast?.(message);
    }
  };

  const submitAuctionBid = async (row: NativeMarketStateDisplayRow) => {
    try {
      const provider = typeof window !== "undefined" ? window.monolythium : undefined;
      if (!provider?.request) {
        throw new Error("Monolythium wallet provider not detected.");
      }
      setBuySubmit({ listingId: row.primaryId, state: "submitting", message: "awaiting wallet" });
      const accounts = await provider.request({ method: "eth_requestAccounts", params: [] });
      const bidderAddress = _walletAccount(accounts);
      const request = buildNftAuctionBidWalletRequest({
        listingId: row.primaryId,
        bidderAddress,
        amount: auctionBidAmount,
        currentBlock: latestBlock,
        forwarderContractAddress: forwarderAddress,
        capabilities,
      });
      const result = await provider.request(request);
      const txHash = _walletTxHash(result);
      setBuySubmit({
        listingId: row.primaryId,
        state: "success",
        txHash,
        message: txHash ? `bid submitted ${_shortHash(txHash, 10, 6)}` : "bid submitted",
      });
      window.__msToast?.(txHash ? `NFT auction bid submitted ${_shortHash(txHash, 10, 6)}` : "NFT auction bid submitted");
    } catch (err) {
      const message = err instanceof Error ? err.message : "NFT auction bid failed.";
      setBuySubmit({ listingId: row.primaryId, state: "error", message });
      if (typeof window !== "undefined") window.__msToast?.(message);
    }
  };

  const submitAuctionSettle = async (row: NativeMarketStateDisplayRow) => {
    try {
      const provider = typeof window !== "undefined" ? window.monolythium : undefined;
      if (!provider?.request) {
        throw new Error("Monolythium wallet provider not detected.");
      }
      setBuySubmit({ listingId: row.primaryId, state: "submitting", message: "awaiting wallet" });
      await provider.request({ method: "eth_requestAccounts", params: [] });
      const request = buildNftAuctionSettleWalletRequest({
        listingId: row.primaryId,
        currentBlock: latestBlock,
        forwarderContractAddress: forwarderAddress,
        capabilities,
      });
      const result = await provider.request(request);
      const txHash = _walletTxHash(result);
      setBuySubmit({
        listingId: row.primaryId,
        state: "success",
        txHash,
        message: txHash ? `settle submitted ${_shortHash(txHash, 10, 6)}` : "settle submitted",
      });
      window.__msToast?.(txHash ? `NFT auction settle submitted ${_shortHash(txHash, 10, 6)}` : "NFT auction settle submitted");
    } catch (err) {
      const message = err instanceof Error ? err.message : "NFT auction settle failed.";
      setBuySubmit({ listingId: row.primaryId, state: "error", message });
      if (typeof window !== "undefined") window.__msToast?.(message);
    }
  };

  const submitSweep = async (row: NativeMarketStateDisplayRow) => {
    try {
      const provider = typeof window !== "undefined" ? window.monolythium : undefined;
      if (!provider?.request) {
        throw new Error("Monolythium wallet provider not detected.");
      }
      setBuySubmit({ listingId: row.primaryId, state: "submitting", message: "awaiting wallet" });
      await provider.request({ method: "eth_requestAccounts", params: [] });
      const request = buildNftListingSweepWalletRequest({
        listingIds: row.primaryId ? [row.primaryId] : [],
        currentBlock: latestBlock,
        forwarderContractAddress: forwarderAddress,
        capabilities,
      });
      const result = await provider.request(request);
      const txHash = _walletTxHash(result);
      setBuySubmit({
        listingId: row.primaryId,
        state: "success",
        txHash,
        message: txHash ? `sweep submitted ${_shortHash(txHash, 10, 6)}` : "sweep submitted",
      });
      window.__msToast?.(txHash ? `NFT listing sweep submitted ${_shortHash(txHash, 10, 6)}` : "NFT listing sweep submitted");
    } catch (err) {
      const message = err instanceof Error ? err.message : "NFT listing sweep failed.";
      setBuySubmit({ listingId: row.primaryId, state: "error", message });
      if (typeof window !== "undefined") window.__msToast?.(message);
    }
  };

  const canCreateListing = Boolean(
    forwarderAddress &&
    createForm.collectionId.trim() &&
    createForm.tokenId.trim() &&
    createForm.paymentAsset.trim() &&
    createForm.quantity.trim() &&
    createForm.price.trim() &&
    (createForm.listingKind !== "english-auction" ||
      (createForm.auctionReserve.trim() &&
        createForm.auctionEndBlock.trim() &&
        createForm.minBidIncrementBps.trim())) &&
    createSubmit.state !== "submitting",
  );

  return (
    <div style={{overflowX:"auto"}}>
      <div className="cap" style={{padding:"12px 16px 6px"}}>NFT listings</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr)) auto",gap:8,alignItems:"end",padding:"0 16px 12px",borderBottom:"1px solid var(--fg-700)"}}>
        <label className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>
          Standard
          <select
            value={createForm.standard}
            onChange={(event)=>updateCreateForm("standard", event.currentTarget.value as NativeNftAssetStandard)}
            style={{display:"block",width:"100%",marginTop:4,padding:"6px 8px",borderRadius:6,border:"1px solid var(--fg-700)",background:"rgba(255,255,255,0.03)",color:"var(--fg-200)"}}
          >
            <option value="mrc721">MRC-721</option>
            <option value="mrc1155">MRC-1155</option>
          </select>
        </label>
        <label className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>
          Sale type
          <select
            value={createForm.listingKind}
            onChange={(event)=>updateCreateForm("listingKind", event.currentTarget.value as "fixed-price" | "english-auction")}
            style={{display:"block",width:"100%",marginTop:4,padding:"6px 8px",borderRadius:6,border:"1px solid var(--fg-700)",background:"rgba(255,255,255,0.03)",color:"var(--fg-200)"}}
          >
            <option value="fixed-price">Fixed price</option>
            <option value="english-auction">English auction</option>
          </select>
        </label>
        {[
          ["collectionId", "Collection id"],
          ["tokenId", "Token id"],
          ["paymentAsset", "Payment asset"],
          ["price", "Price"],
          ["quantity", "Quantity"],
          ["nonce", "Nonce fallback"],
          ["expiresAtBlock", "Expiry block"],
        ].map(([key, label])=>(
          <label key={key} className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>
            {label}
            <input
              value={createForm[key as keyof typeof createForm]}
              onChange={(event)=>updateCreateForm(key as keyof typeof createForm, event.currentTarget.value)}
              className="mono"
              style={{display:"block",width:"100%",marginTop:4,padding:"6px 8px",borderRadius:6,border:"1px solid var(--fg-700)",background:"rgba(255,255,255,0.03)",color:"var(--fg-200)"}}
            />
          </label>
        ))}
        {createForm.listingKind === "english-auction" && ([
          ["auctionReserve", "Reserve"],
          ["auctionEndBlock", "Auction end"],
          ["minBidIncrementBps", "Min bump bps"],
        ] as const).map(([key, label])=>(
          <label key={key} className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>
            {label}
            <input
              value={createForm[key]}
              onChange={(event)=>updateCreateForm(key, event.currentTarget.value)}
              className="mono"
              style={{display:"block",width:"100%",marginTop:4,padding:"6px 8px",borderRadius:6,border:"1px solid var(--fg-700)",background:"rgba(255,255,255,0.03)",color:"var(--fg-200)"}}
            />
          </label>
        ))}
        <label className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>
          Auction bid
          <input
            value={auctionBidAmount}
            onChange={(event)=>setAuctionBidAmount(event.currentTarget.value)}
            className="mono"
            style={{display:"block",width:"100%",marginTop:4,padding:"6px 8px",borderRadius:6,border:"1px solid var(--fg-700)",background:"rgba(255,255,255,0.03)",color:"var(--fg-200)"}}
          />
        </label>
        <button
          className="mono"
          disabled={!canCreateListing}
          onClick={submitCreate}
          style={{
            padding:"7px 11px",
            borderRadius:6,
            border:"1px solid var(--fg-700)",
            background:canCreateListing ? "rgba(242,180,65,0.12)" : "rgba(255,255,255,0.03)",
            color:canCreateListing ? "var(--gold)" : "var(--fg-500)",
            cursor:canCreateListing ? "pointer" : "not-allowed",
            fontSize:10.5,
          }}
        >
          {createSubmit.state === "submitting" ? "Submitting" : !forwarderAddress ? "Forwarder" : "Create"}
        </button>
        {createSubmit.state !== "idle" && (
          <div className="mono" style={{
            gridColumn:"1 / -1",
            fontSize:10.5,
            color: createSubmit.state === "error" ? "var(--err)" : createSubmit.state === "success" ? "var(--ok)" : "var(--fg-400)",
          }}>
            {createSubmit.message}
            {createSubmit.txHash && (
              <a href={`#/tx/${createSubmit.txHash}`} onClick={()=>go?.(`#/tx/${createSubmit.txHash}`)} style={{color:"var(--gold)",marginLeft:8}}>View tx</a>
            )}
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="mono" style={{padding:"0 16px 14px",fontSize:12,color:"var(--fg-500)"}}>{empty}</div>
      ) : (
        <table className="ms-table ms-table--tight">
          <thead>
            <tr>
              <th>Listing</th>
              <th>Collection</th>
              <th>Seller</th>
              <th>Token</th>
              <th style={{textAlign:"right"}}>Price</th>
              <th>Status</th>
              <th>Fields</th>
              <th style={{textAlign:"right"}}>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i)=> {
              const activeSubmit = buySubmit.listingId === row.primaryId ? buySubmit : null;
              const isAuctionListing = _isNativeNftAuctionListing(row);
              const canBuy = Boolean(
                row.primaryId &&
                latestBlock !== null &&
                forwarderAddress &&
                !isAuctionListing &&
                row.status !== "filled" &&
                row.status !== "cancelled" &&
                row.status !== "expired",
              );
              const canAuctionBid = Boolean(
                isAuctionListing &&
                row.primaryId &&
                latestBlock !== null &&
                forwarderAddress &&
                row.status !== "filled" &&
                row.status !== "cancelled" &&
                row.status !== "expired" &&
                activeSubmit?.state !== "submitting",
              );
              const canAuctionSettle = Boolean(
                isAuctionListing &&
                row.primaryId &&
                latestBlock !== null &&
                forwarderAddress &&
                row.status !== "filled" &&
                row.status !== "cancelled" &&
                activeSubmit?.state !== "submitting",
              );
              const canSweepListing = Boolean(
                row.primaryId &&
                latestBlock !== null &&
                forwarderAddress &&
                activeSubmit?.state !== "submitting",
              );
              return (
                <tr key={`${row.kind}-${row.primaryId ?? row.collectionId ?? i}`}>
                  <td className="mono" title={row.primaryId ?? undefined} style={{fontSize:11,color:"var(--fg-300)"}}>{_shortHash(row.primaryId, 8, 5)}</td>
                  <td className="mono" title={row.collectionId ?? undefined} style={{fontSize:11,color:"var(--fg-300)"}}>{_shortHash(row.collectionId, 8, 5)}</td>
                  <td className="mono" title={row.account ? fmtAddr(row.account, "user") : undefined} style={{fontSize:11,color:"var(--fg-300)"}}>{fmtAddrShort(row.account, "user", 8, 5)}</td>
                  <td className="mono" title={row.tokenId ?? undefined} style={{fontSize:11,color:"var(--fg-300)"}}>{_shortHash(row.tokenId, 7, 4)}</td>
                  {/* Listing price is a raw quote-asset integer — render in quote terms, never "$". */}
                  <td className="mono num" style={{textAlign:"right",fontSize:11,color:"var(--fg-200)"}}>{row.price == null ? "—" : mkQuote(mkDec(row.price), row.quoteAsset)}</td>
                  <td className="mono" style={{fontSize:11,color:"var(--fg-300)"}}>{row.status ?? "—"}</td>
                  <td className="mono" style={{fontSize:10.5,color:"var(--fg-500)",maxWidth:260,whiteSpace:"normal"}}>
                    <MarketFieldChips fields={row.fields} limit={3}/>
                    {activeSubmit && activeSubmit.state !== "idle" && (
                      <div style={{
                        marginTop:4,
                        color: activeSubmit.state === "error" ? "var(--err)" : activeSubmit.state === "success" ? "var(--ok)" : "var(--fg-400)",
                      }}>
                        {activeSubmit.message}
                        {activeSubmit.txHash && (
                          <a href={`#/tx/${activeSubmit.txHash}`} onClick={()=>go?.(`#/tx/${activeSubmit.txHash}`)} style={{color:"var(--gold)",marginLeft:8}}>View tx</a>
                        )}
                      </div>
                    )}
                  </td>
                  <td style={{textAlign:"right"}}>
                    <div style={{display:"inline-flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
                      <button
                        className="mono"
                        disabled={!canBuy || activeSubmit?.state === "submitting"}
                        onClick={()=>submitBuy(row)}
                        style={{
                          padding:"5px 10px",
                          borderRadius:6,
                          border:"1px solid var(--fg-700)",
                          background:canBuy ? "rgba(242,180,65,0.12)" : "rgba(255,255,255,0.03)",
                          color:canBuy ? "var(--gold)" : "var(--fg-500)",
                          cursor:canBuy ? "pointer" : "not-allowed",
                          fontSize:10.5,
                        }}
                      >
                        {activeSubmit?.state === "submitting"
                          ? "Submitting"
                          : !forwarderAddress
                            ? "Forwarder"
                            : latestBlock === null
                              ? "Head"
                              : "Buy"}
                      </button>
                      <button
                        className="mono"
                        disabled={!forwarderAddress || !row.primaryId || activeSubmit?.state === "submitting"}
                        onClick={()=>submitCancel(row)}
                        style={{
                          padding:"5px 10px",
                          borderRadius:6,
                          border:"1px solid var(--fg-700)",
                          background:forwarderAddress && row.primaryId ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.03)",
                          color:forwarderAddress && row.primaryId ? "var(--fg-300)" : "var(--fg-500)",
                          cursor:forwarderAddress && row.primaryId ? "pointer" : "not-allowed",
                          fontSize:10.5,
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        className="mono"
                        disabled={!canAuctionBid}
                        onClick={()=>submitAuctionBid(row)}
                        style={{
                          padding:"5px 10px",
                          borderRadius:6,
                          border:"1px solid var(--fg-700)",
                          background:canAuctionBid ? "rgba(242,180,65,0.12)" : "rgba(255,255,255,0.03)",
                          color:canAuctionBid ? "var(--gold)" : "var(--fg-500)",
                          cursor:canAuctionBid ? "pointer" : "not-allowed",
                          fontSize:10.5,
                        }}
                      >
                        Bid
                      </button>
                      <button
                        className="mono"
                        disabled={!canAuctionSettle}
                        onClick={()=>submitAuctionSettle(row)}
                        style={{
                          padding:"5px 10px",
                          borderRadius:6,
                          border:"1px solid var(--fg-700)",
                          background:canAuctionSettle ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.03)",
                          color:canAuctionSettle ? "var(--fg-300)" : "var(--fg-500)",
                          cursor:canAuctionSettle ? "pointer" : "not-allowed",
                          fontSize:10.5,
                        }}
                      >
                        Settle
                      </button>
                      <button
                        className="mono"
                        disabled={!canSweepListing}
                        onClick={()=>submitSweep(row)}
                        style={{
                          padding:"5px 10px",
                          borderRadius:6,
                          border:"1px solid var(--fg-700)",
                          background:canSweepListing ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.03)",
                          color:canSweepListing ? "var(--fg-300)" : "var(--fg-500)",
                          cursor:canSweepListing ? "pointer" : "not-allowed",
                          fontSize:10.5,
                        }}
                      >
                        Sweep
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

const NativeMarketStateCard = ({ state, rows, loading, scope, latestBlock, forwarderAddress, capabilities, go }: any) => {
  const total = rows.spotMarkets.length + rows.spotOrders.length + rows.nftListings.length + rows.collectionRoyalties.length;
  return (
    <div className="ms-card" style={{padding:0,overflow:"hidden"}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"center",padding:"14px 16px",borderBottom:"1px solid var(--fg-700)"}}>
        <div>
          <div className="cap">Native market current state</div>
          <h3 style={{margin:"3px 0 0",fontSize:14,fontWeight:500}}>Spot, NFT, and royalty rows</h3>
        </div>
        <div className="mono" style={{fontSize:10,color:"var(--fg-500)",textAlign:"right"}}>
          {state ? _nativeStateSource(state) : loading ? "reading /api/v1/native-market-state" : "no current-state response"}
          {scope && <div style={{marginTop:3}}>{scope}</div>}
        </div>
      </div>
      {state && total === 0 ? (
        <div className="mono" style={{padding:"16px",fontSize:12.5,color:"var(--fg-400)",lineHeight:1.55}}>
          The native market state endpoint returned successfully, but it did not return spot markets, spot orders, NFT listings, or collection royalties for this scope.
        </div>
      ) : !state ? (
        <div className="mono" style={{padding:"16px",fontSize:12.5,color:"var(--fg-400)",lineHeight:1.55}}>
          {loading ? "Reading /api/v1/native-market-state…" : "Native market current state is unavailable from this node."}
        </div>
      ) : (
        <>
          <NativeMarketStateTable title="Spot markets" rows={rows.spotMarkets} empty="No spot markets returned."/>
          <NativeMarketStateTable title="Spot orders" rows={rows.spotOrders} empty="No spot orders returned."/>
          <NativeNftListingsTable
            rows={rows.nftListings}
            empty="No NFT listings returned."
            latestBlock={latestBlock ?? null}
            forwarderAddress={forwarderAddress ?? null}
            capabilities={capabilities ?? null}
            go={go}
          />
          <NativeMarketStateTable title="Collection royalties" rows={rows.collectionRoyalties} empty="No collection royalties returned."/>
        </>
      )}
    </div>
  );
};

/* Token glyph — seeded, visually stable */
const TokenMark = ({ sym, size=24 }: any) => {
  const hue = Math.abs(sym.split("").reduce((a,c)=>a*17+c.charCodeAt(0),7))%360;
  const letter = sym.replace(/[^A-Za-z]/g,"").slice(0,2) || sym.slice(0,2);
  return (
    <span style={{
      width:size, height:size, borderRadius:"50%",
      display:"inline-grid", placeItems:"center",
      background:`oklch(0.62 0.17 ${hue})`,
      color: "#fff", fontFamily:"var(--f-mono)", fontWeight:700,
      fontSize: size*0.42, letterSpacing:"-0.02em",
      boxShadow:`inset 0 1px 0 oklch(0.80 0.10 ${hue}), 0 0 0 1px oklch(0.35 0.10 ${hue})`,
      flexShrink:0,
    }}>{letter}</span>
  );
};

/**
 * Neutral market-id glyph for an UNNAMED live CLOB market. Unlike TokenMark it
 * does not hue-seed a colored "coin" that could be mistaken for a branded
 * asset — it renders a muted monospace chip seeded off the stable market id so
 * it reads as generic and is consistent per-market.
 */
const MarketIdMark = ({ id, size=24 }: { id: string; size?: number }) => {
  const seed = String(id || "");
  const glyph = seed.replace(/^0x/i, "").replace(/[^0-9a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "·";
  return (
    <span style={{
      width:size, height:size, borderRadius:6,
      display:"inline-grid", placeItems:"center",
      background:"rgba(255,255,255,0.04)",
      color:"var(--fg-400)", fontFamily:"var(--f-mono)", fontWeight:600,
      fontSize:size*0.38, letterSpacing:"-0.02em",
      border:"1px solid var(--fg-700)",
      flexShrink:0,
    }} title={seed || undefined}>{glyph}</span>
  );
};

/* Sparkline — positive/negative aware */
const Spark = ({ data, up, w=100, h=28 }: any) => {
  const min = Math.min(...data), max = Math.max(...data);
  const sx = w/(data.length-1);
  const sy = (v) => max===min ? h/2 : h-((v-min)/(max-min))*h;
  const d = data.map((v,i)=>`${i===0?"M":"L"}${(i*sx).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const color = up ? "var(--ok)" : "var(--err)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{display:"block"}}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
};

/* ---------- MARKETS LIST ---------- */
const MarketsPage = ({ go }: any) => {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("rank");
  const [dir, setDir] = useState(1);
  const [tab, setTab] = useState("all");
  const head = useChainHead();
  const capabilities = useCapabilities();
  const liveMarkets = useClobMarkets(100);
  const nativeMarketState = useNativeMarketState();
  const nativeStateRows = useMemo(() => nativeMarketStateRows(nativeMarketState.data), [nativeMarketState.data]);
  const nativeMarketEvents = useNativeMarketEvents({ latestBlock: head.data?.blockNumber ?? null, limit: 25 });
  const nativeMarketRows = useMemo(() => nativeMarketEventRows(nativeMarketEvents.data), [nativeMarketEvents.data]);

  const clobSummaryRows = useMemo(() => {
    return (liveMarkets.data?.markets ?? []).map((row: any, i: number) => {
      const price = mkDec(row.lastPrice, 0);
      const baseVolume = mkDec(row.totalVolumeBase, 0);
      return {
        rank: i + 1,
        // Unnamed market — no ticker registry on-chain. Carry the marketId so
        // the row renders a neutral market-id chip instead of a branded glyph.
        sym: `MKT-${i + 1}`,
        name: `CLOB ${_shortMarketId(row.marketId)}`,
        kind: "native",
        price,
        chg24h: 0,
        sparkline: [price || 0, price || 0],
        // Base volume only. The CLOB summary has no quote-notional aggregate and
        // price*baseVolume of two unscaled integers is not a real notional.
        // TODO(core-sdk): no quote-notional traded-volume aggregate endpoint.
        vol24h: baseVolume,
        liquidity: 0,
        mcap: 0,
        holders: 0,
        // Permissionless CLOB — no listing authority verifies a market.
        verified: false,
        trades: row.lastBlockHeight ? [{ round: row.lastBlockHeight }] : [],
        marketId: row.marketId,
        tradeCount: row.tradeCount,
        totalVolumeBase: baseVolume,
        // ClobMarketSummary carries no base/quote asset ids — the quote-unit
        // label degrades to a neutral "quote" placeholder for these rows.
        // TODO(core-sdk): expose base/quote asset ids + symbols on ClobMarketSummary.
        baseAssetId: null,
        quoteAssetId: null,
        hasFallback: false,
        live: true,
        source: "indexed_trades",
      };
    });
  }, [liveMarkets.data]);
  const nativeSpotRows = useMemo(
    () => liveMarketRowsFromNativeState(nativeMarketState.data?.spotMarkets ?? []),
    [nativeMarketState.data],
  );
  const liveRows = clobSummaryRows.length > 0 ? clobSummaryRows : nativeSpotRows;

  const indexerAvailability = useIndexerAvailability();
  const hasLiveMarketResponse = (liveMarkets.data !== undefined && liveMarkets.data !== null)
    || (nativeMarketState.data !== undefined && nativeMarketState.data !== null);
  // Once the chain is reachable (liveChain) the CLOB endpoint speaks for
  // itself — even an empty array is the truth. Only fall back to the
  // 100-row demo fixture in offline / RPC-unreachable mode.
  const marketRows = indexerAvailability.liveChain
    ? hasLiveMarketResponse ? liveRows : []
    : hasLiveMarketResponse ? liveRows : MARKETS;

  const tabs = [
    { k:"all",    label:"All markets" },
    { k:"mono",   label:"MONO pairs" },
    { k:"stable", label:"Stables" },
    { k:"bridged",label:"Bridged" },
    { k:"native", label:"Native" },
  ];

  const filtered = useMemo(() => {
    let m = marketRows.slice();
    if (q) {
      const qq = q.toLowerCase();
      m = m.filter(t =>
        t.sym.toLowerCase().includes(qq) ||
        t.name.toLowerCase().includes(qq) ||
        (t.marketId ?? "").toLowerCase().includes(qq),
      );
    }
    if (tab==="mono")    m = m.filter(t => t.kind==="mono");
    if (tab==="stable")  m = m.filter(t => t.kind==="stable");
    if (tab==="bridged") m = m.filter(t => /^w[A-Z]/.test(t.sym));
    if (tab==="native")  m = m.filter(t => !/^w[A-Z]/.test(t.sym) && t.kind!=="stable");
    m.sort((a,b) => {
      const A = a[sort], B = b[sort];
      if (typeof A === "string") return dir*(A.localeCompare(B));
      return dir*((A||0) - (B||0));
    });
    return m;
  }, [marketRows, q, sort, dir, tab]);

  const flip = (k) => { if (sort===k) setDir(-dir); else { setSort(k); setDir(k==="rank"||k==="sym"?1:-1); } };
  const arrow = (k) => sort!==k ? "" : (dir>0 ? " ↑" : " ↓");

  const totalMCAP = marketRows.reduce((a,t)=>a+(t.mcap || 0),0);
  const totalVOL  = marketRows.reduce((a,t)=>a+(t.vol24h || 0),0);
  const totalLIQ  = marketRows.reduce((a,t)=>a+(t.liquidity || 0),0);
  const usingLiveMarkets = hasLiveMarketResponse || indexerAvailability.liveChain;

  return (
    <div className="ms-page ms-markets">
      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:20,flexWrap:"wrap"}}>
        <div>
          <div className="cap">Markets · settled on Monolythium</div>
          <h1 className="ms-h1" style={{marginTop:4}}>{usingLiveMarkets ? "On-chain CLOB markets" : "Top 100 by 24h volume"}</h1>
          <div className="mono" style={{color:"var(--fg-400)",marginTop:8,fontSize:13,maxWidth:720,lineHeight:1.55}}>
            Orderbook matching happens on-chain. Every fill carries a DAG round and an attestation quorum —
            you can trade from this page and read the receipt in the same place.
          </div>
        </div>
        <div style={{display:"flex",gap:14,alignItems:"flex-end"}}>
          <div style={{textAlign:"right"}}>
            <div className="cap">{usingLiveMarkets ? "Live markets" : "Total MCAP"}</div>
            <div className="mono num" style={{fontSize:20,color:"var(--fg-100)",marginTop:2}}>
              {usingLiveMarkets ? liveRows.length.toLocaleString() : mkUsd(totalMCAP)}
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div className="cap">{usingLiveMarkets ? "Indexed base volume" : "24H volume"}</div>
            {/* Live: sum of per-market base volumes (mixed base assets) — not a
                fiat total. No quote-notional aggregate exists upstream.
                TODO(core-sdk): no quote-notional traded-volume aggregate endpoint. */}
            <div className="mono num" style={{fontSize:20,color:"var(--fg-100)",marginTop:2}}>{usingLiveMarkets ? mkNum(totalVOL) : mkUsd(totalVOL)}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div className="cap">{usingLiveMarkets ? "Trades indexed" : "Total liquidity"}</div>
            <div className="mono num" style={{fontSize:20,color:"var(--fg-100)",marginTop:2}}>
              {usingLiveMarkets ? liveRows.reduce((a,t)=>a+(t.tradeCount || 0),0).toLocaleString() : mkUsd(totalLIQ)}
            </div>
          </div>
        </div>
      </div>

      {/* filter bar */}
      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:2}}>
          {tabs.map(t=>(
            <button key={t.k} onClick={()=>setTab(t.k)}
              className="mono"
              style={{
                padding:"7px 14px",borderRadius:8,border:"1px solid var(--fg-700)",
                background: tab===t.k ? "rgba(242,180,65,0.10)" : "rgba(255,255,255,0.02)",
                color: tab===t.k ? "var(--gold)" : "var(--fg-300)",
                fontSize:11,letterSpacing:"0.06em",cursor:"pointer",textTransform:"uppercase",
              }}>{t.label}</button>
          ))}
        </div>
        <div style={{flex:1}}/>
        <div style={{
          display:"flex",alignItems:"center",gap:8,padding:"7px 12px",
          background:"rgba(255,255,255,0.03)",border:"1px solid var(--fg-700)",
          borderRadius:"var(--r-pill)",minWidth:280,
        }}>
          <span style={{color:"var(--fg-400)",fontSize:12}}>⌕</span>
          <input value={q} onChange={e=>setQ(e.target.value)}
            placeholder="Filter by symbol or name…"
            style={{fontSize:12.5,color:"var(--fg-200)"}}/>
          <span className="mono" style={{color:"var(--fg-500)",fontSize:10,letterSpacing:"0.08em"}}>
            {filtered.length} / {usingLiveMarkets ? liveRows.length : 100}
          </span>
        </div>
      </div>

      <div className="ms-card" style={{padding:0,overflow:"hidden"}}>
        <table className="ms-table ms-table--tight">
          <thead>
            <tr>
              <th onClick={()=>flip("rank")} style={{cursor:"pointer",width:46}}>#{arrow("rank")}</th>
              <th onClick={()=>flip("sym")}  style={{cursor:"pointer"}}>Asset{arrow("sym")}</th>
              <th onClick={()=>flip("price")} style={{cursor:"pointer",textAlign:"right"}}>Price{arrow("price")}</th>
              <th onClick={()=>flip("chg24h")} style={{cursor:"pointer",textAlign:"right",width:92}}>24h{arrow("chg24h")}</th>
              <th style={{textAlign:"center",width:112}}>7d</th>
              <th onClick={()=>flip("vol24h")} style={{cursor:"pointer",textAlign:"right"}}>24h vol{arrow("vol24h")}</th>
              <th onClick={()=>flip("liquidity")} style={{cursor:"pointer",textAlign:"right"}}>Liquidity{arrow("liquidity")}</th>
              <th onClick={()=>flip("mcap")} style={{cursor:"pointer",textAlign:"right"}}>MCAP{arrow("mcap")}</th>
              <th onClick={()=>flip("holders")} style={{cursor:"pointer",textAlign:"right"}}>Holders{arrow("holders")}</th>
              <th style={{textAlign:"right",width:120}}>Settled</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10}>
                  <div className="mono" style={{color:"var(--fg-400)",fontSize:12,lineHeight:1.55,padding:"14px 8px"}}>
                    {indexerAvailability.disabled
                      ? `${indexerAvailability.reason ?? "Indexer is unavailable on the connected node"}. Markets list will populate once a peer with an indexer is reachable.`
                      : usingLiveMarkets
                        ? nativeMarketRows.length > 0
                          ? `The live market index has ${nativeMarketRows.length.toLocaleString()} recent event${nativeMarketRows.length === 1 ? "" : "s"}, but no market rows match this filter.`
                          : "The live market index responded, but it has no market rows matching this view yet."
                        : "No fallback markets matched this filter."}
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map(t => (
                <tr key={t.marketId ?? t.sym} onClick={()=>go(`#/market/${encodeURIComponent(t.live && !t.hasFallback ? t.marketId : t.sym)}`)}>
                  <td className="mono num" style={{color:"var(--fg-500)",fontSize:11.5}}>{t.rank}</td>
                  <td>
                    <div style={{display:"flex",alignItems:"center",gap:10}}>
                      {t.live && !t.hasFallback
                        ? <MarketIdMark id={t.marketId ?? t.sym} size={26}/>
                        : <TokenMark sym={t.sym} size={26}/>}
                      <div style={{minWidth:0}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontWeight:500,color:"var(--fg-100)",fontSize:13}}>{t.sym}</span>
                          {/* Nothing verifies a permissionless live CLOB — the ✓ is
                              reserved for a real listing-verification signal. */}
                          {t.verified && <span title="verified" style={{color:"var(--gold)",fontSize:11,lineHeight:1}}>✓</span>}
                        </div>
                        <div className="mono" style={{fontSize:10.5,color:"var(--fg-500)",marginTop:1,letterSpacing:"0.02em"}}>
                          {t.live && !t.hasFallback
                            ? t.baseAssetId && t.quoteAssetId
                              ? `${_shortMarketId(t.baseAssetId)} / ${_shortMarketId(t.quoteAssetId)}`
                              : `market ${_shortMarketId(t.marketId)}`
                            : t.name}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-100)",fontSize:12.5}}>
                    {t.live && !t.hasFallback ? mkQuote(t.price, t.quoteAssetId) : mkMoney(t.price)}
                  </td>
                  <td className="mono num" style={{textAlign:"right",color: t.live && !t.hasFallback ? "var(--fg-500)" : t.chg24h>=0?"var(--ok)":"var(--err)", fontSize:12}}>
                    {t.live && !t.hasFallback ? "—" : `${t.chg24h>=0?"+":""}${t.chg24h.toFixed(2)}%`}
                  </td>
                  <td style={{textAlign:"center"}}>
                    {t.live && !t.hasFallback ? (
                      <span className="mono" style={{fontSize:11,color:"var(--fg-500)"}}>—</span>
                    ) : (
                      <span style={{display:"inline-block"}}><Spark data={t.sparkline} up={t.chg24h>=0} w={96} h={24}/></span>
                    )}
                  </td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-200)",fontSize:12}}>
                    {/* Live: base-volume count only — no quote-notional aggregate. */}
                    {t.live && !t.hasFallback
                      ? `${mkNum(t.vol24h)}${t.baseAssetId ? ` ${_shortMarketId(t.baseAssetId)}` : " base"}`
                      : mkUsd(t.vol24h)}
                  </td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-300)",fontSize:12}}>{t.live && !t.hasFallback ? "—" : mkUsd(t.liquidity)}</td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-300)",fontSize:12}}>{t.live && !t.hasFallback ? "—" : mkUsd(t.mcap)}</td>
                  <td className="mono num" style={{textAlign:"right",color:"var(--fg-400)",fontSize:12}}>{t.live && !t.hasFallback ? "—" : mkNum(t.holders)}</td>
                  <td className="mono" style={{textAlign:"right",fontSize:11,color:"var(--fg-400)"}}>
                    <span style={{display:"inline-flex",alignItems:"center",gap:5}}>
                      <span className="dot" style={{color:"var(--ok)",width:5,height:5}}/>
                      round {Number(t.trades[0]?.round ?? t.lastBlockHeight ?? 0).toLocaleString()}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <NativeMarketEventsCard
        rows={nativeMarketRows}
        latestBlock={head.data?.blockNumber ?? null}
        loading={nativeMarketEvents.isLoading || head.isLoading}
      />

      <NativeMarketStateCard
        state={nativeMarketState.data}
        rows={nativeStateRows}
        loading={nativeMarketState.isLoading}
        latestBlock={head.data?.blockNumber ?? null}
        forwarderAddress={getNativeMarketForwarderAddress(capabilities.data)}
        capabilities={capabilities.data}
      />

      <div className="mono" style={{color:"var(--fg-500)",fontSize:11,textAlign:"center",letterSpacing:"0.04em",padding:"6px 0"}}>
        {indexerAvailability.disabled
          ? `${indexerAvailability.reason ?? "Indexer disabled on this node"}. Markets read through an indexed peer.`
          : usingLiveMarkets
            ? liveRows.length > 0
              ? `Live market rows from ${liveRows[0]?.source === "native_market_state" ? "native-market-state" : "indexed trade summaries"}.`
              : "Live market index. Empty rows mean the node has no indexed markets yet."
            : "Listing policy: top 100 markets by rolling 24h volume · re-ranked every 240 rounds · full list on the Monoscan API"}
      </div>
    </div>
  );
};

/* ---------- MARKET DETAIL ---------- */
/** Translate the chart's range button (`1H`, `1D`, …) into the
 *  block-window + bucket-size params `lyth_clobOhlc` expects, sized
 *  against the ADR-0031 3 s round cadence so a typical range produces
 *  ~30-100 candles for a chart that doesn't look flat. */
function clobOhlcRangeParams(range: string): { lookbackBlocks: number; bucket: number } {
  // 1 hour ≈ 1200 blocks at 3 s rounds.
  switch (range) {
    case "1H":  return { lookbackBlocks:    1_200, bucket:    12 };
    case "4H":  return { lookbackBlocks:    4_800, bucket:    48 };
    case "1D":  return { lookbackBlocks:   28_800, bucket:   288 };
    case "7D":  return { lookbackBlocks:  201_600, bucket: 2_016 };
    case "1M":  return { lookbackBlocks:  864_000, bucket: 8_640 };
    case "1Y":  return { lookbackBlocks: 10_512_000, bucket: 105_120 };
    case "All": return { lookbackBlocks: 100_000_000, bucket: 100 };
    default:    return { lookbackBlocks:   28_800, bucket:   288 };
  }
}

const MarketPage = ({ sym, go }: any) => {
  const routeKey = decodeURIComponent(sym ?? "");
  const configuredMarketId = getMarketIdForSymbol(routeKey);
  const head = useChainHead();
  const capabilities = useCapabilities();
  const indexerAvailability = useIndexerAvailability();
  const liveMarkets = useClobMarkets(100);
  const matchedLiveSummary = liveMarkets.data?.markets.find((row: any) =>
    row.marketId === configuredMarketId || row.marketId === routeKey,
  ) ?? null;
  const marketId = configuredMarketId ?? (/^0x[0-9a-fA-F]{64}$/.test(routeKey) ? routeKey : matchedLiveSummary?.marketId);
  const clob = useClobMarket(marketId);
  const liveTrades = useClobTrades(marketId, 50);
  // CLOB depth comes from the precompile via `lyth_clobOrderBook`;
  // `useNativeMarketOrderBook` was the wrong upstream — that hook
  // queries the native_spot_markets layer which is a different
  // market system. Mid-page chart + book now reflect the actual CLOB.
  const liveBook = useClobOrderBook(marketId, 9);
  const nativeMarketState = useNativeMarketState({ primaryId: marketId ?? null });
  const nativeStateRows = useMemo(() => nativeMarketStateRows(nativeMarketState.data), [nativeMarketState.data]);
  const nativeLiveSummaries = useMemo(
    () => liveMarketRowsFromNativeState(nativeMarketState.data?.spotMarkets ?? []),
    [nativeMarketState.data],
  );
  const matchedNativeSummary = nativeLiveSummaries.find((row: any) =>
    row.marketId === marketId || row.marketId === routeKey,
  ) ?? null;
  const nativeMarketEvents = useNativeMarketEvents({ latestBlock: head.data?.blockNumber ?? null, limit: 25, primaryId: marketId ?? null });
  const nativeMarketRows = useMemo(() => nativeMarketEventRows(nativeMarketEvents.data), [nativeMarketEvents.data]);
  const liveMarket = clob.data?.market ?? null;
  // When the chain is reachable, a deep-link is only honoured if the
  // requested market actually exists in the live CLOB set. On a near-empty
  // chain (zero markets) this is false for every route, so we render an
  // honest "no markets" page instead of the seeded MARKETS[0] fixture below.
  const liveChain = indexerAvailability.liveChain;
  const marketIsLive = Boolean(liveMarket || matchedLiveSummary || matchedNativeSummary);
  const matchedLiveIndex = matchedLiveSummary ? liveMarkets.data?.markets.indexOf(matchedLiveSummary) ?? -1 : -1;
  const matchedSummary = matchedLiveSummary ?? matchedNativeSummary;
  const matchedSummaryRow: any = matchedSummary ?? null;
  const matchedSummaryIndex = matchedLiveSummary ? matchedLiveIndex : matchedNativeSummary ? nativeLiveSummaries.indexOf(matchedNativeSummary) : -1;
  const fixtureMarket = !liveChain
    ? MARKETS.find((m: any) => m.sym === routeKey || getMarketIdForSymbol(m.sym) === marketId)
    : null;
  const liveTokenSource: any = matchedSummaryRow ?? liveMarket ?? null;
  const liveToken = liveTokenSource ? {
    rank: matchedSummaryIndex >= 0 ? matchedSummaryIndex + 1 : 1,
    sym: matchedSummaryRow?.sym ?? `MKT-${matchedSummaryIndex >= 0 ? matchedSummaryIndex + 1 : 1}`,
    name: matchedSummaryRow?.name ?? `CLOB ${_shortMarketId(marketId ?? "")}`,
    kind: "native",
    contract: marketId ?? "",
    price: mkDec(matchedSummaryRow?.lastPrice ?? matchedSummaryRow?.price ?? liveMarket?.lastTradePrice ?? liveMarket?.bestBidPrice, 0),
    chg24h: 0,
    tick: mkDec(matchedSummaryRow?.tickSize ?? matchedSummaryRow?.tick ?? liveMarket?.tickSize, 1),
    vol24h: mkDec(matchedSummaryRow?.totalVolumeBase ?? matchedSummaryRow?.vol24h ?? liveMarket?.totalVolumeBase, 0),
    liquidity: 0,
    mcap: 0,
    holders: 0,
    // Permissionless live CLOB — nothing verifies the market.
    verified: false,
    // Quote/base asset ids drive the quote-unit label on price displays.
    quoteAssetId: liveMarket?.quoteToken ?? matchedSummaryRow?.quoteAssetId ?? null,
    baseAssetId: liveMarket?.baseToken ?? matchedSummaryRow?.baseAssetId ?? null,
    age: { days: 0 },
    ohlc: [],
    trades: [],
    venues: [],
    supply: 0,
  } : null;
  const tkn = fixtureMarket || liveToken || MARKETS[0];
  // A live market detail is being shown when the chain resolved a real market.
  const tknIsLive = Boolean(liveToken && !fixtureMarket);
  const quoteAssetId: string | null = (tkn as any).quoteAssetId ?? null;
  const baseAssetId: string | null = (tkn as any).baseAssetId ?? null;
  // Price/value display: quote-asset units (no fiat) on a live chain; the
  // USD-style fixture formatters are reserved for the offline demo preview.
  const fmtPrice = (n: any) => (tknIsLive || liveChain) ? mkQuote(n, quoteAssetId) : mkMoney(n);
  // Quote-notional value (px*sz). On-chain this is a product of unscaled
  // integers, not real fiat — show it in quote-asset terms, never "$".
  const fmtValue = (n: any) => (tknIsLive || liveChain) ? mkQuote(n, quoteAssetId) : `$${Number(n).toLocaleString(undefined,{maximumFractionDigits:2})}`;
  // Base-size display with the base-asset label.
  const fmtBase = (n: any) => `${mkNum(Number(n))}${baseAssetId ? ` ${_shortMarketId(baseAssetId)}` : ""}`;
  const [range, setRange] = useState("1D");
  // Range -> (lookback-in-blocks, bucket-size-in-blocks) under the
  // ADR-0031 3 s round cadence. Buckets are sized so a typical range
  // resolves to ~30-100 candles; the testnet's sparse volume looks
  // less synthetic at smaller buckets.
  const headBlock = head.data?.blockNumber ?? null;
  const ohlcParams = useMemo(() => {
    const params = clobOhlcRangeParams(range);
    if (headBlock == null) {
      return { fromBlock: undefined, toBlock: undefined, bucketBlocks: params.bucket };
    }
    const from = Math.max(0, headBlock - params.lookbackBlocks);
    return { fromBlock: from, toBlock: headBlock, bucketBlocks: params.bucket };
  }, [headBlock, range]);
  const liveOhlc = useClobOhlc(
    marketId,
    ohlcParams.fromBlock,
    ohlcParams.toBlock,
    ohlcParams.bucketBlocks,
  );
  const [orderSide, setOrderSide] = useState<SpotLimitOrderSide>("buy");
  const [orderType, setOrderType] = useState<"swap" | "limit" | "market">("limit");
  const [orderPrice, setOrderPrice] = useState("1");
  const [orderQuantity, setOrderQuantity] = useState("1");
  const [orderNonce, setOrderNonce] = useState("0");
  const [orderNonceResolution, setOrderNonceResolution] = useState<MarketOrderNonceResolution | null>(null);
  const [orderExpiryBlock, setOrderExpiryBlock] = useState("0");
  const [orderMarketSeed, setOrderMarketSeed] = useState<string | null>(null);
  const [orderSubmit, setOrderSubmit] = useState<{
    state: "idle" | "submitting" | "success" | "error";
    message?: string;
    txHash?: string | null;
  }>({ state: "idle" });

  const ranges = ["1H","4H","1D","7D","1M","1Y","All"];
  const chg = tkn.chg24h;
  const up = chg >= 0;
  const nativeStatePrice = matchedNativeSummary ? mkDec(matchedNativeSummary.price, 0) : null;
  const liveMarketSourceLabel = liveMarket ? "live CLOB" : matchedNativeSummary ? "native market state" : matchedLiveSummary ? "indexed CLOB" : null;
  const bestBid = liveMarket ? mkDec(liveMarket.bestBidPrice, tkn.price - tkn.tick) : null;
  const bestAsk = liveMarket ? mkDec(liveMarket.bestAskPrice, tkn.price + tkn.tick) : null;
  const lastTrade = liveMarket ? mkDec(liveMarket.lastTradePrice, 0) : null;
  const livePrice = lastTrade && lastTrade > 0
    ? lastTrade
    : bestBid !== null && bestAsk !== null && bestBid > 0 && bestAsk > 0
      ? (bestBid + bestAsk) / 2
      : nativeStatePrice && nativeStatePrice > 0
        ? nativeStatePrice
        : null;
  const tick = liveMarket ? mkDec(liveMarket.tickSize, tkn.tick) : matchedNativeSummary ? mkDec(matchedNativeSummary.tickSize, tkn.tick) : tkn.tick;
  const totalVolumeBase = liveMarket ? mkDec(liveMarket.totalVolumeBase, tkn.vol24h) : matchedNativeSummary ? mkDec(matchedNativeSummary.totalVolumeBase, tkn.vol24h) : tkn.vol24h;
  const takerFeeBps = liveMarket?.takerFeeBps ?? null;
  const orderBaseTokenId = liveMarket?.baseToken ?? matchedNativeSummary?.baseAssetId ?? null;
  const orderQuoteTokenId = liveMarket?.quoteToken ?? matchedNativeSummary?.quoteAssetId ?? null;
  const nativeMarketForwarderAddress = getNativeMarketForwarderAddress(capabilities.data);
  const suggestedOrderPrice = _positiveIntegerText(
    orderSide === "buy" ? liveMarket?.bestBidPrice : liveMarket?.bestAskPrice,
    _positiveIntegerText(liveMarket?.lastTradePrice ?? matchedNativeSummary?.price, _positiveIntegerText(liveMarket?.tickSize ?? matchedNativeSummary?.tickSize, "1")),
  );
  const suggestedOrderQuantity = _positiveIntegerText(liveMarket?.lotSize ?? matchedNativeSummary?.lotSize, "1");
  const orderNonceStatus = orderNonceResolution
    ? orderNonceResolution.source === "indexed"
      ? `indexed next ${orderNonceResolution.nonce}`
      : `fallback ${orderNonceResolution.nonce}`
    : "indexed after wallet connect";

  useEffect(() => {
    if (!marketId || (!liveMarket && !matchedNativeSummary) || orderMarketSeed === marketId) return;
    setOrderPrice(suggestedOrderPrice);
    setOrderQuantity(suggestedOrderQuantity);
    setOrderNonce("0");
    setOrderNonceResolution(null);
    setOrderExpiryBlock("0");
    setOrderMarketSeed(marketId);
    setOrderSubmit({ state: "idle" });
  }, [liveMarket, matchedNativeSummary, marketId, orderMarketSeed, suggestedOrderPrice, suggestedOrderQuantity]);

  const orderCanSubmit = orderType === "limit"
    && orderSubmit.state !== "submitting"
    && orderPrice.trim().length > 0
    && orderQuantity.trim().length > 0
    && orderNonce.trim().length > 0
    && Boolean(marketId && nativeMarketForwarderAddress);
  const submitMarketOrder = async () => {
    try {
      if (orderType !== "limit") {
        throw new Error("Only limit orders are wired for native market submission.");
      }
      const provider = typeof window !== "undefined" ? window.monolythium : undefined;
      if (!provider?.request) {
        throw new Error("Monolythium wallet provider not detected.");
      }
      setOrderSubmit({ state: "submitting", message: "awaiting wallet" });
      const accounts = await provider.request({ method: "eth_requestAccounts", params: [] });
      const ownerAddress = _walletAccount(accounts);
      setOrderSubmit({ state: "submitting", message: "resolving owner nonce" });
      const nonceResolution = await resolveMarketOrderNonce({
        ownerAddress,
        fallbackNonce: orderNonce.trim() || "0",
        spotOrders: nativeStateRows.spotOrders,
      });
      setOrderNonceResolution(nonceResolution);
      setOrderSubmit({
        state: "submitting",
        message: nonceResolution.source === "indexed"
          ? `using indexed order nonce ${nonceResolution.nonce}`
          : `using fallback order nonce ${nonceResolution.nonce}; indexed owner nonce unavailable`,
      });
      const request = buildMarketOrderWalletRequest({
        marketId,
        baseTokenId: orderBaseTokenId,
        quoteTokenId: orderQuoteTokenId,
        ownerAddress,
        orderNonce: nonceResolution.nonce,
        forwarderContractAddress: nativeMarketForwarderAddress,
        capabilities: capabilities.data,
        side: orderSide,
        price: orderPrice,
        quantity: orderQuantity,
        expiryBlock: orderExpiryBlock.trim() || "0",
      });
      const result = await provider.request(request);
      const txHash = _walletTxHash(result);
      setOrderSubmit({
        state: "success",
        txHash,
        message: txHash ? `submitted ${_shortHash(txHash, 10, 6)}` : "submitted",
      });
      window.__msToast?.(txHash ? `Limit order submitted ${_shortHash(txHash, 10, 6)}` : "Limit order submitted");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Limit order submission failed.";
      setOrderSubmit({ state: "error", message });
      if (typeof window !== "undefined") window.__msToast?.(message);
    }
  };

  // chart
  const liveCandles = (liveOhlc.data?.candles ?? [])
    .map((c: any) => ({
      o: mkDec(c.open),
      h: mkDec(c.high),
      l: mkDec(c.low),
      c: mkDec(c.close),
      v: mkDec(c.volumeBase),
      startBlock: c.startBlock,
      endBlock: c.endBlock,
    }))
    .filter((c: any) => c.o > 0 || c.h > 0 || c.l > 0 || c.c > 0);
  // When the chain has at least one indexed trade, render the live
  // candles even if the series is sparse — a flat line at the
  // last-trade price is honest data, where the synthetic `tkn.ohlc`
  // sparkline drawn from the seed-string is not. Only fall back to
  // the fixture when the indexer has zero candles AND the live RPC
  // is offline / pre-trade.
  const ohlc = liveCandles.length > 0
    ? (liveCandles.length === 1
        ? [
            { ...liveCandles[0], startBlock: liveCandles[0].startBlock },
            { ...liveCandles[0], startBlock: liveCandles[0].endBlock + 1 },
          ]
        : liveCandles)
    : liveChain
      // On a live chain the synthetic seed-string sparkline is not honest —
      // an absent series means "no indexed OHLC yet", not a fabricated curve.
      ? []
      : tkn.ohlc;
  const hasOhlc = ohlc.length > 0;
  const closes = ohlc.map(c=>c.c);
  const chartLo = Math.min(...closes)*0.996;
  const chartHi = Math.max(...closes)*1.004;
  const chartSpan = chartHi - chartLo || 1;
  const W = 900, H = 320;
  const sx = (i) => (i / (closes.length - 1)) * (W - 48);
  const sy = (v) => H - ((v - chartLo) / chartSpan) * (H - 20) - 10;
  const linePath = closes.map((v,i)=>`${i===0?"M":"L"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${sx(closes.length-1).toFixed(1)},${H} L0,${H} Z`;
  const mid = livePrice ?? tkn.price;
  const midY = sy(mid);

  // Chart X-axis labels. Live OHLC is block-bucketed (startBlock/endBlock), so
  // the design's hardcoded wall-clock strings are meaningless on a live chain —
  // derive eight evenly-spaced block-height labels from the candle range. The
  // static clock labels stay only for the offline fixture chart.
  const STATIC_TIME_LABELS = ["13:00","16:00","19:00","22:00","01:00","04:00","07:00","10:00"];
  const liveCandleStart = liveCandles.length > 0 ? mkDec(liveCandles[0]?.startBlock, 0) : 0;
  const liveCandleEnd = liveCandles.length > 0 ? mkDec(liveCandles[liveCandles.length - 1]?.endBlock ?? liveCandles[liveCandles.length - 1]?.startBlock, liveCandleStart) : 0;
  const timeAxisLabels = (liveChain && liveCandles.length > 0 && liveCandleEnd >= liveCandleStart)
    ? Array.from({ length: 8 }, (_, i) => {
        const b = Math.round(liveCandleStart + ((liveCandleEnd - liveCandleStart) * i) / 7);
        return `#${b.toLocaleString()}`;
      })
    : STATIC_TIME_LABELS;

  // orderbook derived from trades — make plausible levels
  const bookLevels = 9;
  const syntheticAsks = Array.from({length:bookLevels},(_,i)=>{
    const px = +(mid + tick*(i+1)).toFixed(mid<1?6:mid<100?3:2);
    const sz = 40 + ((i*37 + tkn.sym.length*11) % 7) * 60 + i*25;
    return { px, sz, total:0 };
  });
  const syntheticBids = Array.from({length:bookLevels},(_,i)=>{
    const px = +(mid - tick*(i+1)).toFixed(mid<1?6:mid<100?3:2);
    const sz = 40 + ((i*29 + tkn.sym.length*7) % 7) * 65 + i*22;
    return { px, sz, total:0 };
  });
  let aT=0, bT=0;
  syntheticAsks.forEach(a=>{ aT+=a.sz; a.total=aT; });
  syntheticBids.forEach(b=>{ bT+=b.sz; b.total=bT; });
  const liveBookResponded = liveBook.data !== undefined && liveBook.data !== null;
  const liveAsks = _cumLevels(liveBook.data?.asks ?? []);
  const liveBids = _cumLevels(liveBook.data?.bids ?? []);
  // Once the chain's CLOB-order-book RPC has responded for this market
  // (even with an empty book — that's a real "nothing to display"
  // signal), show the live depth. The synthetic ladder is only for the
  // offline / pre-launch demo state when no node is reachable.
  const asks = liveBookResponded ? liveAsks : liveChain ? [] : syntheticAsks;
  const bids = liveBookResponded ? liveBids : liveChain ? [] : syntheticBids;
  const maxT = Math.max(
    1,
    asks[asks.length - 1]?.total ?? 0,
    bids[bids.length - 1]?.total ?? 0,
  );

  const liveTradeRows = (liveTrades.data?.trades ?? []).map((row: any, i: number) => {
    const px = mkDec(row.price);
    const sz = mkDec(row.amount);
    return {
      t: 0,
      live: true,
      side: "fill",
      px,
      sz,
      value: px * sz,
      maker: fmtAddrShort(row.maker, "user", 7, 4),
      taker: fmtAddrShort(row.taker, "user", 7, 4),
      venue: "clob",
      round: row.blockHeight,
      attest: "indexed",
      txIndex: row.txIndex,
      logIndex: row.logIndex,
      key: `${row.blockHeight}-${row.txIndex}-${row.logIndex}-${i}`,
    };
  });
  const nativeTradeRows = nativeTradeRowsFromMarketEvents(nativeMarketRows, {
    fallbackPrice: mid,
    symbol: tkn.sym,
  });
  // On a live chain, an absent trade index means "no trades indexed yet" —
  // never the fabricated `tkn.trades` rows (which carry fake "attested 11/11"
  // quorum lines). Only the offline preview shows the fixture trades.
  const tradeRows = liveTradeRows.length ? liveTradeRows : nativeTradeRows.length ? nativeTradeRows : liveChain ? [] : tkn.trades;
  // Depth = cumulative book SIZE in base units. (Old code did total*mid =
  // lot-int * tick-int, a fabricated quote notional with no decimal scaling.)
  // On a live chain we show base size and drop the "$"; the offline fixture
  // keeps its synthetic quote-notional sum.
  const buyVol  = liveBids.length ? (bids[bids.length - 1]?.total ?? 0) : liveChain ? null : liveBookResponded ? null : tkn.trades.filter(t=>t.side==="buy").reduce((a,t)=>a+t.value,0);
  const sellVol = liveAsks.length ? (asks[asks.length - 1]?.total ?? 0) : liveChain ? null : liveBookResponded ? null : tkn.trades.filter(t=>t.side==="sell").reduce((a,t)=>a+t.value,0);

  // The chain is reachable but this deep-link does not resolve to a live
  // market. On a near-empty chain (zero CLOB markets) every market route
  // lands here. Render an honest page rather than the seeded MARKETS[0]
  // fixture (which would fabricate price/holders/supply/order-book/trades).
  const marketLookupPending = liveMarkets.isLoading || clob.isLoading || nativeMarketState.isLoading;
  if (liveChain && !marketIsLive && marketLookupPending) {
    return (
      <div className="ms-page ms-market">
        <div className="ms-crumb">
          <a href="#/markets" onClick={()=>go("#/markets")}>Markets</a>
          <span>›</span>
          <b>{_shortMarketId(marketId ?? routeKey) || "market"}</b>
        </div>
        <div className="ms-card" style={{padding:"28px 24px",marginTop:14}}>
          <div className="mono" style={{color:"var(--fg-200)",fontSize:15,letterSpacing:"-0.01em"}}>
            Resolving live market…
          </div>
          <div className="mono" style={{color:"var(--fg-400)",fontSize:12.5,lineHeight:1.55,marginTop:8,maxWidth:560}}>
            Checking indexed CLOB summaries and native-market-state before deciding whether this market exists.
          </div>
        </div>
      </div>
    );
  }
  if (liveChain && !marketIsLive && !marketLookupPending) {
    return (
      <div className="ms-page ms-market">
        <div className="ms-crumb">
          <a href="#/markets" onClick={()=>go("#/markets")}>Markets</a>
          <span>›</span>
          <b>{_shortMarketId(marketId ?? routeKey) || "market"}</b>
        </div>
        <div className="ms-card" style={{padding:"28px 24px",marginTop:14}}>
          <div className="mono" style={{color:"var(--fg-200)",fontSize:15,letterSpacing:"-0.01em"}}>
            No markets are live on this chain yet.
          </div>
          <div className="mono" style={{color:"var(--fg-400)",fontSize:12.5,lineHeight:1.55,marginTop:8,maxWidth:560}}>
            {indexerAvailability.disabled
              ? `${indexerAvailability.reason ?? "Indexer is unavailable on the connected node"}. `
              : "The connected node reports no CLOB market for this address. "}
            Once a market is registered and indexed it will resolve here with its live price, order book, and settled trades.
          </div>
          <div style={{marginTop:16}}>
            <a href="#/markets" onClick={()=>go("#/markets")} className="mono"
              style={{fontSize:12,letterSpacing:"0.04em",color:"var(--gold)",textDecoration:"none"}}>
              ← Back to all markets
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ms-page ms-market">
      <div className="ms-crumb">
        <a href="#/markets" onClick={()=>go("#/markets")}>Markets</a>
        <span>›</span>
        <b>{tkn.sym}</b>
      </div>

      {/* HEADER */}
      <section style={{display:"flex",alignItems:"center",gap:18,flexWrap:"wrap",padding:"14px 0 10px"}}>
        {tknIsLive ? <MarketIdMark id={marketId ?? tkn.sym} size={56}/> : <TokenMark sym={tkn.sym} size={56}/>}
        <div style={{minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <h1 className="ms-h1" style={{fontSize:30,margin:0,letterSpacing:"-0.02em"}}>{tkn.name}</h1>
            <span className="mono" style={{color:"var(--fg-400)",fontSize:18,letterSpacing:"0.02em"}}>({tkn.sym})</span>
            {/* No listing authority verifies a permissionless live CLOB market —
                show ✓ only for the offline fixture; live rows keep the honest
                source pill below as their provenance. */}
            {tkn.verified && !tknIsLive && <span className="pill ok" style={{fontSize:10.5}}>✓ verified</span>}
            {liveMarketSourceLabel && <span className="pill ok" style={{fontSize:10.5}}>{liveMarketSourceLabel}</span>}
          </div>
          <div className="mono" style={{display:"flex",alignItems:"center",gap:10,marginTop:6,color:"var(--fg-400)",fontSize:11.5,letterSpacing:"0.02em"}}>
            <span style={{padding:"3px 8px",background:"rgba(255,255,255,0.04)",border:"1px solid var(--fg-700)",borderRadius:4}}>{fmtAddr(tkn.contract, "contract")}</span>
            {marketId && <span title={marketId}>market {_shortMarketId(marketId)}</span>}
            <CopyToClipboard text={marketId ?? tkn.contract} title={marketId ? `copy ${marketId}` : `copy ${tkn.contract}`}/>
            <TryApiLink marketId={marketId}/>
            <span>·</span>
            {/* TODO(core-sdk): missing lyth_clobMarket listing-age field to return market registration age */}
            <span>{matchedNativeSummary?.createdAtBlock ? `created block ${Number(matchedNativeSummary.createdAtBlock).toLocaleString()}` : liveChain ? "listed pending" : `listed ${tkn.age.days}d ago`}</span>
          </div>
        </div>
        <div style={{flex:1}}/>
        <div style={{textAlign:"right"}}>
          <div className="mono num" style={{fontSize:28,color:"var(--fg-100)",letterSpacing:"-0.02em",fontWeight:300}}>{fmtPrice(mid)}</div>
          <div className="mono" style={{fontSize:12,marginTop:2,color: up?"var(--ok)":"var(--err)"}}>
            {liveMarket ? "live CLOB midpoint" : matchedNativeSummary ? "native market last price" : `${up?"▲":"▼"} ${Math.abs(chg).toFixed(3)}% · 24h`}
          </div>
        </div>
      </section>

      {/* QUICK STATS STRIP */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,minmax(0,1fr))",gap:10,padding:"10px 0"}}>
        {[
          ["Price", fmtPrice(mid), up?"var(--ok)":"var(--err)", liveMarket ? "lyth_clobMarket" : matchedNativeSummary ? "native-market-state" : `${chg>=0?"+":""}${chg.toFixed(2)}%`],
          // TODO(core-sdk): missing liquidity aggregate endpoint to return market liquidity in quote terms
          ["Liquidity", liveChain ? "pending" : mkUsd(tkn.liquidity)],
          [marketIsLive ? "Base volume" : "24h volume", marketIsLive ? fmtBase(totalVolumeBase) : mkUsd(tkn.vol24h)],
          // TODO(core-sdk): missing market-cap aggregate endpoint to return base-token MCAP
          ["MCAP", liveChain ? "pending" : mkUsd(tkn.mcap)],
          // TODO(core-sdk): missing holder-count endpoint to return base-token holders for a CLOB market
          ["Holders", liveChain ? "pending" : mkNum(tkn.holders)],
          [liveMarket ? "Taker fee" : matchedNativeSummary ? "Trades indexed" : "Age", liveMarket ? (takerFeeBps !== null ? `${takerFeeBps} bps` : "—") : matchedNativeSummary ? mkNum(matchedNativeSummary.tradeCount) : liveChain ? "pending" : `${tkn.age.days}d`],
        ].map(([k,v,col,sub])=>(
          <div key={k} style={{padding:"10px 14px",borderRadius:8,border:"1px solid var(--fg-700)",background:"rgba(255,255,255,0.02)"}}>
            <div className="cap" style={{fontSize:9.5}}>{k}</div>
            <div className="mono num" style={{fontSize:15,color:"var(--fg-100)",marginTop:3}}>{v}</div>
            {sub && <div className="mono num" style={{fontSize:10.5,color:col,marginTop:2}}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* MAIN : chart + swap */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 340px",gap:16}}>
        {/* Chart */}
        <div className="ms-card" style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <div style={{display:"flex",gap:2,padding:2,background:"rgba(255,255,255,0.03)",borderRadius:8,border:"1px solid var(--fg-700)"}}>
              {["Line","Candle"].map((t,i)=>(
                <span key={t} className="mono"
                  style={{padding:"4px 10px",fontSize:10.5,letterSpacing:"0.04em",borderRadius:6,
                    background: i===0 ? "rgba(242,180,65,0.12)" : "transparent",
                    color: i===0 ? "var(--gold)" : "var(--fg-400)",cursor:"pointer"}}>{t}</span>
              ))}
            </div>
            <div style={{flex:1}}/>
            <div style={{display:"flex",gap:2,padding:2,background:"rgba(255,255,255,0.03)",borderRadius:8,border:"1px solid var(--fg-700)"}}>
              {ranges.map(r=>(
                <button key={r} onClick={()=>setRange(r)} className="mono"
                  style={{padding:"4px 10px",fontSize:10.5,letterSpacing:"0.04em",borderRadius:6,
                    background: range===r ? "rgba(242,180,65,0.12)" : "transparent",
                    color: range===r ? "var(--gold)" : "var(--fg-400)",cursor:"pointer",border:0}}>{r}</button>
              ))}
            </div>
          </div>

          <div style={{position:"relative",height:320,borderRadius:8,background:"linear-gradient(180deg, rgba(0,0,0,0.35), rgba(0,0,0,0.1))",overflow:"hidden"}}>
            {!hasOhlc ? (
              <div className="mono" style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",padding:"0 28px",textAlign:"center",color:"var(--fg-400)",fontSize:12.5,lineHeight:1.55}}>
                No OHLC history yet for this market — the chart will draw once the chain indexes a trade in this range.
              </div>
            ) : (
            <>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{position:"absolute",inset:0,width:"100%",height:"100%"}}>
              <defs>
                <linearGradient id="mkArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={up ? "oklch(0.78 0.14 155)" : "oklch(0.70 0.20 22)"} stopOpacity="0.28"/>
                  <stop offset="100%" stopColor={up ? "oklch(0.78 0.14 155)" : "oklch(0.70 0.20 22)"} stopOpacity="0"/>
                </linearGradient>
              </defs>
              {/* gridlines */}
              {[0.2,0.4,0.6,0.8].map((f,i)=>(
                <line key={i} x1="0" y1={H*f} x2={W-48} y2={H*f} stroke="rgba(255,255,255,0.04)" strokeDasharray="2 4"/>
              ))}
              <path d={areaPath} fill="url(#mkArea)"/>
              <path d={linePath} fill="none" stroke={up ? "oklch(0.78 0.14 155)" : "oklch(0.70 0.20 22)"} strokeWidth="1.4"/>
              {/* current price marker */}
              <line x1="0" y1={midY} x2={W-48} y2={midY} stroke={up ? "oklch(0.78 0.14 155)" : "oklch(0.70 0.20 22)"} strokeDasharray="3 3" strokeOpacity="0.6"/>
              <rect x={W-48} y={midY-9} width="46" height="18" rx="3" fill={up ? "oklch(0.78 0.14 155)" : "oklch(0.70 0.20 22)"}/>
              <text x={W-25} y={midY+4} fontFamily="var(--f-mono)" fontSize="10" textAnchor="middle" fill="#0a0a14" fontWeight="600">{mkFmt(mid)}</text>
              {/* Y-axis ticks on right */}
              {[0.15,0.35,0.55,0.75,0.92].map((f,i)=>{
                const v = chartHi - f*(chartHi-chartLo);
                return <text key={i} x={W-4} y={H*f+3} fontFamily="var(--f-mono)" fontSize="9.5" textAnchor="end" fill="var(--fg-500)">{mkFmt(v)}</text>;
              })}
              {/* time axis — block heights when live, static clock labels offline */}
              {timeAxisLabels.map((t,i)=>(
                <text key={`${t}-${i}`} x={20 + i*((W-68)/7)} y={H-3} fontFamily="var(--f-mono)" fontSize="9" fill="var(--fg-500)">{t}</text>
              ))}
            </svg>
            <div className="mono" style={{position:"absolute",left:12,top:10,fontSize:10.5,color:"var(--fg-400)",letterSpacing:"0.06em",display:"flex",alignItems:"center",gap:10}}>
              <span><span className="dot" style={{color:"var(--ok)",width:5,height:5,marginRight:6}}/>{liveCandles.length > 1 ? "indexed OHLC" : "live"} · round {Number(tradeRows[0]?.round ?? (liveChain ? liveCandles[liveCandles.length-1]?.endBlock ?? 0 : tkn.trades[0].round)).toLocaleString()}</span>
              <span>{liveCandles.length > 1 ? `${liveCandles.length} buckets` : liveChain ? "" : `commit ${tkn.trades[0].round%1000}ms ago`}</span>
            </div>
            </>
            )}
          </div>

          {/* volume strip */}
          <div style={{height:60,position:"relative",borderRadius:8,background:"rgba(0,0,0,0.25)",border:"1px solid var(--fg-700)",overflow:"hidden"}}>
            <svg viewBox={`0 0 ${W} 60`} preserveAspectRatio="none" style={{position:"absolute",inset:0,width:"100%",height:"100%"}}>
              {ohlc.map((c,i)=>{
                const x = sx(i);
                const bw = (W-48)/ohlc.length*0.8;
                const up2 = c.c >= c.o;
                const vol = (c.h - c.l) * 240 + 12;
                const vh = Math.min(56, vol);
                return <rect key={i} x={x} y={60-vh} width={bw} height={vh} fill={up2?"oklch(0.78 0.14 155)":"oklch(0.70 0.20 22)"} opacity="0.35"/>;
              })}
            </svg>
            <div className="cap" style={{position:"absolute",left:10,top:6,fontSize:9}}>VOL · {tkn.sym}</div>
          </div>
        </div>

        {/* Swap / order panel */}
        <div className="ms-card" style={{padding:14,display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div style={{display:"flex",gap:2,padding:2,background:"rgba(255,255,255,0.03)",borderRadius:8,border:"1px solid var(--fg-700)"}}>
              {(["swap","limit","market"] as const).map(t=>(
                <button key={t} onClick={()=>setOrderType(t)} className="mono"
                  style={{padding:"5px 10px",fontSize:10.5,letterSpacing:"0.06em",textTransform:"uppercase",borderRadius:6,
                    background: orderType===t ? "rgba(242,180,65,0.12)" : "transparent",
                    color: orderType===t ? "var(--gold)" : "var(--fg-400)",cursor:"pointer",border:0}}>{t}</button>
              ))}
            </div>
            <span className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.06em"}}>slippage 0.50%</span>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            <button onClick={()=>setOrderSide("buy")} className="mono"
              style={{padding:"8px 0",fontSize:11,letterSpacing:"0.08em",borderRadius:6,cursor:"pointer",border:0,
                background: orderSide==="buy" ? "oklch(0.78 0.14 155)" : "rgba(255,255,255,0.04)",
                color: orderSide==="buy" ? "#052014" : "var(--fg-300)",fontWeight:600}}>BUY · LONG</button>
            <button onClick={()=>setOrderSide("sell")} className="mono"
              style={{padding:"8px 0",fontSize:11,letterSpacing:"0.08em",borderRadius:6,cursor:"pointer",border:0,
                background: orderSide==="sell" ? "oklch(0.70 0.20 22)" : "rgba(255,255,255,0.04)",
                color: orderSide==="sell" ? "#220a0a" : "var(--fg-300)",fontWeight:600}}>SELL · SHORT</button>
          </div>

          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:"rgba(255,255,255,0.03)",borderRadius:8,border:"1px solid var(--fg-700)"}}>
            <div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.08em",textTransform:"uppercase"}}>Limit price</div>
              <input
                value={orderPrice}
                onChange={(event)=>setOrderPrice(event.currentTarget.value)}
                inputMode="numeric"
                className="mono num"
                style={{fontSize:20,color:"var(--fg-100)",fontWeight:300,marginTop:2,width:"100%"}}
              />
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"rgba(255,255,255,0.03)",borderRadius:6,border:"1px solid var(--fg-700)"}}>
              {(tknIsLive || liveChain) ? (
                <>
                  <MarketIdMark id={orderQuoteTokenId ?? "quote"} size={22}/>
                  <span className="mono" style={{fontSize:12,fontWeight:500}}>{orderQuoteTokenId ? _shortMarketId(orderQuoteTokenId) : "quote"}</span>
                </>
              ) : (
                <>
                  <TokenMark sym="USDC" size={22}/>
                  <span className="mono" style={{fontSize:12,fontWeight:500}}>USDC</span>
                </>
              )}
              <span style={{color:"var(--fg-400)",fontSize:11}}>▾</span>
            </div>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",padding:"0 4px",fontSize:10,color:"var(--fg-500)"}}>
            <span className="mono">Balance 0 · <span style={{color:"var(--gold)",cursor:"pointer"}}>half</span> · <span style={{color:"var(--gold)",cursor:"pointer"}}>max</span></span>
            <span className="mono">{(tknIsLive || liveChain) ? "≈ —" : "≈ $0"}</span>
          </div>

          <div style={{textAlign:"center",color:"var(--fg-500)",margin:"-2px 0"}}>
            <span style={{display:"inline-block",width:30,height:30,borderRadius:"50%",background:"rgba(255,255,255,0.04)",border:"1px solid var(--fg-700)",lineHeight:"28px"}}>↓</span>
          </div>

          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:"rgba(255,255,255,0.03)",borderRadius:8,border:"1px solid var(--fg-700)"}}>
            <div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.08em",textTransform:"uppercase"}}>Quantity</div>
              <input
                value={orderQuantity}
                onChange={(event)=>setOrderQuantity(event.currentTarget.value)}
                inputMode="numeric"
                className="mono num"
                style={{fontSize:20,color:"var(--fg-100)",fontWeight:300,marginTop:2,width:"100%"}}
              />
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"6px 10px",background:"rgba(255,255,255,0.03)",borderRadius:6,border:"1px solid var(--fg-700)"}}>
              {tknIsLive ? (
                <>
                  <MarketIdMark id={marketId ?? tkn.sym} size={22}/>
                  <span className="mono" style={{fontSize:12,fontWeight:500}}>{_shortMarketId(marketId ?? tkn.sym)}</span>
                </>
              ) : (
                <>
                  <TokenMark sym={tkn.sym} size={22}/>
                  <span className="mono" style={{fontSize:12,fontWeight:500}}>{tkn.sym}</span>
                </>
              )}
              <span style={{color:"var(--fg-400)",fontSize:11}}>▾</span>
            </div>
          </div>

          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",background:"rgba(255,255,255,0.025)",borderRadius:8,border:"1px solid var(--fg-700)"}}>
            <div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.08em",textTransform:"uppercase"}}>Nonce fallback</div>
              <div className="mono" style={{fontSize:10,color:"var(--fg-500)",marginTop:2}}>{orderNonceStatus}</div>
            </div>
            <input
              value={orderNonce}
              onChange={(event)=>{
                setOrderNonce(event.currentTarget.value);
                setOrderNonceResolution(null);
              }}
              inputMode="numeric"
              className="mono num"
              style={{fontSize:12,color:"var(--fg-200)",textAlign:"right",width:120}}
            />
          </div>

          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 10px",background:"rgba(255,255,255,0.025)",borderRadius:8,border:"1px solid var(--fg-700)"}}>
            <span className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.08em",textTransform:"uppercase"}}>Expiry block</span>
            <input
              value={orderExpiryBlock}
              onChange={(event)=>setOrderExpiryBlock(event.currentTarget.value)}
              inputMode="numeric"
              className="mono num"
              style={{fontSize:12,color:"var(--fg-200)",textAlign:"right",width:120}}
            />
          </div>

          <button className="mono" disabled={!orderCanSubmit} onClick={submitMarketOrder} style={{
            marginTop:6,padding:"12px 0",background:"linear-gradient(180deg, var(--gold), #c98e22)",
            color:"#1a0f00",fontWeight:600,borderRadius:8,cursor:orderCanSubmit?"pointer":"not-allowed",border:0,opacity:orderCanSubmit?1:0.5,
            fontSize:12,letterSpacing:"0.08em",textTransform:"uppercase",
          }}>
            {orderSubmit.state === "submitting"
              ? "Submitting"
              : orderType !== "limit"
                ? "Limit only"
                : !marketId
                  ? "Live market required"
                  : !nativeMarketForwarderAddress
                    ? "Forwarder required"
                  : `Place ${orderSide} limit`}
          </button>

          {orderSubmit.state !== "idle" && (
            <div className="mono" style={{
              fontSize:10.5,
              color: orderSubmit.state === "error" ? "var(--err)" : orderSubmit.state === "success" ? "var(--ok)" : "var(--fg-400)",
              lineHeight:1.45,
              wordBreak:"break-word",
            }}>
              {orderSubmit.message}
              {orderSubmit.txHash && (
                <a href={`#/tx/${orderSubmit.txHash}`} onClick={()=>go(`#/tx/${orderSubmit.txHash}`)} style={{color:"var(--gold)",marginLeft:8}}>View tx</a>
              )}
            </div>
          )}

          <div className="mono" style={{fontSize:10,color:"var(--fg-500)",paddingTop:8,borderTop:"1px solid var(--fg-700)",display:"grid",gridTemplateColumns:"1fr auto",rowGap:3}}>
            <span>Rate</span><span style={{color:"var(--fg-300)"}}>1 {tkn.sym} ≈ {fmtPrice(mid)}</span>
            {/* TODO(core-sdk): missing quote-routing endpoint to return the matched venue/pool for a quote */}
            <span>Route</span><span style={{color:"var(--fg-300)"}}>{liveChain ? "on-chain CLOB" : "coinzen · pool #14"}</span>
            {/* TODO(core-sdk): missing maker-fee field on lyth_clobMarket to return the maker rebate/fee */}
            <span>Maker · taker</span><span style={{color:"var(--fg-300)"}}>{liveChain ? (takerFeeBps !== null ? `— · ${(takerFeeBps / 100).toFixed(2)}%` : "—") : `0.02% · ${((takerFeeBps ?? 5) / 100).toFixed(2)}%`}</span>
            <span>Settles</span><span style={{color: liveChain ? "var(--fg-300)" : "var(--ok)"}}>{liveChain ? "—" : "~1 round · 340ms"}</span>
            {/* TODO(core-sdk): missing per-fill attestation-quorum endpoint to return the signing quorum */}
            <span>Attestation</span><span style={{color: liveChain ? "var(--fg-300)" : "var(--ok)"}}>{liveChain ? "—" : "quorum 11/11 · SLH-DSA"}</span>
          </div>
        </div>
      </div>

      {/* TRADES + ORDERBOOK + INFO */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:16}}>
        {/* LEFT: trade activity tabs */}
        <div className="ms-card" style={{padding:0,overflow:"hidden"}}>
          <div style={{display:"flex",alignItems:"center",gap:18,padding:"10px 14px",borderBottom:"1px solid var(--fg-700)"}}>
            {/* Only Trades is backed by data — Traders/Holders/Pools/Makers were
                decorative labels with no panel. Drop them when live so the strip
                does not imply views that do not exist; the fixture keeps them. */}
            {((tknIsLive || liveChain) ? ["Trades"] : ["Trades","Traders","Holders","Pools","Makers"]).map((t,i)=>(
              <span key={t} className="mono" style={{
                fontSize:11.5,letterSpacing:"0.04em",cursor:"pointer",position:"relative",padding:"4px 0",
                color: i===0 ? "var(--fg-100)" : "var(--fg-400)",fontWeight: i===0 ? 600:400,
              }}>{t}
                {i===0 && <span style={{position:"absolute",left:0,right:0,bottom:-11,height:2,background:"var(--gold)",boxShadow:"0 0 8px var(--gold-bg)",borderRadius:2}}/>}
              </span>
            ))}
            <div style={{flex:1}}/>
            <label className="mono" style={{display:"flex",alignItems:"center",gap:6,fontSize:10.5,color:"var(--fg-400)",letterSpacing:"0.04em"}}>
              <span style={{width:10,height:10,borderRadius:3,border:"1px solid var(--fg-500)",background:"var(--ok)",boxShadow:"0 0 6px var(--ok)"}}/>
              Realtime activity
            </label>
          </div>

          {/* Buy/sell summary bar — SuiVision-esque. Fabricated rolling-window
              buy/sell counts; no live endpoint exposes them, so the bar is
              only shown in the offline preview. */}
          {/* TODO(core-sdk): missing rolling buy/sell-pressure endpoint to return windowed taker counts */}
          {liveChain ? null : (
          <div style={{display:"flex",gap:20,padding:"10px 14px",borderBottom:"1px solid var(--fg-700)",background:"rgba(0,0,0,0.1)"}}>
            {[
              ["30m", -0.03, 82, 94],
              ["1h",  +0.12, 118, 103],
              ["4h",  +0.41, 412, 388],
              ["24h", tkn.chg24h, 68460, 71220],
            ].map(([p,c,b,s],i)=>(
              <div key={i} style={{flex:1}}>
                <div className="cap" style={{fontSize:9}}>{p}</div>
                <div className="mono num" style={{fontSize:13,color: c>=0?"var(--ok)":"var(--err)",marginTop:3}}>{c>=0?"+":""}{c.toFixed(2)}%</div>
                <div style={{display:"flex",gap:2,height:4,marginTop:5,borderRadius:2,overflow:"hidden"}}>
                  <div style={{flex:b,background:"oklch(0.78 0.14 155)"}}/>
                  <div style={{flex:s,background:"oklch(0.70 0.20 22)"}}/>
                </div>
                <div className="mono" style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--fg-500)",marginTop:3}}>
                  <span style={{color:"var(--ok)"}}>{mkNum(b)}</span>
                  <span style={{color:"var(--err)"}}>{mkNum(s)}</span>
                </div>
              </div>
            ))}
          </div>
          )}

          <div style={{maxHeight:520,overflow:"auto"}}>
            <table className="ms-table ms-table--tight">
              <thead>
                <tr>
                  <th style={{width:90}}>Time</th>
                  <th style={{width:60}}>Type</th>
                  <th style={{textAlign:"right"}}>Price</th>
                  <th style={{textAlign:"right"}}>Value</th>
                  <th style={{textAlign:"right"}}>Amount</th>
                  <th>Maker / Taker</th>
                  <th style={{width:98}}>Round · attest</th>
                  <th style={{textAlign:"right",width:70}}>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {tradeRows.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <div className="mono" style={{color:"var(--fg-400)",fontSize:12,lineHeight:1.55,padding:"14px 8px"}}>
                        No trades indexed yet for this market. Settled fills will stream in here as the chain matches orders.
                      </div>
                    </td>
                  </tr>
                ) : tradeRows.map((t:any,i:number)=>(
                  <tr key={t.key ?? i} onClick={()=>go(`#/round/${t.round}`)}>
                    <td className="mono" style={{color:"var(--fg-400)",fontSize:11}}>{t.live ? `block ${Number(t.round).toLocaleString()}` : mkAgo(t.t)}</td>
                    <td>
                      {(() => {
                        const isBuy = t.side === "buy";
                        const isSell = t.side === "sell";
                        const bg = isBuy ? "oklch(0.78 0.14 155 / 0.14)" : isSell ? "oklch(0.70 0.20 22 / 0.14)" : "rgba(242,180,65,0.10)";
                        const color = isBuy ? "var(--ok)" : isSell ? "var(--err)" : "var(--gold)";
                        const border = isBuy ? "oklch(0.78 0.14 155 / 0.3)" : isSell ? "oklch(0.70 0.20 22 / 0.3)" : "rgba(242,180,65,0.25)";
                        return (
                      <span className="mono" style={{
                        padding:"2px 7px",borderRadius:3,fontSize:10,letterSpacing:"0.06em",fontWeight:500,
                        background: bg,
                        color,
                        border: `1px solid ${border}`,
                      }}>{t.side.toUpperCase()}</span>
                        );
                      })()}
                    </td>
                    <td className="mono num" style={{textAlign:"right",color: t.side==="buy"?"var(--ok)":t.side==="sell"?"var(--err)":"var(--gold)",fontSize:12}}>{t.live ? mkQuote(t.px, quoteAssetId) : mkMoney(t.px)}</td>
                    <td className="mono num" style={{textAlign:"right",color:"var(--fg-200)",fontSize:11.5}}>{t.live ? mkQuote(t.value, quoteAssetId) : fmtValue(t.value)}</td>
                    <td className="mono num" style={{textAlign:"right",color:"var(--fg-300)",fontSize:11.5}}>{mkNum(t.sz)} {tkn.sym}</td>
                    <td>
                      <div style={{display:"flex",alignItems:"center",gap:8,fontSize:10.5}}>
                        <span className="mono" style={{color:"var(--fg-300)",padding:"2px 6px",background:"rgba(255,255,255,0.03)",borderRadius:3}}>{t.maker}</span>
                        <span style={{color:"var(--fg-500)"}}>→</span>
                        <span className="mono" style={{color:"var(--fg-300)",padding:"2px 6px",background:"rgba(255,255,255,0.03)",borderRadius:3}}>{t.taker}</span>
                        <span className="mono" style={{color:"var(--fg-500)",fontSize:10,letterSpacing:"0.06em"}}>via {t.venue}</span>
                      </div>
                    </td>
                    <td>
                      <div className="mono" style={{display:"flex",flexDirection:"column",gap:2,fontSize:10}}>
                        <span style={{color:"var(--fg-200)"}}>#{t.round.toLocaleString()}</span>
                        <span style={{color: t.attest==="attested"?"var(--ok)":"var(--warn)",letterSpacing:"0.06em"}}>
                          {t.attest==="attested" ? "● attested · 11/11" : t.attest === "indexed" ? "● indexed" : `◐ ${t.attest}`}
                        </span>
                      </div>
                    </td>
                    <td className="mono" style={{textAlign:"right",color:"var(--gold)",fontSize:10.5}}>↗</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* RIGHT: orderbook + meta */}
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div className="ms-card" style={{padding:"12px 14px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <h3 style={{margin:0,fontSize:13,fontWeight:500}}>Order book</h3>
              {/* Tick size is a raw quote-tick integer — append the quote-asset label. */}
              <span className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.06em"}}>tick {mkFmt(tick)}{(tknIsLive || liveChain) ? ` ${quoteUnitLabel(quoteAssetId)}` : ""}</span>
            </div>
            <div className="mono" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",fontSize:9.5,color:"var(--fg-500)",letterSpacing:"0.08em",textTransform:"uppercase",paddingBottom:6,borderBottom:"1px solid var(--fg-700)"}}>
              <span>Price</span><span style={{textAlign:"right"}}>Size</span><span style={{textAlign:"right"}}>Total</span>
            </div>
            {/* asks */}
            {asks.length === 0 ? (
              <div className="mono" style={{padding:"14px 0",fontSize:11,color:"var(--fg-500)",lineHeight:1.45}}>
                No ask levels returned by the current order-book read.
              </div>
            ) : (
            <div style={{display:"flex",flexDirection:"column-reverse"}}>
              {asks.map((a,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",padding:"3px 0",fontSize:11,position:"relative"}}>
                  <span style={{position:"absolute",right:0,top:0,bottom:0,width:`${(a.total/maxT)*100}%`,background:"oklch(0.70 0.20 22 / 0.10)"}}/>
                  <span className="mono num" style={{color:"var(--err)",position:"relative"}}>{mkFmt(a.px)}</span>
                  <span className="mono num" style={{textAlign:"right",color:"var(--fg-300)",position:"relative"}}>{mkNum(a.sz)}</span>
                  <span className="mono num" style={{textAlign:"right",color:"var(--fg-500)",position:"relative"}}>{mkNum(a.total)}</span>
                </div>
              ))}
            </div>
            )}
            <div style={{padding:"7px 0",margin:"4px 0",borderTop:"1px solid var(--fg-700)",borderBottom:"1px solid var(--fg-700)",display:"flex",alignItems:"center",gap:8}}>
              <span className="mono num" style={{fontSize:14,color: up?"var(--ok)":"var(--err)",fontWeight:500}}>{mkFmt(mid)}</span>
              <span className="mono" style={{fontSize:10,color:"var(--fg-500)",letterSpacing:"0.06em"}}>{up?"↑":"↓"} {Math.abs(chg).toFixed(2)}%</span>
              <span style={{flex:1}}/>
              <span className="mono" style={{fontSize:10,color:"var(--fg-500)"}}>
                spread {liveMarket && bestBid !== null && bestAsk !== null ? mkFmt(Math.max(0, bestAsk - bestBid)) : (tick*2).toFixed(3)}{(tknIsLive || liveChain) ? ` ${quoteUnitLabel(quoteAssetId)}` : ""}
              </span>
            </div>
            {/* bids */}
            {bids.length === 0 ? (
              <div className="mono" style={{padding:"14px 0",fontSize:11,color:"var(--fg-500)",lineHeight:1.45}}>
                No bid levels returned by the current order-book read.
              </div>
            ) : bids.map((b,i)=>(
              <div key={i} style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",padding:"3px 0",fontSize:11,position:"relative"}}>
                <span style={{position:"absolute",right:0,top:0,bottom:0,width:`${(b.total/maxT)*100}%`,background:"oklch(0.78 0.14 155 / 0.10)"}}/>
                <span className="mono num" style={{color:"var(--ok)",position:"relative"}}>{mkFmt(b.px)}</span>
                <span className="mono num" style={{textAlign:"right",color:"var(--fg-300)",position:"relative"}}>{mkNum(b.sz)}</span>
                <span className="mono num" style={{textAlign:"right",color:"var(--fg-500)",position:"relative"}}>{mkNum(b.total)}</span>
              </div>
            ))}
            <div className="mono" style={{marginTop:10,paddingTop:8,borderTop:"1px solid var(--fg-700)",fontSize:10,color:"var(--fg-500)"}}>
              <div style={{display:"flex",justifyContent:"space-between"}}><span>Buy depth</span><span style={{color:"var(--ok)"}}>{buyVol === null ? "—" : (tknIsLive || liveChain) ? fmtBase(buyVol) : mkUsd(buyVol)}</span></div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}><span>Sell depth</span><span style={{color:"var(--err)"}}>{sellVol === null ? "—" : (tknIsLive || liveChain) ? fmtBase(sellVol) : mkUsd(sellVol)}</span></div>
              {/* TODO(core-sdk): missing per-market venue-share endpoint to return executing venues */}
              <div style={{display:"flex",justifyContent:"space-between",marginTop:2}}><span>Venues</span><span style={{color:"var(--fg-300)"}}>{liveChain ? "on-chain CLOB" : tkn.venues.slice(0,3).map(v=>v.name).join(" · ")}</span></div>
            </div>
          </div>

          <div className="ms-card" style={{padding:"12px 14px"}}>
            <h3 style={{margin:"0 0 10px",fontSize:13,fontWeight:500}}>Contract & supply</h3>
            <div className="mono" style={{fontSize:11,color:"var(--fg-400)",display:"grid",gridTemplateColumns:"auto 1fr",gap:"6px 12px"}}>
              <span>Contract</span><span style={{color:"var(--fg-200)",wordBreak:"break-all"}}>{fmtAddr(tkn.contract, "contract")}</span>
              {marketId && <><span>Market id</span><span style={{color:"var(--fg-200)",wordBreak:"break-all"}}>{marketId}</span></>}
              {(liveMarket || matchedNativeSummary?.createdAtBlock) && <><span>Registered</span><span style={{color:"var(--fg-200)"}}>block {Number(liveMarket?.registeredAtBlock ?? matchedNativeSummary?.createdAtBlock).toLocaleString()}</span></>}
              {/* TODO(core-sdk): missing base-token supply endpoint to return circulating supply for a CLOB market */}
              <span>Supply</span><span style={{color:"var(--fg-200)"}}>{liveChain ? "pending" : mkNum(tkn.supply)}</span>
              {/* TODO(core-sdk): missing market-cap aggregate endpoint to return base-token MCAP */}
              <span>MCAP</span><span style={{color:"var(--fg-200)"}}>{liveChain ? "pending" : mkUsd(tkn.mcap)}</span>
              {/* TODO(core-sdk): missing holder-count endpoint to return base-token holders for a CLOB market */}
              <span>Holders</span><span style={{color:"var(--fg-200)"}}>{liveChain ? "pending" : mkNum(tkn.holders)}</span>
              {/* TODO(core-sdk): missing market-ranking endpoint to return volume rank */}
              <span>Rank</span><span style={{color:"var(--gold)"}}>{marketIsLive ? `#${tkn.rank}` : liveChain ? "pending" : `#${tkn.rank}`}</span>
              {/* TODO(core-sdk): missing lyth_clobMarket listing-age field to return market registration age */}
              <span>Listed</span><span style={{color:"var(--fg-200)"}}>{matchedNativeSummary?.createdAtBlock ? `block ${Number(matchedNativeSummary.createdAtBlock).toLocaleString()}` : liveChain ? "pending" : `${tkn.age.days}d ago`}</span>
            </div>
            <div style={{marginTop:12,paddingTop:10,borderTop:"1px solid var(--fg-700)"}}>
              <div className="cap" style={{fontSize:9,marginBottom:8}}>Venue share · 24h</div>
              {/* TODO(core-sdk): missing per-market venue-share endpoint to return 24h volume distribution across venues */}
              {liveChain ? (
                <div className="mono" style={{fontSize:10.5,color:"var(--fg-500)",lineHeight:1.5}}>
                  Venue-share breakdown requires an indexed aggregate the connected node does not expose yet.
                </div>
              ) : tkn.venues.map(v=>(
                <div key={v.name} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
                  <span className="mono" style={{fontSize:10.5,color:"var(--fg-300)",width:60}}>{v.name}</span>
                  <div style={{flex:1,height:5,background:"rgba(255,255,255,0.04)",borderRadius:2,overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${v.share*100}%`,background: v.name==="coinzen" ? "var(--gold)" : "var(--fg-500)"}}/>
                  </div>
                  <span className="mono num" style={{fontSize:10,color:"var(--fg-400)",width:38,textAlign:"right"}}>{(v.share*100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <NativeMarketStateCard
        state={nativeMarketState.data}
        rows={nativeStateRows}
        loading={nativeMarketState.isLoading}
        scope={marketId ? `primaryId ${_shortHash(marketId)}` : "unscoped until a live market id is known"}
        latestBlock={head.data?.blockNumber ?? null}
        forwarderAddress={nativeMarketForwarderAddress}
        capabilities={capabilities.data}
        go={go}
      />

      <NativeMarketEventsCard
        rows={nativeMarketRows}
        latestBlock={head.data?.blockNumber ?? null}
        loading={nativeMarketEvents.isLoading || head.isLoading}
        scope={marketId ? `primaryId ${_shortHash(marketId)}` : "unscoped until a live market id is known"}
      />
    </div>
  );
};

/* Named exports — replaces the legacy window-attach pattern. */
export { MarketsPage, MarketPage };
