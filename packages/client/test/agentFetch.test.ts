import type { Hash, Hex } from "viem";
import { describe, expect, test, vi } from "vitest";

import {
  createAgentFetch,
  type PaymentRuntime,
  USDC_BASE_SEPOLIA,
  X402PaymentError,
  X402ProtocolError,
} from "../src/index.js";

const privateKey = `0x${"11".repeat(32)}` as Hex;
const rpcUrl = "https://rpc.example";
const payTo = "0x1111111111111111111111111111111111111111";
const hash = `0x${"ab".repeat(32)}` as Hash;

function paymentRequired(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 402,
    headers: { "content-type": "application/json" },
  });
}

function dependenciesFor() {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const createPaymentRuntime = vi.fn();
  return { dependencies: { fetch, createPaymentRuntime }, fetch, createPaymentRuntime };
}

function validPaymentRequirement(overrides: Record<string, unknown> = {}) {
  return {
    error: "Payment Required",
    priceUsdc: "0.01",
    payTo: "0x1111111111111111111111111111111111111111",
    network: "base-sepolia",
    chainId: 84532,
    ...overrides,
  };
}

function paymentRuntime(overrides: Partial<PaymentRuntime> = {}): PaymentRuntime {
  return {
    getChainId: vi.fn().mockResolvedValue(84532),
    transferUsdc: vi.fn().mockResolvedValue(hash),
    waitForReceipt: vi.fn().mockResolvedValue({ status: "success" }),
    ...overrides,
  };
}

