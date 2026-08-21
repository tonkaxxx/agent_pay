# AgentPay web

Next.js landing page, developer docs, and the public x402 v2 resource server.
The premium endpoint charges `0.01 USDC` on Base Mainnet and delegates
verification and settlement to the internal self-hosted facilitator.

## Local development

```sh
corepack pnpm install
cp web/.env.example web/.env.local
corepack pnpm dev:web
```

An unpaid request returns a compact public body. Full protocol terms are in the
standard header:

```sh
curl -i http://localhost:3000/api/premium
```

Local paid execution additionally needs the facilitator and Redis services.
To run the complete non-paying container stack, export a Base Mainnet RPC URL
and a newly generated, unfunded gas-only facilitator key, then run:

```sh
docker compose -f web/docker-compose.yml up -d --build
node web/scripts/verify-production.mjs \
  --base-url=http://127.0.0.1:3000 --local
```

The local Compose file is the only place that enables the explicit loopback
HTTP override. Production continues to require the canonical HTTPS origin.

## Web-only variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical public origin; HTTPS and non-local in production |
| `AGENTPAY_PAY_TO` | Controlled Base recipient for the exact 0.01 USDC payment |
| `FACILITATOR_URL` | Internal HTTP URL, normally `http://facilitator:4022` |
| `REDIS_URL` | Internal authenticated `redis://` authorization state store |
| `AGENTPAY_FEE_MODE` | `ledger` (default) or `custodial` for hosted 95/5 payouts |
| `AGENTPAY_GATEWAY_COLLECTION_ADDRESS` | Public collection address; never its private key |
| `AGENTPAY_CUSTODY_LEGAL_APPROVED` | Explicit `true` release gate after legal approval |

Do not place any buyer key, facilitator key, Base RPC credential, or external
facilitator credential in the web environment. The web config fails closed if
it finds one of the forbidden secret variables.

## Buyer compatibility

AgentPay does not ship a custom buyer SDK. Official x402 TypeScript and Python
clients can read `PAYMENT-REQUIRED`, sign `PAYMENT-SIGNATURE`, and decode
`PAYMENT-RESPONSE`. EIP-3009 makes the buyer authorization gasless; the internal
facilitator gas sponsor submits settlement, so the buyer needs no ETH or RPC.

See the repository root README and `scripts/smoke` for guarded preview and
mainnet commands.

## Production Compose

`docker-compose.production.yml` runs `web`, `facilitator`, authenticated
persistent Redis, PostgreSQL, and the one-shot `migrate` job from one Compose
project. Its optional `custodial` profile adds a private payout worker. Database
and cache traffic stays on the internal backend network. Only facilitator and
payout worker receive Base RPC egress; only web joins the external Traefik
`web-net`. The payout private key is injected only into the worker.

Copy `.env.production.example` to the ignored `.env.production`, set mode
`0600`, and replace every placeholder. `AGENTPAY_IMAGE` must use the full
40-character release commit as its tag (or an image digest); mutable tags such
as `latest` are rejected by the production verifier.

Run `migrate` successfully before recreating `web`. Backup, restore, key
rotation, reconciliation, rollback, and incident procedures are in
`docs/operations/hosted-get-gateway-runbook.md`.
Custodial rollout, pause, reconciliation, and payout operations are documented
in `docs/operations/custodial-commission-runbook.md`.

## Verification

```sh
corepack pnpm --dir web test
corepack pnpm --dir web typecheck
corepack pnpm --dir web lint
corepack pnpm --dir web build
corepack pnpm --dir web test:e2e
```
