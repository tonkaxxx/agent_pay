# Additional safety cycle — immutable Sepolia payment boundary

Date: 2026-08-03

Base: `fc77253dd8fc0d9d0504e3bb03ca02c743ae34ed`

Worktree: `/home/user/repos/agent_pay/.worktrees/safe-base-mainnet-demo`

## Status

The default Agent now has a fail-closed payment authorization boundary. It
accepts only chain `84532`, network `base-sepolia`, and the official Base
Sepolia USDC token
`0x036CbD53842c5426634e7929541eC2318f3dCF7e`. A valid Base Mainnet 402 is
rejected as `payment_not_authorized` before payment runtime construction or
transfer, even when the caller forwards `--mainnet --execute` and supplies
Mainnet-looking values through the Sepolia RPC environment variable.

The existing Sepolia flow still accepts a payment at the inclusive `0.10 USDC`
cap. The dedicated Mainnet entrypoint and its exact `0.01 USDC` policy,
preflight, script-selection, `--execute`, and environment opt-in gates are
unchanged.

No demo command, live/testnet RPC request, transaction, dependency install, or
`.env` content inspection was performed. HTTP, RPC/runtime, and transfer
boundaries in the new integration tests are controlled mocks.

## Root cause

`runDefaultAgentDemo` correctly hardcoded `runAgentDemo("sepolia", ...)`, but
the Sepolia `AgentFetchConfig` contained only the key, RPC URL, and `0.10` cap.
It had no `authorizePayment` callback. `createAgentFetch` intentionally remains
backward-compatible when no callback is supplied, so a syntactically and
semantically valid 402 for either supported chain proceeds to runtime creation
using the chain declared by the 402.

Consequently, `BASE_SEPOLIA_RPC_URL=https://mainnet.base.org` plus a valid Base
Mainnet 402 allowed the default Agent path to construct a chain-8453 runtime.
Forwarded mode/execution flags did not select Mainnet logic, but they also did
not compensate for the absent payment authorization boundary.

## TDD and integration-test construction

Before test code was written, the intended mutations were named:

- Removing or widening the default Sepolia authorization, or changing any of
  its chain/network/token constants, must make the Base Mainnet rejection test
  reach runtime construction or fail with the wrong result.
- Lowering/changing the existing `0.10` cap, rejecting valid Sepolia
  authorization, using the wrong official token, or breaking transfer/retry
  orchestration must make the positive Sepolia test fail.
- Removing the callback from the default config must also fail the existing
  configuration-level entrypoint and Agent tests, which previously and
  incorrectly asserted that the callback was absent.

The new regression calls the real `runDefaultAgentDemo` and wraps the real
`createAgentFetch`. Only the latter's external dependencies are injected:

1. The mocked first HTTP response is a complete valid 402 with `error`,
   `priceUsdc`, `payTo`, `network`, and `chainId`; a second paid HTTP 200 is
   queued so the unsafe pre-fix flow can complete.
2. The mocked runtime factory returns a complete `PaymentRuntime` with
   `getChainId`, `transferUsdc`, and `waitForReceipt`.
3. The hostile case supplies chain `8453`, network `base`, price `0.01`,
   forwards `--mainnet --execute`, sets the opt-in and Mainnet-looking
   environment values, and sets `BASE_SEPOLIA_RPC_URL` to the Mainnet URL.
4. The assertions require typed `payment_not_authorized`, exactly one HTTP
   call, and zero payment-runtime construction, transfer, or Mainnet-preflight
   runtime calls.
5. The positive case supplies chain `84532`, network `base-sepolia`, and price
   `0.10`; it requires runtime chain `84532`, a `100_000`-unit transfer through
   official Sepolia USDC, no Mainnet preflight, and the paid HTTP retry.

All payment fields are hand-authored literals. The 402 intentionally has no
token field because the real x402 client derives the official token from the
validated chain before presenting the read-only authorization context.

### Genuine RED

Command, before the production edit:

```text
corepack pnpm exec vitest run examples/demo-entrypoints.test.ts examples/ai-agent.test.ts
```

Observed result:

```text
Test Files  2 failed (2)
Tests       3 failed | 18 passed (21)

expected undefined to deeply equal Any<Function>
expected "vi.fn()" to not be called at all, but actually been called 1 times
```

