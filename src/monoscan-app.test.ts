import { describe, expect, it } from "vitest";
import {
  liveClusterLabel,
  liveClusterRingMembers,
  liveClusterSeatSummary,
  cName,
  clusterDisplayName,
  filterUnseatedRegisteredOperators,
  fmtLythAmount,
  fmtClusterStake,
  fmtCountCompact,
  fmtClusterApy,
  operatorRoleMeta,
  capabilityLabel,
  PRIMARY_NAV,
  NETWORK_NAV,
  navRouteMatches,
} from "./monoscan-app";

describe("primary navigation IA", () => {
  const primaryRoutes = PRIMARY_NAV.map(([h]) => h);
  const primaryLabels = PRIMARY_NAV.map(([, l]) => l);
  const networkRoutes = NETWORK_NAV.map(([h]) => h);
  const networkLabels = NETWORK_NAV.map(([, l]) => l);

  it("surfaces the primary tabs (incl. dApps)", () => {
    expect(primaryLabels).toEqual([
      "Overview", "Transactions", "Markets", "dApps", "Clusters", "Operators", "Wallets", "Statistics",
    ]);
  });

  it("groups exactly the 7 specialized surfaces under Network", () => {
    expect(networkLabels).toEqual([
      "Charters", "Oracle", "Provers", "Bridge", "Directory", "Diversity", "Protocol",
    ]);
  });

  it("surfaces the cluster-charter governance page under Network", () => {
    expect(networkRoutes).toContain("#/charters");
    expect(navRouteMatches("#/charters", "#/charters")).toBe(true);
    expect(navRouteMatches("#/charters", "#/charter")).toBe(true);
  });

  it("never re-adds Governance (on-chain governance was removed)", () => {
    expect([...primaryRoutes, ...networkRoutes]).not.toContain("#/governance");
    expect([...primaryLabels, ...networkLabels]).not.toContain("Governance");
  });

  it("folds Burn into Statistics — Burn is not its own nav item", () => {
    expect([...primaryRoutes, ...networkRoutes]).not.toContain("#/burn");
    // and #/burn lights the Statistics tab so the deep-link still reads as active
    expect(navRouteMatches("#/stats", "#/burn")).toBe(true);
  });

  it("keeps the primary and Network groups disjoint", () => {
    expect(primaryRoutes.filter((r) => networkRoutes.includes(r))).toEqual([]);
  });
});

describe("navRouteMatches — active-state wiring", () => {
  it("lights a tab on its own route", () => {
    expect(navRouteMatches("#/markets", "#/markets")).toBe(true);
    expect(navRouteMatches("#/oracle", "#/oracle")).toBe(true);
  });

  it("lights a parent tab on its child detail routes", () => {
    expect(navRouteMatches("#/markets", "#/market/LYTH")).toBe(true);
    expect(navRouteMatches("#/dapps", "#/dapps")).toBe(true);
    expect(navRouteMatches("#/dapps", "#/dapp/anchorfall")).toBe(true);
    expect(navRouteMatches("#/transactions", "#/tx/0xabc")).toBe(true);
    expect(navRouteMatches("#/operators", "#/operator/mono1abc")).toBe(true);
    expect(navRouteMatches("#/clusters", "#/cluster/5")).toBe(true);
  });

  it("does NOT light Clusters on the Network cluster-directory route", () => {
    // cluster-directory is its own Network item, not a Clusters child
    expect(navRouteMatches("#/clusters", "#/cluster-directory")).toBe(false);
    expect(navRouteMatches("#/cluster-directory", "#/cluster-directory")).toBe(true);
  });

  it("does not cross-light unrelated tabs", () => {
    expect(navRouteMatches("#/markets", "#/wallets")).toBe(false);
    expect(navRouteMatches("#/oracle", "#/bridge")).toBe(false);
  });
});

