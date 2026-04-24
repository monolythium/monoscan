# monoscan

monoscan.xyz — public blockchain explorer for Monolythium v2.

> Part of the [Monolythium](https://monolythium.com) ecosystem — a sovereign Layer-1 for finality-first apps.

---

## What this is

Monoscan is the public web explorer for **Monolythium v2** — a Rust-native L1 running **LythiumDAG-BFT (Starfish-C)** consensus on `chain_id 6940`. It surfaces blocks, transactions, validator clusters, the native CLOB and perpetuals markets, gap records, and an "ask the blockchain" natural-language search.

Currently a static React + CDN mockup served by Caddy. A Vite + React 19 + TypeScript promotion is planned — see the `plans/monoscan.md` notes in the orchestration workspace (local only).

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

Once `docker compose up` is running, open http://localhost:8080 in your browser. The current build is a static SPA — point your gateway/RPC URL at any Monolythium v2 node.

## Documentation

- Public docs: https://docs.monolythium.com
- Chain reference: https://monolythium.com

## Building from source

```bash
# Current (static mockup served by Caddy)
docker compose up

# After Stage 1 promotes to a real Vite build:
# pnpm install
# pnpm dev     # local dev server
# pnpm build   # produces dist/ for static hosting
```

Requirements (current scaffold): Docker. Requirements (post-Vite promotion): Node 22+, pnpm 9+.

## Contributing

We welcome contributions. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the guidelines.

## Security

Found a vulnerability? Please **do not open a public issue**. Email security@monolythium.com instead. See [SECURITY.md](./SECURITY.md) for the full disclosure policy.

## License

MIT
