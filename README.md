# x402 USDC SDK

`@x402/server` turns a paid Express route into a small HTTP 402 protocol
endpoint. `@x402/client` turns `fetch` into an agent client that reads the 402
requirements, sends USDC, waits for one confirmation, and retries with the
transaction hash. The included demo is deliberately fixed to Base Sepolia and
a $0.01 USDC price.

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
payment demo. Keep `.env` out of source control.

## Run the Base Sepolia demo

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
  addresses, and use a dedicated low-balance agent wallet in production.
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