The real-orchestration failure showed `createPaymentRuntime` was called once
with chain `8453` and the normalized Mainnet-looking Sepolia RPC URL. This was
the expected failure mode: the missing default policy allowed runtime
construction instead of producing `payment_not_authorized`.

### Focused GREEN

After the one production-boundary edit:

```text
corepack pnpm exec vitest run examples/demo-entrypoints.test.ts examples/ai-agent.test.ts packages/client/test/agentFetch.test.ts
Test Files  3 passed (3)
Tests       41 passed (41)

corepack pnpm exec vitest run examples/demo-entrypoints.test.ts examples/ai-agent.test.ts examples/mainnet-preflight.test.ts examples/demo-config.test.ts examples/vendor-api.test.ts
Test Files  5 passed (5)
Tests       75 passed (75)
```

The second command retains the dedicated Mainnet entrypoint, exact one-cent
cap, preflight policy, preview/execute behavior, environment opt-in, static
payment checks, balances, simulation, gas, and Vendor configuration coverage.

## Production change

`examples/ai-agent.ts` adds one authorization callback to the default
`0.10` config. It returns true only when the validated context simultaneously
has literal chain `84532`, literal network `base-sepolia`, and the exported
official `USDC_BASE_SEPOLIA` token. The existing Mainnet branch still replaces
that initial config with its unchanged `0.01` preflight/execute policy.

No client protocol, runtime, preflight, configuration, package-script, Vendor,
or documentation behavior was refactored.

## Files changed

- `examples/ai-agent.ts` — adds the immutable Sepolia authorization callback.
- `examples/demo-entrypoints.test.ts` — adds hostile Mainnet and positive
  Sepolia real-orchestration regressions; updates the default entrypoint
  callback expectation.
- `examples/ai-agent.test.ts` — supplies a valid Sepolia authorization context
  and replaces the obsolete no-policy expectation.
- `.superpowers/sdd/2026-08-03-safe-base-mainnet-demo/additional-safety-report.md`
  — records this safety cycle and its evidence.

## Full verification

```text
corepack pnpm test
Test Files  8 passed (8)
Tests       134 passed (134)
exit 0

corepack pnpm typecheck
packages/client typecheck: Done
packages/server typecheck: Done
root examples typecheck: exit 0

corepack pnpm build
packages/client build: Done
packages/server build: Done
exit 0

node --input-type=module -e "const m = await import('./packages/client/dist/index.js'); if (typeof m.createAgentFetch !== 'function') process.exit(1)"
exit 0, no output

node --input-type=module -e "const m = await import('./packages/server/dist/index.js'); if (typeof m.paymentMiddleware !== 'function') process.exit(1)"
exit 0, no output

git diff --check
exit 0, no output

git check-ignore -v .env
.gitignore:5:.env .env
```

The final post-commit status check is recorded in the handoff.

## Security self-review

- Authorization runs inside the real client after full 402 validation and
  before `createPaymentRuntime`, RPC chain reads, transfer, receipt wait, and
  paid retry.
- The callback is independent of argv and environment opt-ins. Forwarded
  `--mainnet`, forwarded `--execute`, `CHAIN_ID=8453`,
  `ALLOW_MAINNET_PAYMENTS=true`, and a Mainnet RPC URL cannot widen it.
- The callback accepts all three exact Sepolia attributes conjunctively. The
  token is the official exported client constant and the real client derives
  it from the already validated chain.
- A Sepolia 402 paired with an accidentally Mainnet RPC URL can pass the policy,
  but the existing runtime RPC-chain check then rejects chain `8453` before
  transfer. A Mainnet 402 cannot reach runtime construction at all.
- The callback receives only `PaymentAuthorizationContext`; it neither closes
  over nor is passed the private key. Existing client tests assert the complete
  normalized callback context, which contains no secret. New log output was not
  added.
- Dedicated Mainnet behavior remains a separate entrypoint and still requires
  successful preflight, `--execute`, and exact `ALLOW_MAINNET_PAYMENTS=true`
  before its existing fixed policy can authorize one transfer.

## Concerns

No known blocker or architectural ambiguity remains. By explicit safety
constraint, real viem/RPC behavior was verified only through existing mocked
adapter tests; no live network or funds were used. The default boundary is
deliberately limited to the currently supported official Base Sepolia USDC
configuration, so any future Sepolia token migration must be an explicit code
and test change.
