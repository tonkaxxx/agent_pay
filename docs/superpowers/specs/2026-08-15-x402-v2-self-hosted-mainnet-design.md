# AgentPay x402 v2 Self-Hosted Mainnet Design

**Date:** 2026-08-15
**Status:** Approved

## Context

AgentPay currently protects `GET /api/premium` with a custom x402 v1-style
receipt flow. The client transfers USDC first and retries the request with the
public transaction hash in `X-Payment-Tx`. The server verifies the transaction
and uses Redis to claim the hash once. Because the hash is public, this proves
that a qualifying transfer happened but does not prove that the HTTP requester
authorized it. An observer can race the payer and claim the paid response.

The previous x402 v2 deployment replaced the public transaction receipt with a
signed EIP-3009 authorization, but delegated verification and settlement to the
CDP facilitator. CDP rejected settlement from the production server with
`request_blocked_by_location`. The failure was caused by that external
facilitator dependency rather than by x402 v2 or the client signature.

## Goal

Expose a standards-compliant x402 v2 `exact` endpoint on Base Mainnet that an
autonomous agent can pay using only a funded EVM private key and the endpoint
URL, without an AgentPay-specific SDK and without an external facilitator.

The implementation lives only on the Git branch `dev` until it passes local,
container, and controlled Base Mainnet verification. Base Sepolia is explicitly
out of scope.

## Compatibility Boundary

The API targets any autonomous agent that can:

- make outbound HTTPS requests;
- execute code or use an x402 v2-capable HTTP client;
- create an EIP-712/EIP-3009 signature with a supplied private key; and
- hold at least the advertised amount of official Base USDC.

No API can make a payment on behalf of a text-only model without network or
code-execution tools, or override an agent platform policy that rejects private
keys. AgentPay will not require a proprietary client, preinstalled AgentPay
package, buyer RPC URL, buyer ETH balance, account, API key, or interactive
browser flow.

## Architecture

One Docker Compose project on the existing production server contains:

1. `web`: the public Next.js AgentPay site and resource server.
2. `facilitator`: an internal Node service built from the official x402 v2
   packages. It verifies EVM `exact` authorizations and settles them on Base.
3. `redis`: the private atomic request-lock and consumed-authorization store.

Traefik terminates public TLS and routes only to `web`. The facilitator and
Redis are reachable only on an internal Compose network and publish no host
ports. The web service calls the facilitator through the standard `/supported`,
`/verify`, and `/settle` interface.

The facilitator has a dedicated low-balance hot wallet funded only with enough
Base ETH to sponsor settlement gas. It never receives or stores buyer private
keys. The seller payout address remains independent from the facilitator gas
wallet. A production Base RPC endpoint is supplied through server-side
configuration.

## Public Payment Contract

An unpaid request to `GET https://agentpay.thebestsites.ru/api/premium` returns
HTTP `402` with the canonical base64-encoded x402 v2 `PaymentRequired` object in
the `PAYMENT-REQUIRED` response header.

The requirement advertises exactly one payment option:

- version: `2`;
- scheme: `exact`;
- network: `eip155:8453`;
- asset: official Base USDC
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`;
- amount: `10000` atomic units (`0.01` USDC);
- recipient: the configured checksummed AgentPay payout address;
- resource URL: the canonical HTTPS premium endpoint; and
- a short authorization timeout.

The JSON body remains compact and contains no premium output or Bazaar example:

```json
{
  "error": "Payment Required",
  "x402Version": 2,
  "priceUsdc": "0.01",
  "network": "eip155:8453"
}
```

The complete protocol terms live in `PAYMENT-REQUIRED`. The server preserves
standard `PAYMENT-SIGNATURE` request and `PAYMENT-RESPONSE` response semantics.

Payment Identifier is not required. It is an optional extension and requiring
it would reject otherwise valid x402 v2 clients. Bazaar discovery metadata is
also omitted because the caller already has the URL and an output example would
disclose protected content.

## Paid Request Flow

1. The agent requests the endpoint and reads `PAYMENT-REQUIRED`.
2. The agent selects the Base USDC `exact` requirement.
3. The agent signs a short-lived EIP-3009 authorization with a fresh 32-byte
   nonce and retries the same URL with `PAYMENT-SIGNATURE`.
4. The resource server validates the canonical resource, exact accepted terms,
   network, asset, amount, recipient, authorization window, payer signature,
   balance, and unused nonce through the internal facilitator.
5. Before protected work begins, Redis atomically acquires a fingerprint of the
   signed authorization. A concurrent request with the same authorization is
   rejected and cannot execute the protected handler.
6. The protected handler prepares the premium response, but no response bytes
   are released to the client yet.
7. The internal facilitator calls USDC `transferWithAuthorization`, pays Base
   gas from its dedicated wallet, and waits for a successful receipt.
8. Only after successful settlement does the resource server return HTTP `200`,
   the premium JSON, and the standard `PAYMENT-RESPONSE` settlement header.
9. Redis marks the authorization fingerprint consumed. It never stores or
   replays the premium response.

If verification, locking, protected work, RPC access, transaction submission,
or settlement confirmation fails, the request fails closed and premium data is
not returned.

## Replay and Disclosure Policy

The server never treats a transaction hash as access authorization. A public
hash cannot unlock the endpoint.

The EIP-3009 nonce is one-use onchain. Redis additionally prevents two requests
from passing verification concurrently before that onchain state changes. The
lock remains held through settlement and response completion.

AgentPay does not replay a cached paid body for a repeated
`PAYMENT-SIGNATURE`. After completion, the same authorization receives a stable
consumed-payment error. This is deliberate: the EIP-3009 signature becomes
observable in transaction calldata after settlement, so using it as a cached
response key would recreate a public bearer credential.

Raw payment signatures, authorization payloads, private keys, RPC credentials,
and premium response bodies are never written to logs or Redis. Redis stores
only a one-way fingerprint, state, safe timestamps, and settlement transaction
metadata required for operations.

## Configuration and Secrets

The production deployment requires:

- `NEXT_PUBLIC_SITE_URL=https://agentpay.thebestsites.ru/`;
- `AGENTPAY_PAY_TO` for the seller payout wallet;
- `BASE_MAINNET_RPC_URL` for the internal facilitator;
- `FACILITATOR_PRIVATE_KEY` for a dedicated gas-only wallet;
- an authenticated internal `REDIS_URL`; and
- an immutable application image identifier.

