# Self-host Monoscan

Monoscan is a static Vite build served by Caddy. It can point at any public Monolythium RPC endpoint through build-time environment variables.

## Quick Start

```bash
git clone https://github.com/monolythium-vision/monoscan.git
cd monoscan
docker compose up --build
```

Open `http://localhost:8080`.

## Configuration

Use these environment variables when building or running:

| Variable | Default | Purpose |
|---|---|---|
| `MONOSCAN_PORT` | `8080` | Host port exposed by Docker Compose. |
| `MONO_CORE_SDK_REPO` | `https://github.com/monolythium-vision/mono-core-sdk.git` | SDK repo cloned during image build. |
| `MONO_CORE_SDK_REF` | `master` | SDK branch, tag, or commit used for the build. |
| `VITE_MONOSCAN_RPC_URL` | chain-registry testnet RPC | Explorer RPC endpoint used by the frontend. |
| `VITE_MONO_RPC_URL` | unset | Secondary RPC override accepted by the app. |

Example:

```bash
MONOSCAN_PORT=8090 \
MONO_CORE_SDK_REF=master \
docker compose up --build
```

## Production Notes

The current app is partially live against JSON-RPC and falls back to fixtures for indexer-only surfaces such as market feeds, rich wallet aggregates, decoded transaction traces, gap records, and natural-language enrichment.

For production, deploy behind TLS and set a CSP that allows the selected RPC endpoint in `connect-src`.
