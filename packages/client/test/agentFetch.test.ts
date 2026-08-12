import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequired, SettleResponse } from "@x402/core/types";
import type { ClientEvmSigner } from "@x402/evm";
import { describe, expect, test, vi } from "vitest";

import {
  createAgentFetch,
  USDC_BASE,
  USDC_BASE_SEPOLIA,
  X402ProtocolError,
  type PaymentEvent,
} from "../src/index.js";

const payer = "0x2222222222222222222222222222222222222222" as const;
const payTo = "0x1111111111111111111111111111111111111111" as const;
const signature = `0x${"ab".repeat(65)}` as const;
const paymentId = "pay_agentpay_test_1234";

function signerFor() {
  const signTypedData = vi.fn<ClientEvmSigner["signTypedData"]>().mockResolvedValue(signature);
  return {
    signer: { address: payer, signTypedData } satisfies ClientEvmSigner,
    signTypedData,
  };
}

function requirement(overrides: Partial<PaymentRequired["accepts"][number]> = {}): PaymentRequired {
  return {
    x402Version: 2,
    resource: {
      url: "https://vendor.example/data",
      description: "Premium data",
      mimeType: "application/json",
    },
    accepts: [{
      scheme: "exact",
      network: "eip155:84532",
      asset: USDC_BASE_SEPOLIA,
      amount: "10000",
      payTo,
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
      ...overrides,
    }],
    extensions: {
      "payment-identifier": {
        info: { required: false },
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: {
            required: { type: "boolean" },
            id: { type: "string", minLength: 16, maxLength: 128, pattern: "^[a-zA-Z0-9_-]+$" },
          },
          required: ["required"],
        },
      },
    },
  };
}

function paymentRequired(value = requirement()): Response {
  return new Response(null, {
    status: 402,
    headers: { "PAYMENT-REQUIRED": encodePaymentRequiredHeader(value) },
  });
}

function settledResponse(overrides: Partial<SettleResponse> = {}): Response {
  const settlement: SettleResponse = {
    success: true,
    payer,
    transaction: `0x${"cd".repeat(32)}`,
    network: "eip155:84532",
    ...overrides,
  };
  return new Response(JSON.stringify({ data: "paid" }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "PAYMENT-RESPONSE": encodePaymentResponseHeader(settlement),
    },
  });
}

function config(overrides: Record<string, unknown> = {}) {
  const { signer } = signerFor();
  return {
    signer,
    networks: ["eip155:84532"] as const,
    maxPaymentUsdc: "1.00",
    paymentIdFactory: () => paymentId,
    ...overrides,
  };
}

