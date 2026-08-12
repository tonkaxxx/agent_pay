# Legacy-Visible x402 v2 Challenge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore AgentPay's pre-v2 unpaid JSON and live-demo presentation without changing the x402 v2 payment protocol underneath.

**Architecture:** Keep the official x402 v2 handler as the source of the `PAYMENT-REQUIRED` header, then apply a narrow compatibility adapter that validates that header and replaces only the unpaid body with the legacy quote. Remove Bazaar discovery from this route so the challenge cannot contain premium output, and make presentation/smoke tooling consume the legacy body while independently validating the v2 header.

**Tech Stack:** TypeScript, Next.js 16, `@x402/core` 2.22, `@x402/next` 2.22, Vitest, Playwright, Docker Compose.

## Global Constraints

- The ordinary response body for an unpaid `GET /api/premium` must be exactly `{ error, priceUsdc, payTo, network, chainId }` with the pre-v2 field values.
- The official `PAYMENT-REQUIRED` header must be preserved byte-for-byte for x402 v2 clients.
- The route must keep x402 v2 exact Base Mainnet USDC, amount `10000`, and required Payment Identifier.
- The unpaid body and decoded header must not contain `premiumData` or a Bazaar extension.
- Do not restore `X-Payment-Tx`; verification, settlement, CDP, and Redis idempotency remain v2.
- Non-402 responses and malformed/missing-header responses remain unchanged.
- Production deployment uses an immutable full-Git-SHA Docker image and the existing backup/rollback process.

---

## File Map

- `web/src/features/premium-api/payment-required-response.ts`: emit the legacy body only after validating the official v2 challenge.
- `web/src/features/premium-api/payment-required-response.test.ts`: prove exact body compatibility and header preservation.
- `web/src/features/premium-api/runtime.ts`: pass legacy quote values to the adapter and stop declaring Bazaar discovery.
- `web/src/features/premium-api/runtime.test.ts`: prove route composition has required Payment Identifier but no discovery output.
- `web/src/components/live-api-demo.tsx`: render the server response body as pre-v2 UI did.
- `web/src/components/live-api-demo.test.tsx`: prove a v2 header does not replace the legacy body in the console.
- `web/e2e/agentpay.spec.ts`: verify legacy body and v2 header as two independent surfaces.
- `web/scripts/verify-production.mjs`: verify the production compatibility body plus the hidden v2 protocol contract.
- `README.md` and `web/README.md`: explain the compatibility presentation accurately.

### Task 1: Restore the Legacy Unpaid Body and Remove Premium Discovery

**Files:**
- Modify: `web/src/features/premium-api/payment-required-response.test.ts`
- Modify: `web/src/features/premium-api/payment-required-response.ts`
- Modify: `web/src/features/premium-api/runtime.test.ts`
- Modify: `web/src/features/premium-api/runtime.ts`

**Interfaces:**
- Produces: `LegacyPaymentQuote` with `priceUsdc`, `payTo`, `network`, and `chainId`.
- Produces: `withLegacyPaymentRequired(handler, quote): PaymentRequestHandler`.
- Preserves: the original `PAYMENT-REQUIRED` header and all non-body headers.

- [ ] **Step 1: Write failing compatibility tests**

Change the adapter test to call:

```ts
withLegacyPaymentRequired(handler, {
  priceUsdc: "0.01",
  payTo: paymentRequired.accepts[0].payTo,
  network: "base",
  chainId: 8453,
})
```

Assert the response body is exactly:

```ts
{
  error: "Payment Required",
  priceUsdc: "0.01",
  payTo: "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB",
  network: "base",
  chainId: 8453,
}
```

Keep assertions for status `402`, byte-for-byte header equality, preserved
upstream headers, JSON content type, and `Cache-Control: no-store`. Keep the
identity tests for non-402 and missing/malformed headers.

Update the runtime test so `createRoute` is called with
`paymentIdentifier: "required"` and no `discovery` property. Make the protected
handler return a valid encoded v2 challenge and assert the composed handler
returns the exact legacy quote.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
corepack pnpm --dir web exec vitest run \
  src/features/premium-api/payment-required-response.test.ts \
  src/features/premium-api/runtime.test.ts
