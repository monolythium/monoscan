![Monoscan](https://raw.githubusercontent.com/mono-labs-org/.github/prod/media/github-banners/monolythium/monoscan.png)

# Monoscan

Monoscan is the public explorer for Monolythium. It provides browser views for blocks, transactions, rounds, operators, clusters, wallets, markets, validator diversity, the oracle dashboard, spending-policy dimensions, the prover market, bridge health, protocol capability surfaces, and native receipt proof material.

The app is a Vite + React + TypeScript single-page application served as static files. Browser traffic uses relative `/rpc` and `/api/v1` routes by default, so deployments can point the Caddy proxy at their own Monolythium node without rebuilding the frontend.

## Architecture

```text
monoscan/
├── Caddyfile              # Static file server and runtime RPC/API proxy
├── Dockerfile             # Self-contained production image
├── docker-compose.yml     # Local container entrypoint
├── docs/
│   └── self-host.md       # Runtime configuration notes
├── public/                # Favicons, manifest, and brand assets
├── src/
│   ├── data/              # Live data hooks and local fallback rows
│   ├── nl/                # Deterministic query routing for Ask Monoscan
│   ├── sdk/               # Monolythium SDK client setup
│   └── *.tsx              # Explorer pages and shared UI
└── styles/                # Monoscan theme and design tokens
```

## Quick Start

```bash
git clone https://github.com/monolythium/monoscan.git
cd monoscan
docker compose up --build
```

Open http://localhost:8080.

By default, the container proxies node requests to `https://rpc.monolythium.com`. Set `MONOSCAN_RPC_UPSTREAM` if you want to use your own node.

## Local Development

Source builds expect `../mono-core-sdk/packages/ts` next to this repository. The Docker build clones that SDK automatically through the `MONO_CORE_SDK_REPO` and `MONO_CORE_SDK_REF` build args.

```bash
pnpm install
pnpm dev        # http://localhost:5174
pnpm typecheck
pnpm test
pnpm build
pnpm preview
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONOSCAN_RPC_UPSTREAM` | `https://rpc.monolythium.com` | Runtime upstream used by Caddy for `/rpc` and `/api/*`. |
| `MONOSCAN_PORT` | `8080` | Host port used by Docker Compose. |
| `VITE_MONOSCAN_RPC_URL` | `/rpc` | Browser RPC route baked into local builds. |
| `VITE_MONO_RPC_URL` | unset | Secondary frontend RPC override. |
| `VITE_MONOSCAN_SOURCEMAP` | unset | Set to `true` only for private debugging builds. |

More deployment notes are in [docs/self-host.md](./docs/self-host.md).

## Documentation

- Monolythium: https://monolythium.com
- Docs: https://docs.monolythium.com
- Hosted explorer: https://monoscan.xyz

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

Please report vulnerabilities privately to security@monolythium.com. See [SECURITY.md](./SECURITY.md).

## License

Released under the Apache License, Version 2.0. See [LICENSE](./LICENSE).
