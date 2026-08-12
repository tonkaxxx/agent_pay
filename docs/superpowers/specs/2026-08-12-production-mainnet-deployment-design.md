# AgentPay Production Mainnet Deployment Design

**Date:** 2026-08-12
**Status:** Approved

## Context

AgentPay already exposes an x402 v2 `exact` payment route on Base Mainnet and
uses the official CDP facilitator integration. The current deployment at
`https://agentpay.thebestsites.ru` is still configured like a demo: quote-only
mode is enabled, the recipient and site URL are placeholders, Redis is
ephemeral, the web image uses the mutable `latest` tag, and the official Next
adapter returns an empty JSON object in the body of unpaid 402 responses even
though the complete challenge is present in the standard `PAYMENT-REQUIRED`
header.

The production recipient is:

```text
0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB
```

The production origin is:

```text
https://agentpay.thebestsites.ru/
```

CDP credentials already exist on the production host and have been verified
against the facilitator's supported-network endpoint without submitting a
payment.

## Goals

- Accept real `$0.01` USDC payments on Base Mainnet through x402 v2.
- Keep AgentPay, Redis, and their operational policy in one Docker Compose
  project on one server.
- Preserve the standard x402 v2 headers for protocol clients.
- Return a readable JSON payment challenge to ordinary HTTP clients.
- Require a Payment Identifier for strict idempotency and replay handling.
- Fail closed when configuration, Redis, verification, or settlement is
  unavailable.
- Use immutable application releases and provide a deterministic rollback.
- Keep all private credentials out of source control, client bundles, logs, and
  HTTP responses.

## Non-goals

- Running a private facilitator.
- Adding networks or assets beyond native USDC on Base Mainnet.
- Storing an agent or buyer private key in the web deployment.
- Providing high availability across multiple hosts.
- Claiming host-loss protection from a volume stored on the same VPS.
- Supporting x402 clients that cannot supply the required Payment Identifier
  extension.

## Runtime Architecture

The production Compose project contains two services:

1. `web`: the AgentPay Next.js application and local AgentPay SDK packages.
2. `redis`: the private idempotency state store.

The `web` service joins both the existing external `web-net` network and a
Compose-private backend network. Traefik continues to terminate TLS and route
`agentpay.thebestsites.ru` to `agentpay-app:3000` over `web-net`. Redis joins
only the private backend network and publishes no host port.

The web container runs an immutable image identified by the release Git SHA,
not `tonkaxxx/agentpay:latest`. Compose waits for Redis to pass its authenticated
healthcheck before starting the web service. The web service has its own HTTP
healthcheck, a restart policy, `no-new-privileges`, dropped Linux capabilities,
and a read-only filesystem with explicit writable temporary storage.

Redis uses a pinned image, an authenticated connection, append-only persistence
with `appendfsync everysec`, and a named Docker volume. A Redis restart must not
discard completed idempotency responses.

## Payment Flow

An unpaid request to `GET /api/premium` follows this flow:

1. AgentPay constructs one official x402 v2 `exact` requirement for
   `eip155:8453`, native Base USDC, amount `10000`, and the production recipient.
2. The requirement declares Payment Identifier as required and includes Bazaar
   discovery metadata.
3. The official Next adapter returns `402` with a base64-encoded
   `PAYMENT-REQUIRED` header.
4. A thin AgentPay response adapter decodes that exact header and mirrors the
   decoded object into an `application/json` response body. It never constructs
   independent payment terms, so the body cannot diverge from the protocol
   header.

A paid retry follows the official v2 flow:

1. The client sends `PAYMENT-SIGNATURE` and the required Payment Identifier.
2. Redis atomically acquires the identifier using a signature fingerprint; the
   raw signature is never persisted.
3. CDP verifies the signed EIP-3009 authorization.
4. The protected handler produces the premium resource.
5. CDP settles the payment on Base Mainnet.
6. AgentPay stores the sanitized response and `PAYMENT-RESPONSE` settlement
   result for replay.
7. The client receives the premium resource and the standard settlement header.

The existing `$0.01` price and Base Mainnet network remain unchanged.

## Idempotency Policy

Payment Identifier is required in production. This deliberately prioritizes
strict replay safety over compatibility with clients that do not implement the
extension.

- Same identifier and same signed payload while pending: `425` with
  `Retry-After`.
- Same identifier and same signed payload after completion: replay the original
  sanitized response and settlement header.
- Same identifier with a different signed payload: `409` conflict.
- Redis unavailable: fail closed before verification or settlement.
- Handler, verification, or settlement failure: release the pending lease when
  safe so the request can be retried according to policy.

