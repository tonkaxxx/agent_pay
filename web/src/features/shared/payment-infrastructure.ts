import {
  createAgentPayResourceServer,
  RedisAuthorizationStore,
  type RedisEvalClient,
} from "@agentpay/server";
import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/http";
import type { x402ResourceServer } from "@x402/core/server";

import { createAuthorizationRedisClient } from "@/features/premium-api/redis-client";

export interface GatewayPaymentInfrastructure {
  readonly server: x402ResourceServer;
  readonly store: RedisAuthorizationStore;
}

export interface GatewayInfrastructureConfig {
  readonly facilitatorUrl: string;
  readonly redisUrl: string;
  readonly configureServer?: (server: x402ResourceServer) => void;
}

export interface GatewayInfrastructureDependencies {
  createFacilitator(url: string): FacilitatorClient;
  createServer(facilitator: FacilitatorClient): x402ResourceServer;
  createRedisClient(url: string): RedisEvalClient;
  createStore(redis: RedisEvalClient): RedisAuthorizationStore;
}

const defaultDependencies: GatewayInfrastructureDependencies = {
  createFacilitator: url => new HTTPFacilitatorClient({ url, timeoutMs: 120_000 }),
  createServer: createAgentPayResourceServer,
  createRedisClient: url => createAuthorizationRedisClient(url) as unknown as RedisEvalClient,
  createStore: redis => new RedisAuthorizationStore(redis),
};

let shared: Promise<GatewayPaymentInfrastructure> | undefined;

export async function getSharedGatewayInfrastructure(
  config: GatewayInfrastructureConfig,
  dependencies: GatewayInfrastructureDependencies = defaultDependencies,
): Promise<GatewayPaymentInfrastructure> {
  shared ??= buildGatewayInfrastructure(config, dependencies);
  return shared;
}

export function buildGatewayInfrastructure(
  config: GatewayInfrastructureConfig,
  dependencies: GatewayInfrastructureDependencies,
): Promise<GatewayPaymentInfrastructure> {
  return Promise.resolve().then(() => {
    const facilitator = dependencies.createFacilitator(config.facilitatorUrl);
    const server = dependencies.createServer(facilitator);
    config.configureServer?.(server);
    const redis = dependencies.createRedisClient(config.redisUrl);
    return {
      server,
      store: dependencies.createStore(redis),
    };
  });
}

export function resetSharedGatewayInfrastructure(): void {
  shared = undefined;
}
