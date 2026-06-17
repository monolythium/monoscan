import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Card, Icon } from "./primitives";
import {
  browserWalletLabel,
  DAPP_DIRECTORY_ENTRIES,
  DAPP_DIRECTORY_REPO_URL,
  DAPP_FILTERS,
  filterDappDirectory,
  listingStatusLabel,
  networkLabel,
  type DappDirectoryEntry,
  type DappFilter,
} from "./data/dapp-directory";

const externalHost = (url?: string) => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
};

const walletTone = (entry: DappDirectoryEntry) => {
  switch (entry.browserWalletCompatibility) {
    case "compatible": return "ok";
    case "planned": return "warn";
    case "not-compatible": return "err";
    default: return "";
  }
};

const statusTone = (entry: DappDirectoryEntry) => {
  switch (entry.listingStatus) {
    case "official":
    case "foundation-maintained":
      return "gold";
    case "experimental":
      return "warn";
    case "deprecated":
      return "err";
    default:
      return "";
  }
};

const ExternalLink = ({ href, children, primary = false }: { href?: string; children: ReactNode; primary?: boolean }) => {
  if (!href) {
    return <span className="dapp-link is-disabled">{children}</span>;
  }
  return (
    <a
      className={`dapp-link ${primary ? "is-primary" : ""}`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
};

const DappDetailsModal = ({ entry, onClose }: { entry: DappDirectoryEntry; onClose: () => void }) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dapp-modal" role="dialog" aria-modal="true" aria-label={`${entry.productName} details`} onClick={onClose}>
      <div className="dapp-modal__panel" onClick={(event) => event.stopPropagation()}>
        <div className="dapp-modal__head">
          <div>
            <div className="cap">dApp directory</div>
            <h2>{entry.productName}</h2>
            <div className="dapp-modal__meta">
              <span className="pill gold">{entry.category}</span>
              <span className={`pill ${statusTone(entry)}`}>{listingStatusLabel(entry.listingStatus)}</span>
            </div>
          </div>
          <button type="button" className="dapp-modal__close" onClick={onClose} aria-label="Close dApp details">
            <Icon name="close" size={16}/>
          </button>
        </div>

        <div className="dapp-modal__body">
          <p className="dapp-modal__tagline">{entry.tagline}</p>
          <p>{entry.description}</p>

          <div className="dapp-kv">
            <div>
              <span>Creator</span>
              <b>{entry.creator}</b>
            </div>
            <div>
              <span>Network</span>
              <b>{networkLabel(entry.network)}</b>
            </div>
            <div>
              <span>Open source</span>
              <b>{entry.openSource ? "Yes" : "No"}</b>
            </div>
            <div>
              <span>Browser wallet</span>
              <b>{browserWalletLabel(entry.browserWalletCompatibility)}</b>
            </div>
            <div>
              <span>Last reviewed</span>
              <b>{entry.lastReviewedAt}</b>
            </div>
          </div>

          {entry.browserWalletNotes && (
            <div className="dapp-note">
              <Icon name="wallet" size={16}/>
              <span>{entry.browserWalletNotes}</span>
            </div>
          )}

          <div className="dapp-warning">
            <Icon name="warn" size={17}/>
            <span>
              You are leaving Monoscan. Listed dApps, bridges, and tools may be community-built and are not necessarily operated,
              audited, or endorsed by the Monolythium Foundation. Review the destination before connecting a wallet or moving funds.
            </span>
          </div>

          <div className="dapp-actions">
            <ExternalLink href={entry.websiteUrl} primary>
              {entry.websiteUrl ? `Open dApp · ${externalHost(entry.websiteUrl)}` : "dApp URL pending"}
            </ExternalLink>
            <ExternalLink href={entry.sourceUrl}>Source</ExternalLink>
            <ExternalLink href={entry.docsUrl}>Docs</ExternalLink>
          </div>
        </div>
      </div>
    </div>
  );
};

