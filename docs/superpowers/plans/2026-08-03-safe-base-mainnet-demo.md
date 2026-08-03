# Safe Base Mainnet Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed Base Mainnet demo that previews an exact `0.01 USDC` payment by default and can transfer real funds only after a verified preflight, the mainnet command, `--execute`, and `ALLOW_MAINNET_PAYMENTS=true`.

**Architecture:** Keep Base Sepolia as the immutable default command path and add explicit mainnet package scripts over shared demo configuration. Extend `@x402/client` with pre-transfer authorization and post-submission observability hooks, then use a read-only, dependency-injected mainnet preflight policy to validate the same HTTP 402 requirement that would be paid.

**Tech Stack:** Node.js 20+, TypeScript ESM/NodeNext, pnpm 11.18.0, viem 2.55.10, Express 5, Vitest 4, Supertest 7.

## Global Constraints

- Never run a real or testnet transaction while implementing or verifying this plan.
- Never run `pnpm demo:agent:mainnet -- --execute` against a real RPC.
- Base Sepolia remains the behavior of `pnpm demo:vendor` and `pnpm demo:agent` regardless of environment values.
- Base Mainnet is selected only by the dedicated package scripts and uses chain ID `8453`.
- Mainnet price and client cap are both exactly `0.01 USDC` (`10_000n` units).
- Mainnet payment requires all of: mainnet script, successful preflight, `--execute`, and `ALLOW_MAINNET_PAYMENTS=true`.
- Mainnet Vendor API binds to `127.0.0.1`; its URL is exactly `http://127.0.0.1:<PORT>/api/data`, without credentials, query, or fragment.
- Mainnet requests use `redirect: "error"`.
- Use only official Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- Do not print, interpolate into errors, or pass the private key to policy/observability callbacks.
- No new runtime dependency is needed; reuse viem, dotenv, Express, and existing test tooling.
- Preserve strict TypeScript settings, ESM exports, declaration output, and the existing client API when optional hooks are absent.
- Keep replay protection in-memory and document that mainnet demo has no refunds.
- Add tests before implementation for every behavior change.

## File Map

- Modify `packages/client/src/agentFetch.ts`: authorization context, policy hook, transaction-submitted hook, typed error code, invocation order.
- Modify `packages/client/src/index.ts`: export new public types.
- Modify `packages/client/test/agentFetch.test.ts`: policy and lifecycle regression coverage.
- Create `examples/demo-config.ts`: static network registry, CLI-mode selection, env validation, exact mainnet URL validation.
- Create `examples/demo-config.test.ts`: deterministic configuration tests.
- Modify `examples/vendor-api.ts`: network-aware app creation, mainnet opt-in, loopback binding, warnings.
- Modify `examples/vendor-api.test.ts`: Base Sepolia and Base Mainnet payload coverage.
- Create `examples/mainnet-preflight.ts`: domain-level read-only runtime and fail-closed authorization policy.
- Create `examples/mainnet-preflight.test.ts`: mocked balance, simulation, fee, and approval tests.
- Modify `examples/ai-agent.ts`: testable entry point, mainnet preview/execute orchestration, hash output.
- Create `examples/ai-agent.test.ts`: command-mode and preview behavior tests.
- Modify `package.json`: dedicated mainnet scripts.
- Modify `.env.example`: mainnet RPC, exact opt-in, IPv4 loopback URL.
- Modify `README.md`: setup, preview, execute, failure recovery, and limitations.

---

### Task 1: Add fail-closed client payment hooks

**Files:**
- Modify: `packages/client/src/agentFetch.ts:15-267`
- Modify: `packages/client/src/index.ts:1-15`
- Test: `packages/client/test/agentFetch.test.ts:1-177`

**Interfaces:**
- Consumes: the existing validated HTTP 402 flow and `PaymentRuntime` interface.
- Produces: `PaymentAuthorizationContext`, `PaymentTransactionContext`, `PaymentChainId`, `PaymentNetwork`, `AgentFetchConfig.authorizePayment`, `AgentFetchConfig.onTransactionSubmitted`, and protocol code `payment_not_authorized`.

- [ ] **Step 1: Add failing tests for a rejecting authorization policy**

Append tests that build a valid 402, provide an authorization callback, and prove no runtime is constructed:

```ts
test("does not create a payment runtime when authorization rejects", async () => {
  const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
  const authorizePayment = vi.fn().mockReturnValue(false);
  fetch.mockResolvedValueOnce(paymentRequired(validPaymentRequirement()));
  const agentFetch = createAgentFetch({ privateKey, rpcUrl, authorizePayment }, dependencies);

  await expect(agentFetch("https://vendor.example/data")).rejects.toMatchObject({
    name: "X402ProtocolError",
    code: "payment_not_authorized",
  });
  expect(authorizePayment).toHaveBeenCalledOnce();
  expect(createPaymentRuntime).not.toHaveBeenCalled();
});

test.each([
  ["throws", vi.fn(() => { throw new Error("policy unavailable"); })],
  ["rejects", vi.fn().mockRejectedValue(new Error("policy unavailable"))],
])("does not create a payment runtime when authorization %s", async (_name, authorizePayment) => {
  const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
  fetch.mockResolvedValueOnce(paymentRequired(validPaymentRequirement()));
  const agentFetch = createAgentFetch({ privateKey, rpcUrl, authorizePayment }, dependencies);

  await expect(agentFetch("https://vendor.example/data")).rejects.toMatchObject({
    name: "X402ProtocolError",
    code: "payment_not_authorized",
    cause: expect.any(Error),
  });
  expect(createPaymentRuntime).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the rejection tests and verify RED**

Run:

```sh
pnpm exec vitest run packages/client/test/agentFetch.test.ts
```

Expected: TypeScript transform/test failure because `authorizePayment` is not part of `AgentFetchConfig`, or assertions fail because the callback is never invoked.

- [ ] **Step 3: Add failing tests for exact context and transaction notification order**

Add tests with the following assertions:

```ts
test("authorizes the normalized requirement before constructing the runtime", async () => {
  const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
  const runtime = paymentRuntime();
  const authorizePayment = vi.fn().mockReturnValue(true);
  createPaymentRuntime.mockReturnValue(runtime);
  fetch
    .mockResolvedValueOnce(paymentRequired(validPaymentRequirement()))
    .mockResolvedValueOnce(new Response("ok", { status: 200 }));

  const agentFetch = createAgentFetch({ privateKey, rpcUrl, authorizePayment }, dependencies);
  await agentFetch("https://vendor.example/data");

  expect(authorizePayment).toHaveBeenCalledWith({
    requestUrl: "https://vendor.example/data",
    chainId: 84532,
    network: "base-sepolia",
    payTo,
    token: USDC_BASE_SEPOLIA,
    priceUsdc: "0.01",
    amount: 10_000n,
  });
  expect(authorizePayment.mock.invocationCallOrder[0]).toBeLessThan(
    createPaymentRuntime.mock.invocationCallOrder[0]!,
  );
});

