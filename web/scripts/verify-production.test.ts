import { encodePaymentRequiredHeader } from "@x402/core/http";
import { describe, expect, test } from "vitest";

import {
  assertEncryptionConfiguration,
  requireNonPlaceholderSecret,
  validateImageReference,
  validateUnpaidContract,
} from "./verify-production.mjs";

const baseUrl = "https://agentpay.thebestsites.ru";
const payTo = "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB";
const body = {
  error: "Payment Required",
  x402Version: 2,
  priceUsdc: "0.01",
  network: "eip155:8453",
};

function paymentRequired(extensions: Record<string, unknown> = {}): string {
  return encodePaymentRequiredHeader({
    x402Version: 2,
    resource: {
      url: `${baseUrl}/api/premium`,
      description: "AgentPay premium API",
      mimeType: "application/json",
    },
    accepts: [{
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo,
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2" },
    }],
    extensions,
  });
}

describe("production verifier policy", () => {
  test.each([
    `agentpay:${"a".repeat(40)}`,
    `ghcr.io/example/agentpay@sha256:${"b".repeat(64)}`,
  ])("accepts immutable image reference %s", image => {
    expect(validateImageReference(image)).toBe(image);
  });

  test.each(["", "agentpay:latest", "agentpay:dev", "agentpay:abc123"])(
    "rejects mutable image reference %s",
    image => expect(() => validateImageReference(image)).toThrow("immutable_image_required"),
  );

  test("accepts the exact compact unpaid Base Mainnet contract", () => {
    expect(validateUnpaidContract({
      status: 402,
      body,
      paymentRequired: paymentRequired(),
      baseUrl,
      payTo,
    })).toEqual(expect.objectContaining({
      resource: `${baseUrl}/api/premium`,
      network: "eip155:8453",
      amount: "10000",
      payTo,
    }));
  });

  test.each([
    ["paid body", { ...body, premiumData: "must stay protected" }, paymentRequired()],
    ["Bazaar leak", body, paymentRequired({ bazaar: { info: {} } })],
    ["wrong status", body, paymentRequired(), 200],
  ])("rejects %s", (_name, changedBody, header, status = 402) => {
    expect(() => validateUnpaidContract({
      status,
      body: changedBody,
      paymentRequired: header,
      baseUrl,
      payTo,
    })).toThrow("unpaid_contract_invalid");
  });

  test.each([
    "INVALID_CHANGE_ME_USE_A_32_BYTE_BASE64_KEY",
    "replace_me_with_a_real_secret",
    "changeme-please",
  ])("rejects placeholder secret %s", value => {
    expect(() => requireNonPlaceholderSecret(value))
      .toThrow("placeholder_secret");
  });

  test("accepts a real master key and rejects missing encryption configuration", () => {
    const masterKey = Buffer.alloc(32, 7).toString("base64");
    expect(requireNonPlaceholderSecret(masterKey)).toBe(masterKey);
    expect(() => assertEncryptionConfiguration({
      services: {
        web: {
          environment: {
            AUTH_SECRET: "a",
            AGENTPAY_MASTER_KEY: "INVALID_CHANGE_ME_USE_A_32_BYTE_BASE64_KEY",
            AUTH_GITHUB_SECRET: "b",
          },
        },
      },
    })).toThrow("placeholder_secret");
    expect(() => assertEncryptionConfiguration({
      services: {
        web: {
          environment: {
            AUTH_SECRET: "a",
            AGENTPAY_MASTER_KEY: "AQID",
            AUTH_GITHUB_SECRET: "b",
          },
        },
      },
    })).toThrow("missing_encryption_config");
    expect(() => assertEncryptionConfiguration({ services: {} })).toThrow(
      "placeholder_secret",
    );
  });
});
