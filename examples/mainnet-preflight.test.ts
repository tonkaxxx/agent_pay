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

function authorizationOptions(
  testRuntime: MainnetPreflightRuntime,
  overrides: Partial<PaymentAuthorizationContext> = {},
) {
  return {
    context: { ...context, ...overrides } as PaymentAuthorizationContext,
    runtime: testRuntime,
    agentAddress,
    expectedPayTo: payTo,
    expectedRequestUrl: context.requestUrl,
    executeRequested: false,
    mainnetAllowed: true,
    log: vi.fn(),
  };
}

describe("authorizeMainnetPayment", () => {
  test("completes preflight but denies payment without --execute", async () => {
    const log = vi.fn();
    const authorized = await authorizeMainnetPayment({
      ...authorizationOptions(runtime()),
      log,
    });

    expect(authorized).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("PAYMENT NOT SENT"));
  });

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

    await expect(authorizeMainnetPayment(
      authorizationOptions(testRuntime, overrides as Partial<PaymentAuthorizationContext>),
    )).rejects.toThrow();

    for (const method of Object.values(testRuntime)) {
      expect(method).not.toHaveBeenCalled();
    }
  });

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
      ...authorizationOptions(runtime(overrides)),
      log: vi.fn(),
    })).rejects.toBeInstanceOf(Error);
  });

  test("rejects execute when the environment opt-in is absent", async () => {
    await expect(authorizeMainnetPayment({
      ...authorizationOptions(runtime()),
      executeRequested: true,
      mainnetAllowed: false,
      log: vi.fn(),
    })).rejects.toThrow(/ALLOW_MAINNET_PAYMENTS/);
  });

  test("authorizes exactly one-cent payment after all checks and both opt-ins", async () => {
    await expect(authorizeMainnetPayment({
      ...authorizationOptions(runtime()),
      executeRequested: true,
      mainnetAllowed: true,
      log: vi.fn(),
    })).resolves.toBe(true);
  });
});