describe("live cluster display helpers", () => {
  it("formats zero-based live cluster descriptors as one-based labels", () => {
    expect(liveClusterLabel({ id: 0 })).toBe("C-001");
    expect(liveClusterLabel({ id: 12 })).toBe("C-013");
  });

  it("counts live roster states without inventing reward metrics", () => {
    const cluster = { id: 0, size: 10, threshold: 7, active: true, aggregateHealth: "ok" };
    const operators = [
      { clusterId: 0, operatorId: "op-a", state: "active" },
      { clusterId: 0, operatorId: "op-b", state: "active" },
      { clusterId: 0, operatorId: "op-c", state: "standby" },
      { clusterId: 1, operatorId: "op-d", state: "active" },
    ];

    expect(liveClusterSeatSummary(cluster, operators)).toMatchObject({
      size: 10,
      threshold: 7,
      active: 2,
      standby: 1,
      reported: 3,
      known: true,
    });
    expect(liveClusterRingMembers(cluster, operators).map((row) => row.state)).toEqual([
      "live",
      "live",
      "standby",
    ]);
  });

  it("does not invent descriptor dots while roster status is still resolving", () => {
    const members = liveClusterRingMembers({ id: 0, size: 10, threshold: 7, active: true, aggregateHealth: "ok" }, []);

    expect(members).toHaveLength(0);
  });
});

describe("cName — one-based padded cluster label", () => {
  it("renders a zero-based protocol id as a one-based C-NNN label", () => {
    expect(cName(0)).toBe("C-001");
    expect(cName(4)).toBe("C-005");
    expect(cName("11")).toBe("C-012");
  });
});

describe("fmtLythAmount — precise bonded/stake amounts", () => {
  it("formats a raw lythoshi string as a precise LYTH amount with unit", () => {
    // 5000 LYTH == 5000 * 1e18 lythoshi (ADR-0037 18-decimal native scale)
    expect(fmtLythAmount("5000000000000000000000")).toBe("5,000 LYTH");
  });

  it("keeps up to two fractional digits", () => {
    // 1.25 LYTH == 1.25 * 1e18 == 1250000000000000000 lythoshi
    expect(fmtLythAmount("1250000000000000000")).toBe("1.25 LYTH");
  });

  it("renders an em dash when the amount is missing", () => {
    expect(fmtLythAmount(null)).toBe("—");
    expect(fmtLythAmount(undefined)).toBe("—");
    expect(fmtLythAmount("")).toBe("—");
  });
});

describe("fmtClusterStake — defensive cluster TVS / stake-weight render", () => {
  it("formats a real lythoshi stake as LYTH", () => {
    // 5000 LYTH at the ADR-0037 18-decimal native scale.
    expect(fmtClusterStake({ stake: "5000000000000000000000" })).toBe("5,000 LYTH");
  });

  it("renders an honest 'not indexed' when the directory carries no stake field", () => {
    // directoryEntryToCluster sets stake:null, stakeIndexed:false
    expect(fmtClusterStake({ stake: null, stakeIndexed: false })).toBe("not indexed");
    expect(fmtClusterStake({})).toBe("not indexed");
  });
});

describe("fmtCountCompact — large execution-unit counts", () => {
  it("compacts millions and thousands", () => {
    expect(fmtCountCompact(1_280_000)).toBe("1.28M");
    expect(fmtCountCompact(4_200)).toBe("4.2K");
  });

  it("leaves small counts as a grouped integer", () => {
    expect(fmtCountCompact(940)).toBe("940");
  });

  it("renders an em dash for non-finite input", () => {
    expect(fmtCountCompact(undefined)).toBe("—");
  });
});

describe("fmtClusterApy — divide-by-zero-safe APY render", () => {
  it("renders a positive APY as a percent", () => {
    expect(fmtClusterApy(6.42)).toBe("6.42%");
  });

  it("renders an em dash for a zero or non-finite APY (near-zero TVS divisor)", () => {
    expect(fmtClusterApy(0)).toBe("—");
    expect(fmtClusterApy(NaN)).toBe("—");
    expect(fmtClusterApy(Infinity)).toBe("—");
  });
});