test("reports the transaction hash before waiting for its receipt", async () => {
  const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
  const runtime = paymentRuntime();
  const onTransactionSubmitted = vi.fn();
  createPaymentRuntime.mockReturnValue(runtime);
  fetch
    .mockResolvedValueOnce(paymentRequired(validPaymentRequirement()))
    .mockResolvedValueOnce(new Response("ok", { status: 200 }));

  await createAgentFetch({ privateKey, rpcUrl, onTransactionSubmitted }, dependencies)(
    "https://vendor.example/data",
  );

  expect(onTransactionSubmitted).toHaveBeenCalledWith(expect.objectContaining({
    hash,
    chainId: 84532,
    token: USDC_BASE_SEPOLIA,
    payTo,
    amount: 10_000n,
  }));
  expect(onTransactionSubmitted.mock.invocationCallOrder[0]).toBeLessThan(
    (runtime.waitForReceipt as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
  );
});

test("continues confirmation and retry when transaction notification throws", async () => {
  const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
  const runtime = paymentRuntime();
  createPaymentRuntime.mockReturnValue(runtime);
  fetch
    .mockResolvedValueOnce(paymentRequired(validPaymentRequirement()))
    .mockResolvedValueOnce(new Response("ok", { status: 200 }));

  const response = await createAgentFetch({
    privateKey,
    rpcUrl,
    onTransactionSubmitted: () => { throw new Error("observer failed"); },
  }, dependencies)("https://vendor.example/data");

  expect(response.status).toBe(200);
  expect(runtime.waitForReceipt).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 4: Implement the public hook types and fail-closed invocation**

In `agentFetch.ts`, replace the internal chain/network aliases with exported aliases and add contexts:

```ts
export type PaymentChainId = 8453 | 84532;
export type PaymentNetwork = "base" | "base-sepolia";

export interface PaymentAuthorizationContext {
  readonly requestUrl: string;
  readonly chainId: PaymentChainId;
  readonly network: PaymentNetwork;
  readonly payTo: Address;
  readonly token: Address;
  readonly priceUsdc: string;
  readonly amount: bigint;
}

export interface PaymentTransactionContext {
  readonly hash: Hash;
  readonly chainId: PaymentChainId;
  readonly token: Address;
  readonly payTo: Address;
  readonly amount: bigint;
}
```

Extend the error code and config:

```ts
export type ProtocolErrorCode =
  | "invalid_payment_response"
  | "unsupported_chain"
  | "network_mismatch"
  | "payment_limit_exceeded"
  | "payment_not_authorized";

export interface AgentFetchConfig {
  privateKey: Hex;
  rpcUrl: string;
  maxPaymentUsdc?: string;
  confirmations?: number;
  authorizePayment?: (
    context: PaymentAuthorizationContext,
  ) => boolean | Promise<boolean>;
  onTransactionSubmitted?: (
    context: PaymentTransactionContext,
  ) => void | Promise<void>;
}
```

Make validated requirements retain `network` and `priceUsdc`, construct the immutable authorization context, and invoke the policy before `createPaymentRuntime`:

```ts
interface PaymentRequirement {
  chainId: PaymentChainId;
  network: PaymentNetwork;
  payTo: Address;
  priceUsdc: string;
  amount: bigint;
}

// validatePaymentRequirement returns the already validated original values.
return {
  chainId: value.chainId,
  network: value.network,
  payTo,
  priceUsdc: value.priceUsdc,
  amount: price,
};

const token = usdcAddresses[requirement.chainId];
const authorizationContext: PaymentAuthorizationContext = {
  requestUrl: request.url,
  chainId: requirement.chainId,
  network: requirement.network,
  payTo: requirement.payTo,
  token,
  priceUsdc: requirement.priceUsdc,
  amount: requirement.amount,
};

if (config.authorizePayment !== undefined) {
  let authorized: boolean;
  try {
    authorized = await config.authorizePayment(authorizationContext);
  } catch (cause) {
    throw protocolError(
      "payment_not_authorized",
      "HTTP 402 payment authorization failed.",
      { cause },
    );
  }
  if (!authorized) {
    throw protocolError(
      "payment_not_authorized",
      "HTTP 402 payment was not authorized.",
    );
  }
}
```

After `transferUsdc` returns, notify without allowing an observer failure to interrupt the irreversible flow:

```ts
if (config.onTransactionSubmitted !== undefined) {
  try {
    await config.onTransactionSubmitted({
      hash,
      chainId: requirement.chainId,
      token,
      payTo: requirement.payTo,
      amount: requirement.amount,
    });
  } catch {
    // Observability must not interrupt confirmation after funds were submitted.
  }
}
```

Export all four new public types from `packages/client/src/index.ts`.

- [ ] **Step 5: Run client tests and typecheck GREEN**

Run:

```sh
pnpm exec vitest run packages/client/test/agentFetch.test.ts
pnpm --filter @x402/client typecheck
pnpm --filter @x402/client build
```

Expected: all client tests pass; typecheck/build exit `0`.

- [ ] **Step 6: Commit the client hooks**

```sh
git add packages/client/src/agentFetch.ts packages/client/src/index.ts packages/client/test/agentFetch.test.ts
git commit -m "feat(client): authorize and observe payments"
```

---

### Task 2: Add deterministic shared demo configuration

**Files:**
- Create: `examples/demo-config.ts`
- Create: `examples/demo-config.test.ts`

**Interfaces:**
- Consumes: `getUsdcAddress` and `SupportedChainId` from `@x402/server`.
- Produces: `DemoMode`, `DemoNetwork`, `DemoEnvironment`, `DEMO_PRICE_USDC`, `DEMO_NETWORKS`, `modeFromArguments`, `executeRequested`, `loadDemoEnvironment`, `vendorApiUrlFromEnvironment`, `assertMainnetAllowed`, and `validatedPrivateKey`.

- [ ] **Step 1: Write failing configuration tests**

Create `examples/demo-config.test.ts` with explicit test fixtures that contain no real secrets:

```ts
import { describe, expect, test } from "vitest";
import {
  DEMO_NETWORKS,
  assertMainnetAllowed,
  executeRequested,
  loadDemoEnvironment,
  modeFromArguments,
  validatedPrivateKey,
  vendorApiUrlFromEnvironment,
} from "./demo-config.js";

const commonEnvironment = {
  BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
  BASE_MAINNET_RPC_URL: "https://mainnet.base.org",
  VENDOR_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
  AGENT_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  VENDOR_API_URL: "http://127.0.0.1:3000/api/data",
  PORT: "3000",
};

describe("demo configuration", () => {
  test("selects Sepolia unless the command explicitly contains --mainnet", () => {
    expect(modeFromArguments([])).toBe("sepolia");
    expect(modeFromArguments(["--mainnet"])).toBe("mainnet");
    expect(modeFromArguments(["--chain-id=8453"])).toBe("sepolia");
  });

  test("selects only the RPC variable belonging to the explicit mode", () => {
    expect(loadDemoEnvironment("sepolia", commonEnvironment).rpcUrl)
      .toBe("https://sepolia.base.org/");
    expect(loadDemoEnvironment("mainnet", commonEnvironment).rpcUrl)
      .toBe("https://mainnet.base.org/");
  });

  test("defines fixed official networks and price", () => {
    expect(DEMO_NETWORKS.sepolia).toMatchObject({ chainId: 84532, network: "base-sepolia" });
    expect(DEMO_NETWORKS.mainnet).toMatchObject({ chainId: 8453, network: "base" });
  });

  test.each([
    "http://localhost:3000/api/data",
    "http://127.0.0.1:3001/api/data",
    "http://127.0.0.1:3000/other",
    "http://user@127.0.0.1:3000/api/data",
    "http://127.0.0.1:3000/api/data?q=1",
    "http://127.0.0.1:3000/api/data#fragment",
  ])("rejects unsafe mainnet Vendor URL %s", (vendorApiUrl) => {
    const config = loadDemoEnvironment("mainnet", commonEnvironment);
    expect(() => vendorApiUrlFromEnvironment(config, {
      ...commonEnvironment,
      VENDOR_API_URL: vendorApiUrl,
    })).toThrow(/VENDOR_API_URL/);
  });

  test("requires the exact mainnet opt-in", () => {
    expect(() => assertMainnetAllowed({ ...commonEnvironment })).toThrow(/ALLOW_MAINNET_PAYMENTS/);
    expect(() => assertMainnetAllowed({
      ...commonEnvironment,
      ALLOW_MAINNET_PAYMENTS: "TRUE",
    })).toThrow(/ALLOW_MAINNET_PAYMENTS/);
    expect(() => assertMainnetAllowed({
      ...commonEnvironment,
      ALLOW_MAINNET_PAYMENTS: "true",
    })).not.toThrow();
  });

  test("recognizes only the exact execute flag", () => {
    expect(executeRequested(["--execute"])).toBe(true);
    expect(executeRequested(["execute", "--dry-run"])).toBe(false);
  });
});
```

Add the explicit validation matrix:

```ts
test.each(["", "ftp://rpc.example"])("rejects invalid mainnet RPC %j", (rpcUrl) => {
  expect(() => loadDemoEnvironment("mainnet", {
    ...commonEnvironment,
    BASE_MAINNET_RPC_URL: rpcUrl,
  })).toThrow(/BASE_MAINNET_RPC_URL/);
});

test("rejects a malformed Vendor address", () => {
  expect(() => loadDemoEnvironment("sepolia", {
    ...commonEnvironment,
    VENDOR_WALLET_ADDRESS: "not-an-address",
  })).toThrow(/VENDOR_WALLET_ADDRESS/);
});

test.each([undefined, "not-a-key", `0x${"11".repeat(31)}`])(
  "rejects malformed agent private key %j",
  (privateKey) => {
    expect(() => validatedPrivateKey(privateKey)).toThrow(/AGENT_PRIVATE_KEY/);
  },
);

test.each(["0", "65536", "1.5"])("rejects invalid PORT %s", (port) => {
  expect(() => loadDemoEnvironment("sepolia", {
    ...commonEnvironment,
    PORT: port,
  })).toThrow(/PORT/);
});
```

- [ ] **Step 2: Run configuration tests and verify RED**

Run:

```sh
pnpm exec vitest run examples/demo-config.test.ts
```

Expected: FAIL because `examples/demo-config.ts` does not exist.

- [ ] **Step 3: Implement the static registry and validators**

Create `examples/demo-config.ts` with these public shapes:

```ts
import { getAddress, type Address, type Hex } from "viem";
import { getUsdcAddress, type SupportedChainId } from "@x402/server";

export const DEMO_PRICE_USDC = "0.01";
export type DemoMode = "sepolia" | "mainnet";

export interface DemoNetwork {
  readonly mode: DemoMode;
  readonly chainId: SupportedChainId;
  readonly network: "base" | "base-sepolia";
  readonly rpcEnvironmentName: "BASE_MAINNET_RPC_URL" | "BASE_SEPOLIA_RPC_URL";
  readonly usdcAddress: Address;
  readonly explorerUrl: string;
  readonly realFunds: boolean;
}

export const DEMO_NETWORKS: Readonly<Record<DemoMode, DemoNetwork>> = {
  sepolia: {
    mode: "sepolia",
    chainId: 84532,
    network: "base-sepolia",
    rpcEnvironmentName: "BASE_SEPOLIA_RPC_URL",
    usdcAddress: getUsdcAddress(84532),
    explorerUrl: "https://sepolia-explorer.base.org",
    realFunds: false,
  },
  mainnet: {
    mode: "mainnet",
    chainId: 8453,
    network: "base",
    rpcEnvironmentName: "BASE_MAINNET_RPC_URL",
    usdcAddress: getUsdcAddress(8453),
    explorerUrl: "https://base.blockscout.com",
    realFunds: true,
  },
};
```

Implement deterministic argument parsing:

```ts
export function modeFromArguments(args: readonly string[]): DemoMode {
  return args.includes("--mainnet") ? "mainnet" : "sepolia";
}

export function executeRequested(args: readonly string[]): boolean {
  return args.includes("--execute");
}
```

Implement `loadDemoEnvironment(mode, env)` so it validates and returns:

```ts
export interface DemoEnvironment {
  readonly network: DemoNetwork;
  readonly rpcUrl: string;
  readonly vendorWalletAddress: Address;
  readonly port: number;
  readonly mainnetAllowed: boolean;
}
```

Keep private-key and Agent URL loading separate so the Vendor process never
needs to read `AGENT_PRIVATE_KEY`. Implement:

```ts
export function validatedPrivateKey(value: unknown): Hex;
export function vendorApiUrlFromEnvironment(
  config: DemoEnvironment,
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
): string;
```

For mainnet, `vendorApiUrlFromEnvironment` requires the normalized URL to equal
`http://127.0.0.1:${config.port}/api/data` and rejects username, password,
search, and hash. For Sepolia, preserve HTTP/HTTPS URLs and the existing
default `http://localhost:3000/api/data`. Implement `assertMainnetAllowed(env)`
with the exact lowercase string comparison. Error messages name fields but
never include their values.

Use these concrete fail-closed implementations for the secret and URL boundary:

```ts
export function validatedPrivateKey(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[\da-fA-F]{64}$/.test(value)) {
    throw new Error("AGENT_PRIVATE_KEY must be a 32-byte hexadecimal private key.");
  }
  return value as Hex;
}

export function vendorApiUrlFromEnvironment(
  config: DemoEnvironment,
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
): string {
  const value = env.VENDOR_API_URL ?? "http://localhost:3000/api/data";
  const url = new URL(value);
  if (config.network.realFunds) {
    const expected = `http://127.0.0.1:${config.port}/api/data`;
    if (url.href !== expected || url.username !== "" || url.password !== ""
      || url.search !== "" || url.hash !== "") {
      throw new Error(`VENDOR_API_URL must be exactly ${expected}.`);
    }
  } else if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("VENDOR_API_URL must use HTTP or HTTPS.");
  }
  return url.href;
}
```

- [ ] **Step 4: Run configuration tests and root typecheck GREEN**

```sh
pnpm exec vitest run examples/demo-config.test.ts
pnpm typecheck
```

Expected: configuration tests and typecheck pass.

- [ ] **Step 5: Commit shared configuration**

```sh
git add examples/demo-config.ts examples/demo-config.test.ts
git commit -m "feat(demo): validate explicit network configuration"
```

---

### Task 3: Make Vendor API explicitly network-aware

**Files:**
- Modify: `examples/vendor-api.ts:1-82`
- Modify: `examples/vendor-api.test.ts:1-20`

**Interfaces:**
- Consumes: `DemoNetwork`, `DEMO_NETWORKS`, `DEMO_PRICE_USDC`, `modeFromArguments`, `loadDemoEnvironment`, and `assertMainnetAllowed` from Task 2.
- Produces: `createVendorApp({ vendorWalletAddress, rpcUrl, network })`, pure `vendorRuntimeConfiguration(args, env)`, and mainnet startup behavior bound to `127.0.0.1`.

- [ ] **Step 1: Replace the example test with failing dual-network expectations**

Update the existing test and add a mainnet case:

```ts
test.each([
  ["Sepolia", DEMO_NETWORKS.sepolia, "base-sepolia", 84532],
  ["Mainnet", DEMO_NETWORKS.mainnet, "base", 8453],
] as const)("returns Base %s payment requirements without RPC verification", async (
  _label,
  network,
  expectedNetwork,
  expectedChainId,
) => {
  const app = createVendorApp({
    vendorWalletAddress: "0x1111111111111111111111111111111111111111",
    rpcUrl: network.realFunds ? "https://mainnet.base.org" : "https://sepolia.base.org",
    network,
  });

  await request(app).get("/api/data").expect(402).expect(({ body }) => {
    expect(body).toMatchObject({
      error: "Payment Required",
      priceUsdc: "0.01",
      network: expectedNetwork,
      chainId: expectedChainId,
    });
  });
});