The Redis password is generated on the production host. It is supplied to both
services through a mode-`0600` production env file and is not committed.

## Error Model and Observability

Public errors use stable, non-secret reason codes:

- `503 configuration_unavailable`: required production configuration is absent
  or invalid.
- `503 idempotency_unavailable`: Redis cannot provide the required atomic
  idempotency operation.
- `502 facilitator_unavailable`: CDP verification or settlement cannot be
  reached or returns an infrastructure failure.
- `402 payment_invalid`: the payment payload fails protocol verification.
- `409 payment_identifier_conflict`: an identifier is bound to another payload.
- `425 payment_in_progress`: the matching payment is currently being processed.

Server logs are structured and include a generated request ID, route, status,
safe reason code, and lifecycle stage. Logs must never include
`CDP_API_KEY_SECRET`, Redis credentials, agent private keys, raw
`PAYMENT-SIGNATURE`, or complete authorization payloads.

The JSON body mirrored for unpaid `402` responses is public protocol data and
contains no credentials.

## Production Configuration

The production web container receives only the variables it needs:

- `NEXT_PUBLIC_SITE_URL=https://agentpay.thebestsites.ru/`
- `AGENTPAY_PAY_TO=0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB`
- `CDP_API_KEY_ID`
- `CDP_API_KEY_SECRET`
- authenticated internal `REDIS_URL`

`AGENTPAY_OFFLINE_QUOTE_ONLY` is absent. `AGENT_PRIVATE_KEY`, RPC URLs, and the
mainnet client execution gates are not passed to the web container.

The production env file remains outside Git, has mode `0600`, and is backed up
only to a second protected file on the same host for rollback. CDP authentication
is verified without printing credentials before deployment.

## Release and Deployment

The release procedure is:

1. Run unit, integration, type, lint, production build, and browser E2E checks.
2. Build the multi-stage Docker image from the verified commit.
3. Tag and push the image using the full Git SHA.
4. Record the previous image digest and back up the current Compose and env
   files on the production server.
5. Upload the new Compose configuration and production env values.
6. Validate the rendered Compose model without printing secrets.
7. Pull the immutable release and start Redis, then web.
8. Wait for container healthchecks.
9. Verify the HTTPS route, security headers, x402 v2 challenge, exact Base
   Mainnet terms, production recipient, Payment Identifier requirement, and CDP
   facilitator support.
10. Restart Redis and confirm its persistent state survives.

Deployment stops before switching containers if any local verification or image
build fails. Deployment rolls back to the recorded image digest and backed-up
Compose configuration if remote health or smoke checks fail.

## Real-payment Validation

The seller deployment never stores a buyer private key. A real settlement smoke
test requires a separate funded Base Mainnet payer wallet and is run from the
guarded AgentPay client outside the web container. It must retain the explicit
`--execute` and `ALLOW_MAINNET_PAYMENTS=true` gates, verify the expected seller
address and `$0.01` cap, and confirm the returned `PAYMENT-RESPONSE` transaction
on Base before the deployment is considered settlement-tested.

The production service can be deployed and protocol-tested without this payer
credential; in that case it is reported as live but not end-to-end
settlement-tested.

## Test Strategy

Automated tests cover:

- the 402 body is decoded from the exact `PAYMENT-REQUIRED` header;
- all original headers, including `PAYMENT-REQUIRED`, survive body mirroring;
- malformed or missing payment headers fail safely;
- Payment Identifier is declared required by the premium route;
- requests without a required identifier cannot reach verification;
- Redis failures map to `idempotency_unavailable` without leaking details;
- facilitator failures retain the expected x402/HTTP semantics;
- Compose defines immutable images, private networking, authenticated Redis,
  AOF persistence, volume storage, and healthchecks;
- production configuration rejects quote-only mode, placeholder recipients,
  localhost origins, and accidental agent private keys;
- existing client policy, server idempotency, web, docs, and E2E suites remain
  green.

Remote smoke checks assert:

- the homepage returns `200` over HTTPS;
- an unpaid premium request returns `402`;
- the JSON body matches the decoded standard header;
- the challenge uses x402 v2, `exact`, `eip155:8453`, `10000`, Base USDC, and
  the production recipient;
- Payment Identifier is required;
- Redis is healthy, private, authenticated, persistent, and not host-published;
- the running image matches the intended immutable release.

## Operational Limits

This design makes the single VPS deployment durable across container and Redis
restarts, but it does not provide multi-host high availability or disaster
recovery if the VPS disk is lost. A later infrastructure phase can add encrypted
off-host Redis backups and replicated application instances without changing the
x402 contract.
