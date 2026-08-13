import { expect, test, vi } from "vitest";

import { createPremiumHandler } from "./handler";

const payTo = "0x1111111111111111111111111111111111111111" as const;

test("returns exact Base Mainnet payment requirements without calling the verifier", async () => {
  const verify = vi.fn();
  const handle = createPremiumHandler({ payTo, verify });

  const response = await handle(new Request("https://agentpay.example/api/premium"));

  expect(response.status).toBe(402);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    error: "Payment Required",
    priceUsdc: "0.01",
    payTo,
    network: "base",
    chainId: 8453,
  });
  expect(verify).not.toHaveBeenCalled();
});

test("returns premium data only after the verifier accepts the payment", async () => {
  const verify = vi.fn().mockResolvedValue({ valid: true });
  const handle = createPremiumHandler({ payTo, verify });
  const txHash = `0x${"ab".repeat(32)}`;

  const response = await handle(new Request("https://agentpay.example/api/premium", {
    headers: { "X-Payment-Tx": txHash },
  }));

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    premiumData: "Here's your premium data — paid, verified, and unlocked by AgentPay.",
    paidWith: "USDC",
    network: "base",
    txHash,
  });
  expect(verify).toHaveBeenCalledWith(txHash);
});

test.each(["insufficient_payment", "transaction_replayed"] as const)(
  "returns 403 when payment verification fails with %s",
  async (reason) => {
    const handle = createPremiumHandler({
      payTo,
      verify: vi.fn().mockResolvedValue({ valid: false, reason, retryable: false }),
    });

    const response = await handle(new Request("https://agentpay.example/api/premium", {
      headers: { "X-Payment-Tx": `0x${"ab".repeat(32)}` },
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Invalid Payment", reason });
  },
);

test("returns retryable 503 when the receipt is not ready", async () => {
  const handle = createPremiumHandler({
    payTo,
    verify: vi.fn().mockResolvedValue({
      valid: false,
      reason: "insufficient_confirmations",
      retryable: true,
    }),
  });

  const response = await handle(new Request("https://agentpay.example/api/premium", {
    headers: { "X-Payment-Tx": `0x${"ab".repeat(32)}` },
  }));

  expect(response.status).toBe(503);
  expect(response.headers.get("retry-after")).toBe("2");
  await expect(response.json()).resolves.toEqual({
    error: "Payment Verification Unavailable",
    reason: "insufficient_confirmations",
  });
});

test("fails closed when the verifier throws", async () => {
  const handle = createPremiumHandler({
    payTo,
    verify: vi.fn().mockRejectedValue(new Error("RPC secret must not leak")),
  });

  const response = await handle(new Request("https://agentpay.example/api/premium", {
    headers: { "X-Payment-Tx": `0x${"ab".repeat(32)}` },
  }));

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({
    error: "Payment Verification Unavailable",
    reason: "verification_unavailable",
  });
});