test("refuses mainnet Vendor startup without exact opt-in", () => {
  expect(() => vendorRuntimeConfiguration(["--mainnet"], {
    BASE_MAINNET_RPC_URL: "https://mainnet.base.org",
    VENDOR_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
    PORT: "3000",
  })).toThrow(/ALLOW_MAINNET_PAYMENTS/);
});
```

- [ ] **Step 2: Run Vendor API tests and verify RED**

```sh
pnpm exec vitest run examples/vendor-api.test.ts
```

Expected: FAIL because `createVendorApp` does not accept `network` and remains hardcoded to Sepolia.

- [ ] **Step 3: Implement network-aware Vendor API creation and startup**

Change the config shape and middleware call:

```ts
export function createVendorApp(config: {
  vendorWalletAddress: Address;
  rpcUrl: string;
  network: DemoNetwork;
}) {
  const app = express();
  app.get(
    "/api/data",
    paymentMiddleware({
      priceUsdc: DEMO_PRICE_USDC,
      payTo: config.vendorWalletAddress,
      chainId: config.network.chainId,
      rpcUrl: config.rpcUrl,
    }),
    (_request, response) => response.json({
      data: "The paid signal is 42.",
      paidWith: "USDC",
      network: config.network.network,
    }),
  );
  return app;
}
```

Replace duplicated env validators with Task 2 helpers. Implement and export the
pure configuration boundary used by both tests and the direct entry point:

```ts
export function vendorRuntimeConfiguration(
  args: readonly string[],
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
): DemoEnvironment {
  const config = loadDemoEnvironment(modeFromArguments(args), env);
  if (config.network.realFunds) assertMainnetAllowed(env);
  return config;
}
```

The direct entry point calls this function with `process.argv.slice(2)` and
`process.env`. Bind using:

```ts
if (config.network.realFunds) {
  app.listen(config.port, "127.0.0.1", onListening);
} else {
  app.listen(config.port, onListening);
}
```

The mainnet banner must include the literal strings `BASE MAINNET / REAL FUNDS`,
`Price: 0.01 USDC`, `Replay store: in-memory only`, and `Refunds: unavailable`.

- [ ] **Step 4: Run Vendor API/config tests and typecheck GREEN**

```sh
pnpm exec vitest run examples/vendor-api.test.ts examples/demo-config.test.ts
pnpm typecheck
```

Expected: all selected tests pass and typecheck exits `0`.

- [ ] **Step 5: Commit the network-aware Vendor API**

```sh
git add examples/vendor-api.ts examples/vendor-api.test.ts
git commit -m "feat(demo): add guarded mainnet vendor mode"
```

---

### Task 4: Build the read-only mainnet preflight policy

**Files:**
- Create: `examples/mainnet-preflight.ts`
- Create: `examples/mainnet-preflight.test.ts`

**Interfaces:**
- Consumes: `PaymentAuthorizationContext` and `USDC_BASE` from Task 1; `DEMO_PRICE_USDC` from Task 2.
- Produces: `MainnetPreflightRuntime`, `MainnetPreflightError`, `createMainnetPreflightRuntime`, and `authorizeMainnetPayment`.

- [ ] **Step 1: Write failing policy tests with a domain-level mock runtime**

Create a reusable fixture:

```ts
import type { Address } from "viem";
import { describe, expect, test, vi } from "vitest";
import { USDC_BASE, type PaymentAuthorizationContext } from "@x402/client";
import {
  authorizeMainnetPayment,
  type MainnetPreflightRuntime,
} from "./mainnet-preflight.js";

