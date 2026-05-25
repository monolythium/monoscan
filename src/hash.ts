import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export function keccak256Hex(bytes: Uint8Array): string {
  return `0x${bytesToHex(keccak_256(bytes))}`;
}
