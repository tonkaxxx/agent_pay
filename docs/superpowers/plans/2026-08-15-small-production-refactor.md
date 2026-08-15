# AgentPay Small Production Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove payment-policy drift and harden facilitator nonce and Redis error handling without changing AgentPay's public x402 v2 contract.

**Architecture:** Add one immutable server-side premium policy consumed by both route generation and replay protection. Keep the facilitator, Redis store, Next.js route, public response bodies, Compose topology, and independent clean-room verifiers intact while introducing focused account and Redis client factories.

**Tech Stack:** TypeScript 6/7, Node.js 22, Next.js 16, x402 v2.22, viem 2.55, node-redis 6.2, Vitest, Playwright, pnpm.

## Global Constraints

- Work only on Git branch `dev`; do not modify `main`.
- Preserve the public unpaid JSON body and canonical x402 v2 headers.
- Preserve price `0.01 USDC`, atomic amount `10000`, network `eip155:8453`, official Base USDC, recipient configuration, and timeout `300` seconds.
- Preserve paid `200`, replay `409`, settlement `502`, and infrastructure `503` JSON contracts and cache headers.
- Do not add an endpoint, payment extension, database, queue, SDK, service, or Base transaction.
- Do not import AgentPay runtime policy into the clean-room smoke clients or production verifier; they must remain independent policy checks.
- Do not read, print, move, delete, or commit local secret files.
- Follow red-green-refactor for every production-code change.

---

## File Map

- Create `packages/server/src/payment-policy.ts`: immutable premium payment terms.
- Modify `packages/server/src/resource-server.ts`: derive the route and compact body from the policy.
- Modify `packages/server/src/index.ts`: export the policy while preserving existing constants.
- Modify `packages/server/test/resource-server.test.ts`: protect policy identity, immutability, and route derivation.
- Modify `web/src/features/premium-api/runtime.ts`: use the policy amount and the Redis client factory.
- Modify `web/src/features/premium-api/runtime.test.ts`: prove the replay guard receives the shared policy amount.
- Modify `packages/facilitator/src/signer.ts`: create the local account with viem's nonce manager.
- Modify `packages/facilitator/test/signer.test.ts`: prove nonce management is installed.
- Create `web/src/features/premium-api/redis-client.ts`: node-redis construction and safe error observation.
- Create `web/src/features/premium-api/redis-client.test.ts`: prove errors are handled without logging secrets.
- Modify `web/src/features/premium-api/route-handler.ts`: deduplicate stable error logging and response creation.
- Modify `package.json`: rename the private root workspace package to `agentpay`.
- Modify `.gitignore`: allow new operational/design documentation to be tracked.

### Task 1: Centralize Premium Payment Policy

**Files:**
- Create: `packages/server/src/payment-policy.ts`
- Modify: `packages/server/src/resource-server.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/test/resource-server.test.ts`
- Modify: `web/src/features/premium-api/runtime.ts`
- Modify: `web/src/features/premium-api/runtime.test.ts`

**Interfaces:**
- Produces: `PREMIUM_PAYMENT_POLICY` with literal fields `scheme`, `network`, `asset`, `amountAtomic`, `amountUsdc`, `price`, and `maxTimeoutSeconds`.
- Preserves: `BASE_NETWORK` and `BASE_USDC` exports from `@agentpay/server`.
- Consumes: `PremiumConfig.payTo` and `PremiumConfig.resourceUrl`; neither becomes a global constant.

- [ ] **Step 1: Write the failing server policy test**

Extend `packages/server/test/resource-server.test.ts` to import
`PREMIUM_PAYMENT_POLICY` and assert the wished-for API:

```ts
expect(Object.isFrozen(PREMIUM_PAYMENT_POLICY)).toBe(true);
expect(PREMIUM_PAYMENT_POLICY).toEqual({
  scheme: "exact",
  network: "eip155:8453",
  asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  amountAtomic: "10000",
  amountUsdc: "0.01",
  price: "$0.01",
  maxTimeoutSeconds: 300,
});

const route = createPremiumRoute(PAY_TO, RESOURCE);
expect(route.accepts).toMatchObject({
  scheme: PREMIUM_PAYMENT_POLICY.scheme,
  network: PREMIUM_PAYMENT_POLICY.network,
  price: PREMIUM_PAYMENT_POLICY.price,
  maxTimeoutSeconds: PREMIUM_PAYMENT_POLICY.maxTimeoutSeconds,
});
```

Also derive the expected unpaid `priceUsdc` and `network` values from the same
policy in this test.

- [ ] **Step 2: Run the server test and verify RED**

Run:

```sh
corepack pnpm exec vitest run packages/server/test/resource-server.test.ts
```

Expected: FAIL because `PREMIUM_PAYMENT_POLICY` is not exported.

- [ ] **Step 3: Implement the immutable policy and route derivation**

Create `packages/server/src/payment-policy.ts`:

```ts
import type { Address } from "viem";

export const BASE_NETWORK = "eip155:8453" as const;
export const BASE_USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export const PREMIUM_PAYMENT_POLICY = Object.freeze({
  scheme: "exact",
  network: BASE_NETWORK,
  asset: BASE_USDC,
  amountAtomic: "10000",
  amountUsdc: "0.01",
  price: "$0.01",
  maxTimeoutSeconds: 300,
} as const);
```

Import and re-export `BASE_NETWORK`, `BASE_USDC`, and
`PREMIUM_PAYMENT_POLICY` through the existing server package surface. Replace
the route's scheme, network, price, timeout, compact-body price, and compact-body
network literals with policy fields.

- [ ] **Step 4: Make the runtime guard consume the same policy**

Import `PREMIUM_PAYMENT_POLICY` in
`web/src/features/premium-api/runtime.ts`. Build the guard policy from
`PREMIUM_PAYMENT_POLICY.network`, `.asset`, and `.amountAtomic`, while retaining
the request-specific `resourceUrl` and configured `payTo`.

Update `runtime.test.ts` so the expected guard call references
`PREMIUM_PAYMENT_POLICY` instead of repeating the three values.

- [ ] **Step 5: Run focused and package verification and verify GREEN**

Run:

```sh
corepack pnpm exec vitest run packages/server/test/resource-server.test.ts
corepack pnpm --dir web exec vitest run src/features/premium-api/runtime.test.ts
corepack pnpm --filter @agentpay/server run typecheck
corepack pnpm --dir web typecheck
```

Expected: all commands PASS and the public route assertions remain unchanged.

- [ ] **Step 6: Commit the policy refactor**

```sh
git add packages/server/src/payment-policy.ts packages/server/src/resource-server.ts packages/server/src/index.ts packages/server/test/resource-server.test.ts web/src/features/premium-api/runtime.ts web/src/features/premium-api/runtime.test.ts
git commit -m "refactor: centralize premium payment policy"
```

### Task 2: Add Facilitator Nonce Management

**Files:**
- Modify: `packages/facilitator/src/signer.ts`
- Modify: `packages/facilitator/test/signer.test.ts`

**Interfaces:**
- Produces: `createMainnetFacilitatorAccount(privateKey: Hex): PrivateKeyAccount`.
- Preserves: `createMainnetFacilitatorSigner(config): Promise<FacilitatorEvmSigner>`.
- Uses: viem's standard singleton `nonceManager`, keyed internally by address and chain ID.

- [ ] **Step 1: Write the failing nonce-manager test**

Add this behavior to `packages/facilitator/test/signer.test.ts`:

```ts
import { nonceManager } from "viem/accounts";
import { createMainnetFacilitatorAccount } from "../src/signer.js";

it("creates the facilitator account with viem nonce management", () => {
  const account = createMainnetFacilitatorAccount(`0x${"12".repeat(32)}`);
  expect(account.nonceManager).toBe(nonceManager);
});
```

- [ ] **Step 2: Run the signer test and verify RED**

