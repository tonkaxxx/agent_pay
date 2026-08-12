# Mainnet Receipt Verification Retry Implementation Plan

> Superseded by [AgentPay x402 v2 Migration Plan](2026-08-12-x402-v2-migration.md). Retained as v1 implementation history.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avoid false paid-request failures caused by temporarily stale Base RPC receipt data, without sending a second USDC transfer.

**Architecture:** The server marks receipt-not-found and confirmation lag as retryable. An opt-in client loop retries only the structured verification `503` using the original payment hash. The mainnet demo waits for two confirmations and opts into the loop; defaults are unchanged.

**Tech Stack:** TypeScript, Vitest, Express, viem.

## Global Constraints

- Retries reuse `X-Payment-Tx`; they cannot call `transferUsdc` more than once.
- Existing mainnet gates, recipient, amount, preflight, and Sepolia policy remain unchanged.
- Do not retry unrelated HTTP 503 responses.

---

### Task 1: Make temporary verification states retryable

**Files:**
- Modify: `packages/server/src/verifier.ts`
- Modify: `packages/server/test/verifier.test.ts`
- Modify: `packages/server/test/middleware.test.ts`

**Interfaces:**
- Produces: `transaction_not_found` and `insufficient_confirmations` values with `retryable: true`.
- Consumes: existing middleware mapping from a retryable verification result to HTTP 503.

- [ ] **Step 1: Write failing tests**

```ts
expect(await verifier(hash)).toEqual({ valid: false, reason: "transaction_not_found", retryable: true });
expect(await verifier(hash)).toEqual({ valid: false, reason: "insufficient_confirmations", retryable: true });
```

- [ ] **Step 2: Run the test and observe RED**

Run: `corepack pnpm --filter @x402/server test -- verifier.test.ts`

Expected: both assertions fail because the current values are non-retryable.

- [ ] **Step 3: Implement the two return-value changes**

```ts
return { valid: false, reason: "transaction_not_found", retryable: true };
return { valid: false, reason: "insufficient_confirmations", retryable: true };
```

- [ ] **Step 4: Assert HTTP 503 and verify GREEN**

```ts
await request(app).get("/api/data").set(PAYMENT_HEADER, hash).expect(503);
```

Run: `corepack pnpm --filter @x402/server test`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run: `git commit -am "fix(server): retry transient receipt verification"`

### Task 2: Retry paid requests only for temporary verification failures

**Files:**
- Modify: `packages/client/src/agentFetch.ts`
- Modify: `packages/client/test/agentFetch.test.ts`
- Modify: `examples/ai-agent.ts`
- Modify: `examples/ai-agent.test.ts`

**Interfaces:**
- Produces: `AgentFetchConfig.paymentVerificationRetries?: number` and `paymentVerificationRetryDelayMs?: number`.
- Produces: mainnet configuration with `confirmations: 2`, three retries, and a 1,000 ms delay.
- Consumes: structured middleware body `{ error: "Payment Verification Unavailable" }`.

- [ ] **Step 1: Write a failing client regression test**

```ts
const response = await agentFetch("https://vendor.example/data");
expect(response.status).toBe(200);
expect(runtime.transferUsdc).toHaveBeenCalledTimes(1);
expect(retryRequest.headers.get("X-Payment-Tx")).toBe(hash);
```

Mock the response sequence: 402, structured verification 503, 200. Set retry delay to zero.

- [ ] **Step 2: Run the test and observe RED**

Run: `corepack pnpm --filter @x402/client test -- agentFetch.test.ts`

Expected: FAIL because the current code returns the first 503.

- [ ] **Step 3: Implement bounded opt-in retrying**

```ts
paymentVerificationRetries?: number;
paymentVerificationRetryDelayMs?: number;
```

Retry only a 503 body whose error is `Payment Verification Unavailable`; reuse the submitted hash and validate both options as non-negative integers. Defaults are zero retries and zero delay.

- [ ] **Step 4: Add negative and mainnet-configuration tests**

```ts
expect(await agentFetch("https://vendor.example/data")).toBe(unrelated503);
expect(agentConfig.confirmations).toBe(2);
```

Run: `corepack pnpm --filter @x402/client test && corepack pnpm test -- examples/ai-agent.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run: `git commit -am "fix(client): retry temporary paid-request verification"`

### Task 3: Full verification

**Files:**
- No new files.

- [ ] **Step 1: Run repository checks**

Run: `corepack pnpm test && corepack pnpm typecheck && corepack pnpm build && git diff --check`

Expected: all checks pass.

- [ ] **Step 2: Inspect one-transfer safety assertions**

Run: `grep -n "transferUsdc" packages/client/test/agentFetch.test.ts`

Expected: retry tests assert exactly one submitted transfer.

- [ ] **Step 3: Confirm a clean status**

Run: `git status --short`

Expected: clean tree after the implementation commits.
