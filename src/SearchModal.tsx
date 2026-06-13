// Centred search modal. Replaces the previous inline search input that
// crowded the header at narrow widths.
//
// Behaviour:
//   - Click the header's Search button → modal opens.
//   - Cmd/Ctrl + K anywhere → modal opens.
//   - Escape or backdrop click → close without navigating.
//   - Enter on the input → routes the same way the inline form did
//     (bare integer → block at that HEIGHT, bech32m account mono1… → wallet,
//     0x… → search, c-N → cluster, anything else → search) and closes the
//     modal. A bare integer is a block height, not a DAG round: it resolves
//     through `#/round/{height}` — the app's block-height detail view, which
//     reads its route param as a chain height (see RoundPage in
//     monoscan-extras.tsx). `#/round` is the only block-height route the app
//     dispatches; there is no separate `#/block` route.

import { useCallback, useEffect, useRef, useState } from "react";

// A bech32m account address (`mono1…`, bech32 charset) routes straight to its
// wallet/address page — mirroring how the design's header sent an operator
// address to its profile. Other HRPs (cluster/contract) fall through to the
// unified search, which disambiguates them.
const BECH32M_ACCOUNT_RE = /^mono1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,}$/i;

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  go: (hash: string) => void;
}

export function SearchModal({ open, onClose, go }: SearchModalProps) {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input as soon as the modal mounts. The `autoFocus`
  // attribute doesn't fire on conditionally-mounted elements
  // consistently across browsers; an explicit ref + useEffect always
  // does.
  useEffect(() => {
    if (!open) return;
    setQ("");
    // Defer one frame so the input is actually in the DOM tree.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Esc closes the modal without navigating.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const v = q.trim();
      if (!v) return;
      const lower = v.toLowerCase();
      // New-surface keyword shortcuts (PF-6 / MB-6 / PF-4 / MB-5 / MB-4 / MB-2).
      const surfaceRoute: Record<string, string> = {
        diversity: "#/diversity",
        oracle: "#/oracle",
        oracles: "#/oracle",
        feed: "#/oracle",
        feeds: "#/oracle",
        prover: "#/prover-market",
        provers: "#/prover-market",
        "prover market": "#/prover-market",
        bridge: "#/bridge",
        bridges: "#/bridge",
        directory: "#/cluster-directory",
        "cluster directory": "#/cluster-directory",
        policy: "#/wallets",
        "spending policy": "#/wallets",
        "operator fee": "#/prover-market",
        "operator fees": "#/prover-market",
      };
      if (surfaceRoute[lower]) go(surfaceRoute[lower]);
      else if (BECH32M_ACCOUNT_RE.test(v)) go(`#/wallet/${encodeURIComponent(v)}`);
      // A bare integer is a block HEIGHT. The block-height detail view is the
      // `#/round/{height}` route (RoundPage reads its param as a chain height,
      // not a DAG round) — this matches how every other nav site in the app
      // links to a block (overview movers, tx rows, the transactions page). No
      // `#/block` route exists, so routing there would 404.
      else if (/^\d+$/.test(v)) go(`#/round/${v}`);
      else if (v.startsWith("0x")) go(`#/search/${encodeURIComponent(v)}`);
      else if (/^c-\d+/i.test(v)) go(`#/cluster/${v.slice(2)}`);
      else go(`#/search/${encodeURIComponent(v)}`);
      onClose();
    },
    [q, go, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="ms-searchmodal"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
      onClick={onClose}
    >
      <div
        className="ms-searchmodal__card"
        onClick={(e) => e.stopPropagation()}
      >
        <form onSubmit={submit} className="ms-searchmodal__form">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Block height · C-0 · mono1… · tx hash · oracle · prover · bridge · diversity"
            className="ms-searchmodal__input"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="ms-searchmodal__hint mono">enter ↵</span>
        </form>
        <div className="ms-searchmodal__examples">
          <span>Try</span>
          <button
            type="button"
            onClick={() => {
              go("#/round/2938441");
              onClose();
            }}
          >
            2938441
          </button>
          <button
            type="button"
            onClick={() => {
              go("#/cluster/0");
              onClose();
            }}
          >
            C-0
          </button>
          <button
            type="button"
            onClick={() => {
              go("#/transactions");
              onClose();
            }}
          >
            transactions
          </button>
          <button
            type="button"
            onClick={() => {
              go("#/operators");
              onClose();
            }}
          >
            operators
          </button>
          <button
            type="button"
            onClick={() => {
              go("#/oracle");
              onClose();
            }}
          >
            oracle
          </button>
          <button
            type="button"
            onClick={() => {
              go("#/prover-market");
              onClose();
            }}
          >
            provers
          </button>
          <button
            type="button"
            onClick={() => {
              go("#/bridge");
              onClose();
            }}
          >
            bridge
          </button>
        </div>
      </div>
    </div>
  );
}
