import type { FacilitatorClient } from "@x402/core/server";
import { expect, test, vi } from "vitest";

import {
  BASE_NETWORK,
  BASE_USDC,
  createAgentPayResourceServer,
  createPremiumRoute,
} from "../src/index.js";

const PAY_TO = "0x1111111111111111111111111111111111111111" as const;
const RESOURCE = "https://agentpay.example/api/premium";

function facilitator(): FacilitatorClient {
  return {
    getSupported: vi.fn().mockResolvedValue({
      kinds: [{ x402Version: 2, scheme: "exact", network: BASE_NETWORK }],
      extensions: [],
      signers: { "eip155:*": ["0x2222222222222222222222222222222222222222"] },
    }),
    verify: vi.fn(),
    settle: vi.fn(),
  };
}

test("registers only the Base Mainnet exact server scheme", async () => {
  const client = facilitator();
  const server = createAgentPayResourceServer(client);

  await expect(server.initialize()).resolves.toBeUndefined();
  expect(client.getSupported).toHaveBeenCalledOnce();
  expect(BASE_NETWORK).toBe("eip155:8453");
  expect(BASE_USDC).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
});

test("builds the canonical compact premium route without extensions", async () => {
  const route = createPremiumRoute(PAY_TO, RESOURCE);

  expect(route).toEqual({
    accepts: {
      scheme: "exact",
      network: "eip155:8453",
      price: "$0.01",
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
    },
    resource: "https://agentpay.example/api/premium",
    description: "AgentPay premium API",
    mimeType: "application/json",
    unpaidResponseBody: expect.any(Function),
    settlementFailedResponseBody: expect.any(Function),
  });
  expect(route.extensions).toBeUndefined();

  const unpaid = await route.unpaidResponseBody?.({} as never);
  expect(unpaid).toEqual({
    contentType: "application/json",
    body: {
      error: "Payment Required",
      x402Version: 2,
      priceUsdc: "0.01",
      network: "eip155:8453",
    },
  });
  expect(JSON.stringify(unpaid)).not.toContain("premiumData");

  const failed = await route.settlementFailedResponseBody?.({} as never, {} as never);
  expect(failed).toEqual({
    contentType: "application/json",
    body: { error: "Bad Gateway", reason: "settlement_failed" },
  });
});

test("rejects non-canonical resources and invalid recipients", () => {
  expect(() => createPremiumRoute(PAY_TO, `${RESOURCE}#fragment`)).toThrow(
    "resource must be a canonical HTTP(S) URL",
  );
  expect(() => createPremiumRoute("not-an-address" as never, RESOURCE)).toThrow(
    "payTo must be a valid EVM address",
  );
});
