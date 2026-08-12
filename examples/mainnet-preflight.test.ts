import type { Address } from "viem";
import { describe, expect, test, vi } from "vitest";
import { base } from "viem/chains";

import { USDC_BASE, type PaymentAuthorizationContext } from "@agentpay/client";

import {
  MainnetPreflightError,
  authorizeMainnetPayment,
  createMainnetPreflightRuntime,
  type MainnetPreflightRuntime,
} from "./mainnet-preflight.js";

const viemMocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  http: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: viemMocks.createPublicClient,
  http: viemMocks.http,
}));

const agentAddress = "0x2222222222222222222222222222222222222222" as Address;
const payTo = "0x1111111111111111111111111111111111111111" as Address;
const context: PaymentAuthorizationContext = {
  requestUrl: "http://127.0.0.1:3000/api/data",
  paymentId: "pay_agentpay_mainnet_1234",
  scheme: "exact",
  chainId: 8453,
  network: "eip155:8453",
  recipient: payTo,
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

function publicClient() {
  return {
    getChainId: vi.fn().mockResolvedValue(8453),
    getBalance: vi.fn().mockResolvedValue(1_000_000_000_000_000n),
    readContract: vi.fn().mockResolvedValue(2_000_000n),
    simulateContract: vi.fn().mockResolvedValue({ result: true }),
    estimateContractGas: vi.fn().mockResolvedValue(60_000n),
    estimateFeesPerGas: vi.fn().mockResolvedValue({ maxFeePerGas: 1_000_000n }),
  };
}

function adapterRuntime(testClient: ReturnType<typeof publicClient>) {
  const transport = { type: "mock-transport" };
  viemMocks.http.mockReturnValue(transport);
  viemMocks.createPublicClient.mockReturnValue(testClient);

  return {
    runtime: createMainnetPreflightRuntime("https://rpc.example"),
    transport,
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
  test("prints the exact public preflight in order and ends preview with PAYMENT NOT SENT", async () => {
    const messages: string[] = [];
    const authorized = await authorizeMainnetPayment({
      ...authorizationOptions(runtime()),
      log: (message) => messages.push(message),
    });

    expect(authorized).toBe(false);
    expect(messages).toEqual([
      "BASE MAINNET / REAL FUNDS",
      `Agent address: ${agentAddress}`,
      `Vendor URL: ${context.requestUrl}`,
      "Chain ID: 8453",
      `Recipient: ${payTo}`,
      `USDC token: ${USDC_BASE}`,
      "Price: 0.01 USDC (10000 base units)",
      "USDC balance: 2 USDC",
      "ETH balance: 0.001 ETH",
      "Gas estimate: 60000 gas",
      "Upper fee per gas: 1000000 wei",
      "Buffered gas cost: 120000000000 wei",
      "PAYMENT NOT SENT",
    ]);
    expect(messages.join("\n")).not.toContain(`0x${"11".repeat(32)}`);
  });

  test.each([
    ["request URL", { requestUrl: "http://127.0.0.1:3000/other" }],
    ["chain", { chainId: 84532 }],
    ["network", { network: "eip155:84532" }],
    ["recipient", { recipient: "0x3333333333333333333333333333333333333333" }],
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
    ["upper fee estimate", {
      estimateUpperFeePerGas: vi.fn().mockRejectedValue(new Error("unavailable")),
    }],
    ["buffered gas balance", {
      getEthBalance: vi.fn().mockResolvedValue(119_999_999_999n),
    }],
  ] as const)("rejects failed %s preflight", async (_label, overrides) => {
    await expect(authorizeMainnetPayment({
      ...authorizationOptions(runtime(overrides)),
      log: vi.fn(),
    })).rejects.toBeInstanceOf(Error);
  });

  test.each([
    ["zero gas estimate", { estimateTransferGas: vi.fn().mockResolvedValue(0n) }],
    ["negative gas estimate", { estimateTransferGas: vi.fn().mockResolvedValue(-1n) }],
    ["zero upper fee", { estimateUpperFeePerGas: vi.fn().mockResolvedValue(0n) }],
    ["negative upper fee", { estimateUpperFeePerGas: vi.fn().mockResolvedValue(-1n) }],
  ] as const)("rejects a non-positive %s before gas-cost multiplication", async (
    _label,
    overrides,
  ) => {
    const log = vi.fn();

    await expect(authorizeMainnetPayment({
      ...authorizationOptions(runtime(overrides)),
      log,
    })).rejects.toBeInstanceOf(MainnetPreflightError);

    expect(log).not.toHaveBeenCalled();
  });

  test("rejects execute when the environment opt-in is absent", async () => {
    await expect(authorizeMainnetPayment({
      ...authorizationOptions(runtime()),
      executeRequested: true,
      mainnetAllowed: false,
      log: vi.fn(),
    })).rejects.toThrow(/ALLOW_MAINNET_PAYMENTS/);
  });

  test("repeats chain, recipient, and exact amount immediately before authorization", async () => {
    const messages: string[] = [];

    await expect(authorizeMainnetPayment({
      ...authorizationOptions(runtime()),
      executeRequested: true,
      mainnetAllowed: true,
      log: (message) => messages.push(message),
    })).resolves.toBe(true);

    expect(messages.slice(-3)).toEqual([
      "Chain ID: 8453",
      `Recipient: ${payTo}`,
      "Amount: 0.01 USDC (10000 base units)",
    ]);
    expect(messages).not.toContain("PAYMENT NOT SENT");
  });
});

describe("createMainnetPreflightRuntime", () => {
  test("creates one Base public client and maps chain and ETH balance reads", async () => {
    const testClient = publicClient();
    const adapter = adapterRuntime(testClient);

    await expect(adapter.runtime.getChainId()).resolves.toBe(8453);
    await expect(adapter.runtime.getEthBalance(agentAddress)).resolves.toBe(
      1_000_000_000_000_000n,
    );

    expect(viemMocks.http).toHaveBeenCalledOnce();
    expect(viemMocks.http).toHaveBeenCalledWith("https://rpc.example");
    expect(viemMocks.createPublicClient).toHaveBeenCalledOnce();
    expect(viemMocks.createPublicClient).toHaveBeenCalledWith({
      chain: base,
      transport: adapter.transport,
    });
    expect(testClient.getChainId).toHaveBeenCalledOnce();
    expect(testClient.getBalance).toHaveBeenCalledWith({ address: agentAddress });
  });

  test("reads balanceOf from the official Base USDC contract", async () => {
    const testClient = publicClient();
    const { runtime: testRuntime } = adapterRuntime(testClient);

    await expect(testRuntime.getUsdcBalance(agentAddress)).resolves.toBe(2_000_000n);

    expect(testClient.readContract).toHaveBeenCalledWith(expect.objectContaining({
      address: USDC_BASE,
      functionName: "balanceOf",
      args: [agentAddress],
    }));
  });

  test("simulates and estimates the same official USDC transfer", async () => {
    const testClient = publicClient();
    const { runtime: testRuntime } = adapterRuntime(testClient);
    const transfer = { from: agentAddress, to: payTo, amount: 10_000n };

    await expect(testRuntime.simulateTransfer(transfer)).resolves.toBeUndefined();
    await expect(testRuntime.estimateTransferGas(transfer)).resolves.toBe(60_000n);

    const expectedContractCall = expect.objectContaining({
      account: agentAddress,
      address: USDC_BASE,
      functionName: "transfer",
      args: [payTo, 10_000n],
    });
    expect(testClient.simulateContract).toHaveBeenCalledWith(expectedContractCall);
    expect(testClient.estimateContractGas).toHaveBeenCalledWith(expectedContractCall);
  });

  test("prefers maxFeePerGas as the upper fee", async () => {
    const testClient = publicClient();
    testClient.estimateFeesPerGas.mockResolvedValue({
      maxFeePerGas: 5_000_000n,
      gasPrice: 2_000_000n,
    });
    const { runtime: testRuntime } = adapterRuntime(testClient);

    await expect(testRuntime.estimateUpperFeePerGas()).resolves.toBe(5_000_000n);
  });

  test("falls back to gasPrice when maxFeePerGas is absent", async () => {
    const testClient = publicClient();
    testClient.estimateFeesPerGas.mockResolvedValue({ gasPrice: 2_000_000n });
    const { runtime: testRuntime } = adapterRuntime(testClient);

    await expect(testRuntime.estimateUpperFeePerGas()).resolves.toBe(2_000_000n);
  });

  test("fails closed when the RPC supplies no usable fee", async () => {
    const testClient = publicClient();
    testClient.estimateFeesPerGas.mockResolvedValue({});
    const { runtime: testRuntime } = adapterRuntime(testClient);

    await expect(testRuntime.estimateUpperFeePerGas()).rejects.toBeInstanceOf(
      MainnetPreflightError,
    );
  });

  test("fails closed when the preferred max fee is zero instead of falling back", async () => {
    const testClient = publicClient();
    testClient.estimateFeesPerGas.mockResolvedValue({
      maxFeePerGas: 0n,
      gasPrice: 2_000_000n,
    });
    const { runtime: testRuntime } = adapterRuntime(testClient);

    await expect(testRuntime.estimateUpperFeePerGas()).rejects.toBeInstanceOf(
      MainnetPreflightError,
    );
  });

  test("fails closed when the fallback gas price is zero", async () => {
    const testClient = publicClient();
    testClient.estimateFeesPerGas.mockResolvedValue({ gasPrice: 0n });
    const { runtime: testRuntime } = adapterRuntime(testClient);

    await expect(testRuntime.estimateUpperFeePerGas()).rejects.toBeInstanceOf(
      MainnetPreflightError,
    );
  });

  test("fails closed when the adapter receives a zero gas estimate", async () => {
    const testClient = publicClient();
    testClient.estimateContractGas.mockResolvedValue(0n);
    const { runtime: testRuntime } = adapterRuntime(testClient);

    await expect(testRuntime.estimateTransferGas({
      from: agentAddress,
      to: payTo,
      amount: 10_000n,
    })).rejects.toBeInstanceOf(MainnetPreflightError);
  });
});
