# Claude Code handoff: AgentPay hosted GET gateway

You are taking over implementation of the AgentPay hosted GET gateway.

## Read first

1. `README.md`
2. `web/AGENTS.md` — mandatory Next.js 16 repository rules
3. `docs/superpowers/specs/2026-08-16-hosted-get-gateway-design.md`
4. `docs/superpowers/specs/2026-08-15-x402-v2-self-hosted-mainnet-design.md`
5. `docs/operations/x402-v2-mainnet-runbook.md`
6. Current implementation under `packages/server`, `packages/facilitator`, and
   `web/src/features/premium-api`

The 2026-08-16 hosted-gateway design is the authoritative feature contract.
Older documents describe important compatibility and security invariants but
must not override the new approved scope.

## User intent

The seller experience must be as close to 10/10 simplicity as possible:

- sign in without a password;
- paste one existing HTTPS GET endpoint;
- choose Bearer or X-API-Key upstream authentication;
- enter a fixed USDC price and Base payout address;
- test and activate;
- copy a ready-to-use x402 v2 gateway URL.

Only `GET` is in scope. Choose sensible secure defaults without repeatedly
asking the user to decide minor implementation details.

## Git workflow is mandatory

Before modifying files:

```sh
git status --short
git branch --show-current
git switch -c feat/hosted-get-gateway main
```

If the branch already exists, inspect it and continue rather than creating a
different duplicate branch. Never discard unrelated user changes.

Make small conventional commits. Use focused tests before each commit. At
useful checkpoints show:

```sh
git status --short
git log --oneline --decorate -12
```

Do not:

- work directly on `main` or `dev`;
- use `git reset --hard` or destructive checkout commands;
- commit any `.env` file, private key, RPC credential, OAuth/email secret,
  database password, encryption key, or generated database;
- add local GTM roadmaps or Obsidian files;
- force-push, merge, deploy, or make a Mainnet payment without explicit user
  direction.

Do not push automatically. When implementation is verified, report the branch
and commit list and ask the user whether to push or open a pull request.

## Existing production contract must survive

- `GET /api/basic` remains free.
- `GET /api/premium` remains exactly `0.01 USDC` on official Base Mainnet USDC.
- Standard x402 v2 headers remain compatible with official clients.
- A transaction hash never grants access.
- Redis authorization locking and consumed replay behavior remain intact.
- Premium and gateway data are returned only after confirmed settlement.
- Facilitator, Redis, and the new PostgreSQL service have no public ports.
- Do not expose or log payment signatures, upstream credentials, keys, query
  values, or paid response bodies.

Generalize existing payment code; do not create a second incompatible x402
implementation.

## Required process

1. Inspect the current code and installed official SDK APIs.
2. Write an implementation plan under `docs/superpowers/plans/` derived from
   the approved design.
3. Check current package versions and relevant local Next.js documentation
   before choosing Auth.js, database, and routing APIs.
4. Implement test-first in the commit sequence suggested by the design.
5. Keep the single-server, single-Compose deployment model.
6. Preserve fail-closed payment behavior and SSRF-safe pinned DNS connections.
7. Run the complete verification suite before claiming completion:

```sh
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm --dir web lint
corepack pnpm --dir web test:e2e
corepack pnpm smoke:preview
```

Automated tests and normal development commands must never spend Mainnet funds.

## Communicating with the user

The user speaks Russian. Give concise progress reports in Russian, especially:

- current branch and latest commit;
- which vertical slice is complete;
- exact verification commands and outcomes;
- blockers that truly require user credentials or external configuration.

Do not ask the user to choose routine technical details. Explain meaningful
security, cost, or product trade-offs before changing the approved scope.
