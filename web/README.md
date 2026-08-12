# AgentPay web

The Next.js investor site, developer docs, and live `$0.01` Base mainnet x402 v2 API. The app imports the local `@agentpay/client` and `@agentpay/server` workspace packages.

## Local development

```sh
corepack pnpm install
cp web/.env.example web/.env.local
corepack pnpm dev:web
```

An unpaid request is safe to inspect. Its standard x402 terms are in the `PAYMENT-REQUIRED` header:

```sh
curl -i http://localhost:3000/api/premium
```

## Deployment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical public HTTPS origin |
| `AGENTPAY_PAY_TO` | Base recipient for the fixed `$0.01` USDC payment |
| `CDP_API_KEY_ID` | CDP facilitator API key identifier |
| `CDP_API_KEY_SECRET` | CDP facilitator API key secret |
| `REDIS_URL` | Shared `redis://` or TLS `rediss://` idempotency store |

`AGENT_PRIVATE_KEY` is used only by the guarded local client example. Never deploy it with the web server. A real client payment requires both the `--execute` argument and `ALLOW_MAINNET_PAYMENTS=true`.

The API uses the official Next x402 wrapper and CDP facilitator. Redis atomically leases Payment Identifiers and replays completed responses, including the original `PAYMENT-RESPONSE`, without persisting raw payment signatures.

## Verification

```sh
corepack pnpm --dir web test
corepack pnpm --dir web typecheck
corepack pnpm --dir web lint
corepack pnpm --dir web build
corepack pnpm --dir web test:e2e
```
