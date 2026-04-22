# Monoscan

Block explorer for Monolythium v2 / LythiumDAG-BFT.

**Status:** design mockup only. Not wired to any live chain. Hosted at https://vision.monoscan.xyz for design review.

## Structure

- `index.html` — entry document, loads React + Babel from unpkg CDN
- `src/` — JSX components (in-browser transpilation via `@babel/standalone`)
  - `primitives.jsx` — shared UI primitives
  - `monoscan-data.jsx` — mock dataset
  - `monoscan-app.jsx` — top-level app
  - `monoscan-markets.jsx` — markets / pairs views
  - `monoscan-extras.jsx` — additional views
- `styles/` — design tokens and component CSS

## Local preview

```
python3 -m http.server 8080
# open http://localhost:8080
```

## Deployment

Single-container static site served by Caddy.

- `Dockerfile` — Caddy Alpine image, copies files to `/srv`
- `Caddyfile` — listens on `$PORT`, gzip/zstd, strict headers, SPA fallback
- `railway.json` — Railway build/deploy config

Railway project: `monoscan-vision`. Custom domain: `vision.monoscan.xyz`.
