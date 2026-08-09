# x402 USDC SDK

`@x402/server` turns a paid Express route into a small HTTP 402 protocol
endpoint. `@x402/client` turns `fetch` into an agent client that reads the 402
requirements, sends USDC, waits for one confirmation, and retries with the
transaction hash. The default no-suffix demo commands (`pnpm demo:vendor` and
`pnpm demo:agent`) are deliberately fixed to Base Sepolia and a $0.01 USDC
price.

## AgentPay investor website

The deployable Next.js demonstration lives entirely in [`web/`](web/). It
includes the investor landing page, developer documentation, and a real
`GET /api/premium` endpoint priced at exactly `0.01` official USDC on Base
Mainnet. The endpoint verifies two confirmations and uses Redis `SET NX` replay
claims before it releases the premium response.

To run the site locally:

```sh
cp web/.env.example web/.env.local
# Replace AGENTPAY_PAY_TO and the service URLs with your deployment values.
pnpm dev:web
```

The server requires `NEXT_PUBLIC_SITE_URL`, `AGENTPAY_PAY_TO`,
`BASE_MAINNET_RPC_URL`, and `REDIS_URL`. Use durable, shared Redis in production
so a transaction hash cannot be reused across instances or restarts. Do not set
`AGENT_PRIVATE_KEY` on the web server; that value belongs only to the optional
local client example.

Without a payment header, the deployed route is safe to inspect:

```sh
curl -i https://your-domain.example/api/premium
```

It returns HTTP `402` with the exact amount, chain, and recipient. The website
itself never connects a wallet or initiates a payment. The guarded CLI described
at `/docs` previews the live quote by default; a real transfer additionally
requires both `--execute` and `ALLOW_MAINNET_PAYMENTS=true`.

The transaction hash is a public bearer receipt for a fixed, non-sensitive
demonstration response. Do not use this route for secrets or user-specific
entitlements unless the protocol is extended to bind a unique quote and an
authenticated payer identity to each request.

For a conventional Node deployment, build and run the app with:

```sh
pnpm build
pnpm --dir web start
```

## Requirements