```

Expected: FAIL because `withLegacyPaymentRequired` does not exist, the current
adapter mirrors the decoded v2 object, and runtime still declares discovery.

- [ ] **Step 3: Implement the compatibility adapter**

Replace the readable adapter with:

```ts
export interface LegacyPaymentQuote {
  readonly priceUsdc: string;
  readonly payTo: string;
  readonly network: "base";
  readonly chainId: 8453;
}

export function withLegacyPaymentRequired(
  handler: PaymentRequestHandler,
  quote: LegacyPaymentQuote,
): PaymentRequestHandler {
  return async request => {
    const response = await handler(request);
    if (response.status !== 402) return response;
    const encoded = response.headers.get("PAYMENT-REQUIRED");
    if (!encoded) return response;
    try {
      decodePaymentRequiredHeader(encoded);
    } catch {
      return response;
    }
    const headers = new Headers(response.headers);
    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("cache-control", "no-store");
    return new Response(JSON.stringify({
      error: "Payment Required",
      ...quote,
    }), { status: 402, headers });
  };
}
```

In runtime, remove the `discovery` option from `createAgentPayRoute` and compose:

```ts
return withLegacyPaymentRequired(idempotentHandler, {
  priceUsdc: "0.01",
  payTo: config.payTo,
  network: "base",
  chainId: 8453,
});
```

- [ ] **Step 4: Run focused and complete web tests**

```bash
corepack pnpm --dir web exec vitest run \
  src/features/premium-api/payment-required-response.test.ts \
  src/features/premium-api/runtime.test.ts
corepack pnpm --dir web test
```

Expected: all tests pass; the decoded challenge has no `bazaar` extension.

- [ ] **Step 5: Commit the API compatibility change**

```bash
git add web/src/features/premium-api/payment-required-response.ts \
  web/src/features/premium-api/payment-required-response.test.ts \
  web/src/features/premium-api/runtime.ts \
  web/src/features/premium-api/runtime.test.ts
git commit -m "fix: restore legacy-visible payment quote"
```

### Task 2: Restore the Legacy Live-Demo Presentation

**Files:**
- Modify: `web/src/components/live-api-demo.test.tsx`
- Modify: `web/src/components/live-api-demo.tsx`
- Modify: `web/e2e/agentpay.spec.ts`

**Interfaces:**
- Consumes: legacy JSON body from Task 1.
- Preserves: the v2 `PAYMENT-REQUIRED` header for protocol consumers.

- [ ] **Step 1: Write failing UI and E2E assertions**

In the component test, return the legacy body together with an encoded v2
header. Assert the console contains `"priceUsdc": "0.01"` and
`"chainId": 8453`, and does not contain `"x402Version"` or `"premiumData"`.

In E2E, assert the actual response body equals the five-field legacy object.
Decode the header separately and assert v2 exact Base requirements, required
Payment Identifier, no `bazaar` key, and no serialized `premiumData`.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
corepack pnpm --dir web exec vitest run src/components/live-api-demo.test.tsx
```

Expected: FAIL because the component currently decodes and renders the v2
header instead of the body.

- [ ] **Step 3: Render the server body directly**

Remove the `decodePaymentRequiredHeader` import from the component and replace
the header branch with:

```ts
const payload: unknown = await response.json();
```

Keep the request, status label, safe network-error state, and endpoint tabs
unchanged.

- [ ] **Step 4: Run UI tests and browser E2E**

```bash
corepack pnpm --dir web exec vitest run src/components/live-api-demo.test.tsx
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  -u http_proxy -u https_proxy -u all_proxy \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/nix/store/4fa0i91br311imiyli0v1j1i3nnss3ly-chromium-150.0.7871.46/bin/chromium \
  corepack pnpm --dir web test:e2e
```

Expected: component tests and all desktop/mobile E2E scenarios pass.

- [ ] **Step 5: Commit the presentation change**

