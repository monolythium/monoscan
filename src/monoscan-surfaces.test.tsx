import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BridgeHealthCard, SpendingPolicyCard } from "./monoscan-surfaces";
import {
  BRIDGE_ROUTE_HEALTH,
  CLUSTER_DIRECTORY,
  CLUSTER_DIVERSITY,
  ORACLE_DASHBOARD,
  PROVER_MARKET,
  SPENDING_POLICIES,
  SPENDING_POLICY_SAMPLE_ADDR,
} from "./data/fallback";
import { matchQuery, ask } from "./nl/query-router";
import {
  DIVERSITY_SCORE_MAX,
  PROVER_BOND_MIN_LYTH,
  PROVER_FEE_FLOOR_LYTH,
  type BridgeRouteHealth,
  type SpendingPolicyDimensions,
} from "./sdk/surfaces";

function render(element: ReactElement): string {
  // Cards take props directly, but wrap in a QueryClientProvider so any
  // hook-bearing child stays render-safe under SSR.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  );
}

/* -------------------------------------------------------------------------- */
/* Seam fixture shapes mirror the chain crates                                */
/* -------------------------------------------------------------------------- */

describe("PF-6 cluster diversity fixture", () => {
  it("scores are bounded 0..DIVERSITY_SCORE_MAX and the mean of three axes", () => {
    expect(CLUSTER_DIVERSITY.length).toBeGreaterThan(0);
    for (const v of CLUSTER_DIVERSITY) {
      const { score, breakdown, resolvedMembers } = v.diversity;
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(DIVERSITY_SCORE_MAX);
      for (const term of [breakdown.asnVariance, breakdown.geoVariance, breakdown.hostingSpread]) {
        expect(term).toBeGreaterThanOrEqual(0);
        expect(term).toBeLessThanOrEqual(DIVERSITY_SCORE_MAX);
      }
      const mean = Math.round(
        (breakdown.asnVariance + breakdown.geoVariance + breakdown.hostingSpread) / 3,
      );
      expect(score).toBe(mean);
      expect(v.operators.length).toBe(resolvedMembers);
    }
  });

  it("operator metadata uses the three hosting classes only", () => {
    const classes = new Set(
      CLUSTER_DIVERSITY.flatMap((v) => v.operators.map((o) => o.hostingClass)),
    );
    for (const c of classes) {
      expect(["bareMetal", "coLocation", "cloud"]).toContain(c);
    }
  });
});

describe("MB-6 oracle fixture", () => {
  it("feeds carry §MB-6 config dims and signers carry the writer flag", () => {
    expect(ORACLE_DASHBOARD.feeds.length).toBeGreaterThan(0);
    for (const f of ORACLE_DASHBOARD.feeds) {
      expect(f.minSigners).toBeLessThanOrEqual(f.allowedWritersLen); // k <= n
      expect(f.decimals).toBeGreaterThan(0);
      expect(f.heartbeatSecs).toBeGreaterThan(0);
    }
    expect(ORACLE_DASHBOARD.signers.length).toBeGreaterThan(0);
    expect(ORACLE_DASHBOARD.signers.every((s) => s.servesOracleWriter)).toBe(true);
  });
});

describe("PF-4 spending policy fixture", () => {
  it("the sample address resolves to a configured policy", () => {
    const policy = SPENDING_POLICIES[SPENDING_POLICY_SAMPLE_ADDR];
    expect(policy).toBeDefined();
    expect(policy.configured).toBe(true);
    expect(policy.subAccount).toBe(SPENDING_POLICY_SAMPLE_ADDR);
  });
});

describe("MB-5 cluster directory fixture", () => {
  it("every entry uses a known formation status", () => {
    expect(CLUSTER_DIRECTORY.clusters.length).toBeGreaterThan(0);
    for (const c of CLUSTER_DIRECTORY.clusters) {
      expect(["forming", "active", "draining", "retired"]).toContain(c.status);
      expect(c.roster.length).toBe(c.size);
      expect(c.threshold).toBeLessThanOrEqual(c.size);
    }
  });
});

describe("MB-4 prover market fixture", () => {
  it("requests use the five-state machine and provers meet floor/bond params", () => {
    for (const r of PROVER_MARKET.requests) {
      expect(["open", "assigned", "settled", "slashed", "expired"]).toContain(r.state);
      // Open / Expired requests carry no assigned prover.
      if (r.state === "open" || r.state === "expired") {
        expect(r.assignedProver).toBeNull();
      } else {
        expect(r.assignedProver).not.toBeNull();
      }
    }
    expect(PROVER_FEE_FLOOR_LYTH).toBe("0.1");
    expect(PROVER_BOND_MIN_LYTH).toBe("250");
    expect(PROVER_MARKET.provers.every((p) => p.servesGpuProve)).toBe(true);
  });
});

