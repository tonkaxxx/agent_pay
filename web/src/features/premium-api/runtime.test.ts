import type { FacilitatorClient, PaymentRequestHandler } from "@agentpay/server";
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

test("builds the paid handler with CDP, exact Base USDC, discovery, and outer idempotency", async () => {
  const facilitator = { kind: "facilitator" } as unknown as FacilitatorClient;
  const redisClient = { eval: vi.fn() };
  const resourceServer = { kind: "resource-server" };
  const protectedHandler: PaymentRequestHandler = vi.fn().mockResolvedValue(
    new Response("{}", { status: 402 }),
  );
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
  expect(createRoute).toHaveBeenCalledWith(expect.objectContaining({
    network: "eip155:8453",
    priceUsdc: "0.01",
    payTo: config.payTo,
    paymentIdentifier: "required",
    discovery: { outputExample: expect.objectContaining({ protocol: "x402-v2" }) },
  }));
  expect(protect).toHaveBeenCalledWith(expect.any(Function), {
    accepts: {},
    resource: "https://agentpay.example/api/premium",
  }, resourceServer);

  const response = await handler(new Request("https://agentpay.example/api/premium"));
  expect(response.status).toBe(402);
  expect(protectedHandler).toHaveBeenCalledOnce();
  expect(redisClient.eval).not.toHaveBeenCalled();
});
