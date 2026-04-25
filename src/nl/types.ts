/**
 * Types shared between the mock LLM driver, the typed tool layer,
 * and the renderer.
 *
 * The shapes here intentionally mirror what the Anthropic Messages API
 * tool-use response gives back (`tool_use` blocks + a `text` block) so
 * the renderer doesn't change shape when we swap `mock-llm.ts` for the
 * real Claude call.
 *
 * TODO(monolythium-vision): swap this file's `mock-llm` consumer for the
 * real Claude API client once the `mono/api/monoscan-claude` key is
 * provisioned and the Rust proxy crate (`monoscan-nl-service/`) lands.
 * The wire shape stays the same — only the producer changes.
 */

/** Names of every tool the (mock) LLM can call. */
export type ToolName =
  | "get_block"
  | "get_tx"
  | "get_validator"
  | "get_cluster"
  | "get_gap_records"
  | "search_tokens"
  | "get_address_activity";

/**
 * A single tool invocation with its result. The mock LLM returns a
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
 * The aggregated answer from the (mock) LLM. The renderer shows the
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
  /** True when the mock couldn't match the query to any template. */
  unmatched: boolean;
  /** Example queries to show as clickable buttons on fallback. */
  examples: string[];
}

/** Sample queries the mockup handles end-to-end. Surfaced as buttons. */
export const SAMPLE_QUERIES: string[] = [
  "What happened in block 12345?",
  "Show me the latest activity for 0xabc1...",
  "Are there any recent gap records?",
  "Find tokens matching MONO",
  "Summarize cluster 3's recent rounds",
];
