import type { FacilitatorClient, PaymentRequestHandler } from "@agentpay/server";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { expect, test, vi } from "vitest";

vi.mock("@x402/next", () => ({ withX402: vi.fn() }));

import type { PremiumConfig } from "./config";
import { buildPremiumHandler } from "./runtime";

const config: PremiumConfig = {
  siteUrl: "https://agentpay.example/",
  payTo: "0x1111111111111111111111111111111111111111",
  redisUrl: "redis://127.0.0.1:6379",
  cdpApiKeyId: "organizations/test/apiKeys/key",
  cdpApiKeySecret: "test-secret",
  offlineQuoteOnly: false,
};

test("builds the v2 paid handler without exposing premium discovery data", async () => {
  const facilitator = { kind: "facilitator" } as unknown as FacilitatorClient;
  const redisClient = { eval: vi.fn() };
  const resourceServer = { kind: "resource-server" };
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
      payTo: config.payTo,
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2" },
    }],
    extensions: {
      "payment-identifier": { info: { required: true } },
    },
  };
  const encoded = encodePaymentRequiredHeader(paymentRequired);
  const protectedHandler: PaymentRequestHandler = vi.fn().mockResolvedValue(new Response("{}", {
    status: 402,
    headers: { "PAYMENT-REQUIRED": encoded },
  }));
  const createFacilitator = vi.fn().mockReturnValue(facilitator);
  const createRedisClient = vi.fn().mockReturnValue(redisClient);
  const createResourceServer = vi.fn().mockReturnValue(resourceServer);
  const createRoute = vi.fn().mockReturnValue({ accepts: {} });
  const protect = vi.fn().mockReturnValue(protectedHandler);

  const handler = buildPremiumHandler(config, {
    createFacilitator,
    createRedisClient,
    createResourceServer,
    createRoute,
    protect,
  } as never);

  expect(createFacilitator).toHaveBeenCalledWith(config);
  expect(createRedisClient).toHaveBeenCalledWith(config.redisUrl);
  expect(createResourceServer).toHaveBeenCalledWith({
    facilitator,
    networks: ["eip155:8453"],
  });
  const routeOptions = createRoute.mock.calls[0]?.[0];
  expect(routeOptions).toEqual(expect.objectContaining({
    network: "eip155:8453",
    priceUsdc: "0.01",
    payTo: config.payTo,
    paymentIdentifier: "required",
  }));
  expect(routeOptions).not.toHaveProperty("discovery");
  expect(protect).toHaveBeenCalledWith(expect.any(Function), {
    accepts: {},
    resource: "https://agentpay.example/api/premium",
  }, resourceServer);

  const response = await handler(new Request("https://agentpay.example/api/premium"));
  expect(response.status).toBe(402);
  expect(response.headers.get("payment-required")).toBe(encoded);
  await expect(response.json()).resolves.toEqual({
    error: "Payment Required",
    priceUsdc: "0.01",
    payTo: config.payTo,
    network: "base",
    chainId: 8453,
  });
  expect(protectedHandler).toHaveBeenCalledOnce();
  expect(redisClient.eval).not.toHaveBeenCalled();
});
