/**
 * Deterministic natural-language router for Ask Monoscan.
 *
 * It maps common explorer questions to typed tool calls, then returns the
 * same `NlAnswer` shape consumed by the page renderer.
 */

import {
  invokeTool,
  type GetBlockResult,
  type GetClusterResult,
  type GetGapRecordsResult,
  type GetAddressActivityResult,
  type SearchTokensResult,
} from "./tools";
import type { NlAnswer, SAMPLE_QUERIES, ToolInvocation, ToolName } from "./types";
import { SAMPLE_QUERIES as SAMPLE_QUERIES_VAL } from "./types";

/* -------------------------------------------------------------------------- */
/* Pattern matchers                                                           */
/* -------------------------------------------------------------------------- */

interface Match {
  template:
    | "block"
    | "address"
    | "gaps"
    | "tokens"
    | "cluster"
    // New-surface navigational templates (PF-6 / MB-6 / PF-4 / MB-5 / MB-4 / MB-2).
    // These resolve to a factual answer that names the route; the surfaces
    // render the live data themselves. No tool fan-out yet — the NL tool
    // catalog gains typed tools in the @monolythium/core-sdk 0.3.10 pass.
    | "oracle"
    | "prover"
    | "directory"
    | "diversity"
    | "bridge"
    | "operatorFee";
  args: Record<string, string | number>;
}

/**
 * Match a query against the five canned templates. Returns null on no
 * match; the caller renders the fallback example-buttons hint.
 *
 * The patterns are intentionally lenient so common explorer queries resolve
 * without requiring exact syntax.
 */
