# Safe Base Mainnet demo — final fix report

Date: 2026-08-03

Base: `558cf90161ce9ccf6c580080ddba7ceee3c77357`

Worktree: `/home/user/repos/agent_pay/.worktrees/safe-base-mainnet-demo`

## Status

The final reviewer findings are resolved. Default Agent and Vendor entrypoints
hardcode Base Sepolia and cannot be switched by forwarded flags or environment
values. Dedicated thin Mainnet entrypoints hardcode Base Mainnet and call shared
business logic. Successful Mainnet preflight prints the required public
operator data in a tested order, preview ends with the exact line
`PAYMENT NOT SENT`, execute repeats the chain/recipient/amount immediately
before authorization, and non-positive gas or fee estimates fail closed.

No demo command, RPC request, testnet/mainnet transaction, or `.env` content
inspection was performed. All runtime-facing tests used mocks or dependency
injection.

## Architecture and file changes

- `examples/demo-config.ts` removes the public `modeFromArguments` parser.
  Network mode is now an explicit shared-logic input; only `--execute` remains
  an exact parsed execution flag.
- `examples/ai-agent.ts` exposes explicit-mode shared logic and a
  `runDefaultAgentDemo` wrapper that always selects `sepolia`.
- `examples/ai-agent-mainnet.ts` is the thin dedicated Agent launcher and
  always selects `mainnet`.
- `examples/vendor-api.ts` accepts an explicit mode and exposes a default
  configuration wrapper that always selects `sepolia`.
- `examples/vendor-api-mainnet.ts` is the thin dedicated Vendor launcher and
  always selects `mainnet`.
- `package.json` points the two `:mainnet` commands at those dedicated files;
  it no longer appends a caller-visible mode flag to default entrypoints.
- `examples/mainnet-preflight.ts` validates gas and upper fee estimates as
  strictly positive at both the domain-policy boundary and the real adapter
  boundary, before multiplication. It prints only public preflight data after
  all checks and repeats execution authorization fields after the opt-in gate.
- `examples/demo-entrypoints.test.ts` adds command-boundary regressions for
  forwarded flags/environment values, dedicated entrypoint selection, and
  package-script targets.
- `examples/mainnet-preflight.test.ts` adds exact output/order/secret
  containment, execute repetition, non-positive domain estimates, zero adapter
  fee, zero adapter gas, and existing fee preference/fallback coverage.
- Existing Agent, Vendor, and config tests now call shared logic with an
  explicit network mode.
- The approved design and implementation plan record the corrected thin-file
  architecture and contain no public `--mainnet` mode-parser prescription.
- The README checklist now requires a “dedicated low-balance mainnet wallet.”

## TDD evidence

### Baseline

Before test changes:

```text
corepack pnpm test
Test Files  7 passed (7)
Tests       121 passed (121)
```

### RED — dedicated entrypoint gate

Command:

```text
corepack pnpm exec vitest run examples/demo-entrypoints.test.ts
```

Observed: `5 failed (5)`. The failures proved that both default wrappers and
both dedicated Mainnet files were absent, and that package scripts still
targeted the shared files with appended `--mainnet`:

```text
TypeError: runDefaultAgentDemo is not a function
TypeError: defaultVendorRuntimeConfiguration is not a function
Cannot find module '/examples/ai-agent-mainnet.js'
Cannot find module '/examples/vendor-api-mainnet.js'
expected "tsx examples/ai-agent-mainnet.ts"
received "tsx examples/ai-agent.ts --mainnet"
```

The desired explicit-mode API was also exercised before implementation:

```text
corepack pnpm exec vitest run examples/ai-agent.test.ts examples/vendor-api.test.ts examples/demo-config.test.ts
Test Files  2 failed | 1 passed (3)
Tests       16 failed | 22 passed (38)
```

The failures consistently showed the old argv-shaped API incorrectly taking
the first explicit-mode argument as argv/environment input.

### RED — operator output and estimate domain

Command:

```text
corepack pnpm exec vitest run examples/mainnet-preflight.test.ts
```

Observed: `9 failed | 21 passed (30)`. The exact-output assertion received
only the two balances and the verbose preview sentence; zero/negative gas and
fee cases resolved `false` instead of rejecting; execute omitted its repeated
authorization fields; and the adapter returned zero estimates instead of
failing closed.

### GREEN — focused

```text
corepack pnpm exec vitest run examples/demo-entrypoints.test.ts examples/demo-config.test.ts examples/vendor-api.test.ts examples/ai-agent.test.ts examples/mainnet-preflight.test.ts
Test Files  5 passed (5)
Tests       73 passed (73)

corepack pnpm exec vitest run examples/demo-entrypoints.test.ts examples/mainnet-preflight.test.ts
Test Files  2 passed (2)
Tests       35 passed (35)
```

## Full verification

Fresh verification on the intended tree immediately before the atomic commit:

```text
corepack pnpm test
Test Files  8 passed (8)
Tests       132 passed (132)

corepack pnpm typecheck
packages/client typecheck: Done
packages/server typecheck: Done
exit 0

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

`git ls-files --error-unmatch .env` did not find a tracked `.env`. Before the
commit, `git status --short --branch` listed only the intended implementation,
tests, package scripts, approved documents, README, and this report.

## Security review

- Default command boundary: both no-suffix entrypoints call Sepolia-hardcoded
  wrappers. Regression tests forward `--mainnet` and `--execute` while setting
  Mainnet-looking environment values and still observe chain `84532`, the
  Sepolia RPC, no Mainnet policy, and no Mainnet runtime construction.
- Dedicated command boundary: package scripts point to distinct thin files;
  their injected tests select chain `8453`, the Mainnet RPC, exact `0.01` cap,
  authorization callback, observability callback, and `redirect: "error"`.
- Payment gates remain conjunctive: dedicated Mainnet selection, successful
  static/RPC/balance/simulation/gas preflight, exact `--execute`, and the
  exact `ALLOW_MAINNET_PAYMENTS=true` boundary are all required.
- Fixed payment policy remains chain `8453`, network `base`, amount `10_000n`
  (`0.01 USDC`), official Base USDC
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, exact loopback Vendor URL,
  exact recipient, and redirect errors.
- Gas safety: domain fakes and the real adapter reject `<= 0n`; `maxFeePerGas`
  remains preferred, `gasPrice` remains the fallback only when max fee is
  absent, and a present zero max fee fails rather than silently falling back.
- Secret hygiene: the private key is used only to configure the payment client
  and derive the public agent address. It is not supplied to preflight policy
  options or transaction observers and is absent from exact captured output.
  Error messages name configuration fields without interpolating secret values.
- Operator output is emitted only after every read-only preflight check passes
  and contains the exact real-funds banner, public address, URL, chain,
  recipient, official token, exact price/units, public balances, gas estimate,
  upper fee, and buffered cost in a locked order. Preview's last line is exactly
  `PAYMENT NOT SENT`.

## Concerns

No known implementation blocker remains. By explicit safety constraint, the
real viem adapter was verified only with mocked clients and no live Base RPC or
transaction was attempted; an operator must still review the preview against
their controlled low-balance wallet before intentionally using execute mode.
