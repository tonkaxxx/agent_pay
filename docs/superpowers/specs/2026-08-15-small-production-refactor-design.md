# AgentPay Small Production Refactor Design

**Date:** 2026-08-15
**Status:** Proposed

## Goal

Reduce configuration drift and harden the existing single-server x402 v2
runtime with a small internal refactor. The public unpaid and paid HTTP
contracts, payment amount, Base Mainnet settlement flow, Redis replay policy,
and Docker topology remain unchanged.

## Scope

The change contains five deliberately small parts:

1. Define one immutable premium payment policy for the resource route and the
   authorization guard. It owns the exact scheme, Base network, official Base
   USDC address, atomic amount `10000`, display amount `0.01`, route price
   `$0.01`, and timeout `300` seconds.
2. Create the facilitator local account with viem's in-process nonce manager so
   concurrent transactions from the single facilitator process do not obtain
   the same account nonce.
3. Move Redis client construction into a focused factory that always installs
   a secret-free `error` listener before the client connects.
4. Remove repeated public-error logging/response construction from the premium
   route wrapper while preserving every existing status, body, header, and log
   field.
5. Apply repository-only cleanup: rename the private root package to
   `agentpay`, allow new files under `docs/` to be tracked, and add focused
   invariant tests. Existing local environment files and historical documents
   are not deleted or moved.

## Architecture

`packages/server/src/payment-policy.ts` will be the runtime source of truth for
premium payment terms. `createPremiumRoute` and `buildPremiumHandler` will both
consume the same exported object, eliminating the current independent `$0.01`
and `10000` literals. Existing `BASE_NETWORK` and `BASE_USDC` exports remain
available so consumers do not need to change import semantics.

The clean-room TypeScript/Python buyers and production verifier intentionally
retain independent expected values. Their purpose is to reject unexpected
server policy changes, so importing the server's policy into those checks would
make them self-fulfilling.

`packages/facilitator/src/signer.ts` will expose a small account factory that
uses viem's standard `nonceManager`. The existing signer adapter, supported
scheme, RPC chain assertion, and settlement implementation remain unchanged.
The Compose deployment still runs exactly one facilitator instance.

`web/src/features/premium-api/redis-client.ts` will own node-redis construction
and its error listener. The listener emits only a fixed component/event record;
it never includes the error object, Redis URL, or credentials. The existing
authorization store continues to fail closed and returns the same stable `503`
response on Redis failures.

## Public Contract Invariants

- Unpaid `GET /api/premium` remains HTTP `402` with the same compact JSON body.
- `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE` semantics do
  not change.
- The price remains exactly `0.01 USDC` (`10000` atomic units) on
  `eip155:8453` using official Base USDC.
- The premium HTTP `200`, replay `409`, settlement `502`, and infrastructure
  `503` bodies and cache headers remain byte-for-byte compatible at the JSON
  contract level.
- No new endpoint, payment extension, database, queue, SDK, or external service
  is introduced.

## Error Handling

Redis transport errors are observed to prevent an unhandled EventEmitter
`error`, but only the fixed event `{ component: "authorization-store", event:
"redis_error" }` is logged. Public error mapping continues to hide caught error
objects and secret values. Facilitator startup remains fail-fast for invalid
keys, RPC URLs, or chain IDs.

## Testing

Work follows red-green-refactor:

- a server test first requires the shared immutable payment policy and proves
  the route is derived from it;
- a facilitator test first requires the created account to use viem's nonce
  manager;
- a web test first requires every Redis client to have a safe error listener
  and proves emitted secret text is not logged;
- existing route-handler tests protect the refactor's public response and log
  behavior;
- the full unit/component suite, typecheck, lint, production build, and
  Playwright E2E suite run before completion.

No automated test broadcasts a Base Mainnet transaction.
