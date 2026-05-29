import { describe, expect, it } from "vitest";
import { fmtAddr, fmtAddrShort, fmtHashShort } from "./format";

const HEX20 = "0x0123456789abcdef0123456789abcdef01234567"; // 20 bytes
const HEX32 = "0x" + "ab".repeat(32); // 32-byte hash/key
const BECH = "mono1qy352euf40x77qfrg4ncn27dqml9q5d6t9p4r0"; // already bech32m-shaped

describe("fmtAddr", () => {
  it("returns an already-bech32m value unchanged", () => {
    expect(fmtAddr(BECH)).toBe(BECH);
  });

  it("encodes a 20-byte 0x address to typed bech32m", () => {
    const user = fmtAddr(HEX20, "user");
    expect(user.startsWith("mono1")).toBe(true);
    expect(user).not.toBe(HEX20);
    expect(fmtAddr(HEX20, "contract").startsWith("monoc1")).toBe(true);
    expect(fmtAddr(HEX20, "cluster").startsWith("monok1")).toBe(true);
  });

  it("leaves a 32-byte hash/key untouched (not a 20-byte address)", () => {
    expect(fmtAddr(HEX32)).toBe(HEX32);
  });

  it("returns empty string for null/undefined", () => {
    expect(fmtAddr(null)).toBe("");
    expect(fmtAddr(undefined)).toBe("");
  });

  it("passes through sentinels like 'contract creation'", () => {
    expect(fmtAddr("contract creation")).toBe("contract creation");
  });
});

describe("fmtAddrShort", () => {
  it("middle-truncates a long bech32m address keeping the HRP head", () => {
    const out = fmtAddrShort(HEX20, "user");
    expect(out.startsWith("mono1")).toBe(true);
    expect(out).toContain("…");
  });

  it("does not truncate a short value", () => {
    expect(fmtAddrShort("mono1abc")).toBe("mono1abc");
  });
});

describe("fmtHashShort", () => {
  it("middle-truncates a 32-byte hash and never bech32m-encodes it", () => {
    const out = fmtHashShort(HEX32);
    expect(out.startsWith("0x")).toBe(true);
    expect(out).toContain("…");
    expect(out).not.toContain("mono");
  });
});
