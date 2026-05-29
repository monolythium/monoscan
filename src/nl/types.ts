/**
 * Types shared between the deterministic query router, the typed tool layer,
 * and the renderer.
 */

/** Names of every tool the query router can call. */
export type ToolName =
  | "get_block"
  | "get_tx"
  | "get_operator"
  | "get_cluster"
  | "get_gap_records"
  | "search_tokens"
  | "get_address_activity";

/**
 * A single tool invocation with its result. The router returns a
 * sequence of these in `tool_calls` order; the renderer shows them as
 * a collapsible trace.
 */
export interface ToolInvocation {
  /** Which typed tool was called. */
  name: ToolName;
  /** Input arguments — JSON-serializable. */
  input: Record<string, unknown>;
  /** Tool result payload — JSON-serializable. */
  result: unknown;
  /** True if the tool reported "no match"/"not found" rather than throwing. */
  empty?: boolean;
}

/**
 * The aggregated answer from the router. The renderer shows the
 * trace first, then `explanation` as Markdown.
 *
 * `error` populates when the query didn't match any template — the
 * renderer falls back to the example-buttons hint.
 */
export interface NlAnswer {
  question: string;
  /** Tool calls made, in order. Empty array is allowed (e.g. fallback). */
  tool_calls: ToolInvocation[];
  /** Markdown body. Always present, even on fallback. */
  explanation: string;
  /** True when the router could not match the query to a supported shape. */
  unmatched: boolean;
  /** Example queries to show as clickable buttons on fallback. */
  examples: string[];
}

/** Sample queries surfaced as buttons. */
export const SAMPLE_QUERIES: string[] = [
  "What happened in block 12345?",
  "Show me the latest activity for mono1...",
  "Are there any recent gap records?",
  "Find tokens matching MONO",
  "Summarize cluster 3's recent rounds",
  "Show the oracle feeds",
  "Open the prover market",
  "How diverse are the clusters?",
  "Bridge circuit-breaker status",
];
