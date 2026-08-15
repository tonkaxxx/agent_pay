import {
  RedisAuthorizationStore,
  createAgentPayResourceServer,
  createPremiumRoute,
  withAuthorizationLock,
} from "@agentpay/server";
import { decodePaymentRequiredHeader, type FacilitatorClient } from "@x402/core/http";
import { withX402 } from "@x402/next";
import { NextRequest } from "next/server";
import { expect, test, vi } from "vitest";

import type { PremiumConfig } from "./config";
import { createPremiumHandler } from "./handler";
import { buildPremiumHandler } from "./runtime";

const config: PremiumConfig = {
  siteUrl: "https://agentpay.example/",
  resourceUrl: "https://agentpay.example/api/premium",
  payTo: "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB",
  facilitatorUrl: "http://facilitator:4022/",
  redisUrl: "redis://redis:6379",
};
const legacyReceiptHeader = ["X", "Payment", "Tx"].join("-");

test("composes official x402 protection before the authorization guard", () => {
  const facilitator = { kind: "facilitator" };
  const server = { kind: "server", registerExtension: vi.fn() };
  const route = { kind: "route" };
  const redis = { kind: "redis" };
  const store = { kind: "store" };
  const paidContent = vi.fn();
  const protectedHandler = vi.fn();
  const finalHandler = vi.fn();

  const dependencies = {
    createFacilitator: vi.fn(() => facilitator),
    createServer: vi.fn(() => server),
    createRoute: vi.fn(() => route),
    createRedisClient: vi.fn(() => redis),
    createStore: vi.fn(() => store),
    createPaidHandler: vi.fn(() => paidContent),
    protect: vi.fn(() => protectedHandler),
    guard: vi.fn(() => finalHandler),
  };

  expect(buildPremiumHandler(config, dependencies as never)).toBe(finalHandler);
  expect(dependencies.createFacilitator).toHaveBeenCalledWith({
    url: "http://facilitator:4022/",
    timeoutMs: 120_000,
  });
  expect(dependencies.createServer).toHaveBeenCalledWith(facilitator);
  expect(dependencies.createRoute).toHaveBeenCalledWith(config.payTo, config.resourceUrl);
  expect(dependencies.createRedisClient).toHaveBeenCalledWith(config.redisUrl);
  expect(dependencies.createStore).toHaveBeenCalledWith(redis);
  expect(dependencies.protect).toHaveBeenCalledWith(paidContent, route, server);
  expect(dependencies.guard).toHaveBeenCalledWith(
    expect.any(Function),
    {
      store,
      policy: {
        resource: config.resourceUrl,
        network: "eip155:8453",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        payTo: config.payTo,
        amount: "10000",
      },
    },
  );
  expect(dependencies.protect.mock.invocationCallOrder[0])
    .toBeLessThan(dependencies.guard.mock.invocationCallOrder[0] ?? 0);
  expect(server.registerExtension).not.toHaveBeenCalled();
  const argumentsPassed = Object.values(dependencies).flatMap(mock => mock.mock.calls);
  expect(JSON.stringify(argumentsPassed)).not.toContain("PRIVATE_KEY");
  expect(JSON.stringify(argumentsPassed)).not.toContain("rpcUrl");
});

test("returns a compact standard v2 challenge and ignores legacy receipt hashes", async () => {
  const facilitator = {
    getSupported: vi.fn(async () => ({
      kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }],
      extensions: [],
      signers: {},
    })),
    verify: vi.fn(),
    settle: vi.fn(),
  } as unknown as FacilitatorClient;
  const redis = { eval: vi.fn() };
  const handler = buildPremiumHandler(config, {
    createFacilitator: () => facilitator,
    createServer: createAgentPayResourceServer,
    createRoute: createPremiumRoute,
    createRedisClient: () => redis,
    createStore: client => new RedisAuthorizationStore(client),
    createPaidHandler: createPremiumHandler,
    protect: withX402,
    guard: withAuthorizationLock,
  });

  const response = await handler(new NextRequest(config.resourceUrl, {
    headers: { [legacyReceiptHeader]: `0x${"ab".repeat(32)}` },
  }));

  expect(response.status).toBe(402);
  await expect(response.clone().json()).resolves.toEqual({
    error: "Payment Required",
    x402Version: 2,
    priceUsdc: "0.01",
    network: "eip155:8453",
  });
  const encoded = response.headers.get("PAYMENT-REQUIRED");
  expect(encoded).not.toBeNull();
  const challenge = decodePaymentRequiredHeader(encoded!);
  expect(challenge.x402Version).toBe(2);
  expect(challenge.accepts).toHaveLength(1);
  expect(challenge.accepts[0]).toMatchObject({
    scheme: "exact",
    network: "eip155:8453",
    amount: "10000",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: config.payTo,
  });
  expect(JSON.stringify(challenge)).not.toContain("bazaar");
  expect(JSON.stringify(challenge)).not.toContain("premiumData");
  expect(facilitator.verify).not.toHaveBeenCalled();
  expect(facilitator.settle).not.toHaveBeenCalled();
  expect(redis.eval).not.toHaveBeenCalled();
});