Run:

```sh
corepack pnpm exec vitest run packages/facilitator/test/signer.test.ts
```

Expected: FAIL because `createMainnetFacilitatorAccount` does not exist.

- [ ] **Step 3: Implement the account factory**

In `packages/facilitator/src/signer.ts`, import `nonceManager` beside
`privateKeyToAccount` and add:

```ts
export function createMainnetFacilitatorAccount(privateKey: Hex) {
  return privateKeyToAccount(privateKey, { nonceManager });
}
```

Use this factory inside `createMainnetFacilitatorSigner`. Do not otherwise
change the wallet client, signer adapter, RPC transport, or settlement service.

- [ ] **Step 4: Run focused verification and verify GREEN**

Run:

```sh
corepack pnpm exec vitest run packages/facilitator/test/signer.test.ts packages/facilitator/test/service.test.ts
corepack pnpm --filter @agentpay/facilitator run typecheck
```

Expected: all commands PASS.

- [ ] **Step 5: Commit the nonce fix**

```sh
git add packages/facilitator/src/signer.ts packages/facilitator/test/signer.test.ts
git commit -m "fix: manage facilitator transaction nonces"
```

### Task 3: Observe Redis Errors Safely

**Files:**
- Create: `web/src/features/premium-api/redis-client.ts`
- Create: `web/src/features/premium-api/redis-client.test.ts`
- Modify: `web/src/features/premium-api/runtime.ts`

**Interfaces:**
- Produces: `createAuthorizationRedisClient(redisUrl: string, log?: RedisEventLogger)`.
- Emits only: `{ component: "authorization-store", event: "redis_error" }`.
- Preserves: the node-redis client used by `RedisAuthorizationStore`.

- [ ] **Step 1: Write the failing safe-listener test**

Create `web/src/features/premium-api/redis-client.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import { createAuthorizationRedisClient } from "./redis-client";

test("observes Redis errors without logging error or credential contents", () => {
  const log = vi.fn();
  const client = createAuthorizationRedisClient(
    "redis://:redis-secret@redis:6379/0",
    log,
  );

  expect(client.listenerCount("error")).toBeGreaterThan(0);
  client.emit("error", new Error("redis-secret transport failure"));
  expect(log).toHaveBeenCalledWith({
    component: "authorization-store",
    event: "redis_error",
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("redis-secret");
  expect(JSON.stringify(log.mock.calls)).not.toContain("transport failure");
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```sh
corepack pnpm --dir web exec vitest run src/features/premium-api/redis-client.test.ts
```

Expected: FAIL because `redis-client.ts` does not exist.

- [ ] **Step 3: Implement the Redis client factory**

Create `web/src/features/premium-api/redis-client.ts`:

```ts
import { createClient } from "redis";

interface RedisEvent {
  readonly component: "authorization-store";
  readonly event: "redis_error";
}

type RedisEventLogger = (event: RedisEvent) => void;

const defaultLogger: RedisEventLogger = event => console.info(event);