const agentAddress = "0x2222222222222222222222222222222222222222" as Address;
const payTo = "0x1111111111111111111111111111111111111111" as Address;
const context: PaymentAuthorizationContext = {
  requestUrl: "http://127.0.0.1:3000/api/data",
  chainId: 8453,
  network: "base",
  payTo,
  token: USDC_BASE,
  priceUsdc: "0.01",
  amount: 10_000n,
};

function runtime(overrides: Partial<MainnetPreflightRuntime> = {}): MainnetPreflightRuntime {
  return {
    getChainId: vi.fn().mockResolvedValue(8453),
    getEthBalance: vi.fn().mockResolvedValue(1_000_000_000_000_000n),
    getUsdcBalance: vi.fn().mockResolvedValue(2_000_000n),
    simulateTransfer: vi.fn().mockResolvedValue(undefined),
    estimateTransferGas: vi.fn().mockResolvedValue(60_000n),
    estimateUpperFeePerGas: vi.fn().mockResolvedValue(1_000_000n),
    ...overrides,
  };
}
```

Add a preview test:

```ts
test("completes preflight but denies payment without --execute", async () => {
  const log = vi.fn();
  const authorized = await authorizeMainnetPayment({
    context,
    runtime: runtime(),
    agentAddress,
    expectedPayTo: payTo,
    expectedRequestUrl: context.requestUrl,
    executeRequested: false,
    mainnetAllowed: true,
    log,
  });

  expect(authorized).toBe(false);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("PAYMENT NOT SENT"));
});
```

Add table-driven static failures before any runtime call:

```ts
test.each([
  ["request URL", { requestUrl: "http://127.0.0.1:3000/other" }],
  ["chain", { chainId: 84532 }],
  ["network", { network: "base-sepolia" }],
  ["recipient", { payTo: "0x3333333333333333333333333333333333333333" }],
  ["token", { token: "0x4444444444444444444444444444444444444444" }],
  ["price string", { priceUsdc: "0.010" }],
  ["amount", { amount: 10_001n }],
] as const)("rejects a mismatched %s before RPC reads", async (_label, overrides) => {
  const testRuntime = runtime();
  await expect(authorizeMainnetPayment({
    context: { ...context, ...overrides } as PaymentAuthorizationContext,
    runtime: testRuntime,
    agentAddress,
    expectedPayTo: payTo,
    expectedRequestUrl: context.requestUrl,
    executeRequested: false,
    mainnetAllowed: true,
    log: vi.fn(),
  })).rejects.toThrow();
  expect(testRuntime.getChainId).not.toHaveBeenCalled();
});
```

Add explicit read-only failure cases:

```ts
test.each([
  ["RPC chain", { getChainId: vi.fn().mockResolvedValue(84532) }],
  ["USDC balance", { getUsdcBalance: vi.fn().mockResolvedValue(9_999n) }],
  ["ETH balance", { getEthBalance: vi.fn().mockResolvedValue(0n) }],
  ["simulation", { simulateTransfer: vi.fn().mockRejectedValue(new Error("reverted")) }],
  ["gas estimate", { estimateTransferGas: vi.fn().mockRejectedValue(new Error("unavailable")) }],
  ["buffered gas balance", {
    getEthBalance: vi.fn().mockResolvedValue(119_999_999_999n),
  }],
] as const)("rejects failed %s preflight", async (_label, overrides) => {
  await expect(authorizeMainnetPayment({
    context,
    runtime: runtime(overrides),
    agentAddress,
    expectedPayTo: payTo,
    expectedRequestUrl: context.requestUrl,
    executeRequested: false,
    mainnetAllowed: true,
    log: vi.fn(),
  })).rejects.toBeInstanceOf(Error);
});
```

Add exact authorization cases:

```ts
test("rejects execute when the environment opt-in is absent", async () => {
  await expect(authorizeMainnetPayment({
    context,
    runtime: runtime(),
    agentAddress,
    expectedPayTo: payTo,
    expectedRequestUrl: context.requestUrl,
    executeRequested: true,
    mainnetAllowed: false,
    log: vi.fn(),
  })).rejects.toThrow(/ALLOW_MAINNET_PAYMENTS/);
});

