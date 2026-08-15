import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { encodePaymentRequiredHeader } from "@x402/core/http";
import { describe, expect, test } from "vitest";

import { validatePaymentRequired } from "./x402-mainnet.js";

const directory = fileURLToPath(new URL(".", import.meta.url));
const typescript = readFileSync(`${directory}/x402-mainnet.ts`, "utf8");
const python = readFileSync(`${directory}/x402_mainnet.py`, "utf8");
const requirements = readFileSync(`${directory}/requirements.txt`, "utf8");

const API_URL = "https://agentpay.thebestsites.ru/api/premium";
const PAY_TO = "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB";

function challenge(overrides: Record<string, unknown> = {}) {
  return encodePaymentRequiredHeader({
    x402Version: 2,
    error: "Payment required",
    resource: {
      url: API_URL,
      description: "AgentPay premium API",
      mimeType: "application/json",
    },
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2" },
      ...overrides,
    }],
    extensions: {},
  });
}

test("uses only official clean-room x402 clients", () => {
  expect(typescript).toContain('from "@x402/core/client"');
  expect(typescript).toContain('from "@x402/evm/exact/client"');
  expect(typescript).toContain('from "@x402/fetch"');
  expect(typescript).toContain('from "viem/accounts"');
  expect(typescript).not.toMatch(/@agentpay\//);

  expect(python).toContain("from x402 import x402ClientSync");
  expect(python).toContain("from x402.http.clients import x402_requests");
  expect(python).toContain("from x402.mechanisms.evm import EthAccountSigner");
  expect(python).not.toMatch(/agentpay[._-](?:client|sdk|package)/i);

  expect(requirements.trim().split("\n")).toEqual([
    "x402[requests,evm]==2.19.0",
    "eth-account==0.13.7",
  ]);
});

test("contains no private-key literal or buyer RPC requirement", () => {
  const sources = `${typescript}\n${python}`;
  expect(sources).not.toMatch(/AGENT_PRIVATE_KEY\s*=\s*0x[0-9a-fA-F]{64}/);
  expect(sources).not.toContain("BASE_MAINNET_RPC_URL");
  expect(sources).toContain("ALLOW_MAINNET_PAYMENTS");
  expect(sources).toContain("--execute");
});

describe("validatePaymentRequired", () => {
  test("accepts the exact capped AgentPay contract", () => {
    expect(validatePaymentRequired(challenge(), API_URL)).toEqual({
      resource: API_URL,
      network: "eip155:8453",
      amount: "10000",
      amountUsdc: "0.01",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
    });
  });

  test.each([
    ["network", "eip155:1"],
    ["amount", "10001"],
    ["asset", "0x1111111111111111111111111111111111111111"],
    ["payTo", "0x1111111111111111111111111111111111111111"],
    ["maxTimeoutSeconds", 301],
  ])("rejects an unexpected %s", (field, value) => {
    expect(() => validatePaymentRequired(challenge({ [field]: value }), API_URL))
      .toThrow("payment_policy_rejected");
  });
});
