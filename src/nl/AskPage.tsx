/**
 * Ask Monoscan — natural-language search over typed node-service tools.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { ask, SAMPLES } from "./query-router";
import { Markdown } from "./markdown";
import type { NlAnswer, ToolInvocation } from "./types";

const SAMPLE_GROUP_LABELS = [
  "DAG state",
  "Accounts",
  "On-chain services",
  "Network health",
] as const;

type SampleGroupLabel = (typeof SAMPLE_GROUP_LABELS)[number];

function promptCategory(query: string): SampleGroupLabel {
  const q = query.toLowerCase();
  if (q.includes("mono1") || q.includes("activity")) return "Accounts";
  if (
    q.includes("token")
    || q.includes("oracle")
    || q.includes("prover")
    || q.includes("bridge")
  ) {
    return "On-chain services";
  }
  if (q.includes("diverse")) return "Network health";
  return "DAG state";
}

const SAMPLE_GROUPS = SAMPLE_GROUP_LABELS.map((label) => ({
  label,
  prompts: SAMPLES.filter((query) => promptCategory(query) === label),
})).filter((group) => group.prompts.length > 0);

const HERO_FACTS = [
  { label: "Rounds", value: "commits + vertices" },
  { label: "Txs", value: "accounts + activity" },
  { label: "Trace", value: "typed JSON I/O" },
];

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

  /** Run the deterministic query router. Cancels any in-flight call first. */
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
        className="ov-cta ov-cta--ghost ms-ask__back"
        onClick={() => go("#/")}
      >
        Overview
      </button>

      <section className="ms-ask__hero">
        <header className="ms-ask__head">
          <div className="ms-ask__eyebrow cap">
            <span className="dot" />
            Starfish DAG query console · live tools
          </div>
          <h1 className="ms-h1">
            Ask Monoscan about rounds, commits, txs, and on-chain services.{" "}
            <span>It picks the typed tool path.</span>
          </h1>
          <p className="mono ms-ask__lede">
            Natural-language search over Starfish DAG explorer data: rounds,
            vertices, tx activity, operators, clusters, gap records, tokens, and
            addresses. Each answer shows the tool trace it used.
          </p>
          <div className="ms-ask__facts" aria-label="Ask Monoscan coverage">
            {HERO_FACTS.map((fact) => (
              <div className="ms-ask__fact" key={fact.label}>
                <span className="cap">{fact.label}</span>
                <b className="mono">{fact.value}</b>
              </div>
            ))}
          </div>
        </header>

        <section className="ms-ask__prompt-panel" aria-label="Ask Monoscan prompt">
          <div className="ms-ask__panel-top">
            <span className="cap">Explorer query</span>
            <span className="mono">deterministic router</span>
          </div>

          <form onSubmit={submit} className="ms-ask__form">
            <span className="ms-ask__form-label cap">Question</span>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What committed in round 12345? · mono1... recent activity · cluster 3 status"
              aria-label="Ask Monoscan a natural-language question"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="submit"
              className="ov-cta ov-cta--primary"
              disabled={thinking || !draft.trim()}
            >
              {thinking ? "Asking..." : "Ask"}
            </button>
          </form>

          {/* Sample query chips - always visible so first-time users have a path. */}
          <div className="ms-ask__chips" aria-label="Sample prompts">
            <div className="ms-ask__chips-title">
              <span className="cap">Try a routed prompt</span>
            </div>
            {SAMPLE_GROUPS.map((group) => (
              <section className="ms-ask__chip-group" key={group.label}>
                <span className="ms-ask__chip-label cap">{group.label}</span>
                <div className="ms-ask__chip-row">
                  {group.prompts.map((q) => (
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
              </section>
            ))}
          </div>
        </section>
      </section>

      {error && (
        <div className="ms-ask__error">
          <span className="pill err">error</span>
          <span className="mono">{error}</span>
        </div>
      )}

      {/* Status line for live and local data coverage. */}
      <div className="ms-ask__notice">
        <span className="pill">routed</span>
        <span className="mono">
          Deterministic routing with live tools where available. Gap records,
          token search, and rich operator aggregates surface as their indexer
          namespaces land.
        </span>
      </div>

      {thinking && (
        <div className="ms-ask__thinking">
          <span className="ms-ask__pulse" />
          <span className="mono">
            Considering tools and drafting the answer for{" "}
            <b>"{query}"</b>...
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
  const toolCount = answer.tool_calls.length;

  return (
    <article className="ms-ask__answer">
      <div className="ms-ask__answer-head ms-ask__surface">
        <div>
          <div className="cap">Question</div>
          <div className="ms-ask__q">{answer.question}</div>
        </div>
        <div className="ms-ask__answer-actions">
          <div className="ms-ask__answer-meta mono">
            {answer.unmatched
              ? "no template matched"
              : `${toolCount} tool call${toolCount === 1 ? "" : "s"}`}
          </div>
          <CopyButton label="Copy answer" text={answer.explanation} />
        </div>
      </div>

      <div className={`ms-ask__answer-grid${toolCount === 0 ? " ms-ask__answer-grid--single" : ""}`}>
        {/* Tool-call trace */}
        {toolCount > 0 && (
          <section className="ms-ask__trace ms-ask__surface">
            <div className="ms-ask__surface-head">
              <div>
                <div className="cap">Tool trace</div>
                <span className="mono">{toolCount} typed call{toolCount === 1 ? "" : "s"}</span>
              </div>
              <span className="pill gold">traceable</span>
            </div>
            <div className="ms-ask__trace-list">
              {answer.tool_calls.map((inv, idx) => (
                <ToolCallRow key={idx} index={idx + 1} invocation={inv} />
              ))}
            </div>
          </section>
        )}

        {/* Markdown explanation */}
        <section className="ms-ask__answer-body ms-ask__surface">
          <div className="ms-ask__surface-head">
            <div>
              <div className="cap">Answer</div>
              <span className="mono">
                {answer.unmatched ? "suggested prompts" : "composed result"}
              </span>
            </div>
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
      </div>
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
  const inputJson = JSON.stringify(invocation.input, null, 2);
  const resultJson = JSON.stringify(invocation.result, null, 2);
  return (
    <div className={`ms-ask__call${invocation.empty ? " ms-ask__call--empty" : ""}`}>
      <button
        type="button"
        className="ms-ask__call-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="mono ms-ask__call-step">{index.toString().padStart(2, "0")}</span>
        <span className="ms-ask__call-name mono">{invocation.name}</span>
        <span className={`ms-ask__call-status mono${invocation.empty ? " is-empty" : " is-ok"}`}>
          {invocation.empty ? "empty" : "ok"}
        </span>
        <span className="ms-ask__call-summary mono">{summary}</span>
        <span className="ms-ask__call-chev mono" aria-hidden="true">{open ? "Hide" : "View"}</span>
      </button>
      {open && (
        <div className="ms-ask__call-body">
          <div className="ms-ask__json-panel">
            <div className="ms-ask__json-head">
              <div className="cap">Input</div>
              <CopyButton compact label={`Copy ${invocation.name} input`} text={inputJson} />
            </div>
            <pre className="ms-ask__json">{inputJson}</pre>
          </div>
          <div className="ms-ask__json-panel">
            <div className="ms-ask__json-head">
              <div className="cap">Result</div>
              <CopyButton compact label={`Copy ${invocation.name} result`} text={resultJson} />
            </div>
            <pre className="ms-ask__json">{resultJson}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function CopyButton({
  text,
  label,
  compact = false,
}: {
  text: string;
  label: string;
  compact?: boolean;
}): ReactElement {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const copy = useCallback(async () => {
    try {
      await copyText(text);
      setStatus("copied");
    } catch {
      setStatus("error");
    }

    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setStatus("idle"), 1400);
  }, [text]);

  return (
    <button
      type="button"
      className={`ms-ask__copy${compact ? " ms-ask__copy--compact" : ""}`}
      onClick={() => void copy()}
      aria-label={label}
    >
      {status === "copied" ? "Copied" : status === "error" ? "Retry" : "Copy"}
    </button>
  );
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) throw new Error("Clipboard copy failed");
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