test("authorizes exactly one-cent payment after all checks and both opt-ins", async () => {
  await expect(authorizeMainnetPayment({
    context,
    runtime: runtime(),
    agentAddress,
    expectedPayTo: payTo,
    expectedRequestUrl: context.requestUrl,
    executeRequested: true,
    mainnetAllowed: true,
    log: vi.fn(),
  })).resolves.toBe(true);
});
```

- [ ] **Step 2: Run preflight tests and verify RED**

```sh
pnpm exec vitest run examples/mainnet-preflight.test.ts
```

Expected: FAIL because `mainnet-preflight.ts` does not exist.

- [ ] **Step 3: Implement the domain-level policy**

Define the runtime without exposing viem generics to tests:

```ts
export interface MainnetPreflightRuntime {
  getChainId(): Promise<number>;
  getEthBalance(address: Address): Promise<bigint>;
  getUsdcBalance(address: Address): Promise<bigint>;
  simulateTransfer(input: { from: Address; to: Address; amount: bigint }): Promise<void>;
  estimateTransferGas(input: { from: Address; to: Address; amount: bigint }): Promise<bigint>;
  estimateUpperFeePerGas(): Promise<bigint>;
}

export class MainnetPreflightError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MainnetPreflightError";
  }
}

export interface MainnetPreflightOptions {
  readonly context: PaymentAuthorizationContext;
  readonly runtime: MainnetPreflightRuntime;
  readonly agentAddress: Address;
  readonly expectedPayTo: Address;
  readonly expectedRequestUrl: string;
  readonly executeRequested: boolean;
  readonly mainnetAllowed: boolean;
  readonly log: (message: string) => void;
}