export function matchQuery(q: string): Match | null {
  const ql = q.toLowerCase().trim();

  // 1) "What happened in block 12345?" / "block 12345" / "show block #1234"
  const block = ql.match(/block\s*#?\s*(0x[a-f0-9]+|\d+)/i);
  if (block) {
    const arg = block[1];
    return {
      template: "block",
      args: { number_or_hash: /^\d+$/.test(arg) ? parseInt(arg, 10) : arg },
    };
  }

  // 2) "Show me activity for mono1..." / "address mono1..." / "what's mono1..." doing
  const addr = ql.match(/(?:mono1[023456789acdefghjklmnpqrstuvwxyz]+(?:\.\.\.|…)?[023456789acdefghjklmnpqrstuvwxyz]*)/i);
  if (addr && /(activity|recent|history|address|happen|do)/.test(ql)) {
    return { template: "address", args: { address: addr[0] } };
  }

  // 3) "Are there any recent gap records?" / "gap records" / "any gaps"
  if (/\bgap[s]?\b/.test(ql) || /\bempty block/.test(ql) || /heartbeat/.test(ql)) {
    return { template: "gaps", args: { range: "24h" } };
  }

  // New-surface matchers — placed before the lenient token matchers so a word
  // like "oracle" or "prover" routes to its surface rather than a token search.

  // Operator fees — monoscan is the neutral transparency surface for the
  // on-chain operator-fee facts (the operator-router landing soon defers here).
  if (/operator\s+fee/.test(ql) || /\bfee\s+floor/.test(ql)) {
    return { template: "operatorFee", args: {} };
  }
  // Oracle / price feeds (MB-6).
  if (/\boracle[s]?\b/.test(ql) || /price\s+feed/.test(ql) || /\bfeed[s]?\b/.test(ql)) {
    return { template: "oracle", args: {} };
  }
  // Prover market (MB-4).
  if (/\bprover[s]?\b/.test(ql) || /proof\s+request/.test(ql) || /prover\s+market/.test(ql)) {
    return { template: "prover", args: {} };
  }
  // Cluster directory (MB-5).
  if (/cluster\s+directory/.test(ql) || /\bdirectory\b/.test(ql)) {
    return { template: "directory", args: {} };
  }
  // Node diversity (PF-6).
  if (/\bdivers\w*\b/.test(ql) || /\basn\b/.test(ql) || /correlated\s+failure/.test(ql)) {
    return { template: "diversity", args: {} };
  }
  // Bridge health + circuit breaker (MB-2).
  if (/\bbridge[s]?\b/.test(ql) || /circuit\s+breaker/.test(ql) || /drain\s+cap/.test(ql)) {
    return { template: "bridge", args: {} };
  }

  // 4) "Find tokens matching MONO" / "search tokens X" / "tokens like X"
  const tokens = ql.match(/(?:tokens?|markets?|symbols?)\s+(?:matching|like|with|named|for|called)\s+([a-z0-9]+)/i)
    || ql.match(/(?:find|search)\s+([a-z0-9]+)\s+(?:tokens?|markets?)/i);
  if (tokens) {
    return { template: "tokens", args: { query: tokens[1] } };
  }
  // Loose fallback: "MONO token" / "BTC market"
  const tokens2 = ql.match(/\b([a-z0-9]{2,8})\b\s+(?:token|market|symbol)/i);
  if (tokens2) {
    return { template: "tokens", args: { query: tokens2[1] } };
  }

  // 5) "Summarize cluster 3's recent rounds" / "cluster c-007" / "cluster #14 status"
  const cluster = ql.match(/cluster\s*#?\s*(?:c-?)?(\d{1,3})/i);
  if (cluster) {
    return { template: "cluster", args: { id: parseInt(cluster[1], 10) } };
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Per-template builders                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Decide whether a tool result is "empty" — i.e. it carries no live rows the
 * reader can act on. The renderer styles empty invocations with `is-empty` so
 * a no-data answer reads as honest rather than as a populated result. We mark
 * empty when a list-shaped result reports `count === 0` (tokens, gap records,
 * address activity), or when a single-record result resolved with no live
 * identity (operator lookups that could not resolve an `operator_id`).
 */
function isEmptyToolResult(name: ToolName, result: unknown): boolean {
  if (result === null || result === undefined) return true;
  if (typeof result !== "object") return false;
  const r = result as Record<string, unknown>;
  if (typeof r.count === "number") return r.count === 0;
  if (name === "get_operator") return r.operator_id === null || r.operator_id === undefined;
  return false;
}

/** Fmt a tool invocation: call the tool, wrap with name/input/result. */
async function call<TIn extends Record<string, unknown>>(
  name: ToolName,
  input: TIn,
): Promise<ToolInvocation> {
  const result = await invokeTool(name, input);
  return { name, input, result, empty: isEmptyToolResult(name, result) };
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function explainBlock(r: GetBlockResult): string {
  // The public block RPC retains height, hash, timestamp, and execution-unit
  // usage; the DAG round is read from the raw eth response when present. Fields
  // the node does not expose (tx-count, proposer cluster, round-cert latency,
  // DAC coverage) come back `null` — render them as "not retained" rather than
  // inventing a value.
  const roundText = r.round !== null ? `round \`${r.round}\`` : "an unretained round";
  const clusterText = r.proposer_cluster !== null ? ` by cluster **${r.proposer_cluster}**` : "";
  const lines = [
    `**Block ${r.number}** committed in ${roundText}${clusterText}.`,
    "",
    r.tx_count !== null
      ? `- **${r.tx_count}** transactions included`
      : "- Transaction count: _not retained on this RPC_",
    `- Execution units: \`${r.gas_used.toLocaleString()}\` of \`${r.gas_limit.toLocaleString()}\` (${r.gas_limit > 0 ? ((r.gas_used / r.gas_limit) * 100).toFixed(1) : "0.0"}%)`,
    r.bls_agg_ms !== null
      ? `- round-certificate latency: **${r.bls_agg_ms.toFixed(2)}ms**`
      : "- round-certificate latency: _not retained on this RPC_",
    r.dac_coverage !== null
      ? `- DAC coverage: **${(r.dac_coverage * 100).toFixed(2)}%** of expected shards`
      : "- DAC coverage: _not retained on this RPC_",
    `- Status: \`${r.status}\` — finalized at ${r.timestamp_iso}`,
    "",
    `Hash: \`${r.hash}\` (parent \`${r.parent_hash}\`).`,
  ];
  return lines.join("\n");
}

function explainAddress(r: GetAddressActivityResult): string {
  const lines = [
    `**Recent activity for \`${r.address}\`** — ${r.count} transactions, current balance **${r.balance_lyth} LYTH**.`,
    "",
  ];
  if (r.is_private_denomination) {
    lines.push(
      "_Private-denomination address — recipient privacy uses stealth addresses; transfer amounts are public on-chain (confidential amounts are not yet activated)._",
      "",
    );
  } else {
    lines.push("| Hash | Type | Direction | Counterparty | LYTH | When |");
    lines.push("|------|------|-----------|--------------|------|------|");
    for (const row of r.activity) {
      lines.push(
        `| \`${row.hash}\` | ${row.type} | ${row.direction} | \`${row.counterparty}\` | ${row.value_lyth} | ${row.timestamp_relative} |`,
      );
    }
  }
  return lines.join("\n");
}

function explainGaps(r: GetGapRecordsResult): string {
  if (r.count === 0) {
    return `**No gap records over the last ${r.range}.** The chain has been advancing on every round.`;
  }
  const lines = [
    `**${r.count} gap record${r.count === 1 ? "" : "s"} over the last ${r.range}.**`,
    "",
    "Heartbeat-throttled empty rounds are coalesced into single records — they're expected, not faults. Network-pause records mean a cluster fell below quorum.",
    "",
    "| Rounds | Duration | Reason | Cluster offline |",
    "|--------|----------|--------|------------------|",
  ];
  for (const g of r.records) {
    lines.push(
      `| \`${g.start_round}–${g.end_round}\` | ${(g.duration_ms / 1000).toFixed(2)}s | ${g.reason} | ${g.cluster_offline ?? "—"} |`,
    );
  }
  return lines.join("\n");
}

function explainTokens(r: SearchTokensResult): string {
  if (r.count === 0) {
    return `**No tokens matching \`${r.query}\`.** Try a shorter substring, or a popular ticker like \`LYTH\`.`;
  }
  const lines = [
    `**${r.count} token${r.count === 1 ? "" : "s"} matching \`${r.query}\`.**`,
    "",
    "| Symbol | Name | Price | 24h | Market cap | Volume |",
    "|--------|------|-------|-----|------------|--------|",
  ];
  for (const t of r.tokens) {
    const arrow = t.change_24h_pct >= 0 ? "▲" : "▼";
    lines.push(
      `| **${t.symbol}** | ${t.name} | $${t.price_usd} | ${arrow} ${t.change_24h_pct >= 0 ? "+" : ""}${t.change_24h_pct.toFixed(2)}% | ${fmtUsd(t.market_cap_usd)} | ${fmtUsd(t.volume_24h_usd)} |`,
    );
  }
  return lines.join("\n");
}

function explainCluster(r: GetClusterResult): string {
  const stateText: Record<GetClusterResult["state"], string> = {
    nominal: "operating nominally",
    maintenance: "in maintenance — one operator degraded but quorum still met",
    jail: "below quorum — delegated stake safe but not earning",
  };
  return [
    `**Cluster ${r.name}** (slot \`C-${String(r.slot).padStart(3, "0")}\`) is **${stateText[r.state]}**.`,
    "",
    `- **${r.members_live}/${r.members_total}** active operators signing, **${r.standby_count}** on standby bench`,
    `- TVS: **${r.tvs_m_lyth}M LYTH**, APY ≈ **${r.apy_pct.toFixed(2)}%**`,
    `- Recent signing record: **${r.recent_rounds_signed}/${r.recent_rounds_window}** rounds in the last window`,
    r.rank ? `- Cluster rank: **#${r.rank}** of 100` : "",
    "",
    "**Active operators:** " + r.active_operators.join(", "),
  ]
    .filter(Boolean)
    .join("\n");
}

/* -------------------------------------------------------------------------- */
/* New-surface navigational explainers                                        */
/*                                                                            */
/* These name the surface + its route in plain English. The surfaces render   */
/* the live, factual chain data themselves; the NL layer just routes the      */
/* reader there. Typed tool fan-out lands with the @monolythium/core-sdk      */
/* 0.3.10 NL-tool catalog.                                                     */
/* -------------------------------------------------------------------------- */

function explainOracle(): string {
  return [
    "**Oracle dashboard** — open `#/oracle`.",
    "",
    "Each price feed closes a round when at least its **k-of-n** signers agree within",
    "the deviation bound. The dashboard lists every configured feed (decimals,",
    "heartbeat, deviation bps, min-signers), the authorized signer roster, and the",
    "latest median + finalized block.",
  ].join("\n");
}

function explainProver(): string {
  return [
    "**Prover market** — open `#/prover-market`.",
    "",
    "Buyers escrow a max fee against a verification key + deadline; registered GPU",
    "provers (holding `SERVES_GPU_PROVE`) bid down to the **0.1 LYTH** fee floor",
    "(**250 LYTH** bond to register). The view lists open / assigned / settled /",
    "slashed / expired requests, live bids, and registered provers.",
  ].join("\n");
}

function explainDirectory(): string {
  return [
    "**Cluster directory** — open `#/cluster-directory`.",
    "",
    "Every DVT cluster the chain has formed, fed by the on-chain `ClusterFormed`",
    "event: roster (consensus pubkeys), anchor address, effective epoch, and formation",
    "status (forming / active / draining / retired).",
  ].join("\n");
}

function explainDiversity(): string {
  return [
    "**Node diversity** — open `#/diversity`.",
    "",
    "Per-cluster correlated-failure exposure (PF-6): the entropy of each roster",
    "across autonomous systems, countries, and hosting classes, scored `0..10000`",
    "basis points. Per-operator ASN / geo / hosting / PCR-digest metadata is on the",
    "cluster detail.",
  ].join("\n");
}

function explainBridge(): string {
  return [
    "**Bridge health** — open `#/bridge`.",
    "",
    "Per-route drain-cap proximity (drained vs cap-per-window) plus circuit-breaker",
    "state. The breaker pauses claims when a route's window cap is crossed, then",
    "waits out a resume cooldown before it re-arms.",
  ].join("\n");
}

function explainOperatorFee(): string {
  return [
    "**Operator fees** — monoscan is the neutral transparency surface for the",
    "on-chain operator-fee facts.",
    "",
    "Registered GPU provers publish a per-prover **fee floor** (≥ 0.1 LYTH) and a",
    "locked **bond** (≥ 250 LYTH); see `#/prover-market`. Oracle signers and their",
    "feed parameters are at `#/oracle`. These values are read straight from chain",
    "state — monoscan reports them factually, without a verdict.",
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Public driver                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Run the local router against a natural-language question. Resolves on a
 * short `setTimeout` so the renderer can show thinking and per-tool calling
 * states consistently.
 *
 * @param signal optional AbortSignal — the renderer cancels in-flight
 *               queries when the user submits a new one.
 */
export async function ask(
  question: string,
  signal?: AbortSignal,
): Promise<NlAnswer> {
  // Tiny artificial delay so the UI's "thinking" state isn't a flicker.
  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("aborted", "AbortError"));
      return;
    }
    const t = setTimeout(resolve, 380);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });

  const matched = matchQuery(question);
  if (!matched) {
    return {
      question,
      tool_calls: [],
      explanation: [
        "I'm not sure how to answer that yet.",
        "",
        "The local router supports these query shapes:",
      ].join("\n"),
      unmatched: true,
      examples: [...SAMPLE_QUERIES_VAL],
    };
  }

  const tool_calls: ToolInvocation[] = [];
  let explanation = "";

  switch (matched.template) {
    case "block": {
      const inv = await call("get_block", { number_or_hash: matched.args.number_or_hash });
      tool_calls.push(inv);
      explanation = explainBlock(inv.result as GetBlockResult);
      break;
    }
    case "address": {
      const inv = await call("get_address_activity", {
        address: String(matched.args.address),
        limit: 5,
      });
      tool_calls.push(inv);
      explanation = explainAddress(inv.result as GetAddressActivityResult);
      break;
    }
    case "gaps": {
      const inv = await call("get_gap_records", { range: String(matched.args.range ?? "24h") });
      tool_calls.push(inv);
      explanation = explainGaps(inv.result as GetGapRecordsResult);
      break;
    }
    case "tokens": {
      const inv = await call("search_tokens", { query: String(matched.args.query) });
      tool_calls.push(inv);
      explanation = explainTokens(inv.result as SearchTokensResult);
      break;
    }
    case "cluster": {
      const inv = await call("get_cluster", { id: Number(matched.args.id) });
      tool_calls.push(inv);
      explanation = explainCluster(inv.result as GetClusterResult);
      break;
    }
    case "oracle": {
      explanation = explainOracle();
      break;
    }
    case "prover": {
      explanation = explainProver();
      break;
    }
    case "directory": {
      explanation = explainDirectory();
      break;
    }
    case "diversity": {
      explanation = explainDiversity();
      break;
    }
    case "bridge": {
      explanation = explainBridge();
      break;
    }
    case "operatorFee": {
      explanation = explainOperatorFee();
      break;
    }
  }

  return {
    question,
    tool_calls,
    explanation,
    unmatched: false,
    examples: [...SAMPLE_QUERIES_VAL],
  };
}

/** Re-export so the renderer can show the canned suggestions. */
export const SAMPLES: typeof SAMPLE_QUERIES = SAMPLE_QUERIES_VAL;
