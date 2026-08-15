import { encodePaymentResponseHeader, encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, SettleResponse } from "@x402/core/types";
import { expect, test, vi } from "vitest";

import {
  BASE_NETWORK,
  BASE_USDC,
  withAuthorizationLock,
  type AuthorizationPolicy,
  type AuthorizationStore,
} from "../src/index.js";

const RESOURCE = "https://agentpay.example/api/premium";
const PAY_TO = "0x1111111111111111111111111111111111111111" as const;
const policy: AuthorizationPolicy = {
  resource: RESOURCE,
  network: BASE_NETWORK,
  asset: BASE_USDC,
  payTo: PAY_TO,
  amount: "10000",
};

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
        from: "0x2222222222222222222222222222222222222222",
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

function paidRequest(header = paymentHeader()): Request {
  return new Request(RESOURCE, { headers: { "PAYMENT-SIGNATURE": header } });
}

function paidResponse(): Response {
  const settlement: SettleResponse = {
    success: true,
    payer: "0x2222222222222222222222222222222222222222",
    transaction: `0x${"ef".repeat(32)}`,
    network: BASE_NETWORK,
  };
  return Response.json({ premiumData: "secret" }, {
    status: 200,
    headers: { "PAYMENT-RESPONSE": encodePaymentResponseHeader(settlement) },
  });
}

function store(overrides: Partial<AuthorizationStore> = {}): AuthorizationStore {
  return {
    acquire: vi.fn().mockResolvedValue("acquired"),
    consume: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

test("does not lock an unpaid request", async () => {
  const lock = store();
  const handler = vi.fn().mockResolvedValue(new Response("unpaid", { status: 402 }));
  const guarded = withAuthorizationLock(handler, { store: lock, policy });

  const response = await guarded(new Request(RESOURCE));

  expect(response.status).toBe(402);
  expect(lock.acquire).not.toHaveBeenCalled();
  expect(handler).toHaveBeenCalledOnce();
});

test("consumes a successful authorization before returning premium data", async () => {
  const lock = store();
  const handler = vi.fn().mockResolvedValue(paidResponse());
  const guarded = withAuthorizationLock(handler, {
    store: lock,
    policy,
    leaseTokenFactory: () => "lease",
  });

  const response = await guarded(paidRequest());

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ premiumData: "secret" });
  expect(lock.acquire).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/), "lease", 360);
  expect(lock.consume).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/), "lease", 86_400);
  expect(lock.release).not.toHaveBeenCalled();
});

test.each([
  ["pending", "payment_in_progress"],
  ["consumed", "payment_consumed"],
] as const)("rejects a %s authorization without executing paid work", async (state, reason) => {
  const lock = store({ acquire: vi.fn().mockResolvedValue(state) });
  const handler = vi.fn().mockResolvedValue(paidResponse());
  const response = await withAuthorizationLock(handler, { store: lock, policy })(paidRequest());

  expect(response.status).toBe(409);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const bodyText = await response.clone().text();
  await expect(response.json()).resolves.toEqual({ error: "Conflict", reason });
  expect(handler).not.toHaveBeenCalled();
  expect(bodyText).not.toContain("premiumData");
});

test("rejects a concurrent duplicate while the first request holds the lease", async () => {
  let finish!: (response: Response) => void;
  const blocked = new Promise<Response>(resolve => { finish = resolve; });
  let acquired = false;
  const lock = store({
    acquire: vi.fn().mockImplementation(async () => {
      if (acquired) return "pending";
      acquired = true;
      return "acquired";
    }),
  });
  const handler = vi.fn().mockReturnValue(blocked);
  const guarded = withAuthorizationLock(handler, { store: lock, policy });

  const first = guarded(paidRequest());
  await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
  const second = await guarded(paidRequest());

  expect(second.status).toBe(409);
  expect(handler).toHaveBeenCalledOnce();
  finish(paidResponse());
  await expect(first).resolves.toMatchObject({ status: 200 });
});

test("releases failed verification and settlement attempts", async () => {
  const lock = store();
  const handler = vi.fn()
    .mockResolvedValueOnce(new Response("invalid", { status: 402 }))
    .mockResolvedValueOnce(new Response("failed", {
      status: 402,
      headers: {
        "PAYMENT-RESPONSE": encodePaymentResponseHeader({
          success: false,
          transaction: "",
          network: BASE_NETWORK,
          errorReason: "settlement_failed",
        }),
      },
    }));
  const guarded = withAuthorizationLock(handler, { store: lock, policy });

  expect((await guarded(paidRequest())).status).toBe(402);
  expect((await guarded(paidRequest())).status).toBe(402);
  expect(lock.release).toHaveBeenCalledTimes(2);
  expect(lock.consume).not.toHaveBeenCalled();
});

test("fails closed when a successful-looking response has no settlement proof", async () => {
  const lock = store();
  const guarded = withAuthorizationLock(
    vi.fn().mockResolvedValue(Response.json({ premiumData: "must-not-leak" })),
    { store: lock, policy },
  );

  const response = await guarded(paidRequest());

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({
    error: "Service Unavailable",
    reason: "payment_infrastructure_unavailable",
  });
  expect(lock.release).toHaveBeenCalledOnce();
});

test("discards premium data when consumed state cannot be persisted", async () => {
  const lock = store({ consume: vi.fn().mockResolvedValue(false) });
  const response = await withAuthorizationLock(
    vi.fn().mockResolvedValue(paidResponse()),
    { store: lock, policy },
  )(paidRequest());

  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("premiumData");
});

test("delegates malformed signatures to official x402 handling", async () => {
  const lock = store();
  const handler = vi.fn().mockResolvedValue(new Response("official challenge", { status: 402 }));
  const response = await withAuthorizationLock(handler, { store: lock, policy })(
    paidRequest("not-base64"),
  );

  expect(response.status).toBe(402);
  expect(lock.acquire).not.toHaveBeenCalled();
  expect(handler).toHaveBeenCalledOnce();
});
