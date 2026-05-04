/**
 * Ask Monoscan — natural-language search over typed node-service tools.
 *
 * HYBRID STAGE — the LLM substrate is `mock-llm.ts` (deterministic
 * pattern matching); the typed tools in `tools.ts` are live-first for
 * current RPC surfaces and fixture-backed for missing indexer data. The full UX is real: streaming-style trace,
 * collapsible per-tool view, Markdown answer block. The follow-up stage
 * swaps `mock-llm` for the real Anthropic Messages API.
 *
 * TODO(monolythium-vision): swap `ask` import for the real Claude API
 * client once `mono/api/monoscan-claude` is provisioned and the
 * `monoscan-nl-service/` Rust proxy is deployed.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { ask, SAMPLES } from "./mock-llm";
import { Markdown } from "./markdown";
import type { NlAnswer, ToolInvocation } from "./types";

interface AskPageProps {
  /** Hash-router callback (legacy `App.go`). Used only by the back link. */
  go: (hash: string) => void;
  /** Initial query lifted from the URL hash (e.g. `#/ask/<encoded>`). */
  initialQuery?: string;
}

export function AskPage({ go, initialQuery }: AskPageProps): ReactElement {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [draft, setDraft] = useState(initialQuery ?? "");
  const [answer, setAnswer] = useState<NlAnswer | null>(null);
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  /** Run the deterministic LLM router. Cancels any in-flight call first. */
  const runQuery = useCallback(async (q: string) => {
    if (!q.trim()) return;
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setThinking(true);
    setError(null);
    setQuery(q);
    try {
      const res = await ask(q, ctrl.signal);
      // Discard if a newer query already started.
      if (ctrl.signal.aborted) return;
      setAnswer(res);
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
      setError((err as Error)?.message ?? "Query failed");
    } finally {
      if (!ctrl.signal.aborted) setThinking(false);
    }
  }, []);

  // If the URL arrives with `#/ask/<encoded>`, run it immediately.
  useEffect(() => {
    if (initialQuery && initialQuery.trim()) {
      void runQuery(initialQuery);
    } else {
      inputRef.current?.focus();
    }
    // intentionally only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void runQuery(draft);
  };

  const onExample = (q: string) => {
    setDraft(q);
    void runQuery(q);
  };

  return (
    <div className="ms-page ms-ask">
      <button
        className="ov-cta ov-cta--ghost"
        onClick={() => go("#/")}
        style={{ alignSelf: "flex-start" }}
      >
        ← Overview
      </button>

      <header className="ms-ask__head">
        <div className="cap" style={{ color: "var(--gold)" }}>
          Ask the blockchain · live tools
        </div>
        <h1 className="ms-h1">
          Ask Monoscan a question.{" "}
          <span style={{ color: "var(--fg-400)" }}>It picks the right tools.</span>
        </h1>
        <p className="mono ms-ask__lede">
          Natural-language search over typed node-service queries — block, transaction,
          operator, cluster, gap-record, token, and address tools. Type a question, see
          which tools the answer pulled from.
        </p>
      </header>

      <form onSubmit={submit} className="ms-ask__form">
        <span className="ms-ask__form-label cap">Question</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="What happened in block 12345? · 0xabc1… recent activity · cluster 3 status"
          aria-label="Ask Monoscan a natural-language question"
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          className="ov-cta ov-cta--primary"
          disabled={thinking || !draft.trim()}
        >
          {thinking ? "Asking…" : "Ask ↵"}
        </button>
      </form>

      {/* Sample query chips — always visible so first-time users have a path. */}
      <div className="ms-ask__chips">
        <span className="cap" style={{ color: "var(--fg-400)" }}>Try:</span>
        {SAMPLES.map((q) => (
          <button
            key={q}
            type="button"
            className="ms-ask__chip"
            onClick={() => onExample(q)}
            disabled={thinking}
          >
            {q}
          </button>
        ))}
      </div>

      {error && (
        <div className="ms-ask__error">
          <span className="pill err">error</span>
          <span className="mono" style={{ color: "var(--err)" }}>
            {error}
          </span>
        </div>
      )}

      {/* Status line: a tiny disclosure that the LLM router is mocked. */}
      <div className="ms-ask__notice">
        <span className="pill">hybrid</span>
        <span className="mono">
          Deterministic routing with live RPC-backed tools where available. Gap records,
          token search, and rich operator aggregates remain fixture-backed until their
          indexer namespaces land.
        </span>
      </div>

      {thinking && (
        <div className="ms-ask__thinking">
          <span className="ms-ask__pulse" />
          <span className="mono">
            Considering tools and drafting the answer for{" "}
            <b style={{ color: "var(--gold)" }}>"{query}"</b>…
          </span>
        </div>
      )}

      {answer && !thinking && (
        <AnswerBlock answer={answer} onExample={onExample} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Answer rendering                                                           */
/* -------------------------------------------------------------------------- */

function AnswerBlock({
  answer,
  onExample,
}: {
  answer: NlAnswer;
  onExample: (q: string) => void;
}): ReactElement {
  return (
    <article className="ms-ask__answer ms-card">
      <div className="ms-ask__answer-head">
        <div>
          <div className="cap">Question</div>
          <div className="ms-ask__q">{answer.question}</div>
        </div>
        <div className="ms-ask__answer-meta mono">
          {answer.unmatched
            ? "no template matched"
            : `${answer.tool_calls.length} tool call${answer.tool_calls.length === 1 ? "" : "s"}`}
        </div>
      </div>

      {/* Tool-call trace */}
      {answer.tool_calls.length > 0 && (
        <section className="ms-ask__trace">
          <div className="cap" style={{ marginBottom: 10 }}>
            Tool-call trace
          </div>
          {answer.tool_calls.map((inv, idx) => (
            <ToolCallRow key={idx} index={idx + 1} invocation={inv} />
          ))}
        </section>
      )}

      {/* Markdown explanation */}
      <section className="ms-ask__answer-body">
        <div className="cap" style={{ marginBottom: 8 }}>
          Answer
        </div>
        <Markdown source={answer.explanation} />
        {answer.unmatched && (
          <div className="ms-ask__examples">
            {answer.examples.map((ex) => (
              <button
                key={ex}
                className="ms-ask__chip"
                type="button"
                onClick={() => onExample(ex)}
              >
                {ex}
              </button>
            ))}
          </div>
        )}
      </section>
    </article>
  );
}

/** Collapsible row for a single tool invocation. Click to expand JSON I/O. */
function ToolCallRow({
  index,
  invocation,
}: {
  index: number;
  invocation: ToolInvocation;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const summary = summarizeInput(invocation);
  return (
    <div className="ms-ask__call">
      <button
        type="button"
        className="ms-ask__call-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="mono ms-ask__call-step">{index.toString().padStart(2, "0")}</span>
        <span className="ms-ask__call-name mono">{invocation.name}</span>
        <span className="ms-ask__call-summary mono">{summary}</span>
        <span className="ms-ask__call-chev mono">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="ms-ask__call-body">
          <div className="cap">Input</div>
          <pre className="ms-ask__json">{JSON.stringify(invocation.input, null, 2)}</pre>
          <div className="cap" style={{ marginTop: 12 }}>
            Result
          </div>
          <pre className="ms-ask__json">{JSON.stringify(invocation.result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

/** One-line summary of the input args, for the closed-row state. */
function summarizeInput(inv: ToolInvocation): string {
  const entries = Object.entries(inv.input);
  if (entries.length === 0) return "(no args)";
  return entries
    .map(([k, v]) => {
      const s =
        typeof v === "string" ? `"${v}"` : typeof v === "object" ? JSON.stringify(v) : String(v);
      return `${k}=${s}`;
    })
    .join(" · ");
}
