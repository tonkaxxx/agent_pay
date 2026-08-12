# AgentPay

AgentPay is a policy, security, and observability layer for agentic commerce built on the official x402 v2 protocol. `@agentpay/client` gives an AI agent a signer-first, policy-controlled `fetch`; `@agentpay/server` gives API providers exact USDC payment routes, Payment Identifier idempotency, Bazaar discovery, and facilitator-neutral settlement.

The current release supports exact official USDC payments on Base (`eip155:8453`) and Base Sepolia (`eip155:84532`). It uses the standard `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE` headers—there is no legacy `X-Payment-Tx` compatibility path.

The live premium route preserves AgentPay's concise pre-v2 `402` JSON for curl
and the website (`error`, `priceUsdc`, `payTo`, `network`, and `chainId`). The
standard `PAYMENT-REQUIRED` header remains the x402 v2 protocol source of truth,
and Payment Identifier remains required for safe Redis-backed retries. Bazaar
output discovery is disabled on this endpoint so an unpaid challenge never
reveals premium response content.

## What is included

- `@agentpay/client` 0.2.0: signer-first x402 v2 fetch, mandatory network allowlist and spend cap, custom authorization policy, Payment Identifier, and unified payment events.
- `@agentpay/server` 0.2.0: exact-USDC resource and route factories, official Express middleware exports, Bazaar metadata, in-memory and Redis idempotency.
- Base Sepolia and guarded Base mainnet CLI examples.
- A Next.js investor site and live `$0.01` Base mainnet endpoint in [`web/`](web/).

## Requirements

- Node.js 20.9 or newer and Corepack.
- A dedicated test wallet with Base Sepolia USDC for the default client demo.
- CDP facilitator credentials for Base mainnet vendor/server flows.
- Redis for durable production idempotency.

```sh
corepack enable
pnpm install
cp .env.example .env
pnpm build
```

The values in `.env.example` are public placeholders. Never fund or deploy them.

## Base Sepolia demo

The default commands are pinned to Base Sepolia even if mainnet variables are present:

```sh
# Terminal A
pnpm demo:vendor

# Terminal B
pnpm demo:agent
```

The vendor advertises an x402 v2 exact-USDC requirement through the x402.org testnet facilitator. The agent validates the CAIP-2 network, official USDC contract, and its `$0.10` cap before signing an EIP-3009 authorization and retrying the original request with `PAYMENT-SIGNATURE`.

## Guarded Base mainnet demo

Mainnet uses real USDC. Configure a dedicated low-balance wallet, `BASE_MAINNET_RPC_URL`, CDP credentials, the exact loopback vendor URL, and `ALLOW_MAINNET_PAYMENTS=true`. Start the CDP-backed vendor:

```sh
pnpm demo:vendor:mainnet
```

Preview the payment policy without signing:

```sh
pnpm demo:agent:mainnet
```

Only the following command can authorize a payment, and only when the environment opt-in is also exactly `true`:

```sh
pnpm demo:agent:mainnet -- --execute
```

The mainnet price is fixed at `$0.01`. If settlement is reported and a later operation fails, inspect the transaction in the Base explorer before rerunning.

## Server SDK

```ts
import express from "express";
import {
  HTTPFacilitatorClient,
  createAgentPayResourceServer,
  createAgentPayRoute,
  paymentMiddleware,
} from "@agentpay/server";

const facilitator = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator",
});
const server = createAgentPayResourceServer({
  facilitator,
  networks: ["eip155:84532"],
});
const route = createAgentPayRoute({
  network: "eip155:84532",
  priceUsdc: "0.01",
  payTo: "0x1111111111111111111111111111111111111111",
  description: "Premium data",
  paymentIdentifier: "optional",
  discovery: { outputExample: { data: "premium" } },
});

const app = express();
app.get(
  "/api/data",
  paymentMiddleware({ "GET /api/data": route }, server),
  (_request, response) => response.json({ data: "premium" }),
);
```

For production, create an `HTTPFacilitatorClient` from CDP's `createFacilitatorConfig` and wrap the paid handler with `withPaymentIdempotency`. The Redis implementation uses atomic Lua compare-and-set operations, a 60-second pending lease, and a one-hour completed-response cache by default.

## Client SDK

```ts
import { createAgentFetch } from "@agentpay/client";
import { privateKeyToAccount } from "viem/accounts";

const signer = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY as `0x${string}`);
const agentFetch = createAgentFetch({
  signer,
  networks: ["eip155:84532"],
  maxPaymentUsdc: "0.10",
  authorizePayment: payment =>
    new URL(payment.requestUrl).origin === "https://vendor.example",
  onPaymentEvent: event => console.log(event.type),
});

const response = await agentFetch("https://vendor.example/api/data");
```

The SDK accepts a `ClientEvmSigner`, not a raw private key or RPC URL. Policy exceptions fail closed; observer exceptions are ignored so telemetry cannot interrupt settlement.

## Idempotency behavior

When a valid Payment Identifier is present:

- the first matching request acquires a short lease;
- a concurrent matching request receives `425 payment_in_progress` with `Retry-After: 1`;
- reuse of the identifier with a different signed payload receives `409 payment_identifier_conflict`;
- a completed retry receives the original status, safe headers, body, and `PAYMENT-RESPONSE`;
- raw `PAYMENT-SIGNATURE` values are never cached—only a SHA-256 fingerprint is stored.

## Network reference

| Network | CAIP-2 | Official USDC |
| --- | --- | --- |
| Base | `eip155:8453` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | `eip155:84532` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

## Verify the workspace

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
```

## Production operations

The supported single-host deployment is one hardened Docker Compose stack:
AgentPay web plus private, authenticated, AOF-backed Redis behind the existing
Traefik `web-net`. Production configuration rejects localhost origins, the demo
recipient, quote-only mode, unauthenticated Redis, and any payer private key in
the web environment.

Build and publish the web image with a full-Git-SHA tag, then deploy that exact
tag. The env template, rollout commands, public smoke verifier, durability
boundary, and rollback procedure are documented in
[`web/README.md`](web/README.md#single-server-production-deployment).

```sh
pnpm --dir web verify:production -- \
  https://agentpay.thebestsites.ru \
  0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB
```

This verifies the unpaid production challenge only. End-to-end settlement is a
separate guarded action requiring a funded payer wallet; seller deployments do
not receive payer signing material.

## Security notes

- Use origin, network, recipient, token, and spend-limit policies for every autonomous agent.
- Keep signer material outside AgentPay SDK configuration when a remote or hardware signer is available.
- Never log `PAYMENT-SIGNATURE`, private keys, or CDP secrets.
- Use shared Redis in multi-instance deployments; the in-memory store is for local demos only.
- A Payment Identifier provides idempotency, not user authentication or authorization to sensitive data.