describe("operatorRoleMeta — human label + 3-tone for protocol state", () => {
  it("maps active states to ok", () => {
    expect(operatorRoleMeta("active")).toEqual({ label: "active", tone: "ok" });
    expect(operatorRoleMeta("signing")).toEqual({ label: "active", tone: "ok" });
  });

  it("maps lagging to warn and standby to neutral", () => {
    expect(operatorRoleMeta("lagging")).toEqual({ label: "lagging", tone: "warn" });
    expect(operatorRoleMeta("standby")).toEqual({ label: "standby", tone: "neutral" });
  });

  it("maps offline / jailed to err (red), not amber", () => {
    expect(operatorRoleMeta("offline")).toEqual({ label: "offline", tone: "err" });
    expect(operatorRoleMeta("jailed")).toEqual({ label: "jailed", tone: "err" });
  });

  it("falls back to a neutral tone for an unknown state", () => {
    expect(operatorRoleMeta("weird")).toEqual({ label: "weird", tone: "neutral" });
    expect(operatorRoleMeta(null)).toEqual({ label: "unknown", tone: "neutral" });
  });
});

describe("capabilityLabel — human labels for camelCase capability keys", () => {
  it("maps known keys through the label table", () => {
    expect(capabilityLabel("stateSync")).toBe("State sync");
    expect(capabilityLabel("rpc")).toBe("RPC");
  });

  it("title-cases and de-camelCases unknown keys", () => {
    expect(capabilityLabel("fooBar")).toBe("Foo Bar");
  });
});

describe("clusterDisplayName — registered name with cName fallback", () => {
  it("prefers a registered name when one is present for the id", () => {
    expect(clusterDisplayName(0, { 0: "Pioneer" })).toBe("Pioneer");
    expect(clusterDisplayName("4", { 4: "Aurora" })).toBe("Aurora");
  });

  it("falls back to the cName label when no name is registered", () => {
    expect(clusterDisplayName(0)).toBe(cName(0));
    expect(clusterDisplayName(7, {})).toBe(cName(7));
    expect(clusterDisplayName(2, { 9: "Other" })).toBe(cName(2));
  });

  it("ignores blank/whitespace registered names and falls back", () => {
    expect(clusterDisplayName(3, { 3: "   " })).toBe(cName(3));
    expect(clusterDisplayName(3, { 3: "" })).toBe(cName(3));
  });

  it("trims a registered name before display", () => {
    expect(clusterDisplayName(5, { 5: "  Nebula  " })).toBe("Nebula");
  });
});

describe("filterUnseatedRegisteredOperators — registry tab dedup", () => {
  const registered = [
    { operatorId: "0xAAA", bond: "1" },
    { operatorId: "0xBBB", bond: "2" },
    { operatorId: "0xCCC", bond: "3" },
  ];

  it("drops registered operators already seated in a live cluster", () => {
    const rows = filterUnseatedRegisteredOperators(registered, ["0xbbb"]);
    expect(rows.map((r) => r.operatorId)).toEqual(["0xAAA", "0xCCC"]);
  });

  it("matches seated operators case-insensitively", () => {
    const rows = filterUnseatedRegisteredOperators(registered, ["0xaaa", "0XCCC"]);
    expect(rows.map((r) => r.operatorId)).toEqual(["0xBBB"]);
  });

  it("returns every registered operator when none are seated", () => {
    const rows = filterUnseatedRegisteredOperators(registered, []);
    expect(rows).toHaveLength(3);
  });

  it("returns an empty list when every operator is seated", () => {
    const rows = filterUnseatedRegisteredOperators(registered, ["0xaaa", "0xbbb", "0xccc"]);
    expect(rows).toEqual([]);
  });
});