```bash
git add web/src/components/live-api-demo.tsx \
  web/src/components/live-api-demo.test.tsx web/e2e/agentpay.spec.ts
git commit -m "fix: show legacy payment quote in live demo"
```

### Task 3: Update Production Verification and Documentation

**Files:**
- Modify: `web/scripts/verify-production.mjs`
- Modify: `web/README.md`
- Modify: `README.md`

**Interfaces:**
- Produces: a smoke verifier that validates the legacy body and v2 header independently.

- [ ] **Step 1: Change smoke assertions to the compatibility contract**

Replace body/header deep equality with exact equality against:

```js
{
  error: "Payment Required",
  priceUsdc: "0.01",
  payTo: recipient,
  network: "base",
  chainId: 8453,
}
```

Keep all decoded-header assertions, add rejection of `decoded.extensions?.bazaar`,
and reject `JSON.stringify(decoded).includes("premiumData")`.

- [ ] **Step 2: Update documentation**

State that the ordinary body intentionally preserves AgentPay's concise legacy
quote while `PAYMENT-REQUIRED` is the x402 v2 source of truth. Remove claims
that the body mirrors the decoded header. Document that Bazaar output discovery
is disabled on this premium endpoint to prevent pre-payment output disclosure.

- [ ] **Step 3: Run the complete release gate**

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  -u http_proxy -u https_proxy -u all_proxy corepack pnpm build
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  -u http_proxy -u https_proxy -u all_proxy \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/nix/store/4fa0i91br311imiyli0v1j1i3nnss3ly-chromium-150.0.7871.46/bin/chromium \
  corepack pnpm test:e2e
```

Expected: unit/integration, typecheck, build, and all E2E tests pass; lint has no errors.

- [ ] **Step 4: Commit verification and docs**

```bash
git add web/scripts/verify-production.mjs web/README.md README.md
git commit -m "docs: document legacy-visible v2 challenge"
```

### Task 4: Publish and Deploy the Immutable Release

**Files:**
- Modify remotely: `/home/worker/repos/vibe/agentpay/.env.production`
- Preserve remotely: `/home/worker/repos/vibe/agentpay/backups/<timestamp>/`

**Interfaces:**
- Consumes: clean verified Git commit and existing production Compose/CDP/Redis configuration.
- Produces: healthy production containers running the new full-SHA image.

- [ ] **Step 1: Build and push the release image**

```bash
release_sha=$(git rev-parse HEAD)
docker build -f web/Dockerfile -t "tonkaxxx/agentpay:${release_sha}" .
docker push "tonkaxxx/agentpay:${release_sha}"
```

Record the repository digest and ensure the tag is the full 40-character SHA.

- [ ] **Step 2: Back up the current remote state**

Over SSH to `worker@192.168.88.44`, create a mode-`0700` timestamped directory
under `/home/worker/repos/vibe/agentpay/backups/`. Copy `docker-compose.yml`,
`.env.production`, and the current image ID/reference into mode-`0600` files.
Do not print environment contents.

- [ ] **Step 3: Point production at the new image and restart safely**

Rewrite only the `AGENTPAY_IMAGE` line through a mode-`0600` temporary env file,
validate `docker compose --env-file .env.production config --quiet`, pull, and run:

```bash
docker compose --env-file .env.production up -d --remove-orphans --wait
```

Rollback to the backup automatically if either service is not healthy.

- [ ] **Step 4: Verify the deployed public contract**

Run `pnpm --dir web verify:production` against
`https://agentpay.thebestsites.ru` and the production recipient. If the local
Node transport cannot use the workstation SOCKS proxy, use curl only as the
transport and apply the same body/header assertions with the local verifier
logic.

Expected safe result:

```json
{
  "homepage": 200,
  "premium": 402,
  "legacyBody": true,
  "x402Version": 2,
  "scheme": "exact",
  "network": "eip155:8453",
  "amount": "10000",
  "paymentIdentifierRequired": true,
  "bazaarPresent": false
}
```

- [ ] **Step 5: Report the release boundary**

Report release SHA/digest, backup directory, healthy services, exact legacy
body fields, and independently verified v2 header fields. State that no real
payment was executed without a separate funded payer wallet.
