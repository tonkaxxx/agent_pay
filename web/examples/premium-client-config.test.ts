import { describe, expect, test } from "vitest";

import { USDC_BASE, type PaymentAuthorizationContext } from "@agentpay/client";

import {
  authorizePremiumPayment,
  executeRequested,
  loadPremiumClientConfig,
} from "./premium-client-config";

const privateKey = `0x${"11".repeat(32)}`;
const payTo = "0x1111111111111111111111111111111111111111";

const environment = {
  AGENT_PRIVATE_KEY: privateKey,
  AGENTPAY_API_URL: "https://agentpay.example/api/premium",
  AGENTPAY_EXPECTED_PAY_TO: payTo,
  ALLOW_MAINNET_PAYMENTS: "false",
} as const;

const payment: PaymentAuthorizationContext = {
  requestUrl: environment.AGENTPAY_API_URL,
  paymentId: "pay_agentpay_web_12345",
  scheme: "exact",
  chainId: 8453,
  network: "eip155:8453",
  recipient: payTo,
  token: USDC_BASE,
  priceUsdc: "0.01",
  amount: 10_000n,
};

describe("loadPremiumClientConfig", () => {
  test("loads and normalizes the pinned mainnet boundaries", () => {
    expect(loadPremiumClientConfig(environment)).toEqual({
      privateKey,
      apiUrl: environment.AGENTPAY_API_URL,
      expectedPayTo: payTo,
      mainnetAllowed: false,
    });
  });

  test.each([
    ["AGENT_PRIVATE_KEY", "0x1234", "32-byte"],
    ["AGENTPAY_API_URL", "not-a-url", "valid URL"],
    ["AGENTPAY_EXPECTED_PAY_TO", "0x1234", "20-byte"],
  ] as const)("fails closed for an invalid %s", (name, value, message) => {
    expect(() => loadPremiumClientConfig({ ...environment, [name]: value }))
      .toThrow(message);
  });
});

test("execute mode requires the explicit --execute flag", () => {
  expect(executeRequested([])).toBe(false);
  expect(executeRequested(["--execute"])).toBe(true);
});

describe("authorizePremiumPayment", () => {
  test("returns false and reports preview without both execution signals", () => {
    const messages: string[] = [];

    expect(authorizePremiumPayment(payment, loadPremiumClientConfig(environment), false, messages.push.bind(messages)))
      .toBe(false);
    expect(messages).toContain("PAYMENT NOT SENT");
  });

  test("rejects --execute unless the environment opt-in is exactly true", () => {
    expect(() => authorizePremiumPayment(payment, loadPremiumClientConfig(environment), true, () => {}))
      .toThrow("ALLOW_MAINNET_PAYMENTS must be exactly true");
  });

  test("authorizes only the exact pinned payment", () => {
    const config = loadPremiumClientConfig({ ...environment, ALLOW_MAINNET_PAYMENTS: "true" });
    expect(authorizePremiumPayment(payment, config, true, () => {})).toBe(true);
  });

  test.each([
    ["requestUrl", "https://evil.example/api/premium"],
    ["chainId", 84532],
    ["network", "eip155:84532"],
    ["recipient", "0x2222222222222222222222222222222222222222"],
    ["token", "0x2222222222222222222222222222222222222222"],
    ["priceUsdc", "0.02"],
    ["amount", 20_000n],
  ] as const)("rejects a changed %s", (field, value) => {
    const config = loadPremiumClientConfig({ ...environment, ALLOW_MAINNET_PAYMENTS: "true" });
    expect(() => authorizePremiumPayment({ ...payment, [field]: value } as PaymentAuthorizationContext, config, true, () => {}))
      .toThrow(/does not match|must be/);
  });
});
