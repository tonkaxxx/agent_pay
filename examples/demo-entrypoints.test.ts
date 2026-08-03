import { readFileSync } from "node:fs";

import type { Address, Hash, Hex } from "viem";
import {
  createAgentFetch,
  USDC_BASE_SEPOLIA,
  type AgentFetch,
  type AgentFetchConfig,
  type PaymentChainId,
  type PaymentRuntime,
} from "@x402/client";
import { expect, test, vi } from "vitest";

import type { AgentDemoDependencies } from "./ai-agent.js";
import type { MainnetPreflightRuntime } from "./mainnet-preflight.js";

const payTo = "0x1111111111111111111111111111111111111111" as Address;
const hash = `0x${"ab".repeat(32)}` as Hash;
const testPrivateKey = `0x${"11".repeat(32)}` as Hex;
const environment = {
  BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
  BASE_MAINNET_RPC_URL: "https://mainnet.base.org",
  ALLOW_MAINNET_PAYMENTS: "true",
  CHAIN_ID: "8453",
  VENDOR_WALLET_ADDRESS: payTo,
  AGENT_PRIVATE_KEY: testPrivateKey,
  VENDOR_API_URL: "http://127.0.0.1:3000/api/data",
  PORT: "3000",
};

function paymentRequired(chainId: PaymentChainId, priceUsdc: string): Response {
  return new Response(JSON.stringify({
    error: "Payment Required",
    priceUsdc,
    payTo,
    network: chainId === 8453 ? "base" : "base-sepolia",
    chainId,
  }), {
    status: 402,
    headers: { "content-type": "application/json" },
  });
}

function defaultAgentOrchestration(chainId: PaymentChainId, priceUsdc: string) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  fetch
    .mockResolvedValueOnce(paymentRequired(chainId, priceUsdc))
    .mockResolvedValueOnce(new Response(JSON.stringify({ data: "paid" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  const transferUsdc = vi.fn().mockResolvedValue(hash);
  const runtime: PaymentRuntime = {
    getChainId: vi.fn().mockResolvedValue(chainId),
    transferUsdc,
    waitForReceipt: vi.fn().mockResolvedValue({ status: "success" }),
  };
  const createPaymentRuntime = vi.fn(() => runtime);
  const createAgentFetchWithMockedBoundaries: typeof createAgentFetch = (config) =>
    createAgentFetch(config, { fetch, createPaymentRuntime });
  const createMainnetPreflightRuntime = vi.fn((): MainnetPreflightRuntime => ({
    getChainId: vi.fn().mockResolvedValue(8453),
    getEthBalance: vi.fn().mockResolvedValue(1_000_000_000_000_000n),
    getUsdcBalance: vi.fn().mockResolvedValue(2_000_000n),
    simulateTransfer: vi.fn().mockResolvedValue(undefined),
    estimateTransferGas: vi.fn().mockResolvedValue(60_000n),
    estimateUpperFeePerGas: vi.fn().mockResolvedValue(1_000_000n),
  }));
  const dependencies: AgentDemoDependencies = {
    createAgentFetch: createAgentFetchWithMockedBoundaries,
    createMainnetPreflightRuntime,
    log: vi.fn(),
  };
  return {
    dependencies,
    fetch,
    createPaymentRuntime,
    createMainnetPreflightRuntime,
    transferUsdc,
  };
}

function agentDependencies() {
  const agentFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: "ok" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })) as unknown as AgentFetch;
  const createAgentFetch = vi.fn((_config: AgentFetchConfig) => agentFetch);
  const createMainnetPreflightRuntime = vi.fn((): MainnetPreflightRuntime => ({
    getChainId: vi.fn().mockResolvedValue(8453),
    getEthBalance: vi.fn().mockResolvedValue(1_000_000_000_000_000n),
    getUsdcBalance: vi.fn().mockResolvedValue(2_000_000n),
    simulateTransfer: vi.fn().mockResolvedValue(undefined),
    estimateTransferGas: vi.fn().mockResolvedValue(60_000n),
    estimateUpperFeePerGas: vi.fn().mockResolvedValue(1_000_000n),
  }));
  const dependencies: AgentDemoDependencies = {
    createAgentFetch,
    createMainnetPreflightRuntime,
    log: vi.fn(),
  };
  return { agentFetch, createAgentFetch, createMainnetPreflightRuntime, dependencies };
}