- Node.js 20 or later and [Corepack](https://nodejs.org/api/corepack.html)
- A Base Sepolia wallet funded with test ETH for gas and test USDC
- A Base Sepolia RPC URL (the public endpoint is suitable for this demo, not
  production)

Install dependencies, make a local environment file, and build the workspace:

```sh
corepack enable
pnpm install
cp .env.example .env
pnpm build
```

Replace the example recipient and private key in `.env` before using the
payment demo. The placeholder addresses and key in `.env.example` are public
examples: do not fund them. Keep `.env` out of source control.

## Run the Base Sepolia demo

The existing demo commands always select Base Sepolia (chain `84532`). They
remain testnet-only defaults even if `.env` contains a mainnet RPC URL or
`ALLOW_MAINNET_PAYMENTS=true`; use the explicitly named `:mainnet` commands
below for the gated mainnet flow.

In Terminal A, start the vendor API:

```sh
pnpm demo:vendor
```

In Terminal B, run the agent:

```sh
pnpm demo:agent
```

The first request receives an HTTP 402 body containing the price, Base Sepolia
chain ID, and recipient. The agent accepts the requirement only when it is at
or below its `$0.10` cap, transfers test USDC, waits for confirmation, then
retries the original URL with `X-Payment-Tx`.

## Run the guarded Base Mainnet demo

Base Mainnet uses real funds. Complete this checklist before running either
mainnet command:

- Replace the `.env.example` placeholder recipient and private key; do not
  fund the placeholders.
- Fund the agent's dedicated low-balance mainnet wallet with official Base USDC
  and enough Base ETH for gas. The vendor needs only a controlled recipient
  address to receive the payment.
- Set `BASE_MAINNET_RPC_URL` to a Base Mainnet RPC URL,
  `VENDOR_API_URL=http://127.0.0.1:3000/api/data`, and
  `ALLOW_MAINNET_PAYMENTS=true` in `.env`.

In Terminal A, start the loopback-only vendor:

```sh
pnpm demo:vendor:mainnet
```

Before using the agent, inspect the raw 402 response locally:

```sh
curl -i http://127.0.0.1:3000/api/data
```

Verify that it contains `priceUsdc: "0.01"`, `network: "base"`, chain `8453`,
and the exact controlled recipient address configured in `VENDOR_WALLET_ADDRESS`.

In Terminal B, run the default non-paying preview:

```sh
pnpm demo:agent:mainnet
```

The preview performs mainnet preflight checks but does not send a payment.
Confirm that its output ends with `PAYMENT NOT SENT` before deciding whether to
execute. To authorize exactly one payment after that confirmation, run:

```sh
pnpm demo:agent:mainnet -- --execute
```

If the execution prints a transaction hash and anything later fails, inspect
that hash in a Base explorer before any rerun. The replay store is in-memory
and refunds are unavailable. This mainnet demo listens only on loopback and is
not a production deployment.

## Use the packages

### Server

```ts
import express from "express";
import { paymentMiddleware } from "@x402/server";
import type { Address } from "viem";

const app = express();
app.get(
  "/api/data",
  paymentMiddleware({
    priceUsdc: "0.01",
    payTo: "0x1111111111111111111111111111111111111111" as Address,
    chainId: 84532,
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL!,
  }),
  (_request, response) => response.json({ data: "The paid signal is 42." }),
);
```

The middleware returns a structured HTTP 402 response when the payment header
is absent. It verifies the submitted receipt, required USDC transfer amount,
recipient, token, confirmation count, and an in-memory replay claim before
calling the route handler.

### Client

```ts
import { createAgentFetch } from "@x402/client";
import type { Hex } from "viem";

const agentFetch = createAgentFetch({
  privateKey: process.env.AGENT_PRIVATE_KEY! as Hex,
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL!,
  maxPaymentUsdc: "0.10",
});

const response = await agentFetch("https://vendor.example/api/data");
if (!response.ok) throw new Error(`Vendor returned HTTP ${response.status}`);
console.log(await response.json());
```

`createAgentFetch` supports Base (8453) and Base Sepolia (84532) payment
requirements. It rejects malformed requirements, chain/network mismatches,
prices above its cap, RPC chain mismatches, transfer failures, and reverted
transactions.

## Network reference

| Network | Chain ID | Official USDC contract |
| --- | ---: | --- |
| [Base](https://docs.base.org/base-chain/quickstart/connecting-to-base) | 8453 | [`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`](https://developers.circle.com/stablecoins/usdc-contract-addresses) |
| [Base Sepolia](https://docs.base.org/base-chain/quickstart/connecting-to-base) | 84532 | [`0x036CbD53842c5426634e7929541eC2318f3dCF7e`](https://developers.circle.com/stablecoins/usdc-contract-addresses) |

Circle publishes the official USDC contract list; Base publishes its network,
RPC, and chain-ID reference at the linked documentation.

## Verify the workspace

```sh
pnpm test
pnpm typecheck
pnpm build
```

## Security notes

- Base mainnet uses real funds. Test on Base Sepolia first, review all contract
  addresses, and use a dedicated low-balance mainnet wallet.
- The demo client's default payment cap is `$0.10`; set a cap appropriate for
  each agent and service instead of trusting a vendor-provided price.
- This SDK does not decide which vendor origins an agent may call. Apply an
  explicit origin allowlist before passing URLs to `createAgentFetch`.
- Receipt verification waits for one confirmation by default. A reorganization
  can still invalidate a recently confirmed transaction; raise confirmations
  for your risk tolerance.
- Replay protection is in-memory only. It does not coordinate across process
  restarts or multiple server instances; provide durable shared replay storage
  for production.
- Never log, commit, or share private keys. The demo validates configuration
  without printing `AGENT_PRIVATE_KEY`.
