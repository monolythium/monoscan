# Contributing

Monoscan is source-available for review, self-hosting, and ecosystem integration work.

Before opening a pull request:

- Keep changes focused on one behavior or surface.
- Do not commit credentials, node IPs, internal planning notes, generated build output, or local assistant context.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm build` when your change touches TypeScript or runtime behavior.
- Open an issue first for large UI, protocol, dependency, or deployment changes.

Security issues should be reported privately through the process in [SECURITY.md](./SECURITY.md).
