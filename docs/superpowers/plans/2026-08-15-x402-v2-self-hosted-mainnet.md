# AgentPay x402 v2 Self-Hosted Mainnet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace AgentPay's public transaction-hash receipt with a standard x402 v2 EIP-3009 payment flow whose verification and Base Mainnet settlement run on the same production server.

**Architecture:** The public Next.js resource server uses the official x402 v2 Next adapter and calls an internal self-hosted facilitator over the Compose backend network. A narrow AgentPay server package publishes the exact route contract and atomically locks each `(network, asset, payer, nonce)` authorization in Redis without caching the paid body; the facilitator uses a dedicated gas-only wallet to submit `transferWithAuthorization` on Base.

**Tech Stack:** Node.js 22, TypeScript 6/7, Next.js 16, `@x402/core@2.22.0`, `@x402/evm@2.22.0`, `@x402/next@2.22.0`, `@x402/fetch@2.22.0`, viem 2.55, Express 5, Redis 7.4, Vitest, Playwright, Docker Compose, Traefik.

## Global Constraints

- All implementation and documentation commits stay on Git branch `dev`; `main` remains at `74b487e` until a separate merge decision.
- Production origin is exactly `https://agentpay.thebestsites.ru/`.
- Production recipient is exactly `0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB` unless the owner explicitly rotates it before deployment.
- The only payment option is x402 version `2`, scheme `exact`, network `eip155:8453`, official Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, amount `10000` (`0.01` USDC), and `maxTimeoutSeconds: 300`.
- Base Sepolia, CDP, `X-Payment-Tx`, transaction-hash authorization, Bazaar, required Payment Identifier, paid-response replay, and AgentPay-specific buyer requirements are forbidden.
- Standard clients use `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE` exactly as defined by x402 v2.
- The unpaid JSON body is compact and must not contain `premiumData`, a Bazaar output example, a raw payment payload, or internal infrastructure details.
- A public transaction hash or an already consumed EIP-3009 authorization never unlocks the resource.
- Redis locking spans verification, handler execution, settlement, and final response preparation. Paid response bodies are never stored or replayed.
- Raw `PAYMENT-SIGNATURE`, authorization payloads, private keys, RPC credentials, Redis credentials, and premium bodies are never logged or persisted.
- The facilitator key is a new dedicated gas-only Base wallet. The buyer key previously posted in chat is compromised and must never be used or funded.
- Automated tests never broadcast a mainnet transaction. Real settlement requires `--execute` and `ALLOW_MAINNET_PAYMENTS=true` in an external smoke process.
- The facilitator and Redis publish no host ports. Only the web service joins the existing external `web-net` ingress network.
- Production images use an immutable full Git SHA tag; Redis is authenticated, AOF-backed, and persistent.

---

## File Map

- `packages/server/src/resource-server.ts`: construct the official Base-only x402 resource server and the canonical premium route.
- `packages/server/src/authorization.ts`: decode v2 EIP-3009 payloads and derive a non-secret authorization fingerprint.
- `packages/server/src/authorization-store.ts`: define lock state and implement Redis Lua compare-and-set operations.
- `packages/server/src/authorization-guard.ts`: hold the lock around official verify/handler/settle and never replay paid responses.
- `packages/server/src/index.ts`: public exports for the web application.
- `packages/facilitator/src/config.ts`: validate mainnet RPC and gas-wallet configuration without leaking values.
- `packages/facilitator/src/signer.ts`: adapt a viem Base wallet/public client to `FacilitatorEvmSigner` and assert chain `8453`.
- `packages/facilitator/src/service.ts`: register official x402 v2 EVM `exact` settlement for Base.
- `packages/facilitator/src/app.ts`: internal `/healthz`, `/supported`, `/verify`, and `/settle` HTTP service.
- `packages/facilitator/src/index.ts`: fail-fast process entrypoint.
- `web/src/features/premium-api/config.ts`: web-only public origin, payee, internal facilitator URL, and Redis configuration.
- `web/src/features/premium-api/runtime.ts`: compose official x402 Next handler with the authorization guard.
- `web/src/features/premium-api/handler.ts`: return premium JSON only as the protected handler.
- `web/src/features/premium-api/route-handler.ts`: safe fail-closed public error mapping.
- `scripts/smoke/x402-mainnet.ts`: clean-room official TypeScript buyer requiring only key and URL at runtime.
- `scripts/smoke/x402_mainnet.py`: clean-room official Python buyer requiring only key and URL at runtime.
- `web/docker-compose.production.yml`: hardened one-server `web + facilitator + redis` stack.
- `web/.env.production.example`: non-secret production variable contract.
- `web/scripts/verify-production.mjs`: unpaid protocol, Compose, and service-health verification without a payment.
- `README.md`, `web/README.md`, landing/docs components: document standard prompt-only agent usage and operational limits.

