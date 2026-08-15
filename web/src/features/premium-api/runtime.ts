import {
  PREMIUM_PAYMENT_POLICY,
  RedisAuthorizationStore,
  createAgentPayResourceServer,
  createPremiumRoute,
  withAuthorizationLock,
  type PaymentRequestHandler,
  type RedisEvalClient,
} from "@agentpay/server";
import {
  HTTPFacilitatorClient,
  type FacilitatorClient,
  type RouteConfig,
} from "@x402/core/http";
import type { x402ResourceServer } from "@x402/core/server";
import { withX402 } from "@x402/next";
import type { NextRequest, NextResponse } from "next/server";
import { createClient } from "redis";

import type { PremiumConfig } from "./config";
import { createPremiumHandler } from "./handler";

interface PremiumRuntimeDependencies {
  createFacilitator(config: { url: string; timeoutMs: number }): FacilitatorClient;
  createServer(facilitator: FacilitatorClient): x402ResourceServer;
  createRoute(payTo: PremiumConfig["payTo"], resource: string): RouteConfig;
  createRedisClient(redisUrl: string): RedisEvalClient;
  createStore(redis: RedisEvalClient): RedisAuthorizationStore;
  createPaidHandler(): (request: NextRequest) => Promise<NextResponse>;
  protect(
    handler: (request: NextRequest) => Promise<NextResponse>,
    route: RouteConfig,
    server: x402ResourceServer,
  ): (request: NextRequest) => Promise<NextResponse>;
  guard: typeof withAuthorizationLock;
}

const defaultDependencies: PremiumRuntimeDependencies = {
  createFacilitator: config => new HTTPFacilitatorClient(config),
  createServer: createAgentPayResourceServer,
  createRoute: createPremiumRoute,
  createRedisClient: redisUrl => createClient({ url: redisUrl }) as unknown as RedisEvalClient,
  createStore: redis => new RedisAuthorizationStore(redis),
  createPaidHandler: createPremiumHandler,
  protect: withX402,
  guard: withAuthorizationLock,
};

export function buildPremiumHandler(
  config: PremiumConfig,
  dependencies: PremiumRuntimeDependencies = defaultDependencies,
): PaymentRequestHandler {
  const facilitator = dependencies.createFacilitator({
    url: config.facilitatorUrl,
    timeoutMs: 120_000,
  });
  const server = dependencies.createServer(facilitator);
  const route = dependencies.createRoute(config.payTo, config.resourceUrl);
  const paid = dependencies.protect(dependencies.createPaidHandler(), route, server);
  const redis = dependencies.createRedisClient(config.redisUrl);

  return dependencies.guard(
    request => paid(request as NextRequest),
    {
      store: dependencies.createStore(redis),
      policy: {
        resource: config.resourceUrl,
        network: PREMIUM_PAYMENT_POLICY.network,
        asset: PREMIUM_PAYMENT_POLICY.asset,
        payTo: config.payTo,
        amount: PREMIUM_PAYMENT_POLICY.amountAtomic,
      },
    },
  );
}