const LeavingMonoscanModal = ({ href, onClose }: { href: string; onClose: () => void }) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const host = externalHost(href) || href;
  const continueOut = () => {
    window.open(href, "_blank", "noopener,noreferrer");
    onClose();
  };

  return (
    <div className="dapp-modal" role="dialog" aria-modal="true" aria-label="Leaving Monoscan" onClick={onClose}>
      <div className="dapp-modal__panel dapp-modal__panel--compact" onClick={(event) => event.stopPropagation()}>
        <div className="dapp-modal__head">
          <div>
            <div className="cap">external link</div>
            <h2>You are leaving Monoscan</h2>
          </div>
          <button type="button" className="dapp-modal__close" onClick={onClose} aria-label="Close external link warning">
            <Icon name="close" size={16}/>
          </button>
        </div>
        <div className="dapp-modal__body">
          <div className="dapp-warning">
            <Icon name="warn" size={17}/>
            <span>
              You are about to open {host}. This website is outside Monoscan. Content in the public directory repo
              may be maintained by contributors and is not necessarily operated, audited, or endorsed by the Monolythium Foundation.
            </span>
          </div>
          <div className="dapp-actions">
            <button type="button" className="dapp-link" onClick={onClose}>Cancel</button>
            <button type="button" className="dapp-link is-primary" onClick={continueOut}>Continue to GitHub</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const DappsPage = () => {
  const [filter, setFilter] = useState<DappFilter>("Show all");
  const [selected, setSelected] = useState<DappDirectoryEntry | null>(null);
  const [leavingUrl, setLeavingUrl] = useState<string | null>(null);
  const rows = useMemo(() => filterDappDirectory(DAPP_DIRECTORY_ENTRIES, filter), [filter]);

  return (
    <div className="ms-page dapps-page">
      <section className="dapps-hero">
        <div>
          <div className="cap">Web3 directory</div>
          <h1>Discover dApps on Monolythium</h1>
          <p>
            A public, PR-reviewed directory for games, bridges, finance apps, AI tools, identity flows,
            supply-chain systems, MCP servers, and other products using the chain or browser wallet.
          </p>
        </div>
        <button type="button" className="dapp-directory-link" onClick={() => setLeavingUrl(DAPP_DIRECTORY_REPO_URL)}>
          Add your dApp
          <span>{externalHost(DAPP_DIRECTORY_REPO_URL)}</span>
        </button>
      </section>

      <Card
        title="dApps / Web3"
        sub="Listings are informational. Compatibility and source status are reviewed from public data; they are not audits."
        right={<span className="cap">{rows.length} shown</span>}
      >
        <div className="dapp-filterbar" role="tablist" aria-label="dApp category filter">
          {DAPP_FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={filter === item}
              className={`dapp-filter ${filter === item ? "is-active" : ""}`}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div className="dapp-table-wrap">
          <table className="ms-table dapp-table">
            <thead>
              <tr>
                <th>Product name</th>
                <th>Category</th>
                <th>Network</th>
                <th>Creator</th>
                <th>Open source</th>
                <th>Browser wallet compatibility</th>
                <th>More info</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <tr key={entry.id} onClick={() => setSelected(entry)}>
                  <td>
                    <div className="dapp-product">
                      <b>{entry.productName}</b>
                      <span>{entry.tagline}</span>
                    </div>
                  </td>
                  <td><span className="pill gold">{entry.category}</span></td>
                  <td><span className="pill">{networkLabel(entry.network)}</span></td>
                  <td>{entry.creator}</td>
                  <td><span className={`pill ${entry.openSource ? "ok" : "warn"}`}>{entry.openSource ? "Yes" : "No"}</span></td>
                  <td><span className={`pill ${walletTone(entry)}`}>{browserWalletLabel(entry.browserWalletCompatibility)}</span></td>
                  <td>
                    <button
                      type="button"
                      className="dapp-info-btn"
                      onClick={(event) => { event.stopPropagation(); setSelected(entry); }}
                    >
                      More info
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={7}>
                    <div className="dapp-empty">No listings in this category yet.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="dapps-disclaimer">
        <Icon name="info" size={16}/>
        <span>
          Want to list an app? Open a PR against the public directory repo with one JSON entry per product.
          Monoscan renders reviewed public data; it does not grant security guarantees.
        </span>
      </div>

      {selected && <DappDetailsModal entry={selected} onClose={() => setSelected(null)}/>}
      {leavingUrl && <LeavingMonoscanModal href={leavingUrl} onClose={() => setLeavingUrl(null)}/>}
    </div>
  );
};
