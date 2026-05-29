/**
 * Address display formatting.
 *
 * Monolythium addresses are presented as bech32m at every surface (per the
 * v2 address-display rule): a human-readable prefix that encodes the account
 * type (`mono1…` user, `monos1…` smart account, `monoc1…` contract,
 * `monok1…` cluster, `monom1…` multisig, `monox1…` system module) plus a
 * checksum. Raw `0x…` hex is never shown for an account address.
 *
 * `fmtAddr` is format-agnostic so it is safe to apply anywhere:
 *   - already bech32m  → returned unchanged (the wire format is already right)
 *   - 20-byte `0x` hex → encoded to typed bech32m
 *   - anything else    → returned unchanged
 *
 * That last branch is deliberate: a 32-byte value is NOT a 20-byte account
 * address — it is a transaction / block / vertex hash, a BLS public key, or an
 * operator authority key. Those are universally shown as hex on a block
 * explorer and must NOT be coerced into an address. Applying `fmtAddr` to such
 * a value leaves it untouched, so mis-targeting it can never corrupt a hash.
 *
 * For hashes and keys use {@link fmtHashShort}; for addresses use
 * {@link fmtAddrShort}.
 */

import { addressToTypedBech32, type AddressKind } from "@monolythium/core-sdk";

const BECH32M_RE = /^mono[a-z]*1[0-9a-z]+$/i;
const HEX20_RE = /^0x[0-9a-fA-F]{40}$/;

/**
 * Render an account address as bech32m. When the input is already bech32m it
 * is returned as-is; a 20-byte `0x` hex address is encoded with the HRP for
 * `kind` (default `user`); any other value (32-byte hash/key, null, sentinel
 * like "contract creation") is returned unchanged.
 */
export function fmtAddr(value: unknown, kind: AddressKind = "user"): string {
  if (value == null) return "";
  const v = String(value);
  if (BECH32M_RE.test(v)) return v;
  if (HEX20_RE.test(v)) {
    try {
      return addressToTypedBech32(kind, v.toLowerCase());
    } catch {
      return v;
    }
  }
  return v;
}

/**
 * `fmtAddr` then middle-truncated for table cells / inline display.
 * bech32m strings keep their HRP head so the type prefix stays visible.
 */
export function fmtAddrShort(
  value: unknown,
  kind: AddressKind = "user",
  head = 12,
  tail = 6,
): string {
  const f = fmtAddr(value, kind);
  return f.length > head + tail + 3 ? `${f.slice(0, head)}…${f.slice(-tail)}` : f;
}

/**
 * Middle-truncate a hash or key (tx/block/vertex hash, BLS key, operator
 * authority key). These stay hex — they are not addresses. No bech32m
 * conversion is attempted.
 */
export function fmtHashShort(value: unknown, head = 10, tail = 6): string {
  if (value == null) return "";
  const v = String(value);
  return v.length > head + tail + 3 ? `${v.slice(0, head)}…${v.slice(-tail)}` : v;
}