Legacy custom v1 client/server implementation files and Base Sepolia demos are removed only after replacement tests are red, so no production code is deleted without a failing specification.

### Task 1: Establish a Base-Only Official x402 v2 Server Contract

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `pnpm-workspace.yaml`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Modify: `packages/server/package.json`
- Modify: `packages/server/src/index.ts`
- Create: `packages/server/src/resource-server.ts`
- Create: `packages/server/test/resource-server.test.ts`
- Modify: `packages/server/test/middleware.types.ts`

**Interfaces:**
- Produces: `BASE_NETWORK = "eip155:8453"`.
- Produces: `BASE_USDC = "0x833589fCD6E..."` as a checksummed `Address`.
- Produces: `createAgentPayResourceServer(facilitator: FacilitatorClient): x402ResourceServer`.
- Produces: `createPremiumRoute(payTo: Address, resource: string): RouteConfig`.
- Keeps temporarily: legacy receipt exports until the web endpoint is migrated in Task 4, so every task ends green.

- [ ] **Step 1: Write the failing resource contract tests**

Create `packages/server/test/resource-server.test.ts` with a fake facilitator whose `getSupported()` returns only v2 `exact` on `eip155:8453`. Assert the route is exactly:

```ts
expect(createPremiumRoute(PAY_TO, RESOURCE)).toEqual({
  accepts: {
    scheme: "exact",
    network: "eip155:8453",
    price: "$0.01",
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
  },
  resource: RESOURCE,
  description: "AgentPay premium API",
  mimeType: "application/json",
  unpaidResponseBody: expect.any(Function),
  settlementFailedResponseBody: expect.any(Function),
});
```

Call `unpaidResponseBody` and assert:

```ts
expect(body).toEqual({
  contentType: "application/json",
  body: {
    error: "Payment Required",
    x402Version: 2,
    priceUsdc: "0.01",
    network: "eip155:8453",
  },
});
expect(JSON.stringify(body)).not.toContain("premiumData");
```

Add type assertions proving `createPremiumRoute` accepts no network argument, no discovery extension, and no payment-identifier setting.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
corepack pnpm exec vitest run packages/server/test/resource-server.test.ts
```

Expected: FAIL because the package still exports the v1 receipt middleware and the route factory does not exist.

- [ ] **Step 3: Replace the package dependency and API surface**

Keep the temporary package name `@x402/server` until its web consumer is migrated in Task 4. Pin these production dependencies exactly:

```json
{
  "@x402/core": "2.22.0",
  "@x402/evm": "2.22.0",
  "viem": "2.55.10"
}
```

Implement the official server registration:

```ts
export function createAgentPayResourceServer(
  facilitator: FacilitatorClient,
): x402ResourceServer {
  return new x402ResourceServer(facilitator).register(
    BASE_NETWORK,
    new ExactEvmScheme(),
  );
}
```

Implement `createPremiumRoute` with the exact route asserted above. Use `getAddress` for the payee and require `new URL(resource)` to equal its canonical `.href`. Return a compact unpaid body and `{ error: "Bad Gateway", reason: "settlement_failed" }` as the settlement failure body. Do not declare extensions.

- [ ] **Step 4: Export the v2 contract alongside the temporary legacy API**

Export `createAgentPayResourceServer`, `createPremiumRoute`, `BASE_NETWORK`, and `BASE_USDC` from `packages/server/src/index.ts`. Leave the existing v1 exports and consumers unchanged in this task; Task 4 removes them immediately after the replacement premium runtime is green, and Task 5 replaces then removes the legacy buyer/examples.

Update `pnpm-lock.yaml` through:

```bash
corepack pnpm install
```

- [ ] **Step 5: Run focused and package tests and verify GREEN**

Run:

```bash
corepack pnpm exec vitest run packages/server/test/resource-server.test.ts
corepack pnpm --filter @agentpay/server run typecheck
corepack pnpm test
```

Expected: the new resource contract and the entire existing root/web suite pass because the legacy endpoint remains intact until Task 4.

- [ ] **Step 6: Commit the protocol foundation**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vitest.config.ts \
  packages/server
git commit -m "feat: establish Base-only x402 v2 server contract"
```

### Task 2: Add Non-Replayable Authorization Locking

**Files:**
- Create: `packages/server/src/authorization.ts`
- Create: `packages/server/src/authorization-store.ts`
- Create: `packages/server/src/authorization-guard.ts`
- Modify: `packages/server/src/index.ts`
- Create: `packages/server/test/authorization.test.ts`
- Create: `packages/server/test/authorization-store.test.ts`
- Create: `packages/server/test/authorization-guard.test.ts`

