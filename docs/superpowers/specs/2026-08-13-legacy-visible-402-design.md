# Legacy-Visible x402 v2 Challenge Design

## Goal

Restore the public, unpaid `/api/premium` presentation that AgentPay exposed
immediately before the x402 v2 migration, while retaining x402 v2 verification,
settlement, Payment Identifier idempotency, CDP, and Redis internally.

## Selected approach

AgentPay will use a compatibility response adapter on the existing endpoint.
The official x402 v2 handler remains the protocol authority and still creates
the `PAYMENT-REQUIRED` header. After that handler returns an unpaid `402`, the
adapter replaces only the HTTP response body with the legacy quote:

```json
{
  "error": "Payment Required",
  "priceUsdc": "0.01",
  "payTo": "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB",
  "network": "base",
  "chainId": 8453
}
```

The adapter preserves the exact v2 `PAYMENT-REQUIRED` header and all other
protocol headers. Consequently, a normal `curl` sees the same concise JSON as
before the migration, while an x402 v2 client can still decode and pay the
standard challenge.

Alternatives rejected:

- A new minimal body containing only `error` would be concise but would not
  restore the previous external contract.
- A separate legacy endpoint would duplicate routing and create two public
  contracts.
- Restoring `X-Payment-Tx` would reintroduce the obsolete payment protocol and
  violate the requirement that payment processing remain x402 v2.

## Public-data boundary

The premium route will stop declaring the Bazaar discovery extension. Its
current `output.example` contains the exact premium response and therefore
makes paid output public inside the challenge metadata. The required Payment
Identifier extension remains because it is part of the production replay and
idempotency contract.

The remaining v2 header necessarily contains the protected resource URL and
description, payment amount, asset, recipient, network, timeout, and Payment
Identifier declaration. These are payment instructions, not paid resource
content.

## Browser presentation

The live API demo will render the response JSON body again instead of decoding
and displaying the `PAYMENT-REQUIRED` header. It will therefore show the same
legacy quote fields as a normal curl request. This affects presentation only;
the browser does not attempt payment.

## Paid and error behavior

- A successfully paid request continues through the official x402 v2 verify
  and settle flow and returns the premium resource body.
- The compatibility adapter changes only valid unpaid `402` responses that
  contain a decodable `PAYMENT-REQUIRED` header.
- Non-402 responses are returned unchanged.
- A missing or malformed protocol header is returned unchanged rather than
  fabricating payment terms.
- The legacy body uses `Cache-Control: no-store` and JSON content type.
- Configuration, Redis, facilitator, and unknown failures retain the hardened
  status/reason responses already deployed.

This design restores the unauthenticated external quote presentation; it does
not restore the obsolete `X-Payment-Tx` request interface or roll back SDK,
documentation, settlement, or security semantics to x402 v1.

## Verification

Automated tests will prove that:

- the exact legacy body is derived from configured price, recipient, and Base
  constants;
- the byte-for-byte v2 `PAYMENT-REQUIRED` header is preserved;
- the decoded header still advertises x402 v2 exact Base USDC and required
  Payment Identifier;
- no Bazaar extension or `premiumData` occurs in the unpaid challenge;
- the live demo renders `priceUsdc` and `chainId`, not decoded v2 metadata;
- paid/non-402 and malformed-header responses are not rewritten.

The production smoke check will validate both surfaces independently: legacy
JSON in the body and x402 v2 requirements in the header. Deployment will use a
new immutable full-Git-SHA image and retain the current rollback backup process.