describe("createAgentFetch", () => {
  test("returns the original non-402 response without creating a payment runtime", async () => {
    const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
    const ok = new Response(JSON.stringify({ ok: true }), { status: 200 });
    fetch.mockResolvedValueOnce(ok);
    const agentFetch = createAgentFetch({ privateKey, rpcUrl }, dependencies);

    await expect(agentFetch("https://vendor.example/data")).resolves.toBe(ok);
    expect(createPaymentRuntime).not.toHaveBeenCalled();
  });

  test.each([
    ["invalid JSON", new Response("{", { status: 402 }), "invalid_payment_response"],
    ["missing price", paymentRequired({ ...validPaymentRequirement(), priceUsdc: undefined }), "invalid_payment_response"],
    ["malformed payTo", paymentRequired(validPaymentRequirement({ payTo: "not-an-address" })), "invalid_payment_response"],
    ["unsupported chain", paymentRequired(validPaymentRequirement({ chainId: 1, network: "ethereum" })), "unsupported_chain"],
    ["network mismatch", paymentRequired(validPaymentRequirement({ network: "base" })), "network_mismatch"],
    ["zero price", paymentRequired(validPaymentRequirement({ priceUsdc: "0" })), "invalid_payment_response"],
    ["price with more than six decimals", paymentRequired(validPaymentRequirement({ priceUsdc: "0.0000001" })), "invalid_payment_response"],
    ["price above cap", paymentRequired(validPaymentRequirement({ priceUsdc: "1.01" })), "payment_limit_exceeded"],
  ] as const)("rejects a 402 with %s", async (_name, response, code) => {
    const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
    fetch.mockResolvedValueOnce(response);
    const agentFetch = createAgentFetch(
      { privateKey, rpcUrl, maxPaymentUsdc: "1.00" },
      dependencies,
    );

    await expect(agentFetch("https://vendor.example/data")).rejects.toMatchObject<Partial<X402ProtocolError>>({
      name: "X402ProtocolError",
      code,
    });
    expect(createPaymentRuntime).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("pays the validated USDC requirement then retries the original request with its transaction hash", async () => {
    const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
    const runtime = paymentRuntime();
    createPaymentRuntime.mockReturnValue(runtime);
    fetch
      .mockResolvedValueOnce(paymentRequired(validPaymentRequirement()))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: "paid" }), { status: 200 }));
    const agentFetch = createAgentFetch({ privateKey, rpcUrl }, dependencies);

    const response = await agentFetch("https://vendor.example/data", {
      method: "POST",
      headers: { "content-type": "application/json", "x-agent": "demo" },
      body: JSON.stringify({ prompt: "hello" }),
    });

    expect(response.status).toBe(200);
    expect(runtime.transferUsdc).toHaveBeenCalledWith({
      token: USDC_BASE_SEPOLIA,
      to: payTo,
      amount: 10_000n,
    });
    expect(runtime.waitForReceipt).toHaveBeenCalledWith(hash, 1);
    expect(fetch).toHaveBeenCalledTimes(2);

    const retryRequest = fetch.mock.calls[1]?.[0] as Request;
    expect(retryRequest.method).toBe("POST");
    expect(retryRequest.headers.get("content-type")).toBe("application/json");
    expect(retryRequest.headers.get("x-agent")).toBe("demo");
    expect(retryRequest.headers.get("X-Payment-Tx")).toBe(hash);
    await expect(retryRequest.text()).resolves.toBe(JSON.stringify({ prompt: "hello" }));
  });

  test("rejects a payment when the RPC chain does not match the validated requirement", async () => {
    const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
    const runtime = paymentRuntime({ getChainId: vi.fn().mockResolvedValue(8453) });
    createPaymentRuntime.mockReturnValue(runtime);
    fetch.mockResolvedValueOnce(paymentRequired(validPaymentRequirement()));
    const agentFetch = createAgentFetch({ privateKey, rpcUrl }, dependencies);

    await expect(agentFetch("https://vendor.example/data")).rejects.toMatchObject<Partial<X402PaymentError>>({
      name: "X402PaymentError",
      code: "rpc_chain_mismatch",
    });
    expect(runtime.transferUsdc).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("wraps a failed USDC transfer in a typed payment error", async () => {
    const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
    const cause = new Error("wallet rejected transfer");
    const runtime = paymentRuntime({ transferUsdc: vi.fn().mockRejectedValue(cause) });
    createPaymentRuntime.mockReturnValue(runtime);
    fetch.mockResolvedValueOnce(paymentRequired(validPaymentRequirement()));
    const agentFetch = createAgentFetch({ privateKey, rpcUrl }, dependencies);

    await expect(agentFetch("https://vendor.example/data")).rejects.toMatchObject<Partial<X402PaymentError>>({
      name: "X402PaymentError",
      code: "transfer_failed",
      cause,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("rejects a reverted payment receipt without retrying the request", async () => {
    const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
    const runtime = paymentRuntime({ waitForReceipt: vi.fn().mockResolvedValue({ status: "reverted" }) });
    createPaymentRuntime.mockReturnValue(runtime);
    fetch.mockResolvedValueOnce(paymentRequired(validPaymentRequirement()));
    const agentFetch = createAgentFetch({ privateKey, rpcUrl }, dependencies);

    await expect(agentFetch("https://vendor.example/data")).rejects.toMatchObject<Partial<X402PaymentError>>({
      name: "X402PaymentError",
      code: "transaction_failed",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("returns a second HTTP 402 response without submitting a second transfer", async () => {
    const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
    const runtime = paymentRuntime();
    createPaymentRuntime.mockReturnValue(runtime);
    const retryPaymentRequired = paymentRequired(validPaymentRequirement());
    fetch
      .mockResolvedValueOnce(paymentRequired(validPaymentRequirement()))
      .mockResolvedValueOnce(retryPaymentRequired);
    const agentFetch = createAgentFetch({ privateKey, rpcUrl }, dependencies);

    await expect(agentFetch("https://vendor.example/data")).resolves.toBe(retryPaymentRequired);
    expect(runtime.transferUsdc).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("does not create a payment runtime when authorization rejects", async () => {
    const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
    const authorizePayment = vi.fn().mockReturnValue(false);
    fetch.mockResolvedValueOnce(paymentRequired(validPaymentRequirement()));
    const agentFetch = createAgentFetch({ privateKey, rpcUrl, authorizePayment }, dependencies);

    await expect(agentFetch("https://vendor.example/data")).rejects.toMatchObject({
      name: "X402ProtocolError",
      code: "payment_not_authorized",
    });
    expect(authorizePayment).toHaveBeenCalledOnce();
    expect(createPaymentRuntime).not.toHaveBeenCalled();
  });

  test.each([
    ["throws", vi.fn(() => { throw new Error("policy unavailable"); })],
    ["rejects", vi.fn().mockRejectedValue(new Error("policy unavailable"))],
  ])("does not create a payment runtime when authorization %s", async (_name, authorizePayment) => {
    const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
    fetch.mockResolvedValueOnce(paymentRequired(validPaymentRequirement()));
    const agentFetch = createAgentFetch({ privateKey, rpcUrl, authorizePayment }, dependencies);

    await expect(agentFetch("https://vendor.example/data")).rejects.toMatchObject({
      name: "X402ProtocolError",
      code: "payment_not_authorized",
      cause: expect.any(Error),
    });
    expect(createPaymentRuntime).not.toHaveBeenCalled();
  });

  test("authorizes the normalized requirement before constructing the runtime", async () => {
    const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
    const runtime = paymentRuntime();
    const authorizePayment = vi.fn().mockReturnValue(true);
    createPaymentRuntime.mockReturnValue(runtime);
    fetch
      .mockResolvedValueOnce(paymentRequired(validPaymentRequirement()))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const agentFetch = createAgentFetch({ privateKey, rpcUrl, authorizePayment }, dependencies);
    await agentFetch("https://vendor.example/data");

    expect(authorizePayment).toHaveBeenCalledWith({
      requestUrl: "https://vendor.example/data",
      chainId: 84532,
      network: "base-sepolia",
      payTo,
      token: USDC_BASE_SEPOLIA,
      priceUsdc: "0.01",
      amount: 10_000n,
    });
    expect(authorizePayment.mock.invocationCallOrder[0]).toBeLessThan(
      createPaymentRuntime.mock.invocationCallOrder[0]!,
    );
  });

  test("reports the transaction hash before waiting for its receipt", async () => {
    const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
    const runtime = paymentRuntime();
    const onTransactionSubmitted = vi.fn();
    createPaymentRuntime.mockReturnValue(runtime);
    fetch
      .mockResolvedValueOnce(paymentRequired(validPaymentRequirement()))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    await createAgentFetch({ privateKey, rpcUrl, onTransactionSubmitted }, dependencies)(
      "https://vendor.example/data",
    );

    expect(onTransactionSubmitted).toHaveBeenCalledWith(expect.objectContaining({
      hash,
      chainId: 84532,
      token: USDC_BASE_SEPOLIA,
      payTo,
      amount: 10_000n,
    }));
    expect(onTransactionSubmitted.mock.invocationCallOrder[0]).toBeLessThan(
      (runtime.waitForReceipt as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
    );
  });

  test("continues confirmation and retry when transaction notification throws", async () => {
    const { dependencies, fetch, createPaymentRuntime } = dependenciesFor();
    const runtime = paymentRuntime();
    createPaymentRuntime.mockReturnValue(runtime);
    fetch
      .mockResolvedValueOnce(paymentRequired(validPaymentRequirement()))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const response = await createAgentFetch({
      privateKey,
      rpcUrl,
      onTransactionSubmitted: () => { throw new Error("observer failed"); },
    }, dependencies)("https://vendor.example/data");

    expect(response.status).toBe(200);
    expect(runtime.waitForReceipt).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
