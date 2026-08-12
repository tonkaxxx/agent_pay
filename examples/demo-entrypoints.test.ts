import { readFileSync } from "node:fs";

import type { AgentFetch, AgentFetchConfig } from "@agentpay/client";
import { expect, test, vi } from "vitest";

import type { AgentDemoDependencies } from "./ai-agent.js";
import type { MainnetPreflightRuntime } from "./mainnet-preflight.js";

const payTo = "0x1111111111111111111111111111111111111111" as const;
const environment = {
  BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
  BASE_MAINNET_RPC_URL: "https://mainnet.base.org",
  ALLOW_MAINNET_PAYMENTS: "true",
  VENDOR_WALLET_ADDRESS: payTo,
  AGENT_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  VENDOR_API_URL: "http://127.0.0.1:3000/api/data",
  PORT: "3000",
};

function dependencies() {
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
  const result: AgentDemoDependencies = {
    createAgentFetch,
    createMainnetPreflightRuntime,
    log: vi.fn(),
  };
  return { agentFetch, createAgentFetch, createMainnetPreflightRuntime, result };
}

test("default agent entrypoint stays on Base Sepolia regardless of forwarded flags", async () => {
  const { runDefaultAgentDemo } = await import("./ai-agent.js");
  const { agentFetch, createAgentFetch, createMainnetPreflightRuntime, result } = dependencies();

  await runDefaultAgentDemo(["--mainnet", "--execute"], environment, result);

  expect(createAgentFetch).toHaveBeenCalledWith(expect.objectContaining({
    networks: ["eip155:84532"],
    maxPaymentUsdc: "0.10",
    signer: expect.objectContaining({ address: expect.any(String) }),
  }));
  expect(createMainnetPreflightRuntime).not.toHaveBeenCalled();
  expect(agentFetch).toHaveBeenCalledWith("http://127.0.0.1:3000/api/data");
});

test("dedicated mainnet agent selects Base and keeps both payment gates", async () => {
  const { runMainnetAgentDemo } = await import("./ai-agent-mainnet.js");
  const { agentFetch, createAgentFetch, createMainnetPreflightRuntime, result } = dependencies();

  await runMainnetAgentDemo(["--execute"], environment, result);

  expect(createAgentFetch).toHaveBeenCalledWith(expect.objectContaining({
    networks: ["eip155:8453"],
    maxPaymentUsdc: "0.01",
    authorizePayment: expect.any(Function),
    onPaymentEvent: expect.any(Function),
  }));
  expect(createMainnetPreflightRuntime).toHaveBeenCalledWith("https://mainnet.base.org/");
  expect(agentFetch).toHaveBeenCalledWith(
    "http://127.0.0.1:3000/api/data",
    { redirect: "error" },
  );
});

test("dedicated mainnet Vendor entrypoint selects Base Mainnet explicitly", async () => {
  const { mainnetVendorRuntimeConfiguration } = await import("./vendor-api-mainnet.js");
  const config = mainnetVendorRuntimeConfiguration([], environment);
  expect(config.network).toMatchObject({ mode: "mainnet", network: "eip155:8453" });
});

test("package commands keep dedicated mainnet entrypoints", () => {
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
