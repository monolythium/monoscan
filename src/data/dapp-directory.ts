export const DAPP_CATEGORIES = [
  "AI",
  "Bridges",
  "Education",
  "Finance",
  "Games",
  "Healthcare",
  "ID",
  "Prediction Markets",
  "Social",
  "Supply Chain",
  "Tools",
] as const;

export const DAPP_FILTERS = ["Show all", ...DAPP_CATEGORIES] as const;

export type DappCategory = typeof DAPP_CATEGORIES[number];
export type DappFilter = typeof DAPP_FILTERS[number];
export type DappListingStatus = "official" | "foundation-maintained" | "community" | "experimental" | "deprecated";
export type BrowserWalletCompatibility = "compatible" | "planned" | "not-compatible" | "unknown";
export type DappNetwork = "mainnet" | "testnet" | "mainnet-and-testnet";

export interface DappDirectoryEntry {
  id: string;
  productName: string;
  category: DappCategory;
  network: DappNetwork;
  creator: string;
  openSource: boolean;
  browserWalletCompatibility: BrowserWalletCompatibility;
  browserWalletNotes?: string;
  listingStatus: DappListingStatus;
  tagline: string;
  description: string;
  websiteUrl?: string;
  sourceUrl?: string;
  docsUrl?: string;
  contactUrl?: string;
  lastReviewedAt: string;
}

export const DAPP_DIRECTORY_REPO_URL = "https://github.com/monolythium/monoscan-public-directory";

export const DAPP_DIRECTORY_ENTRIES: DappDirectoryEntry[] = [
  {
    id: "anchorfall",
    productName: "Anchorfall",
    category: "Games",
    network: "testnet",
    creator: "Monolythium",
    openSource: true,
    browserWalletCompatibility: "compatible",
    browserWalletNotes: "Wallet sign-in and score receipt flows are wired on the app side; on-chain leaderboard deployment is pending upstream MRV runtime surfaces.",
    listingStatus: "foundation-maintained",
    tagline: "A tactical co-op game showing how a browser game can use Monolythium wallet identity and app-layer receipts.",
    description: "Anchorfall is a separate game and dApp showcase, not blockchain core logic. The listing demonstrates wallet-based identity, server-issued run receipts, and the path toward deployable app contracts for rankings and rewards.",
    websiteUrl: "https://anchorfall.monoplay.xyz",
    sourceUrl: "https://github.com/monoplay-xyz/anchorfall-ts-game",
    docsUrl: "https://github.com/monoplay-xyz/anchorfall-ts-game/blob/main/docs/WEB3-GOAL.md",
    lastReviewedAt: "2026-06-17",
  },
  {
    id: "lyth-mcp",
    productName: "Lyth MCP",
    category: "Tools",
    network: "testnet",
    creator: "Monolythium",
    openSource: true,
    browserWalletCompatibility: "not-compatible",
    browserWalletNotes: "This is an MCP/CLI tool for assistants, live-chain reads, runbooks, and local wallet flows; it is not a browser dApp.",
    listingStatus: "foundation-maintained",
    tagline: "A Monolythium MCP server for live-chain reads, AI runbooks, local agent-wallet flows, and transaction drafting.",
    description: "Lyth MCP lets AI assistants inspect Monolythium testnet state, look up accounts and transactions, list markets, run safety checks, manage local encrypted agent-wallet workflows, and draft wallet approval payloads without silently spending funds.",
    sourceUrl: "https://github.com/monolythium/lyth_mcp",
    docsUrl: "https://github.com/monolythium/lyth_mcp/blob/main/README.md",
    lastReviewedAt: "2026-06-17",
  },
];

function byProductName(a: DappDirectoryEntry, b: DappDirectoryEntry) {
  return a.productName.localeCompare(b.productName, undefined, { sensitivity: "base" })
    || a.id.localeCompare(b.id);
}

export function filterDappDirectory(entries: readonly DappDirectoryEntry[], filter: DappFilter) {
  const filtered = filter === "Show all" ? [...entries] : entries.filter((entry) => entry.category === filter);
  return filtered.sort(byProductName);
}

export function browserWalletLabel(value: BrowserWalletCompatibility) {
  switch (value) {
    case "compatible": return "Compatible";
    case "planned": return "Planned";
    case "not-compatible": return "No";
    default: return "Unknown";
  }
}

export function networkLabel(value: DappNetwork) {
  switch (value) {
    case "mainnet": return "Mainnet";
    case "mainnet-and-testnet": return "Mainnet + testnet";
    default: return "Testnet";
  }
}

export function listingStatusLabel(value: DappListingStatus) {
  switch (value) {
    case "foundation-maintained": return "Foundation maintained";
    case "official": return "Official";
    case "community": return "Community";
    case "experimental": return "Experimental";
    case "deprecated": return "Deprecated";
    default: return "Community";
  }
}
