import { createFacilitatorConfig } from "@coinbase/x402";
import {
  HTTPFacilitatorClient,
  RedisPaymentIdempotencyStore,
  createAgentPayResourceServer,
  createAgentPayRoute,
  withPaymentIdempotency,
  type FacilitatorClient,
  type PaymentRequestHandler,
  type RedisEvalClient,
  type RouteConfig,
  type x402ResourceServer,
} from "@agentpay/server";
import { withX402 } from "@x402/next";
import { createClient } from "redis";
import type { NextRequest } from "next/server";

import type { PremiumConfig } from "./config";
import { createPremiumHandler } from "./handler";
import { withLegacyPaymentRequired } from "./payment-required-response";

interface PremiumRuntimeDependencies {
  createFacilitator(config: PremiumConfig): FacilitatorClient;
  createRedisClient(redisUrl: string): RedisEvalClient;
  createResourceServer: typeof createAgentPayResourceServer;
  createRoute: typeof createAgentPayRoute;
  protect(
    handler: ReturnType<typeof createPremiumHandler>,
    route: RouteConfig,
    server: x402ResourceServer,
  ): PaymentRequestHandler;
}

const defaultDependencies: PremiumRuntimeDependencies = {
  createFacilitator: config => config.offlineQuoteOnly
    ? {
      getSupported: async () => ({
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }],
        extensions: ["payment-identifier"],
        signers: {},
      }),
      verify: async () => { throw new Error("Quote-only facilitator cannot verify payments."); },
      settle: async () => { throw new Error("Quote-only facilitator cannot settle payments."); },
    }
    : new HTTPFacilitatorClient(
      createFacilitatorConfig(config.cdpApiKeyId, config.cdpApiKeySecret),
    ),
  createRedisClient: redisUrl => createClient({ url: redisUrl }) as RedisEvalClient,
  createResourceServer: createAgentPayResourceServer,
  createRoute: createAgentPayRoute,
  protect: (handler, route, server) => {
    const protectedHandler = withX402(handler, route, server);
    return request => protectedHandler(request as NextRequest);
  },
};

export function buildPremiumHandler(
  config: PremiumConfig,
  dependencies: PremiumRuntimeDependencies = defaultDependencies,
): PaymentRequestHandler {
  const facilitator = dependencies.createFacilitator(config);
  const server = dependencies.createResourceServer({
    facilitator,
    networks: ["eip155:8453"],
  });
  const route = {
    ...dependencies.createRoute({
      network: "eip155:8453",
      priceUsdc: "0.01",
      payTo: config.payTo,
      description: "AgentPay premium API",
      mimeType: "application/json",
      paymentIdentifier: "required",
    }),
    resource: new URL("/api/premium", config.siteUrl).href,
  } satisfies RouteConfig;
  const paidHandler = dependencies.protect(createPremiumHandler(), route, server);
  const store = new RedisPaymentIdempotencyStore(
    dependencies.createRedisClient(config.redisUrl),
  );

  const idempotentHandler = withPaymentIdempotency(paidHandler, {
    store,
    pendingTtlSeconds: 60,
    completedTtlSeconds: 3_600,
  });
  return withLegacyPaymentRequired(idempotentHandler, {
    priceUsdc: "0.01",
    payTo: config.payTo,
    network: "base",
    chainId: 8453,
  });
}