The buyer's `AGENT_PRIVATE_KEY` is never a server variable. It exists only in
the external agent process making the paid request. The private key previously
posted in chat is considered compromised and must not be used or funded.

Production env files remain untracked, mode `0600`, and are not copied into
container images. Startup validates addresses, origins, chain ID, RPC chain,
and placeholder values before accepting traffic.

## Error Model

Public responses expose stable codes without infrastructure details:

- `402 payment_required`: no signed authorization was supplied;
- `402 payment_invalid`: signature or payment terms are invalid;
- `409 payment_in_progress`: the same authorization is already processing;
- `409 payment_consumed`: the authorization was already settled or consumed;
- `502 settlement_failed`: a submitted payment could not be confirmed;
- `503 payment_infrastructure_unavailable`: Redis, facilitator, or RPC is not
  safely available; and
- `503 configuration_unavailable`: required production configuration is absent
  or invalid.

Unpaid and error responses never contain the premium body. Internal logs use a
generated request ID and safe lifecycle stage but omit payment signatures and
all secrets.

## Mainnet-Only Verification

No Base Sepolia code path, configuration, or deployment is added. Automated
tests use deterministic local signers and mocked chain transports only for unit
and integration boundaries; they do not claim onchain settlement.

Verification proceeds in increasing-risk order:

1. Unit tests validate requirements, canonical URL matching, exact terms,
   signature fingerprints, locking, consumed-state behavior, fail-closed
   errors, and secret redaction.
2. HTTP integration tests validate canonical x402 v2 headers, the compact 402
   body, paid response gating, concurrent duplicate rejection, and lack of
   cached response replay.
3. Facilitator contract tests validate `/supported`, `/verify`, and `/settle`
   request/response compatibility with the official x402 v2 packages using a
   nonbroadcasting test transport.
4. Docker Compose tests validate that facilitator and Redis are internal,
   secrets are scoped to the correct services, images are pinned, healthchecks
   are present, and the public web container fails closed when dependencies are
   unavailable.
5. Clean-room TypeScript and Python smoke clients use only their official x402
   packages, a temporary private key, and the public API URL. Neither client
   imports AgentPay code.
6. A single controlled Base Mainnet smoke payment uses a new dedicated payer
   wallet holding only the required USDC. The facilitator gas wallet is funded
   minimally. The test confirms the seller balance change, successful
   `PAYMENT-RESPONSE`, premium body, and rejection of the exact same signed
   authorization afterward.

The mainnet payment is not sent automatically by the test suite or deployment.
It requires a separate explicit execution flag so rerunning ordinary checks can
never spend funds.

## Deployment and Rollback

All implementation commits remain on `dev`. The existing `main` branch and
current production v1 deployment remain untouched while development and
offline verification run.

After local verification, an immutable image is built from the exact `dev`
commit and deployed with the facilitator and Redis in one Compose project. The
existing Compose and env files are backed up before replacement. Public unpaid
checks and internal healthchecks run before the controlled mainnet payment.

If configuration, health, standard header validation, or settlement fails, the
deployment rolls back to the recorded v1 image and Compose configuration.

## Acceptance Criteria

- `main` remains unchanged while all code and documentation land on `dev`.
- The production contract is x402 v2 `exact` on Base Mainnet for `0.01` official
  USDC to the configured AgentPay recipient.
- CDP credentials and requests are completely absent.
- Facilitator and Redis run on the same server and Compose project as AgentPay
  but have no public ports.
- An ordinary curl receives a compact body and canonical
  `PAYMENT-REQUIRED`, with no premium content.
- A clean TypeScript or Python x402 v2 client needs only a private key and API
  URL to pay and receive the resource.
- A public transaction hash cannot unlock the resource.
- A duplicate, concurrent, consumed, or copied authorization cannot receive a
  second premium response.
- Premium data is returned only after successful onchain settlement.
- Missing or unhealthy payment infrastructure fails closed.
- No supplied buyer private key is stored, logged, committed, or deployed.
