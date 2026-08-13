# AgentPay web

Investor landing page, developer docs, and the paid Base Mainnet API for
AgentPay. The app is a Next.js workspace package and imports the local
`@x402/client` and `@x402/server` packages, so install and build it from the
repository root.

## Local development

```sh
corepack pnpm install
cp web/.env.example web/.env.local
corepack pnpm dev:web
```

Open `http://localhost:3000`. A request without `X-Payment-Tx` can inspect the
live quote without spending funds:

```sh
curl -i http://localhost:3000/api/premium
```

## Deployment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical public HTTPS origin |
| `AGENTPAY_PAY_TO` | Checksummed Base recipient for the 0.01 USDC payment |
| `BASE_MAINNET_RPC_URL` | Base Mainnet receipt RPC |
| `REDIS_URL` | Durable `redis://` or TLS `rediss://` replay store |

The four client-example values at the bottom of `.env.example` are local-only.
The private-key placeholder is deliberately invalid. Replace it with a dedicated
low-balance wallet key for the local client only, never fund the placeholder,
and never deploy `AGENT_PRIVATE_KEY` with the website.

Build from the repository root with `corepack pnpm build`, then run
`corepack pnpm --dir web start`. On a managed Next.js provider, retain the
repository workspace root during install so both local SDK packages are
available.

## Guarded payment example

The `/docs` page describes the complete workflow. With `web/.env.local`
configured, preview the server's quote using:

```sh
corepack pnpm --dir web demo:premium
```

The preview ends with `PAYMENT NOT SENT`. A real transfer requires both the
`--execute` argument and `ALLOW_MAINNET_PAYMENTS=true`; it uses real USDC and
Base ETH and cannot be refunded.

`X-Payment-Tx` is a public bearer receipt in this fixed, non-sensitive demo.
Before protecting secrets or user-specific data, extend the protocol so a
unique quote and authenticated payer identity are bound to each request.

## Verification

```sh
corepack pnpm --dir web test
corepack pnpm --dir web typecheck
corepack pnpm --dir web lint
corepack pnpm --dir web build
corepack pnpm --dir web test:e2e
```
