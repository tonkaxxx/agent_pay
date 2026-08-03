import { readFileSync } from "node:fs";

import type { AgentFetch, AgentFetchConfig } from "@x402/client";
import { expect, test, vi } from "vitest";

import type { AgentDemoDependencies } from "./ai-agent.js";
import type { MainnetPreflightRuntime } from "./mainnet-preflight.js";

const payTo = "0x1111111111111111111111111111111111111111";
const testPrivateKey = `0x${"11".repeat(32)}`;
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
  expect(config.authorizePayment).toBeUndefined();
  expect(config.onTransactionSubmitted).toBeUndefined();
  expect(createMainnetPreflightRuntime).not.toHaveBeenCalled();
  expect(agentFetch).toHaveBeenCalledWith("http://127.0.0.1:3000/api/data");
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