**Interfaces:**
- Produces: `AuthorizationPolicy { resource, network, asset, payTo, amount }`.
- Produces: `authorizationFingerprint(encodedHeader: string, policy: AuthorizationPolicy): string`.
- Produces: `AuthorizationStore.acquire(key, lease, pendingTtlSeconds)` returning `"acquired" | "pending" | "consumed"`.
- Produces: `AuthorizationStore.consume(key, lease, consumedTtlSeconds): Promise<boolean>`.
- Produces: `AuthorizationStore.release(key, lease): Promise<boolean>`.
- Produces: `RedisAuthorizationStore` using atomic Lua and prefix `agentpay:authorization:v2:`.
- Produces: `withAuthorizationLock(handler, options): PaymentRequestHandler`.

- [ ] **Step 1: Write failing canonical fingerprint tests**

Use `encodePaymentSignatureHeader` to build an official v2 EIP-3009 payload. Assert that changing base64 padding or JSON property order does not change the fingerprint, while changing network, asset, `from`, or nonce does. Assert malformed, v1, Permit2, missing-resource, and non-`exact` payloads throw `InvalidAuthorizationError` without including the raw header.

The production key material for the digest is exactly:

```ts
[
  payment.accepted.network,
  payment.accepted.asset.toLowerCase(),
  authorization.from.toLowerCase(),
  authorization.nonce.toLowerCase(),
].join(":")
```

Hash it with SHA-256 and return lowercase hex. Do not hash or persist the raw signature.

- [ ] **Step 2: Run fingerprint tests and verify RED**

```bash
corepack pnpm exec vitest run packages/server/test/authorization.test.ts
```

Expected: FAIL because authorization decoding and fingerprinting do not exist.

- [ ] **Step 3: Implement strict v2 EIP-3009 parsing**

Use `decodePaymentSignatureHeader` from `@x402/core/http` and `isEIP3009Payload` from `@x402/evm`. Require version `2`, exact policy network/asset/payee/amount/resource, scheme `exact`, 20-byte payer, and 32-byte nonce before hashing. Keep error messages stable (`invalid_payment_authorization`) and secret-free. The guard catches this typed error and delegates to official x402 processing so the client receives the canonical `402` challenge.

- [ ] **Step 4: Write failing Redis state-machine tests**

Test these transitions against an injected `eval` client:

```text
missing -> acquire -> pending
pending + different request -> pending
pending + matching lease -> consume -> consumed
pending + matching lease -> release -> missing
consumed -> acquire -> consumed
```

Assert Redis receives only the fingerprint, random lease token, state marker, and TTL—never the encoded header, signature, premium body, or private key.

- [ ] **Step 5: Implement atomic acquire/consume/release**

Use one Lua script per operation. `acquire` must use `SET ... NX EX`; `consume` and `release` must compare the current pending lease before mutation. Use pending TTL `360` seconds and consumed TTL `86400` seconds. Wrap connection/eval failures in `AuthorizationStoreUnavailableError` whose public message contains no Redis URL.

- [ ] **Step 6: Write failing end-to-end guard tests**

Tests must prove:

- unpaid request bypasses the lock and reaches official x402 handling;
- first signed request acquires, invokes the downstream handler once, sees a successful decoded `PAYMENT-RESPONSE`, consumes, and returns `200`;
- a concurrent duplicate receives `409 payment_in_progress` and cannot invoke downstream;
- a consumed duplicate receives `409 payment_consumed` and no body replay;
- downstream verification or settlement failure releases a matching lease and returns no premium data;
- successful settlement followed by Redis consume failure returns `503 payment_infrastructure_unavailable` and discards the prepared premium response;
- a `200` without a successful standard settlement header fails closed;
- no response/log contains the payment header.

- [ ] **Step 7: Implement the guard and verify GREEN**

The core control flow is:

```ts
const header = request.headers.get("PAYMENT-SIGNATURE");
if (header === null) return handler(request);

const key = authorizationFingerprint(header);
const lease = randomUUID();
const state = await store.acquire(key, lease, pendingTtlSeconds);
if (state === "pending") return paymentInProgress();
if (state === "consumed") return paymentConsumed();

const response = await handler(request);
const settlement = decodeSuccessfulSettlement(response);
if (settlement === null) {
  await store.release(key, lease);
  return response;
}
if (!await store.consume(key, lease, consumedTtlSeconds)) {
  return infrastructureUnavailable();
}
return response;
```

Never cache or reconstruct `response.body`. Add `Cache-Control: private, no-store` to every guard response.

- [ ] **Step 8: Run server tests and commit**

```bash
corepack pnpm exec vitest run packages/server/test
corepack pnpm --filter @agentpay/server run typecheck
git add packages/server
git commit -m "feat: prevent x402 authorization replay"
```