export async function authorizeMainnetPayment(
  options: MainnetPreflightOptions,
): Promise<boolean>;

export function createMainnetPreflightRuntime(
  rpcUrl: string,
): MainnetPreflightRuntime;
```

`authorizeMainnetPayment` must validate static fields before any balance call,
then execute read-only calls, simulation, and fee checks. Compute:

```ts
const bufferedGasCost = estimatedGas * upperFeePerGas * 2n;
if (ethBalance < bufferedGasCost) {
  throw new MainnetPreflightError("Agent Base ETH balance is below the buffered gas estimate.");
}
```

Print balances with `formatEther` and `formatUnits`, never any secret. Return
`false` after successful preview when execute is absent. Throw when execute is
present but opt-in is false. Return `true` only after every check.

- [ ] **Step 4: Implement the real read-only viem adapter**

Use one `createPublicClient({ chain: base, transport: http(rpcUrl) })` and a
minimal ABI:

```ts
const usdcAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
]);
```

Map methods to `getChainId`, `getBalance`, `readContract`, `simulateContract`,
`estimateContractGas`, and `estimateFeesPerGas`. For the upper fee, use
`maxFeePerGas` when present, otherwise `gasPrice`; throw
`MainnetPreflightError` if neither is available. The adapter receives only
`rpcUrl`; transfer simulation receives the public agent address, never the key.

- [ ] **Step 5: Run preflight tests and typecheck GREEN**

```sh
pnpm exec vitest run examples/mainnet-preflight.test.ts
pnpm typecheck
```

Expected: all preflight tests pass and typecheck exits `0`.

- [ ] **Step 6: Commit the preflight policy**

```sh
git add examples/mainnet-preflight.ts examples/mainnet-preflight.test.ts
git commit -m "feat(demo): add read-only mainnet preflight"
```

---

### Task 5: Wire preview/execute behavior into the agent demo

**Files:**
- Modify: `examples/ai-agent.ts:1-50`
- Create: `examples/ai-agent.test.ts`
- Modify: `package.json:7-15`

**Interfaces:**
- Consumes: client hooks from Task 1; `loadDemoEnvironment`, `vendorApiUrlFromEnvironment`, and `validatedPrivateKey` from Task 2; preflight policy/runtime from Task 4.
- Produces: exported `runAgentDemo(args, env, dependencies)`, `demo:vendor:mainnet`, and `demo:agent:mainnet` scripts.

- [ ] **Step 1: Write failing tests for testnet compatibility and mainnet preview**

Design `AgentDemoDependencies` so tests inject a factory, preflight runtime, and
logger:

```ts
export interface AgentDemoDependencies {
  createAgentFetch: typeof createAgentFetch;
  createMainnetPreflightRuntime: typeof createMainnetPreflightRuntime;
  log(message: string): void;
}

