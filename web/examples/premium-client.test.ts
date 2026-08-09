import { expect, test, vi } from "vitest";

import { X402ProtocolError, type AgentFetchConfig } from "@x402/client";

import { runPremiumClient } from "./premium-client";

const environment = {
  AGENT_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  BASE_MAINNET_RPC_URL: "https://mainnet.base.org",
  AGENTPAY_API_URL: "https://agentpay.example/api/premium",
  AGENTPAY_EXPECTED_PAY_TO: "0x1111111111111111111111111111111111111111",
  ALLOW_MAINNET_PAYMENTS: "false",
} as const;

test("configures the SDK with a one-cent cap and safe verification retries", async () => {
  let receivedConfig: AgentFetchConfig | undefined;
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ premiumData: "unlocked" }), { status: 200 }));
  const log = vi.fn();

  await runPremiumClient(["--execute"], { ...environment, ALLOW_MAINNET_PAYMENTS: "true" }, {
    createAgentFetch: (config) => {
      receivedConfig = config;
      return request;
    },
    log,
  });

  expect(receivedConfig).toMatchObject({
    maxPaymentUsdc: "0.01",
    confirmations: 2,
    paymentVerificationRetries: 5,
    paymentVerificationRetryDelayMs: 2_000,
  });
  expect(request).toHaveBeenCalledWith(environment.AGENTPAY_API_URL, { redirect: "error" });
  expect(log).toHaveBeenCalledWith("Vendor API status: 200");
  expect(log.mock.calls.flat().join(" ")).not.toContain(environment.AGENT_PRIVATE_KEY);
});

test("treats a denied preview as a successful no-payment run", async () => {
  const log = vi.fn();

  await expect(runPremiumClient([], environment, {
    createAgentFetch: (config) => async () => {
      await config.authorizePayment?.({
        requestUrl: environment.AGENTPAY_API_URL,
        chainId: 8453,
        network: "base",
        payTo: environment.AGENTPAY_EXPECTED_PAY_TO,
        token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        priceUsdc: "0.01",
        amount: 10_000n,
      });
      throw new X402ProtocolError("payment_not_authorized", "not authorized");
    },
    log,
  })).resolves.toBeUndefined();

  expect(log).toHaveBeenCalledWith("PAYMENT NOT SENT");
});

test("prints the transaction hash and an irreversible-action warning immediately", async () => {
  const log = vi.fn();
  let receivedConfig: AgentFetchConfig | undefined;

  await runPremiumClient(["--execute"], { ...environment, ALLOW_MAINNET_PAYMENTS: "true" }, {
    createAgentFetch: (config) => {
      receivedConfig = config;
      return vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    },
    log,
  });

  await receivedConfig?.onTransactionSubmitted?.({
    hash: `0x${"ab".repeat(32)}`,
    chainId: 8453,
    token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: environment.AGENTPAY_EXPECTED_PAY_TO,
    amount: 10_000n,
  });

  expect(log).toHaveBeenCalledWith(`Transaction submitted: 0x${"ab".repeat(32)}`);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("basescan.org/tx/"));
  expect(log).toHaveBeenCalledWith("WARNING: PAYMENT SUBMITTED. DO NOT RERUN THIS COMMAND.");
});
