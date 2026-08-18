import { encodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, SettleResponse } from "@x402/core/types";
import { describe, expect, it } from "vitest";

import { BASE_NETWORK, BASE_USDC, createPaymentPolicy } from "@agentpay/server";

import { buildPaymentEvent } from "./payment-event";

const RESOURCE = "https://gateway.example/g/public-id";
const PAY_TO = "0x63A4536BC72c6d17A2ec1e6aa14555e0Ef9044D1" as const;
const PAYER = "0x2222222222222222222222222222222222222222" as const;
const policy = createPaymentPolicy({
  resource: RESOURCE,
  payTo: PAY_TO,
  amountAtomic: "10000",
  maxTimeoutSeconds: 300,
  description: "Paid endpoint",
});

function paymentHeader(): string {
  const payment: PaymentPayload = {
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
        nonce: `0x${"ab".repeat(32)}`,
      },
    },
    extensions: {},
  };
  return encodePaymentSignatureHeader(payment);
}

function settlementHeader(): string {
  const settlement: SettleResponse = {
    success: true,
    payer: PAYER,
    transaction: `0x${"ef".repeat(32)}`,
    network: BASE_NETWORK,
  };
  return encodePaymentResponseHeader(settlement);
}

describe("buildPaymentEvent", () => {
  it("captures a confirmed settlement without exposing authorization material", async () => {
    const event = await buildPaymentEvent({
      endpointId: "endpoint-id",
      requestId: "request-id",
      paymentHeader: paymentHeader(),
      response: new Response("paid", {
        status: 200,
        headers: { "PAYMENT-RESPONSE": settlementHeader() },
      }),
      policy,
      upstream: {
        ok: true,
        status: 200,
        contentType: "application/json",
        contentLength: 42,
        body: new Uint8Array(),
        latencyMs: 18,
      },
    });

    expect(event).toEqual({
      endpointId: "endpoint-id",
      requestId: "request-id",
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      payerAddress: PAYER,
      txHash: `0x${"ef".repeat(32)}`,
      amountAtomic: "10000",
      upstreamStatus: 200,
      upstreamDurationMs: 18,
      upstreamResponseSize: 42,
      settlementDurationMs: null,
      outcome: "settled",
    });
    expect(JSON.stringify(event)).not.toContain(paymentHeader());
  });

  it("records an upstream failure without charging commission", async () => {
    const event = await buildPaymentEvent({
      endpointId: "endpoint-id",
      requestId: "request-id",
      paymentHeader: paymentHeader(),
      response: Response.json({ reason: "upstream_unavailable" }, { status: 502 }),
      policy,
      upstream: { ok: false, reason: "timeout", status: null, latencyMs: 30_000 },
    });

    expect(event.outcome).toBe("upstream_failed");
    expect(event.fingerprint).toBeNull();
    expect(event.txHash).toBeNull();
    expect(event.upstreamDurationMs).toBe(30_000);
  });

  it("records an unpaid challenge with no payer identity", async () => {
    const event = await buildPaymentEvent({
      endpointId: "endpoint-id",
      requestId: "request-id",
      paymentHeader: null,
      response: Response.json({ reason: "payment_required" }, { status: 402 }),
      policy,
      upstream: null,
    });

    expect(event).toMatchObject({
      fingerprint: null,
      payerAddress: null,
      txHash: null,
      outcome: "challenge",
    });
  });
});
