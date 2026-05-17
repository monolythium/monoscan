# Self-host Monoscan

Monoscan is a static Vite build served by Caddy. By default the browser calls relative `/rpc` and `/api/v1` paths, and Caddy proxies those to a Monolythium RPC node at runtime.

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
| `MONOSCAN_RPC_UPSTREAM` | `http://178.105.15.216:8545` | Runtime upstream node for Caddy's `/rpc` and `/api/*` proxy routes. |
| `MONO_CORE_SDK_REPO` | `https://github.com/monolythium-vision/mono-core-sdk.git` | SDK repo cloned during image build. |
| `MONO_CORE_SDK_REF` | `ffeb897e4b710b4ee993a0c78bdde3f505009ae6` | SDK branch, tag, or commit used for the build. |
| `VITE_MONOSCAN_RPC_URL` | `/rpc` | Optional build-time frontend RPC override. Usually leave unset for the container. |
| `VITE_MONO_RPC_URL` | unset | Secondary build-time RPC override accepted by the app. |

Example:

```bash
MONOSCAN_PORT=8090 \
MONOSCAN_RPC_UPSTREAM=http://178.104.233.182:8545 \
docker compose up --build
```

## Production Notes

The current app is live-first against JSON-RPC and `/api/v1`. It falls back to fixtures only for enrichment that the node does not expose yet, such as token metadata, USD market aggregates, operator reputation history, reward charts, and deterministic natural-language enrichment.

For production, deploy behind TLS. When using the container defaults, the browser only needs to connect to the Monoscan origin because Caddy proxies node traffic server-side.