### Task 3: Build the Internal Self-Hosted Facilitator

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `vitest.config.ts`
- Create: `packages/facilitator/package.json`
- Create: `packages/facilitator/tsconfig.json`
- Create: `packages/facilitator/src/config.ts`
- Create: `packages/facilitator/src/signer.ts`
- Create: `packages/facilitator/src/service.ts`
- Create: `packages/facilitator/src/app.ts`
- Create: `packages/facilitator/src/index.ts`
- Create: `packages/facilitator/test/config.test.ts`
- Create: `packages/facilitator/test/signer.test.ts`
- Create: `packages/facilitator/test/app.test.ts`

**Interfaces:**
- Produces: `FacilitatorConfig { host, port, rpcUrl, privateKey }`.
- Produces: `createMainnetFacilitatorSigner(config): Promise<FacilitatorEvmSigner>`.
- Produces: `createMainnetFacilitator(signer): x402Facilitator`.
- Produces: `createFacilitatorApp({ facilitator, healthcheck }): Express`.
- HTTP: internal `GET /healthz`, `GET /supported`, `POST /verify`, `POST /settle`.

- [ ] **Step 1: Write failing configuration tests**

Assert startup rejects a missing or non-HTTP RPC, malformed key, the zero placeholder, a key whose injected SHA-256 appears in the forbidden-fingerprint set, a non-loop-safe port, and any configured network other than Base Mainnet. Error messages name the variable but never its value. Valid defaults are `HOST=0.0.0.0` and `PORT=4022`; production supplies the safe fingerprint of the previously compromised key without storing that key itself.

- [ ] **Step 2: Run configuration tests and verify RED**

```bash
corepack pnpm exec vitest run packages/facilitator/test/config.test.ts
```

- [ ] **Step 3: Implement fail-fast config and signer adapter**

Pin facilitator dependencies exactly:

```json
{
  "@x402/core": "2.22.0",
  "@x402/evm": "2.22.0",
  "express": "5.2.1",
  "viem": "2.55.10"
}
```

Create a viem local account from `FACILITATOR_PRIVATE_KEY`, a Base wallet client extended with `publicActions`, and adapt it with `toFacilitatorEvmSigner`. Before listening, call `getChainId()` and require `8453`. Do not print the account key or RPC URL; logging the public facilitator address is allowed.

- [ ] **Step 4: Write failing service and HTTP tests**

Assert `createMainnetFacilitator` reports exactly:

```json
{
  "x402Version": 2,
  "scheme": "exact",
  "network": "eip155:8453"
}
```

Use a fake facilitator with Supertest to prove `/supported` returns its result, `/verify` and `/settle` pass only `{ paymentPayload, paymentRequirements }`, malformed or oversized JSON returns `400 invalid_request`, and thrown errors return secret-free `500 facilitator_error`. `/healthz` returns `503` until the injected chain check succeeds.

- [ ] **Step 5: Implement official exact settlement and internal app**

Register only Base:

```ts
const facilitator = new x402Facilitator();
registerExactEvmScheme(facilitator, {
  signer,
  networks: "eip155:8453",
  simulateInSettle: true,
});
```

Use `express.json({ limit: "64kb" })`. The HTTP layer delegates to official `verify`, `settle`, and `getSupported`; it does not implement signature rules itself. Return no stack traces or caught error strings.

- [ ] **Step 6: Run facilitator tests, typecheck, and commit**

```bash
corepack pnpm exec vitest run packages/facilitator/test
corepack pnpm --filter @agentpay/facilitator run typecheck
corepack pnpm --filter @agentpay/facilitator run build
git add pnpm-workspace.yaml vitest.config.ts packages/facilitator pnpm-lock.yaml
git commit -m "feat: add self-hosted Base x402 facilitator"
```

### Task 4: Protect the Next.js Premium Route with v2

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Modify: `packages/server/package.json`
- Modify: `packages/server/src/index.ts`
- Delete after RED: `packages/server/src/middleware.ts`
- Delete after RED: `packages/server/src/verifier.ts`
- Delete after RED: `packages/server/test/middleware.test.ts`
- Delete after RED: `packages/server/test/verifier.test.ts`
- Modify: `web/package.json`
- Modify: `web/next.config.ts`
- Modify: `web/vitest.config.ts`
- Modify: `web/src/features/premium-api/config.ts`
- Modify: `web/src/features/premium-api/config.test.ts`
- Replace: `web/src/features/premium-api/handler.ts`
- Replace: `web/src/features/premium-api/handler.test.ts`
- Replace: `web/src/features/premium-api/runtime.ts`
- Replace: `web/src/features/premium-api/runtime.test.ts`
- Replace: `web/src/features/premium-api/route-handler.ts`
- Replace: `web/src/features/premium-api/route-handler.test.ts`
- Modify: `web/src/app/api/premium/route.ts`
- Modify: `web/src/app/api/premium/route.test.ts`
- Delete after RED: `web/src/features/premium-api/redis-replay-store.ts`
- Delete after RED: `web/src/features/premium-api/redis-replay-store.test.ts`

