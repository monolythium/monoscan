# monoscan

monoscan.xyz — public blockchain explorer for Monolythium v2.

> Part of the [Monolythium](https://monolythium.com) ecosystem — a sovereign Layer-1 for finality-first apps.

---

## What this is

Monoscan is the public web explorer for **Monolythium v2** — a Rust-native L1 running **LythiumDAG-BFT (Starfish-C)** consensus on testnet `chain_id 69420`. It surfaces blocks, transactions, clusters/operators, protocol capability gates, and the explorer shell for markets, gap records, and natural-language chain search.

Built as a Vite + React 19 + TypeScript SPA, served as a static `dist/` bundle behind Caddy. The current build is partially live against any Monolythium v2 node's JSON-RPC surface: head/block data, fee history, mempool, clusters, account basics, delegation views, capability gates, checkpoints, certificate lookups, and operator-exit ledgers route through `@monolythium/core-sdk`. Indexer-only views such as market feeds, rich wallet aggregates, decoded transaction traces, gap records, and natural-language enrichment remain fixture-backed until the mono-core indexer APIs are live.

## Who this is for

Traders, developers, and compliance teams who need a fast, honest view into what is happening on the Monolythium chain — without running a node.

## Install

This repo ships a self-hostable container. To run it locally:

```bash
git clone https://github.com/monolythium-vision/monoscan.git
cd monoscan
docker compose up
```

Or visit the hosted instance at https://monoscan.xyz.

## Getting started

Once `docker compose up` is running, open http://localhost:8080 in your browser. For local development, `pnpm dev` serves the app at http://localhost:5174 and proxies `/rpc` to the testnet endpoint from `chain-registry` unless `VITE_MONOSCAN_RPC_URL` or `VITE_MONO_RPC_URL` is set.

## Documentation

- Public docs: https://docs.monolythium.com
- Chain reference: https://monolythium.com

## Building from source

```bash
pnpm install      # install dependencies
pnpm dev          # local dev server (http://localhost:5174)
pnpm typecheck    # tsc --noEmit
pnpm build        # produces dist/ for static hosting
pnpm preview      # serve the production build locally
```

Or build a self-contained container (Caddy serving `dist/`):

```bash
docker compose up
```

Requirements: Node 22+, pnpm 9+, or Docker.

## Contributing

We welcome contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the guidelines.

## Security

Found a vulnerability? Please **do not open a public issue**. Email security@monolythium.com instead. See [SECURITY.md](./SECURITY.md) for the full disclosure policy.

## License

Released under the Apache License, Version 2.0. See [LICENSE](./LICENSE) for the full text.
