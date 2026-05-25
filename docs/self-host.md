# Self-host Monoscan

Monoscan is a static Vite build served by Caddy. The browser calls relative `/rpc` and `/api/v1` paths, and Caddy proxies those requests to a Monolythium node at runtime.

## Quick Start

```bash
git clone https://github.com/monolythium/monoscan.git
cd monoscan
docker compose up --build
```

Open `http://localhost:8080`.

## Configuration

Use these environment variables when building or running:

| Variable | Default | Purpose |
|---|---|---|
| `MONOSCAN_PORT` | `8080` | Host port exposed by Docker Compose. |
| `MONOSCAN_RPC_UPSTREAM` | `https://rpc.monolythium.com` | Runtime upstream node for Caddy's `/rpc` and `/api/*` proxy routes. |
| `MONO_CORE_SDK_REPO` | `https://github.com/monolythium/mono-core-sdk.git` | SDK repo cloned during image build. |
| `MONO_CORE_SDK_REF` | `46c009ab04217434a3760de6bcf53a9f856cc228` | SDK branch, tag, or commit used for the build. |
| `VITE_MONOSCAN_RPC_URL` | `/rpc` | Optional build-time frontend RPC override. Usually leave unset for the container. |
| `VITE_MONO_RPC_URL` | unset | Secondary build-time RPC override accepted by the app. |

Example:

```bash
MONOSCAN_PORT=8090 \
MONOSCAN_RPC_UPSTREAM=http://127.0.0.1:8545 \
docker compose up --build
```

## Production Notes

The app reads live JSON-RPC and `/api/v1` surfaces first. Some aggregate views use local fallback rows when a node does not expose retained indexer data yet.

For production, deploy behind TLS. When using the container defaults, the browser only needs to connect to the Monoscan origin because Caddy proxies node traffic server-side.