export function createAuthorizationRedisClient(
  redisUrl: string,
  log: RedisEventLogger = defaultLogger,
) {
  const client = createClient({ url: redisUrl });
  client.on("error", () => log({
    component: "authorization-store",
    event: "redis_error",
  }));
  return client;
}
```

Replace the direct `createClient` dependency in `runtime.ts` with this factory.
Keep the existing injected `createRedisClient` seam so runtime composition tests
remain focused and unchanged in behavior.

- [ ] **Step 4: Run focused verification and verify GREEN**

Run:

```sh
corepack pnpm --dir web exec vitest run src/features/premium-api/redis-client.test.ts src/features/premium-api/runtime.test.ts
corepack pnpm --dir web typecheck
corepack pnpm --dir web lint
```

Expected: all commands PASS and no Redis error detail is logged by the test.

- [ ] **Step 5: Commit Redis error handling**

```sh
git add web/src/features/premium-api/redis-client.ts web/src/features/premium-api/redis-client.test.ts web/src/features/premium-api/runtime.ts
git commit -m "fix: observe Redis client errors safely"
```

### Task 4: Deduplicate Premium Error Mapping

**Files:**
- Modify: `web/src/features/premium-api/route-handler.ts`
- Test: `web/src/features/premium-api/route-handler.test.ts`

**Interfaces:**
- Consumes: existing `PremiumRouteLog` fields.
- Preserves: every existing public body, status, `Cache-Control`, `X-Request-ID`, and safe log entry.

- [ ] **Step 1: Run the existing characterization tests**

Run:

```sh
corepack pnpm --dir web exec vitest run src/features/premium-api/route-handler.test.ts
```

Expected: PASS. These tests are the behavior lock for this pure refactor.

- [ ] **Step 2: Extract one failure helper**

Add a private helper with this interface:

```ts
function failure(
  log: PremiumRouteDependencies["log"],
  entry: PremiumRouteLog,
): Response {
  log(entry);
  return stableError(entry.requestId, entry.status, entry.reason);
}
```

Replace the three duplicated `log(entry); return stableError(...)` blocks with
`return failure(log, entry)`. Do not change branching or response inspection.

- [ ] **Step 3: Re-run characterization tests**

Run:

```sh
corepack pnpm --dir web exec vitest run src/features/premium-api/route-handler.test.ts
corepack pnpm --dir web typecheck
```

Expected: PASS with identical assertions.

- [ ] **Step 4: Commit the pure refactor**

```sh
git add web/src/features/premium-api/route-handler.ts
git commit -m "refactor: deduplicate premium route failures"
```

### Task 5: Clean Repository Metadata

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Preserves: workspace layout, package manager, scripts, lockfile resolution, and runtime behavior.
- Produces: root private package name `agentpay` and trackable `docs/` additions.

- [ ] **Step 1: Rename the private workspace package**

Change only the root `package.json` name:

```json
"name": "agentpay"
```

Run `corepack pnpm install --lockfile-only --offline` and retain a lockfile
change only if pnpm records the root name.

- [ ] **Step 2: Stop ignoring documentation**

Remove these obsolete `.gitignore` entries:

```gitignore
docs/
!web/src/app/docs/
!web/src/app/docs/**
```

Do not change `.env` ignore rules and do not add any ignored local artifacts.

- [ ] **Step 3: Verify repository metadata**

Run:

```sh
corepack pnpm install --lockfile-only --offline
git check-ignore docs/new-agentpay-document.md
git status --short
```

Expected: pnpm succeeds; `git check-ignore` exits `1` because the docs path is
not ignored; only intentional tracked files appear in status.

- [ ] **Step 4: Commit repository cleanup**

```sh
git add package.json pnpm-lock.yaml .gitignore
git commit -m "chore: align AgentPay repository metadata"
```

If `pnpm-lock.yaml` is unchanged, omit it from `git add`.

### Task 6: Full Regression Verification

**Files:**
- Verify only; no production file is created or modified.

**Interfaces:**
- Confirms: unit, type, lint, build, browser, Git, and public unpaid-contract invariants.

- [ ] **Step 1: Run the complete automated suite**

```sh
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm --dir web test:e2e
```

Expected: at least 71 root tests, at least 56 web tests after the new Redis test, and 8
Playwright tests PASS; typecheck, lint, and build exit `0`.

- [ ] **Step 2: Verify the live no-spend contract**

Request `https://agentpay.thebestsites.ru/api/premium` without a payment and
assert HTTP `402`, presence of `PAYMENT-REQUIRED`, the exact compact JSON body,
and absence of `premiumData`. Do not send `PAYMENT-SIGNATURE` and do not execute
a mainnet payment.

- [ ] **Step 3: Inspect the final diff and repository state**

```sh
git diff dev@{upstream} --check
git status --short --branch
git log --oneline --decorate -8
```

Expected: no whitespace errors, no uncommitted files, and all implementation
commits appear only on `dev`.