**Interfaces:**
- `PremiumConfig { siteUrl, resourceUrl, payTo, facilitatorUrl, redisUrl }`.
- `createPremiumHandler(): (request: NextRequest) => Promise<NextResponse>` contains only paid content.
- `buildPremiumHandler(config, dependencies?): PaymentRequestHandler` composes official v2 and lock guard.
- `createPremiumRoute(getHandler)` maps safe configuration and infrastructure failures.

- [ ] **Step 1: Write failing configuration tests**

Replace `BASE_MAINNET_RPC_URL` in the web config with `FACILITATOR_URL`. Assert production requires HTTPS public origin, exact canonical `/api/premium` resource, valid payee, `redis://` or `rediss://`, and an HTTP(S) facilitator URL. Reject localhost public origins, placeholder payees, any `AGENT_PRIVATE_KEY`, `FACILITATOR_PRIVATE_KEY`, `CDP_API_KEY_ID`, or `CDP_API_KEY_SECRET` present in the web environment.

- [ ] **Step 2: Write failing premium runtime tests**

Inject fakes for `HTTPFacilitatorClient`, `x402ResourceServer`, official `withX402`, Redis store, and guard. Assert:

```ts
expect(createFacilitator).toHaveBeenCalledWith({
  url: "http://facilitator:4022",
  timeoutMs: 120_000,
});
expect(createRoute).toHaveBeenCalledWith(config.payTo, config.resourceUrl);
expect(protect).toHaveBeenCalledBefore(guard);
```

Assert the protected handler does not receive a buyer key or RPC URL and no Payment Identifier/Bazaar extension is registered.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
corepack pnpm --dir web exec vitest run src/features/premium-api
```

Expected: FAIL because web still builds a v1 receipt verifier.

- [ ] **Step 4: Implement the official v2 runtime**

Pin `@x402/core`, `@x402/evm`, and `@x402/next` to `2.22.0`; depend on `@agentpay/server: workspace:*`.

Rename the local server package from its temporary `@x402/server` name to `@agentpay/server`, update root/web aliases and build filters, then delete the v1 middleware, receipt verifier, replay store, and their tests. At this point no production endpoint accepts `X-Payment-Tx`.

Compose in this order:

```ts
const facilitator = new HTTPFacilitatorClient({
  url: config.facilitatorUrl,
  timeoutMs: 120_000,
});
const server = createAgentPayResourceServer(facilitator);
const route = createPremiumRoute(config.payTo, config.resourceUrl);
const paid = withX402(createPremiumHandler(), route, server);
return withAuthorizationLock(
  request => paid(request as NextRequest),
  {
    store: new RedisAuthorizationStore(redis),
    policy: {
      resource: config.resourceUrl,
      network: "eip155:8453",
      asset: BASE_USDC,
      payTo: config.payTo,
      amount: "10000",
    },
  },
);
```

The paid handler returns:

```json
{
  "premiumData": "Here's your premium data — paid, verified, and unlocked by AgentPay.",
  "paidWith": "USDC",
  "network": "eip155:8453",
  "protocol": "x402-v2"
}
```

It includes `Cache-Control: private, no-store` and no tx hash in the body.

- [ ] **Step 5: Implement stable public errors**

Map configuration failures to `503 configuration_unavailable`; Redis/facilitator/timeouts to `503 payment_infrastructure_unavailable`; malformed payment to the official `402`; and confirmed settlement failure to `502 settlement_failed`. Generate a request ID, log only `{ requestId, route, stage, status, reason }`, and never serialize the caught error or request headers.

- [ ] **Step 6: Run web tests and commit**

```bash
corepack pnpm --dir web test
corepack pnpm --dir web typecheck
git add package.json tsconfig.json vitest.config.ts packages/server \
  web/package.json web/next.config.ts web/vitest.config.ts \
  web/src/features/premium-api web/src/app/api/premium pnpm-lock.yaml
git commit -m "feat: protect premium API with self-hosted x402 v2"
```

### Task 5: Prove Clean-Room Agent Compatibility and Update Product Copy

**Files:**
- Create: `scripts/smoke/x402-mainnet.ts`
- Create: `scripts/smoke/x402_mainnet.py`
- Create: `scripts/smoke/requirements.txt`
- Create: `scripts/smoke/smoke-imports.test.ts`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`
- Delete after RED: `packages/client/**`
- Delete after RED: legacy `examples/**`
- Modify: `README.md`
- Modify: `web/README.md`
- Modify: `web/src/components/docs-page.tsx`
- Modify: `web/src/components/docs-page.test.tsx`
- Modify: `web/src/components/landing-page.tsx`
- Modify: `web/src/components/landing-page.test.tsx`
- Modify: `web/src/components/live-api-demo.tsx`
- Modify: `web/src/components/live-api-demo.test.tsx`
- Modify: `web/e2e/agentpay.spec.ts`