test("default agent entrypoint stays on Sepolia under forwarded mainnet and execute flags", async () => {
  const { runDefaultAgentDemo } = await import("./ai-agent.js");
  const { agentFetch, createAgentFetch, createMainnetPreflightRuntime, dependencies } =
    agentDependencies();

  await runDefaultAgentDemo(["--mainnet", "--execute"], environment, dependencies);

  expect(createAgentFetch).toHaveBeenCalledWith(expect.objectContaining({
    rpcUrl: "https://sepolia.base.org/",
    maxPaymentUsdc: "0.10",
  }));
  const config = createAgentFetch.mock.calls[0]![0];
  expect(config.authorizePayment).toEqual(expect.any(Function));
  expect(config.onTransactionSubmitted).toBeUndefined();
  expect(createMainnetPreflightRuntime).not.toHaveBeenCalled();
  expect(agentFetch).toHaveBeenCalledWith("http://127.0.0.1:3000/api/data");
});

test("default agent rejects a valid Base Mainnet 402 before runtime construction", async () => {
  const { runDefaultAgentDemo } = await import("./ai-agent.js");
  const {
    dependencies,
    fetch,
    createPaymentRuntime,
    createMainnetPreflightRuntime,
    transferUsdc,
  } = defaultAgentOrchestration(8453, "0.01");
  let error: unknown;

  try {
    await runDefaultAgentDemo(["--mainnet", "--execute"], {
      ...environment,
      BASE_SEPOLIA_RPC_URL: "https://mainnet.base.org",
    }, dependencies);
  } catch (caught) {
    error = caught;
  }

  expect(createPaymentRuntime).not.toHaveBeenCalled();
  expect(transferUsdc).not.toHaveBeenCalled();
  expect(createMainnetPreflightRuntime).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(error).toMatchObject({
    name: "X402ProtocolError",
    code: "payment_not_authorized",
  });
});

test("default agent pays a valid Base Sepolia 402 at its existing 0.10 cap", async () => {
  const { runDefaultAgentDemo } = await import("./ai-agent.js");
  const {
    dependencies,
    fetch,
    createPaymentRuntime,
    createMainnetPreflightRuntime,
    transferUsdc,
  } = defaultAgentOrchestration(84532, "0.10");

  await runDefaultAgentDemo(["--mainnet", "--execute"], environment, dependencies);

  expect(createPaymentRuntime).toHaveBeenCalledWith({
    privateKey: testPrivateKey,
    rpcUrl: "https://sepolia.base.org/",
    chainId: 84532,
  });
  expect(transferUsdc).toHaveBeenCalledWith({
    token: USDC_BASE_SEPOLIA,
    to: payTo,
    amount: 100_000n,
  });
  expect(createMainnetPreflightRuntime).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("default Vendor entrypoint stays on Sepolia under all forwarded flags and env values", async () => {
  const { defaultVendorRuntimeConfiguration } = await import("./vendor-api.js");

  const config = defaultVendorRuntimeConfiguration(
    ["--mainnet", "--execute"],
    environment,
  );

  expect(config.network).toMatchObject({ mode: "sepolia", chainId: 84532 });
  expect(config.rpcUrl).toBe("https://sepolia.base.org/");
});

test("dedicated mainnet agent entrypoint selects Base Mainnet explicitly", async () => {
  const { runMainnetAgentDemo } = await import("./ai-agent-mainnet.js");
  const { agentFetch, createAgentFetch, createMainnetPreflightRuntime, dependencies } =
    agentDependencies();

  await runMainnetAgentDemo(["--sepolia"], environment, dependencies);

  expect(createAgentFetch).toHaveBeenCalledWith(expect.objectContaining({
    rpcUrl: "https://mainnet.base.org/",
    maxPaymentUsdc: "0.01",
    authorizePayment: expect.any(Function),
    onTransactionSubmitted: expect.any(Function),
  }));
  expect(createMainnetPreflightRuntime).toHaveBeenCalledWith("https://mainnet.base.org/");
  expect(agentFetch).toHaveBeenCalledWith(
    "http://127.0.0.1:3000/api/data",
    { redirect: "error" },
  );
});

test("dedicated mainnet Vendor entrypoint selects Base Mainnet explicitly", async () => {
  const { mainnetVendorRuntimeConfiguration } = await import("./vendor-api-mainnet.js");

  const config = mainnetVendorRuntimeConfiguration(["--sepolia"], environment);

  expect(config.network).toMatchObject({ mode: "mainnet", chainId: 8453 });
  expect(config.rpcUrl).toBe("https://mainnet.base.org/");
});

test("package mainnet commands target dedicated entrypoint files", () => {
  const packageConfiguration = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };

  expect(packageConfiguration.scripts).toMatchObject({
    "demo:vendor": "tsx examples/vendor-api.ts",
    "demo:agent": "tsx examples/ai-agent.ts",
    "demo:vendor:mainnet": "tsx examples/vendor-api-mainnet.ts",
    "demo:agent:mainnet": "tsx examples/ai-agent-mainnet.ts",
  });
});
