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
    | "cluster";
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

  // 2) "Show me activity for 0xabc..." / "address 0x..." / "what's 0x..." doing
  const addr = ql.match(/(?:0x[a-f0-9]+(?:\.\.\.|…)?[a-f0-9]*)/i);
  if (addr && /(activity|recent|history|address|happen|do)/.test(ql)) {
    return { template: "address", args: { address: addr[0] } };
  }

  // 3) "Are there any recent gap records?" / "gap records" / "any gaps"
  if (/\bgap[s]?\b/.test(ql) || /\bempty block/.test(ql) || /heartbeat/.test(ql)) {
    return { template: "gaps", args: { range: "24h" } };
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

/** Fmt a tool invocation: call the tool, wrap with name/input/result. */
async function call<TIn extends Record<string, unknown>>(
  name: ToolName,
  input: TIn,
): Promise<ToolInvocation> {
  const result = await invokeTool(name, input);
  return { name, input, result };
}

function fmtUsd(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function explainBlock(r: GetBlockResult): string {
  return [
    `**Block ${r.number}** committed in round \`${r.round}\` by cluster **${r.proposer_cluster}**.`,
    "",
    `- **${r.tx_count}** transactions included`,
    `- Gas used: \`${r.gas_used.toLocaleString()}\` of \`${r.gas_limit.toLocaleString()}\` (${((r.gas_used / r.gas_limit) * 100).toFixed(1)}%)`,
    `- BLS aggregation latency: **${r.bls_agg_ms.toFixed(2)}ms**`,
    `- DAC coverage: **${(r.dac_coverage * 100).toFixed(2)}%** of expected shards`,
    `- Status: \`${r.status}\` — finalized at ${r.timestamp_iso}`,
    "",
    `Hash: \`${r.hash}\` (parent \`${r.parent_hash}\`).`,
  ].join("\n");
}

function explainAddress(r: GetAddressActivityResult): string {
  const lines = [
    `**Recent activity for \`${r.address}\`** — ${r.count} transactions, current balance **${r.balance_lyth} LYTH**.`,
    "",
  ];
  if (r.is_private_denomination) {
    lines.push(
      "_Private-denomination address — amounts withheld by protocol privacy rules._",
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