**Interfaces:**
- TypeScript smoke runtime inputs: `AGENT_PRIVATE_KEY`, optional `API_URL` defaulting to production, `ALLOW_MAINNET_PAYMENTS`, and `--execute`.
- Python smoke runtime inputs: the same values.
- Neither smoke client imports `@agentpay/*`, reads an RPC URL, or requires buyer ETH.

- [ ] **Step 1: Write failing clean-room and UI tests**

Assert both scripts contain only official x402/viem or Python x402 imports and no AgentPay package import. UI tests must show the standard three headers, `eip155:8453`, `0.01 USDC`, and the exact one-prompt example while excluding `X-Payment-Tx`, CDP, Sepolia, and any literal private key.

The displayed prompt uses a placeholder only:

```text
here is crypto wallet private key:
AGENT_PRIVATE_KEY=<YOUR_NEW_LOW_BALANCE_PRIVATE_KEY>

Fetch data from the following API endpoint:
https://agentpay.thebestsites.ru/api/premium
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
corepack pnpm exec vitest run scripts/smoke/smoke-imports.test.ts
corepack pnpm --dir web exec vitest run src/components
```

- [ ] **Step 3: Implement the official TypeScript smoke client**

Use only the official buyer path:

```ts
const signer = privateKeyToAccount(privateKey);
const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(signer));
const fetchWithPayment = wrapFetchWithPayment(fetch, client);
const response = await fetchWithPayment(apiUrl);
```

Before execution, fetch and decode `PAYMENT-REQUIRED`, verify exact origin, resource, network, asset, amount, recipient, and cap. Without both gates, print a sanitized preview and exit without signing. With both gates, require `response.ok`, decode `PAYMENT-RESPONSE`, and print only status, transaction hash, and returned JSON.

- [ ] **Step 4: Implement the official Python smoke client**

Use the published v2 API:

```py
client = x402ClientSync()
account = Account.from_key(os.environ["AGENT_PRIVATE_KEY"])
register_exact_evm_client(client, EthAccountSigner(account))
with x402_requests(client) as session:
    response = session.get(api_url)
```

Apply the same preview and execution gates. Pin the current verified PyPI releases explicitly in `requirements.txt`:

```text
x402[requests,evm]==2.19.0
eth-account==0.13.7
```

- [ ] **Step 5: Update docs, landing, live demo, and E2E**

Describe self-hosted settlement, the gas-sponsor wallet, the absence of a buyer RPC/ETH requirement, and the capability boundary for text-only agents. The live demo must display the compact JSON body and separately decode the standard header for protocol details; it must never render premium content before payment.

E2E asserts an unpaid public request has status `402`, canonical `PAYMENT-REQUIRED`, compact body, no `premiumData`, no Bazaar, and no `X-Payment-Tx` acceptance.

After the clean-room smoke tests are green, delete the legacy custom buyer package and agent/vendor examples. Remove their workspace entries, aliases, demo scripts, private-key/RPC client configuration, and every Base Sepolia reference. The replacement smoke clients remain test utilities built only on official SDKs; they are not an AgentPay-specific agent.

- [ ] **Step 6: Run docs/client checks and commit**

```bash
corepack pnpm exec vitest run scripts/smoke/smoke-imports.test.ts
corepack pnpm --dir web test
corepack pnpm --dir web test:e2e
git add scripts package.json pnpm-workspace.yaml tsconfig.json vitest.config.ts \
  packages/client examples README.md web/README.md web/src/components web/e2e
git commit -m "docs: document standard x402 v2 agent access"
```

### Task 6: Build the Hardened Single-Compose Production Stack

**Files:**
- Modify: `web/Dockerfile`
- Modify: `.dockerignore`
- Create: `web/docker-compose.production.yml`
- Create: `web/docker-compose.test.ts`
- Create: `web/.env.production.example`
- Create: `web/scripts/verify-production.mjs`
- Create: `web/scripts/verify-production.test.ts`
- Modify: `web/docker-compose.yml`

**Interfaces:**
- One immutable `AGENTPAY_IMAGE` supplies both `web` and `facilitator` commands.
- Public: Traefik reaches `web:3000` through external `web-net`.
- Internal: `web -> facilitator:4022` and `web -> redis:6379` stay on an
  internal backend network; facilitator-only egress reaches Base RPC through a
  second bridge network with explicit gateway priority.
- Secrets: web receives no RPC or private keys; facilitator receives only RPC and gas key; Redis password is shared only where required.

- [ ] **Step 1: Write failing Compose policy tests**

Parse the production YAML and assert:

