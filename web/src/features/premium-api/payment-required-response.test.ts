import {
  decodePaymentRequiredHeader,
  encodePaymentRequiredHeader,
} from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { expect, test, vi } from "vitest";

import { withReadablePaymentRequired } from "./payment-required-response";

const paymentRequired: PaymentRequired = {
  x402Version: 2,
  resource: {
    url: "https://agentpay.example/api/premium",
    description: "AgentPay premium API",
    mimeType: "application/json",
  },
  accepts: [{
    scheme: "exact",
    network: "eip155:8453",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    amount: "10000",
    payTo: "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB",
    maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2" },
  }],
  extensions: {},
};

test("mirrors the official PAYMENT-REQUIRED header into the 402 JSON body", async () => {
  const encoded = encodePaymentRequiredHeader(paymentRequired);
  const handler = vi.fn().mockResolvedValue(new Response("{}", {
    status: 402,
    headers: {
      "PAYMENT-REQUIRED": encoded,
      "x-upstream": "preserved",
    },
  }));
  const request = new Request("https://agentpay.example/api/premium");

  const response = await withReadablePaymentRequired(handler)(request);

  expect(response.status).toBe(402);
  expect(response.headers.get("payment-required")).toBe(encoded);
  expect(response.headers.get("x-upstream")).toBe("preserved");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("content-type")).toContain("application/json");
  await expect(response.json()).resolves.toEqual(decodePaymentRequiredHeader(encoded));
  expect(handler).toHaveBeenCalledWith(request);
});

test("returns non-402 responses by identity", async () => {
  const upstream = Response.json({ premium: true });
  const handler = vi.fn().mockResolvedValue(upstream);

  await expect(withReadablePaymentRequired(handler)(
    new Request("https://agentpay.example/api/premium"),
  )).resolves.toBe(upstream);
});

test.each([
  ["missing", undefined],
  ["malformed", "not-base64"],
] as const)("leaves a 402 with a %s payment header unchanged", async (_label, encoded) => {
  const upstream = new Response("official fallback", {
    status: 402,
    ...(encoded === undefined ? {} : { headers: { "PAYMENT-REQUIRED": encoded } }),
  });
  const handler = vi.fn().mockResolvedValue(upstream);

  await expect(withReadablePaymentRequired(handler)(
    new Request("https://agentpay.example/api/premium"),
  )).resolves.toBe(upstream);
});