export async function runAgentDemo(
  args: readonly string[],
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>>,
  dependencies: AgentDemoDependencies = defaultAgentDemoDependencies,
): Promise<void>;
```

In `examples/ai-agent.test.ts`, use a fake factory that captures
`AgentFetchConfig` and invokes its policy with a valid context. Define the
fixture explicitly:

```ts
import type { Address, Hash, Hex } from "viem";
import { describe, expect, test, vi } from "vitest";
import {
  USDC_BASE,
  X402ProtocolError,
  type AgentFetch,
  type AgentFetchConfig,
  type PaymentAuthorizationContext,
} from "@x402/client";
import type { MainnetPreflightRuntime } from "./mainnet-preflight.js";

const payTo = "0x1111111111111111111111111111111111111111" as Address;
const hash = `0x${"ab".repeat(32)}` as Hash;
const testPrivateKey = `0x${"11".repeat(32)}` as Hex;
const context: PaymentAuthorizationContext = {
  requestUrl: "http://127.0.0.1:3000/api/data",
  chainId: 8453,
  network: "base",
  payTo,
  token: USDC_BASE,
  priceUsdc: "0.01",
  amount: 10_000n,
};

function mainnetRuntime(): MainnetPreflightRuntime {
  return {
    getChainId: vi.fn().mockResolvedValue(8453),
    getEthBalance: vi.fn().mockResolvedValue(1_000_000_000_000_000n),
    getUsdcBalance: vi.fn().mockResolvedValue(2_000_000n),
    simulateTransfer: vi.fn().mockResolvedValue(undefined),
    estimateTransferGas: vi.fn().mockResolvedValue(60_000n),
    estimateUpperFeePerGas: vi.fn().mockResolvedValue(1_000_000n),
  };
}

const sepoliaEnvironment = {
  BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
  VENDOR_WALLET_ADDRESS: payTo,
  AGENT_PRIVATE_KEY: testPrivateKey,
  VENDOR_API_URL: "http://localhost:3000/api/data",
  PORT: "3000",
};
const mainnetEnvironment = {
  ...sepoliaEnvironment,
  BASE_MAINNET_RPC_URL: "https://mainnet.base.org",
  VENDOR_API_URL: "http://127.0.0.1:3000/api/data",
  ALLOW_MAINNET_PAYMENTS: "true",
};