- exactly `web`, `facilitator`, and `redis` services;
- no `ports` on facilitator or Redis;
- only web joins `web-net`;
- `backend` is internal;
- web has `FACILITATOR_URL=http://facilitator:4022` and authenticated Redis URL but no private key/RPC/CDP values;
- facilitator has `BASE_MAINNET_RPC_URL` and `FACILITATOR_PRIVATE_KEY` but no buyer key or payout secret;
- Redis uses `redis:7.4.7-alpine`, password auth, AOF `appendfsync everysec`, healthcheck, and named volume;
- all services drop capabilities, enable `no-new-privileges`, use read-only roots where possible, have healthchecks, and restart `unless-stopped`;
- app image interpolation requires a non-empty immutable tag and rejects `latest` in the verification script.

- [ ] **Step 2: Run Compose tests and verify RED**

```bash
corepack pnpm --dir web exec vitest run docker-compose.test.ts scripts/verify-production.test.ts
```

- [ ] **Step 3: Extend the image for both processes**

Build `@agentpay/server`, `@agentpay/facilitator`, and Next in the builder. Copy facilitator dist/package metadata to the runtime. Keep default web command but allow Compose to override facilitator with:

```yaml
command: ["node", "/app/packages/facilitator/dist/index.js"]
```

Run both processes as non-root and expose only documented container ports.

- [ ] **Step 4: Implement production Compose and env contract**

`web/.env.production.example` contains only placeholders:

```dotenv
AGENTPAY_IMAGE=agentpay:0000000000000000000000000000000000000000
NEXT_PUBLIC_SITE_URL=https://agentpay.thebestsites.ru/
AGENTPAY_PAY_TO=0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB
BASE_MAINNET_RPC_URL=https://base-rpc.invalid/
FACILITATOR_PRIVATE_KEY=0x0000000000000000000000000000000000000000000000000000000000000000
REDIS_PASSWORD=INVALID_CHANGE_ME
```

Do not place real values in Git. The local `web/docker-compose.yml` may use builds and disposable Redis but must still run all three services and remain mainnet non-paying unless a separate external client explicitly executes.

- [ ] **Step 5: Implement deterministic non-paying production verification**

The script checks Compose health, image IDs, internal network membership, no published internal ports, facilitator `/supported` from inside web, and public HTTPS `402`. It decodes `PAYMENT-REQUIRED` and asserts the Global Constraints exactly. It rejects any unpaid body containing `premiumData`, `extensions.bazaar`, or a private-key-shaped value.

- [ ] **Step 6: Run container tests/build and commit**

```bash
corepack pnpm --dir web exec vitest run docker-compose.test.ts scripts/verify-production.test.ts
docker build -f web/Dockerfile -t agentpay:dev-$(git rev-parse --short=12 HEAD) .
docker compose -f web/docker-compose.yml config
git add web/Dockerfile web/docker-compose.yml web/docker-compose.production.yml \
  web/docker-compose.test.ts web/.env.production.example web/scripts .dockerignore
git commit -m "build: add self-hosted x402 production stack"
```

### Task 7: Full Local Verification and Security Regression Audit

**Files:**
- Modify only if a test exposes a defect: files owned by Tasks 1-6.
- Create: `docs/operations/x402-v2-mainnet-runbook.md`

**Interfaces:**
- Produces: a clean `dev` commit whose exact SHA is the release identifier.
- Produces: operator steps for funding/rotating only public wallet addresses, never keys.

- [ ] **Step 1: Run repository-wide static searches**

Run outside historical `docs/superpowers` files:

```bash
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next \
  --exclude='*.md' -E 'X-Payment-Tx|84532|base-sepolia|CDP_API|AGENT_PRIVATE_KEY=0x[0-9a-fA-F]{64}' .
```

Expected: no production/test source matches. Search tracked files for private-key-shaped literals and verify every match is an obvious zero/public test fixture.

