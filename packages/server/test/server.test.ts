import type { FacilitatorClient } from "@x402/core/server";
import { describe, expect, test, vi } from "vitest";

import {
  createAgentPayResourceServer,
  createAgentPayRoute,
  paymentMiddleware,
  USDC_BASE,
  USDC_BASE_SEPOLIA,
} from "../src/index.js";

const payTo = "0x1111111111111111111111111111111111111111" as const;

function facilitator(): FacilitatorClient {
  return {
    verify: vi.fn().mockResolvedValue({ isValid: true, payer: payTo }),
    settle: vi.fn().mockResolvedValue({
      success: true,
      payer: payTo,
      transaction: `0x${"ab".repeat(32)}`,
      network: "eip155:84532",
    }),
    getSupported: vi.fn().mockResolvedValue({
      kinds: [
        { x402Version: 2, scheme: "exact", network: "eip155:8453" },
        { x402Version: 2, scheme: "exact", network: "eip155:84532" },
      ],
      extensions: ["payment-identifier"],
      signers: {},
    }),
  };
}

describe("AgentPay x402 resource server", () => {
  test("registers exact EVM and extensions for every configured Base network", () => {
    const server = createAgentPayResourceServer({
      facilitator: facilitator(),
      networks: ["eip155:8453", "eip155:84532"],
    });

    expect(server.hasRegisteredScheme("eip155:8453", "exact")).toBe(true);
    expect(server.hasRegisteredScheme("eip155:84532", "exact")).toBe(true);
    expect(server.hasExtension("payment-identifier")).toBe(true);
    expect(server.hasExtension("bazaar")).toBe(true);
  });

  test("rejects an empty or unsupported network list", () => {
    expect(() => createAgentPayResourceServer({
      facilitator: facilitator(),
      networks: [] as never,
    })).toThrow(/network/i);
    expect(() => createAgentPayResourceServer({
      facilitator: facilitator(),
      networks: ["eip155:1"] as never,
    })).toThrow(/network/i);
  });

  test("creates an exact USDC route with optional Payment Identifier by default", () => {
    const route = createAgentPayRoute({
      network: "eip155:84532",
      priceUsdc: "0.010000",
      payTo,
      description: "Premium data",
      mimeType: "application/json",
    });

    expect(route).toMatchObject({
      accepts: {
        scheme: "exact",
        network: "eip155:84532",
        price: "$0.01",
        payTo,
      },
      description: "Premium data",
      mimeType: "application/json",
      extensions: {
        "payment-identifier": { info: { required: false } },
      },
    });
  });

  test("uses official USDC defaults for both supported networks", () => {
    expect(USDC_BASE).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(USDC_BASE_SEPOLIA).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
  });

  test("can require or disable Payment Identifier", () => {
    const required = createAgentPayRoute({
      network: "eip155:8453",
      priceUsdc: "0.01",
      payTo,
      description: "Required ID",
      paymentIdentifier: "required",
    });
    const disabled = createAgentPayRoute({
      network: "eip155:8453",
      priceUsdc: "0.01",
      payTo,
      description: "No ID",
      paymentIdentifier: false,
    });

    expect(required.extensions?.["payment-identifier"]).toMatchObject({
      info: { required: true },
    });
    expect(disabled.extensions?.["payment-identifier"]).toBeUndefined();
  });

  test("adds a Bazaar discovery output example", () => {
    const route = createAgentPayRoute({
      network: "eip155:84532",
      priceUsdc: "0.01",
      payTo,
      description: "Discoverable API",
      discovery: { outputExample: { data: "premium" } },
    });

    expect(route.extensions?.bazaar).toMatchObject({
      info: { output: { example: { data: "premium" } } },
    });
  });

  test.each(["0", "-1", "0.0000001", "1e-2", "not-money"])(
    "rejects an invalid USDC price %s",
    priceUsdc => {
      expect(() => createAgentPayRoute({
        network: "eip155:84532",
        priceUsdc,
        payTo,
        description: "Invalid",
      })).toThrow(/priceUsdc/);
    },
  );

  test("re-exports the official Express middleware", () => {
    expect(paymentMiddleware).toBeTypeOf("function");
  });

  test("fails verification when a route requires a missing Payment Identifier", async () => {
    const server = createAgentPayResourceServer({
      facilitator: facilitator(),
      networks: ["eip155:84532"],
    });
    await server.initialize();
    const requirements = {
      scheme: "exact",
      network: "eip155:84532" as const,
      asset: USDC_BASE_SEPOLIA,
      amount: "10000",
      payTo,
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    };

    await expect(server.verifyPayment({
      x402Version: 2,
      accepted: requirements,
      payload: {},
    }, requirements, {
      "payment-identifier": {
        info: { required: true },
        schema: {},
      },
    })).resolves.toMatchObject({
      isValid: false,
      invalidReason: "payment_identifier_required",
    });
  });
});
