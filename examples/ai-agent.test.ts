import type { Address, Hash, Hex } from "viem";
import { describe, expect, test, vi } from "vitest";

import {
  USDC_BASE,
  USDC_BASE_SEPOLIA,
  X402PaymentError,
  X402ProtocolError,
  type AgentFetch,
  type AgentFetchConfig,
  type PaymentAuthorizationContext,
} from "@agentpay/client";

import { runAgentDemo } from "./ai-agent.js";
import {
  MainnetPreflightError,
  type MainnetPreflightRuntime,
} from "./mainnet-preflight.js";

const payTo = "0x1111111111111111111111111111111111111111" as Address;
const hash = `0x${"ab".repeat(32)}` as Hash;
const testPrivateKey = `0x${"11".repeat(32)}` as Hex;
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
const sepoliaContext: PaymentAuthorizationContext = {
  requestUrl: "http://localhost:3000/api/data",
  paymentId: "pay_agentpay_sepolia_1234",
  scheme: "exact",
  chainId: 84532,
  network: "eip155:84532",
  recipient: payTo,
  token: USDC_BASE_SEPOLIA,
  priceUsdc: "0.10",
  amount: 100_000n,
};

function mainnetRuntime(
  overrides: Partial<MainnetPreflightRuntime> = {},
): MainnetPreflightRuntime {
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

function dependenciesForAgent(options: {
  runtime?: MainnetPreflightRuntime;
  requestError?: Error;
  denialCause?: Error;
  authorizationContext?: PaymentAuthorizationContext;
} = {}) {
  const log = vi.fn();
  const transferReached = vi.fn();
  const agentFetch = vi.fn();
  const createAgentFetch = vi.fn((config: AgentFetchConfig): AgentFetch => {
    agentFetch.mockImplementation(async () => {
      if (options.requestError !== undefined) throw options.requestError;
      if (config.authorizePayment !== undefined) {
        let authorized: boolean;
        try {
          authorized = await config.authorizePayment(options.authorizationContext ?? context);
        } catch (cause) {
          throw new X402ProtocolError(
            "payment_not_authorized",
            "HTTP 402 payment authorization failed.",
            { cause },
          );
        }
        if (!authorized) {
          throw new X402ProtocolError(
            "payment_not_authorized",
            "HTTP 402 payment was not authorized.",
            options.denialCause === undefined ? undefined : { cause: options.denialCause },
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
  const createMainnetPreflightRuntime = vi.fn().mockReturnValue(
    options.runtime ?? mainnetRuntime(),
  );
  const dependencies = { createAgentFetch, createMainnetPreflightRuntime, log };
  return { dependencies, createAgentFetch, agentFetch, log, transferReached };
}

describe("runAgentDemo", () => {
  test("keeps the default command on Sepolia with an immutable payment policy", async () => {
    const { dependencies, createAgentFetch } = dependenciesForAgent({
      authorizationContext: sepoliaContext,
    });
    await runAgentDemo("sepolia", [], sepoliaEnvironment, dependencies);
    expect(createAgentFetch).toHaveBeenCalledWith(expect.objectContaining({
      signer: expect.objectContaining({ address: expect.any(String) }),
      networks: ["eip155:84532"],
      maxPaymentUsdc: "0.10",
    }));
    const config = createAgentFetch.mock.calls[0]![0];
    expect(config.authorizePayment).toEqual(expect.any(Function));
    expect(config.onPaymentEvent).toBeUndefined();
  });

  test("treats a successful mainnet preflight without execute as a no-payment success", async () => {
    const { dependencies, log, transferReached } = dependenciesForAgent();
    await expect(runAgentDemo("mainnet", [], mainnetEnvironment, dependencies))
      .resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("PAYMENT NOT SENT"));
    expect(transferReached).not.toHaveBeenCalled();
  });

  test("authorizes exact mainnet execute and reaches transfer", async () => {
    const { dependencies, transferReached } = dependenciesForAgent();

    await runAgentDemo("mainnet", ["--execute"], mainnetEnvironment, dependencies);

    expect(transferReached).toHaveBeenCalledOnce();
  });

  test("uses the exact one-cent payment cap for mainnet", async () => {
    const { dependencies, createAgentFetch } = dependenciesForAgent();

    await runAgentDemo("mainnet", [], mainnetEnvironment, dependencies);

    expect(createAgentFetch.mock.calls[0]![0].maxPaymentUsdc).toBe("0.01");
  });

  test("uses signer-first x402 v2 configuration on mainnet", async () => {
    const { dependencies, createAgentFetch } = dependenciesForAgent();

    await runAgentDemo("mainnet", [], mainnetEnvironment, dependencies);

    expect(createAgentFetch.mock.calls[0]![0]).toMatchObject({
      signer: expect.objectContaining({ address: expect.any(String) }),
      networks: ["eip155:8453"],
      onPaymentEvent: expect.any(Function),
    });
  });

  test("passes redirect:error for a mainnet request", async () => {
    const { dependencies, agentFetch } = dependenciesForAgent();
    await runAgentDemo("mainnet", [], mainnetEnvironment, dependencies);
    expect(agentFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/api/data",
      { redirect: "error" },
    );
  });

  test("rejects execute without environment opt-in before transfer", async () => {
    const { ALLOW_MAINNET_PAYMENTS: _removed, ...withoutOptIn } = mainnetEnvironment;
    const { dependencies, transferReached } = dependenciesForAgent();
    await expect(runAgentDemo("mainnet", ["--execute"], withoutOptIn, dependencies))
      .rejects.toThrow(/ALLOW_MAINNET_PAYMENTS/);
    expect(transferReached).not.toHaveBeenCalled();
  });

  test("rethrows a wrapped preflight failure instead of treating it as preview", async () => {
    const { dependencies, transferReached } = dependenciesForAgent({
      runtime: mainnetRuntime({ getChainId: vi.fn().mockResolvedValue(84532) }),
    });

    await expect(runAgentDemo("mainnet", [], mainnetEnvironment, dependencies))
      .rejects.toBeInstanceOf(MainnetPreflightError);
    expect(transferReached).not.toHaveBeenCalled();
  });

  test.each([
    ["unrelated payment_not_authorized", new X402ProtocolError(
      "payment_not_authorized",
      "Unrelated authorization denial.",
    )],
    ["fetch", new TypeError("fetch failed")],
    ["sign", new X402PaymentError("payment_creation_failed", "sign", "sign failed")],
    ["settle", new X402PaymentError("payment_settlement_failed", "settle", "settle failed")],
    ["retry", new TypeError("retry failed")],
  ] as const)("propagates %s failure", async (_label, requestError) => {
    const { dependencies } = dependenciesForAgent({ requestError });

    await expect(runAgentDemo("mainnet", [], mainnetEnvironment, dependencies))
      .rejects.toBe(requestError);
  });

  test("does not swallow an unrelated authorization cause after successful preview", async () => {
    const denialCause = new Error("unrelated authorization failure");
    const { dependencies } = dependenciesForAgent({ denialCause });

    await expect(runAgentDemo("mainnet", [], mainnetEnvironment, dependencies))
      .rejects.toMatchObject({
        code: "payment_not_authorized",
        cause: denialCause,
      });
  });

  test("prints submitted hash and explorer without printing the key", async () => {
    const { dependencies, createAgentFetch, log } = dependenciesForAgent();
    await runAgentDemo("mainnet", [], mainnetEnvironment, dependencies);
    const config = createAgentFetch.mock.calls[0]![0];
    await config.onPaymentEvent?.({
      type: "payment_settled",
      context,
      transaction: hash,
    });
    const output = log.mock.calls.flat().join("\n");
    expect(output).toContain(hash);
    expect(output).toContain(`https://base.blockscout.com/tx/${hash}`);
    expect(output).toContain("DO NOT RERUN THIS COMMAND");
    expect(output).not.toContain(testPrivateKey);
  });
});
