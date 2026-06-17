import { describe, expect, it } from "vitest";
import {
  browserWalletLabel,
  DAPP_CATEGORIES,
  DAPP_DIRECTORY_ENTRIES,
  DAPP_FILTERS,
  filterDappDirectory,
  listingStatusLabel,
} from "./dapp-directory";

describe("dApp directory categories", () => {
  it("keeps Show all first and public categories alphabetized", () => {
    expect(DAPP_FILTERS).toEqual([
      "Show all",
      "AI",
      "Bridges",
      "Education",
      "Finance",
      "Games",
      "Healthcare",
      "ID",
      "Prediction Markets",
      "Social",
      "Supply Chain",
      "Tools",
    ]);
    expect([...DAPP_CATEGORIES]).toEqual([...DAPP_CATEGORIES].sort((a, b) => a.localeCompare(b)));
    expect(DAPP_CATEGORIES).toContain("AI");
    expect(DAPP_CATEGORIES).toContain("Bridges");
    expect(DAPP_CATEGORIES).toContain("Tools");
  });

  it("keeps seeded entries on a known category", () => {
    const allowed = new Set(DAPP_CATEGORIES);
    for (const entry of DAPP_DIRECTORY_ENTRIES) {
      expect(allowed.has(entry.category)).toBe(true);
    }
  });
});

describe("filterDappDirectory", () => {
  it("returns every entry for Show all", () => {
    expect(filterDappDirectory(DAPP_DIRECTORY_ENTRIES, "Show all")).toHaveLength(DAPP_DIRECTORY_ENTRIES.length);
  });

  it("returns entries in product-name order", () => {
    expect(filterDappDirectory(DAPP_DIRECTORY_ENTRIES, "Show all").map((entry) => entry.productName)).toEqual([
      "Anchorfall",
      "Lyth MCP",
    ]);
  });

  it("filters by selected category", () => {
    const games = filterDappDirectory(DAPP_DIRECTORY_ENTRIES, "Games");
    expect(games.map((entry) => entry.id)).toContain("anchorfall");
    expect(filterDappDirectory(DAPP_DIRECTORY_ENTRIES, "Tools").map((entry) => entry.id)).toContain("lyth-mcp");
    expect(filterDappDirectory(DAPP_DIRECTORY_ENTRIES, "AI")).toEqual([]);
  });
});

describe("dApp directory labels", () => {
  it("renders human-facing compatibility and listing status labels", () => {
    expect(browserWalletLabel("compatible")).toBe("Compatible");
    expect(browserWalletLabel("not-compatible")).toBe("No");
    expect(listingStatusLabel("foundation-maintained")).toBe("Foundation maintained");
  });
});
