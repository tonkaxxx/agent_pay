# AgentPay maintainer handoff

This file describes the current repository and production contract. Historical
designs under `docs/superpowers/` explain how features were developed, but they
are not operational instructions.

## Read first

1. `README.md` — product, architecture, and local development
2. `web/AGENTS.md` — mandatory Next.js repository rules
3. `docs/README.md` — documentation index and source-of-truth order
4. `docs/operations/x402-v2-mainnet-runbook.md` — production deployment
5. `docs/operations/hosted-get-gateway-runbook.md` — seller gateway operations
6. `docs/operations/custodial-commission-runbook.md` — 95/5 settlement and payouts

## Current product contract

AgentPay is a self-hosted x402 v2 payment gateway for HTTPS `GET` APIs on Base
Mainnet. A seller signs in, registers an existing API, configures Bearer or
X-API-Key authentication, chooses a fixed USDC price and payout address, and
receives a public URL at `GET /g/<publicId>`.

Public route roles must remain distinct:

- `GET /api/basic` is the free demo.
- `GET /api/premium` is the direct-settlement demo priced at `0.01 USDC`.
- `GET /g/<publicId>` is the hosted seller gateway with the production 95/5
  commission flow.

Only a facilitator-verified and confirmed x402 v2 settlement grants access. A
transaction hash alone never authorizes a request. Paid data and upstream
credentials must never appear in a `402` response or application log.

## Production custody model

The hosted gateway currently runs in custodial mode:

- collection wallet: `0x7C04bf9fFd46EAeF9101F4aC558C13fb569923E6`
- treasury wallet: `0x748BB9bDA321B434DA83F402Cc8152eD23668a9a`
- seller liability: 95% of each hosted payment
- AgentPay commission: 5%
- seller payout eligibility: at least `1 USDC` net or an unpaid balance at
  least seven days old
- automatic payout preparation window: after `03:00 UTC`, with an explicit
  operator-triggered cycle also available
- incoming and outgoing finality: two Base confirmations
- collection-wallet emergency gas floor: `0.0001 ETH`

The payout worker is part of the production Compose project and runs under the
`custodial` profile. Ledger mode remains a safe rollout and incident rollback
state; it is not the normal production fee mode.

Never commit or print the collection private key, OAuth/email secrets, RPC
credentials, database passwords, encryption keys, or seller upstream secrets.

## Architecture

The repository is a pnpm workspace:

- `packages/core` — protocol types and shared logic
- `packages/client` — x402 client helpers
- `packages/server` — payment enforcement and resource-server helpers
- `packages/facilitator` — Base verification and settlement service
- `web` — Next.js site, dashboard, public docs, demos, and hosted gateway

Production uses one Docker Compose project containing the web app, facilitator,
PostgreSQL, Redis, and a one-shot migration job. The custodial profile adds the
payout worker from the same immutable web image; Traefik terminates public TLS
outside this project.

## Security invariants

- Keep payment authorization fail-closed.
- Preserve Redis locking, replay protection, and consumed-payment behavior.
- Preserve SSRF-safe pinned DNS behavior for seller upstream requests.
- Never expose facilitator, PostgreSQL, or Redis directly to the public network.
- Never log payment signatures, private keys, seller credentials, query values,
  or paid response bodies.
- Automated tests and normal development commands must never spend Mainnet
  funds.
- Do not change public wallet roles, commission math, payout thresholds, or
  confirmation rules without updating code, tests, all current runbooks, and
  `/docs` together.

## Git and verification workflow

Inspect the current branch and worktree before editing. Use a feature branch or
worktree, preserve unrelated user changes, and make conventional commits. Never
use destructive Git commands or force-push.

Run focused tests while editing, then the relevant full suite before claiming
completion:

```sh
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm --dir web lint
corepack pnpm --dir web test:e2e
corepack pnpm smoke:preview
```

Deployment, pushes, merges, and Mainnet transactions require explicit user
authorization. Follow the current operational runbooks instead of reconstructing
commands from historical implementation plans.

## Communication

The user speaks Russian. Keep progress reports concise and state the branch,
commit, verification evidence, and any real credential or infrastructure
blocker. Explain material security, cost, or product trade-offs before changing
scope.