describe("MB-2 bridge route health fixture", () => {
  it("remaining + proximity are consistent with the cap", () => {
    for (const r of BRIDGE_ROUTE_HEALTH) {
      expect(["armed", "paused", "disabled"]).toContain(r.breaker);
      if (r.capPerWindow !== null) {
        const cap = BigInt(r.capPerWindow);
        const drained = BigInt(r.drainedThisBucket);
        expect(BigInt(r.remaining ?? "0")).toBe(cap - drained);
        expect(r.proximity).not.toBeNull();
      } else {
        expect(r.remaining).toBeNull();
        expect(r.proximity).toBeNull();
      }
      if (r.breaker === "paused") {
        expect(r.pausedAtBlock).not.toBeNull();
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Component rendering (SSR)                                                   */
/* -------------------------------------------------------------------------- */

describe("SpendingPolicyCard (PF-4)", () => {
  it("renders the §18.8 dims for a configured policy", () => {
    const policy = SPENDING_POLICIES[SPENDING_POLICY_SAMPLE_ADDR];
    const html = render(<SpendingPolicyCard policy={policy} />);
    expect(html).toContain("Spending policy");
    expect(html).toContain("Per-transaction cap");
    expect(html).toContain("Daily cap");
    expect(html).toContain("Weekly cap");
    expect(html).toContain("Monthly cap");
    expect(html).toContain("Time-of-day window");
    expect(html).toContain("Policy expiry");
  });

  it("renders the unconfigured state when no policy is installed", () => {
    const html = render(<SpendingPolicyCard policy={null} />);
    expect(html).toContain("No spending policy is configured");
  });

  it("labels a disabled-or-unconfigured time window as any hour", () => {
    const open: SpendingPolicyDimensions = {
      ...SPENDING_POLICIES[SPENDING_POLICY_SAMPLE_ADDR],
      timeWindow: null,
      categoryAllowRoot: null,
    };
    const html = render(<SpendingPolicyCard policy={open} />);
    expect(html).toContain("any hour");
    expect(html).toContain("any category");
  });
});

describe("BridgeHealthCard (MB-2)", () => {
  it("renders breaker state and drain-cap proximity", () => {
    const html = render(<BridgeHealthCard routes={BRIDGE_ROUTE_HEALTH} />);
    expect(html).toContain("circuit breaker");
    expect(html).toContain("drained");
    expect(html).toContain("armed");
    // A paused route surfaces its paused-at block.
    expect(html).toContain("paused");
  });

  it("renders nothing for an empty route list", () => {
    expect(render(<BridgeHealthCard routes={[] as BridgeRouteHealth[]} />)).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/* NL router recognizes the new surfaces                                       */
/* -------------------------------------------------------------------------- */

describe("NL router — new surfaces", () => {
  it("matches oracle / prover / directory / diversity / bridge / operator fee", () => {
    expect(matchQuery("show the oracle feeds")?.template).toBe("oracle");
    expect(matchQuery("open the prover market")?.template).toBe("prover");
    expect(matchQuery("cluster directory")?.template).toBe("directory");
    expect(matchQuery("how diverse are the clusters")?.template).toBe("diversity");
    expect(matchQuery("bridge circuit breaker status")?.template).toBe("bridge");
    expect(matchQuery("what is the operator fee")?.template).toBe("operatorFee");
  });

  it("still matches the original templates", () => {
    expect(matchQuery("block 12345")?.template).toBe("block");
    expect(matchQuery("cluster 3 status")?.template).toBe("cluster");
    expect(matchQuery("recent gap records")?.template).toBe("gaps");
  });

  it("ask() returns a navigational explanation that names the route", async () => {
    const oracle = await ask("show the oracle feeds");
    expect(oracle.unmatched).toBe(false);
    expect(oracle.explanation).toContain("#/oracle");
    const prover = await ask("open the prover market");
    expect(prover.explanation).toContain("#/prover-market");
    expect(prover.explanation).toContain("0.1 LYTH");
    const fee = await ask("operator fee");
    expect(fee.explanation.toLowerCase()).toContain("transparency");
  });
});