function dependenciesForAgent() {
  const log = vi.fn();
  const transferReached = vi.fn();
  const agentFetch = vi.fn();
  const createAgentFetch = vi.fn((config: AgentFetchConfig): AgentFetch => {
    agentFetch.mockImplementation(async () => {
      if (config.authorizePayment !== undefined) {
        const authorized = await config.authorizePayment(context);
        if (!authorized) {
          throw new X402ProtocolError(
            "payment_not_authorized",
            "HTTP 402 payment was not authorized.",
          );
        }
      }
      transferReached();
      return new Response(JSON.stringify({ data: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    return agentFetch as AgentFetch;
  });
  const createMainnetPreflightRuntime = vi.fn().mockReturnValue(mainnetRuntime());
  const dependencies = { createAgentFetch, createMainnetPreflightRuntime, log };
  return { dependencies, createAgentFetch, agentFetch, log, transferReached };
}
```

Assert:

```ts
test("keeps the default command on Sepolia without a payment policy", async () => {
  const { dependencies, createAgentFetch } = dependenciesForAgent();
  await runAgentDemo([], sepoliaEnvironment, dependencies);
  expect(createAgentFetch).toHaveBeenCalledWith(expect.objectContaining({
    rpcUrl: "https://sepolia.base.org/",
    maxPaymentUsdc: "0.10",
  }));
  const config = createAgentFetch.mock.calls[0]![0];
  expect(config.authorizePayment).toBeUndefined();
  expect(config.onTransactionSubmitted).toBeUndefined();
});

test("treats a successful mainnet preflight without execute as a no-payment success", async () => {
  const { dependencies, log, transferReached } = dependenciesForAgent();
  await expect(runAgentDemo(["--mainnet"], mainnetEnvironment, dependencies))
    .resolves.toBeUndefined();
  expect(log).toHaveBeenCalledWith(expect.stringContaining("PAYMENT NOT SENT"));
  expect(transferReached).not.toHaveBeenCalled();
});

test("passes redirect:error for a mainnet request", async () => {
  const { dependencies, agentFetch } = dependenciesForAgent();
  await runAgentDemo(["--mainnet"], mainnetEnvironment, dependencies);
  expect(agentFetch).toHaveBeenCalledWith(
    "http://127.0.0.1:3000/api/data",
    { redirect: "error" },
  );
});
```

Add exact execute-gate and observability tests:

```ts
test("rejects execute without environment opt-in before transfer", async () => {
  const { ALLOW_MAINNET_PAYMENTS: _removed, ...withoutOptIn } = mainnetEnvironment;
  const { dependencies, transferReached } = dependenciesForAgent();
  await expect(runAgentDemo(["--mainnet", "--execute"], withoutOptIn, dependencies))
    .rejects.toThrow(/ALLOW_MAINNET_PAYMENTS/);
  expect(transferReached).not.toHaveBeenCalled();
});

test("prints submitted hash and explorer without printing the key", async () => {
  const { dependencies, createAgentFetch, log } = dependenciesForAgent();
  await runAgentDemo(["--mainnet"], mainnetEnvironment, dependencies);
  const config = createAgentFetch.mock.calls[0]![0];
  await config.onTransactionSubmitted?.({
    hash,
    chainId: 8453,
    token: USDC_BASE,
    payTo,
    amount: 10_000n,
  });
  const output = log.mock.calls.flat().join("\n");
  expect(output).toContain(hash);
  expect(output).toContain(`https://base.blockscout.com/tx/${hash}`);
  expect(output).not.toContain(testPrivateKey);
});
```

- [ ] **Step 2: Run agent demo tests and verify RED**

```sh
pnpm exec vitest run examples/ai-agent.test.ts
```

Expected: FAIL because `runAgentDemo` and dependency injection do not exist.

- [ ] **Step 3: Refactor `ai-agent.ts` into a testable entry point**

Export `runAgentDemo` and add the same direct-entry guard used by Vendor API:

```ts
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runAgentDemo(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Agent request failed.");
    process.exitCode = 1;
  });
}
```

Load Task 2 configuration. For Sepolia, preserve current cap `0.10` and no
callbacks. For mainnet:

- derive only the public address with `privateKeyToAccount`;
- create the read-only runtime;
- set cap `DEMO_PRICE_USDC`;
- set `authorizePayment` to `authorizeMainnetPayment`;
- set `onTransactionSubmitted` to print hash/explorer and a do-not-rerun warning;
- use `{ redirect: "error" }`;
- remember when a successful preview returned `false`, catch only the resulting
  `X402ProtocolError`/`payment_not_authorized`, and return success;
- when `payment_not_authorized` has a `MainnetPreflightError` cause, rethrow that
  safe cause so the user sees the failed balance/network/simulation check;
- propagate every failed preflight, configuration, fetch, transfer, receipt,
  or retry error.

The preview marker must only be set after every read-only preflight check has
passed; a policy exception must never be mistaken for successful preview.

- [ ] **Step 4: Add explicit package scripts**

Modify the scripts exactly as follows:

```json
"demo:vendor": "tsx examples/vendor-api.ts",
"demo:agent": "tsx examples/ai-agent.ts",
"demo:vendor:mainnet": "tsx examples/vendor-api.ts --mainnet",
"demo:agent:mainnet": "tsx examples/ai-agent.ts --mainnet"
```

The actual command remains:

```sh
pnpm demo:agent:mainnet -- --execute
```

- [ ] **Step 5: Run all example tests and typecheck GREEN**

```sh
pnpm exec vitest run examples/demo-config.test.ts examples/vendor-api.test.ts examples/mainnet-preflight.test.ts examples/ai-agent.test.ts
pnpm typecheck
```

Expected: every example test passes and typecheck exits `0`.

- [ ] **Step 6: Commit agent orchestration and scripts**

```sh
git add examples/ai-agent.ts examples/ai-agent.test.ts package.json
git commit -m "feat(demo): gate Base mainnet payment execution"
```

---

### Task 6: Document mainnet setup and run release-grade verification

**Files:**
- Modify: `.env.example:1-5`
- Modify: `README.md:1-129`

**Interfaces:**
- Consumes: final commands and environment names from Tasks 2, 3, and 5.
- Produces: copy-paste setup, preview, execute, and recovery instructions for the user.

- [ ] **Step 1: Update `.env.example` with safe defaults**

Use exactly:

```dotenv
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASE_MAINNET_RPC_URL=https://mainnet.base.org
ALLOW_MAINNET_PAYMENTS=false
VENDOR_WALLET_ADDRESS=0x1111111111111111111111111111111111111111
AGENT_PRIVATE_KEY=0x1111111111111111111111111111111111111111111111111111111111111111
VENDOR_API_URL=http://127.0.0.1:3000/api/data
PORT=3000
```

- [ ] **Step 2: Rewrite README demo instructions around testnet-safe defaults**

State that existing commands always use Sepolia. Keep the current two-terminal
commands and change the displayed cap explanation only where it remains
accurate. Explain that `.env` placeholders must not be funded.

- [ ] **Step 3: Add the exact mainnet checklist and commands**

Document these facts explicitly:

- agent needs both official Base USDC and Base ETH;
- Vendor needs only a controlled recipient address to receive;
- verify raw 402 contains `priceUsdc: "0.01"`, `network: "base"`, chain `8453`,
  and exact recipient;
- set `BASE_MAINNET_RPC_URL`, `VENDOR_API_URL=http://127.0.0.1:3000/api/data`,
  and `ALLOW_MAINNET_PAYMENTS=true`;
- Terminal A: `pnpm demo:vendor:mainnet`;
- Terminal B preview: `pnpm demo:agent:mainnet`;
- confirm output ends with `PAYMENT NOT SENT`;
- execute once: `pnpm demo:agent:mainnet -- --execute`;
- if a hash was printed and anything later failed, inspect the hash before any
  rerun;
- replay store is in-memory and refunds are unavailable;
- mainnet demo is loopback-only and not a production deployment.

- [ ] **Step 4: Run the full fresh test suite**

Run outside any sandbox that forbids Supertest localhost listeners:

```sh
pnpm test
```

Expected: all test files pass with zero failed tests and zero unhandled errors.

- [ ] **Step 5: Run full typecheck and build**

```sh
pnpm typecheck
pnpm build
```

Expected: both commands exit `0`; client and server emit ESM JS, declarations,
source maps, and declaration maps.

- [ ] **Step 6: Smoke-import built package entry points**

```sh
node --input-type=module -e "const m = await import('./packages/client/dist/index.js'); if (typeof m.createAgentFetch !== 'function') process.exit(1)"
node --input-type=module -e "const m = await import('./packages/server/dist/index.js'); if (typeof m.paymentMiddleware !== 'function') process.exit(1)"
```

Expected: both commands exit `0` without output.

- [ ] **Step 7: Verify secret hygiene and clean tracked state**

```sh
git check-ignore -v .env
git diff --check
git status --short
```

Expected: `.env` is ignored; `git diff --check` exits `0`; status lists only the
intended documentation changes before the final commit. Do not print `.env`.

- [ ] **Step 8: Commit documentation**

```sh
git add .env.example README.md
git commit -m "docs: explain safe Base mainnet demo"
```

- [ ] **Step 9: Re-run final verification after the documentation commit**

```sh
pnpm test
pnpm typecheck
pnpm build
git status --short --branch
```

Expected: tests/typecheck/build all exit `0`; Git reports a clean branch. Do not
run either mainnet execute command as part of verification.
