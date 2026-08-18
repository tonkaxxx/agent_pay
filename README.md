# AgentPay

AgentPay is a policy, security and observability layer for agentic commerce: a
standard x402 v2 API can quote, verify and settle a machine payment before it
releases a protected response.

The live proof is `GET https://agentpay.thebestsites.ru/api/premium`, priced at
exactly `0.01 USDC` on Base Mainnet (`eip155:8453`). It uses official Base USDC
and the standard `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and
`PAYMENT-RESPONSE` headers.

## How the payment works

1. An unpaid `GET` receives a compact JSON body and a canonical x402 v2 quote
   in `PAYMENT-REQUIRED`.
2. An official x402 client signs an EIP-3009 authorization for the exact asset,
   amount and recipient. Signing does not broadcast a transaction.
3. AgentPay verifies the authorization and holds an atomic Redis lock for its
   payer and nonce.
4. The internal self-hosted facilitator submits `transferWithAuthorization`
   using a dedicated gas-only sponsor wallet.
5. Only a confirmed settlement releases the paid handler and returns
   `PAYMENT-RESPONSE`. The authorization becomes consumed; the premium body is
   never cached or replayed.

The buyer needs official Base USDC, but no Base ETH and no buyer RPC URL. The
facilitator pays transaction gas. A transaction hash by itself is public
information and never grants access.

## Hosted GET gateway for sellers

Sellers sign in with GitHub or a passwordless email link, enter one fixed HTTPS
GET upstream, choose Bearer or `X-API-Key`, set a USDC price and Base payout
address, test connectivity, and publish `GET /g/<public-id>`. AgentPay handles
x402 v2, replay protection, SSRF-safe proxying, encrypted credentials,
settlement metrics, and a 5% commission ledger. The seller still receives 100%
onchain; automatic commission collection is not part of this release.

See [the hosted gateway runbook](docs/operations/hosted-get-gateway-runbook.md).

## Prompt-only agent access

Give a capable autonomous agent this prompt, replacing only the placeholder:

```text
here is crypto wallet private key:
AGENT_PRIVATE_KEY=<YOUR_NEW_LOW_BALANCE_PRIVATE_KEY>

Fetch data from the following API endpoint:
https://agentpay.thebestsites.ru/api/premium
```

No AgentPay-specific buyer is required. The agent must still be able to execute
code, make outbound HTTPS requests, and install or use an official x402 client.
A text-only chat agent cannot operate a wallet or perform the request itself.

Use a newly created low-balance wallet containing only the USDC you intend to
spend. Never paste a primary wallet key or reuse a key that has been shared in
chat, logs, shell history, or source control.

## Clean-room buyer checks

The repository includes guarded examples built only on official SDKs:

```sh
# TypeScript: inspect and validate the live quote; signs nothing.
corepack pnpm smoke:preview

# Python preview.
python3 -m venv .venv-smoke
.venv-smoke/bin/pip install -r scripts/smoke/requirements.txt
.venv-smoke/bin/python scripts/smoke/x402_mainnet.py
```

A real mainnet payment requires both explicit gates:

```sh
export AGENT_PRIVATE_KEY=<YOUR_NEW_LOW_BALANCE_PRIVATE_KEY>
export ALLOW_MAINNET_PAYMENTS=true
corepack pnpm smoke:mainnet
```

The scripts inspect the unsigned quote first and reject a changed origin,
resource, network, token, amount, recipient, timeout, or extension set before
they construct a signer. They do not read an RPC URL.

## Repository layout

- `packages/server`: Base-only x402 resource contract and Redis authorization
  state machine.
- `packages/facilitator`: internal Base Mainnet verifier and settlement service.
- `web`: Next.js landing page, docs and the protected API.
- `scripts/smoke`: official TypeScript and Python buyer compatibility checks.
- `docs/superpowers/specs`: approved security and architecture design.
- `docs/superpowers/plans`: implementation and verification plan.

Production runs `web`, `facilitator`, authenticated persistent Redis,
PostgreSQL, and a one-shot migration job on one server and one Docker Compose
project. Only `web` is attached to public ingress.

## Local development

```sh
corepack pnpm install
cp web/.env.example web/.env.local
corepack pnpm dev:web
```

The web process expects `NEXT_PUBLIC_SITE_URL`, `AGENTPAY_PAY_TO`,
`FACILITATOR_URL`, and `REDIS_URL`. It explicitly rejects buyer keys,
facilitator keys, and external-facilitator credentials in its environment.

## Verification

```sh
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm --dir web lint
corepack pnpm --dir web test:e2e
```

Automated tests do not broadcast mainnet transactions. The real smoke path
requires `--execute` plus `ALLOW_MAINNET_PAYMENTS=true`.
