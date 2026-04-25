# monoscan

monoscan.xyz — public blockchain explorer for Monolythium v2.

> Part of the [Monolythium](https://monolythium.com) ecosystem — a sovereign Layer-1 for finality-first apps.

---

## What this is

Monoscan is the public web explorer for **Monolythium v2** — a Rust-native L1 running **LythiumDAG-BFT (Starfish-C)** consensus on `chain_id 6940`. It surfaces blocks, transactions, validator clusters, the native CLOB and perpetuals markets, gap records, and an "ask the blockchain" natural-language search.

Built as a Vite + React 19 + TypeScript SPA, served as a static `dist/` bundle behind Caddy. Live data wiring against any Monolythium v2 node's JSON-RPC + indexer ships in a follow-up stage; the current build renders shape-true mock data for design review.

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

Once `docker compose up` is running, open http://localhost:8080 in your browser. The current build is a static SPA — point it at any Monolythium v2 node's JSON-RPC + indexer endpoint (live wiring lands in the next stage).

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
