import type { Hex } from "viem";
import { describe, expect, test, vi } from "vitest";

import {
  createAgentFetch,
  X402ProtocolError,
} from "../src/index.js";

const privateKey = `0x${"11".repeat(32)}` as Hex;
const rpcUrl = "https://rpc.example";

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
});
