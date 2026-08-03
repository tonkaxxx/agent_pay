import type { Address, Hash, Hex } from "viem";
import { describe, expect, test, vi } from "vitest";

import {
  USDC_BASE,
  X402ProtocolError,
  type AgentFetch,
  type AgentFetchConfig,
  type PaymentAuthorizationContext,
} from "@x402/client";

import { runAgentDemo } from "./ai-agent.js";
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

describe("runAgentDemo", () => {
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
});
