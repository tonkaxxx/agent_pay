import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload } from "@x402/core/types";
import { expect, test } from "vitest";

import {
  BASE_NETWORK,
  BASE_USDC,
  InvalidAuthorizationError,
  authorizationFingerprint,
  type AuthorizationPolicy,
} from "../src/index.js";

const RESOURCE = "https://agentpay.example/api/premium";
const PAY_TO = "0x1111111111111111111111111111111111111111" as const;
const PAYER = "0x2222222222222222222222222222222222222222" as const;
const NONCE = `0x${"ab".repeat(32)}` as const;

const policy: AuthorizationPolicy = {
  resource: RESOURCE,
  network: BASE_NETWORK,
  asset: BASE_USDC,
  payTo: PAY_TO,
  amount: "10000",
};

function payload(overrides: Partial<PaymentPayload> = {}): PaymentPayload {
  return {
    x402Version: 2,
    resource: { url: RESOURCE },
    accepted: {
      scheme: "exact",
      network: BASE_NETWORK,
      asset: BASE_USDC,
      amount: "10000",
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2" },
    },
    payload: {
      signature: `0x${"cd".repeat(65)}`,
      authorization: {
        from: PAYER,
        to: PAY_TO,
        value: "10000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: NONCE,
      },
    },
    extensions: {},
    ...overrides,
  };
}

test("derives the same safe fingerprint from equivalent header encodings", () => {
  const value = payload();
  const canonical = encodePaymentSignatureHeader(value);
  const reordered = Buffer.from(JSON.stringify({
    extensions: value.extensions,
    payload: value.payload,
    accepted: value.accepted,
    resource: value.resource,
    x402Version: value.x402Version,
  })).toString("base64").replace(/=+$/, "");

  const first = authorizationFingerprint(canonical, policy);
  const second = authorizationFingerprint(reordered, policy);

  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(second).toBe(first);
  expect(first).not.toContain(PAYER.slice(2).toLowerCase());
  expect(first).not.toContain(NONCE.slice(2));
});

test.each([
  ["network", { accepted: { ...payload().accepted, network: "eip155:1" } }],
  ["asset", { accepted: { ...payload().accepted, asset: PAY_TO } }],
  ["resource", { resource: { url: "https://other.example/api/premium" } }],
  ["payee", { accepted: { ...payload().accepted, payTo: PAYER } }],
  ["amount", { accepted: { ...payload().accepted, amount: "10001" } }],
] as const)("rejects a payment whose %s differs from policy", (_field, overrides) => {
  const encoded = encodePaymentSignatureHeader(payload(overrides as Partial<PaymentPayload>));
  expect(() => authorizationFingerprint(encoded, policy)).toThrow(InvalidAuthorizationError);
});

test("changes the fingerprint for another payer or nonce", () => {
  const first = authorizationFingerprint(encodePaymentSignatureHeader(payload()), policy);
  const otherPayer = payload({
    payload: {
      ...(payload().payload as Record<string, unknown>),
      authorization: {
        ...(payload().payload as { authorization: Record<string, unknown> }).authorization,
        from: "0x3333333333333333333333333333333333333333",
      },
    },
  });
  const otherNonce = payload({
    payload: {
      ...(payload().payload as Record<string, unknown>),
      authorization: {
        ...(payload().payload as { authorization: Record<string, unknown> }).authorization,
        nonce: `0x${"ef".repeat(32)}`,
      },
    },
  });

  expect(authorizationFingerprint(encodePaymentSignatureHeader(otherPayer), policy)).not.toBe(first);
  expect(authorizationFingerprint(encodePaymentSignatureHeader(otherNonce), policy)).not.toBe(first);
});

test.each([
  "not-base64",
  Buffer.from(JSON.stringify({ x402Version: 1 })).toString("base64"),
  encodePaymentSignatureHeader(payload({ resource: undefined })),
  encodePaymentSignatureHeader(payload({ accepted: { ...payload().accepted, scheme: "upto" } })),
  encodePaymentSignatureHeader(payload({ payload: { signature: "0x12", permit2Authorization: {} } })),
])("rejects malformed or unsupported authorization without echoing it", encoded => {
  let error: unknown;
  try {
    authorizationFingerprint(encoded, policy);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(InvalidAuthorizationError);
  expect(String(error)).not.toContain(encoded);
});
