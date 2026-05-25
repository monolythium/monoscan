# Build stage — produce static dist/ via Vite.
FROM node:22-alpine AS build
WORKDIR /build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN apk add --no-cache git

# Railway builds this repo in isolation, but the app intentionally consumes
# the sibling SDK through `file:../mono-core-sdk/packages/ts`. Recreate that
# sibling path inside the image, then build the SDK dist before installing
# Monoscan so pnpm can resolve the linked package exactly like local dev.
ARG MONO_CORE_SDK_REPO=https://github.com/monolythium/mono-core-sdk.git
# Pin the SDK commit used by Monoscan's API-client integration. Docker build
# cache cannot see when a remote branch moves, so a floating `master` ref can
# keep serving stale dist files until the cache is manually busted.
ARG MONO_CORE_SDK_REF=46c009ab04217434a3760de6bcf53a9f856cc228
RUN git clone "${MONO_CORE_SDK_REPO}" /mono-core-sdk \
  && cd /mono-core-sdk \
  && git checkout "${MONO_CORE_SDK_REF}" \
  && (pnpm --dir /mono-core-sdk/packages/ts install --frozen-lockfile || pnpm --dir /mono-core-sdk/packages/ts install --no-frozen-lockfile) \
  && pnpm --dir /mono-core-sdk/packages/ts build

COPY .npmrc package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN pnpm build

# Serve stage — Caddy serves the static bundle.
FROM caddy:2-alpine
WORKDIR /srv
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /build/dist /srv
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
