import { encodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, SettleResponse } from "@x402/core/types";
import { describe, expect, test, vi } from "vitest";

import {
  InMemoryPaymentIdempotencyStore,
  PaymentIdempotencyUnavailableError,
  RedisPaymentIdempotencyStore,
  withPaymentIdempotency,
  type PaymentIdempotencyStore,
} from "../src/index.js";

const paymentId = "pay_agentpay_test_1234";
const otherPaymentId = "pay_agentpay_other_123";
const settlement: SettleResponse = {
  success: true,
  payer: "0x2222222222222222222222222222222222222222",
  transaction: `0x${"ab".repeat(32)}`,
  network: "eip155:84532",
};

function paymentHeader(id = paymentId, signature = `0x${"cd".repeat(65)}`): string {
  const payload: PaymentPayload = {
    x402Version: 2,
    resource: { url: "https://vendor.example/data" },
    accepted: {
      scheme: "exact",
      network: "eip155:84532",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      amount: "10000",
      payTo: "0x1111111111111111111111111111111111111111",
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    },
    payload: {
      signature,
      authorization: {
        from: "0x2222222222222222222222222222222222222222",
        to: "0x1111111111111111111111111111111111111111",
        value: "10000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${"ef".repeat(32)}`,
      },
    },
    extensions: {
      "payment-identifier": {
        info: { required: false, id },
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
  return encodePaymentSignatureHeader(payload);
}

function paidResponse(body = JSON.stringify({ data: "premium" })): Response {
  return new Response(body, {
    status: 201,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
      "payment-response": encodePaymentResponseHeader(settlement),
      "set-cookie": "session=secret",
    },
  });
}

function paidRequest(header = paymentHeader()): Request {
  return new Request("https://vendor.example/data", {
    headers: { "PAYMENT-SIGNATURE": header },
  });
}

describe("InMemoryPaymentIdempotencyStore", () => {
  test("atomically distinguishes acquired, pending, replay, and conflict", async () => {
    let now = 1_000;
    const store = new InMemoryPaymentIdempotencyStore({
      now: () => now,
      leaseTokenFactory: () => "lease-1",
    });
    const input = {
      paymentId,
      paymentFingerprint: "a".repeat(64),
      pendingTtlSeconds: 60,
      completedTtlSeconds: 3_600,
    };

    await expect(store.begin(input)).resolves.toEqual({
      kind: "acquired",
      leaseToken: "lease-1",
    });
    await expect(store.begin(input)).resolves.toEqual({ kind: "pending" });
    await expect(store.begin({
      ...input,
      paymentFingerprint: "b".repeat(64),
    })).resolves.toEqual({ kind: "conflict" });

    const response = {
      status: 200,
      headers: { "payment-response": "encoded" },
      bodyBase64: "b2s=",
      settlement,
    };
    await expect(store.complete({
      ...input,
      leaseToken: "lease-1",
      response,
    })).resolves.toBe(true);
    await expect(store.begin(input)).resolves.toEqual({ kind: "replay", response });

    now += 3_600_001;
    await expect(store.begin(input)).resolves.toMatchObject({ kind: "acquired" });
  });

  test("only the lease owner can complete or release a pending entry", async () => {
    const store = new InMemoryPaymentIdempotencyStore({ leaseTokenFactory: () => "owner" });
    const input = {
      paymentId,
      paymentFingerprint: "a".repeat(64),
      pendingTtlSeconds: 60,
      completedTtlSeconds: 3_600,
    };
    await store.begin(input);

    await expect(store.complete({
      ...input,
      leaseToken: "intruder",
      response: { status: 200, headers: {}, bodyBase64: "" },
    })).resolves.toBe(false);
    await store.release({ ...input, leaseToken: "intruder" });
    await expect(store.begin(input)).resolves.toEqual({ kind: "pending" });

    await store.release({ ...input, leaseToken: "owner" });
    await expect(store.begin(input)).resolves.toMatchObject({ kind: "acquired" });
  });
});

describe("withPaymentIdempotency", () => {
  test("delegates requests without a valid Payment Identifier", async () => {
    const handler = vi.fn().mockResolvedValue(new Response("unpaid", { status: 402 }));
    const wrapped = withPaymentIdempotency(handler, {
      store: new InMemoryPaymentIdempotencyStore(),
    });

    await wrapped(new Request("https://vendor.example/data"));
    await wrapped(new Request("https://vendor.example/data", {
      headers: { "PAYMENT-SIGNATURE": "not-base64" },
    }));
    await wrapped(paidRequest(paymentHeader("bad")));

    expect(handler).toHaveBeenCalledTimes(3);
  });

  test("replays the exact settled response for the same ID and payment payload", async () => {
    const handler = vi.fn().mockResolvedValue(paidResponse());
    const wrapped = withPaymentIdempotency(handler, {
      store: new InMemoryPaymentIdempotencyStore(),
    });

    const first = await wrapped(paidRequest());
    const replay = await wrapped(paidRequest());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    await expect(replay.text()).resolves.toBe(JSON.stringify({ data: "premium" }));
    expect(replay.headers.get("payment-response")).toBe(first.headers.get("payment-response"));
    expect(replay.headers.get("content-type")).toContain("application/json");
    expect(replay.headers.has("set-cookie")).toBe(false);
  });

  test("returns 409 when the same ID is reused with another payment payload", async () => {
    const handler = vi.fn().mockResolvedValue(paidResponse());
    const wrapped = withPaymentIdempotency(handler, {
      store: new InMemoryPaymentIdempotencyStore(),
    });
    await wrapped(paidRequest());

    const response = await wrapped(paidRequest(paymentHeader(
      paymentId,
      `0x${"12".repeat(65)}`,
    )));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "payment_identifier_conflict" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test("returns 425 for a concurrent matching payment", async () => {
    let resolveHandler!: (response: Response) => void;
    const blocked = new Promise<Response>(resolve => { resolveHandler = resolve; });
    const handler = vi.fn().mockReturnValue(blocked);
    const wrapped = withPaymentIdempotency(handler, {
      store: new InMemoryPaymentIdempotencyStore(),
    });

    const first = wrapped(paidRequest());
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    const concurrent = await wrapped(paidRequest());

    expect(concurrent.status).toBe(425);
    expect(concurrent.headers.get("retry-after")).toBe("1");
    await expect(concurrent.json()).resolves.toEqual({ error: "payment_in_progress" });

    resolveHandler(paidResponse());
    await first;
  });

  test("releases the lease when the handler or settlement fails", async () => {
    const handler = vi.fn()
      .mockRejectedValueOnce(new Error("handler failed"))
      .mockResolvedValueOnce(new Response("missing settlement", { status: 200 }))
      .mockResolvedValueOnce(paidResponse());
    const wrapped = withPaymentIdempotency(handler, {
      store: new InMemoryPaymentIdempotencyStore(),
    });

    await expect(wrapped(paidRequest())).rejects.toThrow("handler failed");
    expect((await wrapped(paidRequest())).status).toBe(200);
    expect((await wrapped(paidRequest())).status).toBe(201);
    expect(handler).toHaveBeenCalledTimes(3);
  });

  test("passes only a SHA-256 fingerprint and sanitized response to the store", async () => {
    const begin = vi.fn<PaymentIdempotencyStore["begin"]>().mockResolvedValue({
      kind: "acquired",
      leaseToken: "lease",
    });
    const complete = vi.fn<PaymentIdempotencyStore["complete"]>().mockResolvedValue(true);
    const store: PaymentIdempotencyStore = {
      begin,
      complete,
      release: vi.fn(),
    };
    const rawHeader = paymentHeader(otherPaymentId);
    const wrapped = withPaymentIdempotency(vi.fn().mockResolvedValue(paidResponse()), { store });

    await wrapped(paidRequest(rawHeader));

    expect(begin).toHaveBeenCalledWith(expect.objectContaining({
      paymentId: otherPaymentId,
      paymentFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      pendingTtlSeconds: 60,
      completedTtlSeconds: 3_600,
    }));
    expect(JSON.stringify(begin.mock.calls)).not.toContain(rawHeader);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      response: expect.objectContaining({
        headers: expect.not.objectContaining({ "set-cookie": expect.anything() }),
        settlement,
      }),
    }));
  });

  test("fails closed with a safe typed error when the store is unavailable", async () => {
    const handler = vi.fn().mockResolvedValue(paidResponse());
    const store: PaymentIdempotencyStore = {
      begin: vi.fn().mockRejectedValue(new Error("redis://:secret@redis:6379")),
      complete: vi.fn(),
      release: vi.fn(),
    };
    const wrapped = withPaymentIdempotency(handler, { store });

    const operation = wrapped(paidRequest());

    await expect(operation).rejects.toBeInstanceOf(PaymentIdempotencyUnavailableError);
    await expect(operation).rejects.not.toThrow("secret");
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("RedisPaymentIdempotencyStore", () => {
  test("uses atomic scripts and the v2 namespace", async () => {
    const evalScript = vi.fn()
      .mockResolvedValueOnce(["acquired", "lease-from-redis"])
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1);
    const store = new RedisPaymentIdempotencyStore({ eval: evalScript });
    const input = {
      paymentId,
      paymentFingerprint: "a".repeat(64),
      pendingTtlSeconds: 60,
      completedTtlSeconds: 3_600,
    };

    await expect(store.begin(input)).resolves.toEqual({
      kind: "acquired",
      leaseToken: "lease-from-redis",
    });
    await expect(store.complete({
      ...input,
      leaseToken: "lease-from-redis",
      response: { status: 200, headers: {}, bodyBase64: "" },
    })).resolves.toBe(true);
    await store.release({ ...input, leaseToken: "lease-from-redis" });

    expect(evalScript).toHaveBeenCalledTimes(3);
    expect(evalScript.mock.calls[0]?.[1]).toMatchObject({
      keys: [`agentpay:idempotency:v2:${paymentId}`],
    });
  });
});
