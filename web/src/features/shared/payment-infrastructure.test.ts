import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildGatewayInfrastructure,
  getSharedGatewayInfrastructure,
  resetSharedGatewayInfrastructure,
  type GatewayInfrastructureDependencies,
} from "./payment-infrastructure";

const facilitator = { name: "facilitator" } as never;
const server = { name: "server" } as never;
const redis = { name: "redis" } as never;
const store = { name: "store" } as never;

function dependencies(): GatewayInfrastructureDependencies {
  return {
    createFacilitator: vi.fn(() => facilitator),
    createServer: vi.fn(() => server),
    createRedisClient: vi.fn(() => redis),
    createStore: vi.fn(() => store),
  };
}

const config = {
  facilitatorUrl: "https://facilitator.example",
  redisUrl: "redis://cache.example:6379",
} as const;

afterEach(() => {
  resetSharedGatewayInfrastructure();
});

describe("buildGatewayInfrastructure", () => {
  it("creates a facilitator, server, redis client and store", async () => {
    const deps = dependencies();
    const infrastructure = await buildGatewayInfrastructure(config, deps);

    expect(infrastructure.server).toBe(server);
    expect(infrastructure.store).toBe(store);
    expect(deps.createFacilitator).toHaveBeenCalledWith(config.facilitatorUrl);
    expect(deps.createServer).toHaveBeenCalledWith(facilitator);
    expect(deps.createRedisClient).toHaveBeenCalledWith(config.redisUrl);
    expect(deps.createStore).toHaveBeenCalledWith(redis);
  });

  it("configures the gateway resource server before exposing it", async () => {
    const deps = dependencies();
    const configureServer = vi.fn();
    await buildGatewayInfrastructure({ ...config, configureServer }, deps);

    expect(configureServer).toHaveBeenCalledWith(server);
  });
});

describe("getSharedGatewayInfrastructure", () => {
  it("returns the same instance for repeated calls", async () => {
    const deps = dependencies();
    const first = await getSharedGatewayInfrastructure(config, deps);
    const second = await getSharedGatewayInfrastructure(config, deps);

    expect(first).toBe(second);
    expect(deps.createFacilitator).toHaveBeenCalledTimes(1);
  });

  it("builds a fresh instance after reset", async () => {
    const first = await getSharedGatewayInfrastructure(config, dependencies());
    resetSharedGatewayInfrastructure();
    const second = await getSharedGatewayInfrastructure(config, dependencies());

    expect(first).not.toBe(second);
  });
});