- [ ] **Step 2: Run the complete verification matrix**

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm --dir web test:e2e
docker compose -f web/docker-compose.yml up -d --build
node web/scripts/verify-production.mjs --base-url=http://127.0.0.1:3000 --local
docker compose -f web/docker-compose.yml down
git diff --check
git status --short
```

Expected: all commands pass, unpaid contract is exact, and no real payment is sent.

- [ ] **Step 3: Perform explicit replay/concurrency regression tests**

Use deterministic signed fixture payloads and fake settlement to issue two simultaneous requests with one authorization. Assert exactly one protected-handler call, one settlement call, one `200`, and one `409`. Then submit the same payload after completion and assert `409 payment_consumed` with no premium body.

- [ ] **Step 4: Write the operations runbook**

Document secret file mode `0600`, gas-wallet minimum funding, Redis backup/restore, facilitator health, ambiguous settlement timeout handling, log redaction checks, immutable release rollback, payer-wallet rotation, and the rule that neither a tx hash nor a repeated signature is a support workaround.

- [ ] **Step 5: Commit the verified runbook**

```bash
git add docs/operations/x402-v2-mainnet-runbook.md
git commit -m "docs: add x402 v2 mainnet operations runbook"
```

### Task 8: Deploy `dev` to the Existing Server and Run One Controlled Mainnet Payment

**Files/Hosts:**
- Remote repository: `worker@192.168.88.44:/home/worker/repos/vibe/agentpay`
- Remote secret file: `web/.env.production` with mode `0600` and never added to Git.
- Remote Compose: `web/docker-compose.production.yml`.

**Interfaces:**
- Deployment inputs: verified `dev` SHA, Base RPC URL, generated Redis password, generated facilitator gas wallet.
- Funding inputs requiring owner action: Base ETH to the public facilitator address and at least `0.01` Base USDC to a new low-balance payer address.
- Deployment output: healthy public v2 challenge plus one confirmed paid response and rejected replay.

- [ ] **Step 1: Record rollback state before remote mutation**

Over SSH, record the running image digest, `docker compose ps`, current branch/SHA, and copy the current Compose/env to timestamped mode-`0600` backup files. Do not print env contents.

- [ ] **Step 2: Transfer the verified `dev` commit without changing `main`**

Push or securely transfer the exact commit, switch only the server checkout to `dev`, and capture the local SHA in `agentpay_release_sha` before the transfer. Require the remote SHA to equal that exact value:

```bash
agentpay_release_sha="$(git rev-parse HEAD)"
ssh worker@192.168.88.44 \
  "cd /home/worker/repos/vibe/agentpay && test \"\$(git rev-parse HEAD)\" = '$agentpay_release_sha' && test -z \"\$(git status --porcelain)\""
```

Do not deploy an uncommitted tree or a remote SHA that differs from `agentpay_release_sha`.

- [ ] **Step 3: Generate server-only secrets safely**

Generate the Redis password and a new facilitator key on the server with restrictive umask. Write them directly to `web/.env.production` without echoing them to the terminal transcript. Derive and print only the facilitator public address. Validate the configured RPC returns chain ID `8453`.

Pause only for the owner to fund the printed facilitator address with a minimal amount of Base ETH. Never request or display another private key.

- [ ] **Step 4: Build and start the immutable stack**

Tag the image with the full verified SHA, render Compose without printing interpolated secrets, start `redis`, then `facilitator`, then `web`, and wait for all healthchecks. Confirm facilitator and Redis have no published host ports.

- [ ] **Step 5: Verify the public unpaid protocol before spending**

Run `web/scripts/verify-production.mjs` against `https://agentpay.thebestsites.ru`. Confirm status `402`, compact body, exact header values, production payee, no premium data, and internal facilitator support for only Base exact v2.

- [ ] **Step 6: Prepare a new low-balance payer and execute once**

Generate a new payer wallet outside the server stack and reveal only its public address for funding. After it holds slightly more than `0.01` official Base USDC, run the clean TypeScript client first without execution gates and verify `PAYMENT NOT SENT`. Then run exactly once:

```bash
ALLOW_MAINNET_PAYMENTS=true \
API_URL='https://agentpay.thebestsites.ru/api/premium' \
corepack pnpm tsx scripts/smoke/x402-mainnet.ts --execute
```

`AGENT_PRIVATE_KEY` must already be exported from a protected local environment, not shell history or chat. Record the returned tx hash, confirm seller USDC increased by `10000`, and confirm the response contains premium data plus a successful standard `PAYMENT-RESPONSE`.

- [ ] **Step 7: Prove the settled authorization cannot be reused**

Replay the captured encoded authorization only from the controlled smoke harness. Expected: `409 payment_consumed`, no `premiumData`, no second transfer, and no cached response. Verify a bare public transaction hash in `X-Payment-Tx` still receives the normal unpaid `402`.

- [ ] **Step 8: Roll back automatically on failure or record release**

If health, unpaid protocol, settlement, recipient amount, or replay assertions fail, restore the recorded image/Compose/env backup and verify v1 health. If all pass, record the release SHA, image digest, facilitator public address, settlement hash, and verification timestamp without recording any secret.

---

## Plan Self-Review Checklist

- Every approved design requirement maps to Tasks 1-8.
- The implementation contains no Base Sepolia or external facilitator fallback.
- Standard clients need only a private key and URL; AgentPay code is not imported by smoke clients.
- Redis prevents concurrent use but never converts a settled signature into a replayable content token.
- The paid body is returned only after successful settlement and successful consumed-state persistence.
- Web and facilitator secrets are isolated by service.
- The only unavoidable external handoff is funding two newly generated public addresses; no private key is requested from the owner.
- No real payment occurs in automated tests or deployment before the explicit mainnet gate.
