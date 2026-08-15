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

## Web-only variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical public origin; HTTPS and non-local in production |
| `AGENTPAY_PAY_TO` | Controlled Base recipient for the exact 0.01 USDC payment |
| `FACILITATOR_URL` | Internal HTTP URL, normally `http://facilitator:4022` |
| `REDIS_URL` | Internal authenticated `redis://` authorization state store |

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

## Verification

```sh
corepack pnpm --dir web test
corepack pnpm --dir web typecheck
corepack pnpm --dir web lint
corepack pnpm --dir web build
corepack pnpm --dir web test:e2e
```
