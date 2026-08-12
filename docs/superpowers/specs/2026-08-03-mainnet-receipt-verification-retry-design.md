# Mainnet receipt verification retry design

> Superseded by the [x402 v2 migration](../plans/2026-08-12-x402-v2-migration.md). Retained as v1 design history.

## Problem

The mainnet demo submits a USDC transfer, waits for one confirmation, and immediately
retries the paid request. The vendor verifies that transaction through a public RPC.
Immediately after inclusion, a public RPC can temporarily lack the receipt or report a
block height that is too old. The current verifier treats both conditions as permanent
invalid payments and returns HTTP 403. No additional transfer is made, but the agent
reports a failed request after payment.

## Design

For the real-funds demo only, the agent waits for two transaction confirmations before
making the paid retry request. This reduces the chance that the vendor's independent RPC
view has not caught up.

The vendor classifies `transaction_not_found` and `insufficient_confirmations` as
retryable payment-verification states. The middleware therefore replies with HTTP 503
and its existing `Payment Verification Unavailable` response instead of HTTP 403.
Permanent invalid receipts remain HTTP 403: malformed hashes, reverted transactions,
insufficient USDC transfers, and replayed transaction hashes.

After a payment has been submitted and confirmed, the client retries only an HTTP 503
whose body is the middleware's payment-verification-unavailable response. Every retry
uses the exact same `X-Payment-Tx` value; it never creates or signs another token
transfer. Retries are bounded and delayed. Other HTTP 503 responses, all HTTP 4xx
responses, and network errors retain their current behavior.

The mainnet demo configures this retry behavior. The default SDK behavior remains
unchanged unless a caller explicitly opts into it.

## Tests

Tests cover the following:

- A newly included transaction and a stale block height yield a retryable verifier
  result and middleware HTTP 503.
- A mainnet demo configures two confirmations and bounded receipt-verification retries.
- The client reuses one transaction hash for temporary payment-verification failures,
  then returns the eventual successful response without a second transfer.
- A non-payment-verification HTTP 503 is not retried.

## Safety properties

The change cannot repeat a USDC payment: the transfer happens once before all retry
requests, and each retry carries the original immutable transaction hash. The explicit
mainnet entrypoint, `--execute` gate, exact opt-in variable, fixed recipient, fixed
price, preflight, and default Sepolia restrictions are unchanged.