describe("createAgentFetch x402 v2", () => {
  test("returns a non-402 response without signing", async () => {
    const { signer, signTypedData } = signerFor();
    const response = new Response("ok", { status: 200 });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    const agentFetch = createAgentFetch({
      signer,
      networks: ["eip155:84532"],
      maxPaymentUsdc: "1",
    }, { fetch });

    await expect(agentFetch("https://vendor.example/free")).resolves.toBe(response);
    expect(signTypedData).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("signs the standard exact payload, adds a payment identifier, and preserves the request", async () => {
    const events: PaymentEvent[] = [];
    const { signer, signTypedData } = signerFor();
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(paymentRequired())
      .mockResolvedValueOnce(settledResponse());
    const agentFetch = createAgentFetch({
      signer,
      networks: ["eip155:84532"],
      maxPaymentUsdc: "0.01",
      paymentIdFactory: () => paymentId,
      onPaymentEvent: event => { events.push(event); },
    }, { fetch });

    const response = await agentFetch("https://vendor.example/data", {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent": "demo" },
      body: JSON.stringify({ prompt: "hello" }),
    });

    expect(response.status).toBe(200);
    expect(signTypedData).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);

    const paidRequest = fetch.mock.calls[1]?.[0] as Request;
    expect(paidRequest.method).toBe("POST");
    expect(paidRequest.headers.get("x-agent")).toBe("demo");
    expect(paidRequest.headers.has("X-Payment-Tx")).toBe(false);
    await expect(paidRequest.clone().text()).resolves.toBe(JSON.stringify({ prompt: "hello" }));

    const encoded = paidRequest.headers.get("PAYMENT-SIGNATURE");
    expect(encoded).toBeTruthy();
    const payload = decodePaymentSignatureHeader(encoded!) as PaymentPayload;
    expect(payload.x402Version).toBe(2);
    expect(payload.accepted).toMatchObject({
      scheme: "exact",
      network: "eip155:84532",
      asset: USDC_BASE_SEPOLIA,
      amount: "10000",
      payTo,
    });
    expect(payload.extensions?.["payment-identifier"]).toMatchObject({
      info: { required: false, id: paymentId },
    });

    expect(events.map(event => event.type)).toEqual([
      "payment_required",
      "payment_authorized",
      "payment_settled",
    ]);
    expect(events[0]).toMatchObject({
      context: {
        requestUrl: "https://vendor.example/data",
        paymentId,
        scheme: "exact",
        network: "eip155:84532",
        chainId: 84532,
        recipient: payTo,
        token: USDC_BASE_SEPOLIA,
        priceUsdc: "0.01",
        amount: 10_000n,
      },
    });
    expect(events[2]).toMatchObject({ transaction: `0x${"cd".repeat(32)}` });
  });

  test("supports official Base USDC on mainnet", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(paymentRequired(requirement({
        network: "eip155:8453",
        asset: USDC_BASE,
      })))
      .mockResolvedValueOnce(settledResponse({ network: "eip155:8453" }));
    const agentFetch = createAgentFetch({
      ...config(),
      networks: ["eip155:8453"] as const,
    }, { fetch });

    await expect(agentFetch("https://vendor.example/data")).resolves.toMatchObject({ status: 200 });
  });

  test("fails closed before signing when the amount exceeds the policy cap", async () => {
    const { signer, signTypedData } = signerFor();
    const events: PaymentEvent[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(paymentRequired(requirement({ amount: "10001" })));
    const agentFetch = createAgentFetch({
      signer,
      networks: ["eip155:84532"],
      maxPaymentUsdc: "0.01",
      paymentIdFactory: () => paymentId,
      onPaymentEvent: event => { events.push(event); },
    }, { fetch });

    await expect(agentFetch("https://vendor.example/data")).rejects.toMatchObject<Partial<X402ProtocolError>>({
      name: "X402ProtocolError",
      code: "payment_limit_exceeded",
    });
    expect(signTypedData).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(events.at(-1)).toMatchObject({ type: "payment_failed", stage: "policy" });
  });

  test("fails closed when authorizePayment throws or rejects the payment", async () => {
    for (const authorizePayment of [
      vi.fn().mockReturnValue(false),
      vi.fn().mockRejectedValue(new Error("policy service unavailable")),
    ]) {
      const { signer, signTypedData } = signerFor();
      const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(paymentRequired());
      const agentFetch = createAgentFetch({
        signer,
        networks: ["eip155:84532"],
        maxPaymentUsdc: "1",
        paymentIdFactory: () => paymentId,
        authorizePayment,
      }, { fetch });

      await expect(agentFetch("https://vendor.example/data")).rejects.toMatchObject({
        name: "X402ProtocolError",
        code: "payment_not_authorized",
      });
      expect(signTypedData).not.toHaveBeenCalled();
    }
  });

  test("rejects an invalid generated Payment Identifier before policy or signing", async () => {
    const { signer, signTypedData } = signerFor();
    const authorizePayment = vi.fn();
    const events: PaymentEvent[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(paymentRequired());
    const agentFetch = createAgentFetch({
      signer,
      networks: ["eip155:84532"],
      maxPaymentUsdc: "1",
      paymentIdFactory: () => "invalid",
      authorizePayment,
      onPaymentEvent: event => { events.push(event); },
    }, { fetch });

    await expect(agentFetch("https://vendor.example/data")).rejects.toMatchObject({
      name: "X402ProtocolError",
      code: "invalid_payment_response",
    });
    expect(authorizePayment).not.toHaveBeenCalled();
    expect(signTypedData).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "payment_failed", stage: "parse" });
  });

  test("classifies a malformed PAYMENT-REQUIRED header as a parse failure", async () => {
    const events: PaymentEvent[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(new Response(null, {
      status: 402,
      headers: { "PAYMENT-REQUIRED": "not-valid-base64" },
    }));
    const agentFetch = createAgentFetch({
      ...config(),
      onPaymentEvent: event => { events.push(event); },
    }, { fetch });

    await expect(agentFetch("https://vendor.example/data")).rejects.toMatchObject({
      name: "X402PaymentError",
      stage: "parse",
    });
    expect(events.at(-1)).toMatchObject({ type: "payment_failed", stage: "parse" });
  });

  test("ignores observer failures so observability cannot interrupt settlement", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(paymentRequired())
      .mockResolvedValueOnce(settledResponse());
    const agentFetch = createAgentFetch({
      ...config(),
      onPaymentEvent: vi.fn().mockRejectedValue(new Error("observer unavailable")),
    }, { fetch });

    await expect(agentFetch("https://vendor.example/data")).resolves.toMatchObject({ status: 200 });
  });

  test("reports settlement failures through the unified event", async () => {
    const events: PaymentEvent[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(paymentRequired())
      .mockResolvedValueOnce(settledResponse({
        success: false,
        errorReason: "settlement_failed",
        transaction: "",
      }));
    const agentFetch = createAgentFetch({
      ...config(),
      onPaymentEvent: event => { events.push(event); },
    }, { fetch });

    await agentFetch("https://vendor.example/data");

    expect(events.at(-1)).toMatchObject({
      type: "payment_failed",
      stage: "settle",
      requestUrl: "https://vendor.example/data",
      paymentId,
    });
  });

  test.each([
    ["empty network list", { networks: [] }],
    ["invalid cap", { maxPaymentUsdc: "0" }],
  ])("rejects invalid configuration: %s", (_name, override) => {
    expect(() => createAgentFetch({ ...config(), ...override } as never)).toThrow();
  });
});
