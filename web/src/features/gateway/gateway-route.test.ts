import { describe, expect, it, vi } from "vitest";

import {
  createGatewayRoute,
  type GatewayRouteDependencies,
  type GatewayRouteLogger,
} from "./gateway-route";
import { buildGatewayPolicy } from "./policy";
import type { EndpointRecord } from "./repository";

const endpoint: EndpointRecord = {
  id: "1b4e28ba-2fa1-4d9e-8d1e-5f2a1b3c4d5e",
  publicId: "9d4f2e7a-1b3c-4d5e-8f9a-0b1c2d3e4f5a",
  ownerId: "6f7e8d9c-0a1b-2c3d-4e5f-6a7b8c9d0e1f",
  displayName: "Weather API",
  upstreamUrl: "https://upstream.example/data",
  authMode: "none",
  payTo: "0x0000000000000000000000000000000000001234",
  amountAtomic: "1000000",
  status: "active",
  configVersion: 1,
  secretConfigured: false,
  lastTestStatus: null,
  lastTestHttpStatus: null,
  lastTestResponseSize: null,
  lastTestLatencyMs: null,
  lastTestAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  secretCiphertext: null,
  secretIv: null,
  secretAuthTag: null,
  secretKeyVersion: null,
};

const logger: GatewayRouteLogger = { log: vi.fn() };

function request(): Request {
  return new Request("https://gateway.example/g/9d4f2e7a-1b3c-4d5e-8f9a-0b1c2d3e4f5a");
}

function dependencies(overrides: Partial<GatewayRouteDependencies> = {}): GatewayRouteDependencies {
  return {
    requestId: () => "req-123",
    log: logger.log,
    infrastructure: vi.fn(async () => ({ server: {}, store: {} } as never)),
    loadEndpoint: vi.fn(async () => endpoint),
    buildPolicy: vi.fn(() => ({ policy: true } as never)),
    siteUrl: () => "https://gateway.example",
    createPaidHandler: vi.fn(() => async () =>
      Response.json({ data: "paid" }, { status: 200, headers: { "Content-Type": "application/json" } }),
    ),
    recordPaymentEvent: vi.fn(async () => undefined),
    protect: (handler) => handler as never,
    guard: (handler) => handler,
    ...overrides,
  };
}

describe("createGatewayRoute", () => {
  it("forwards a paid response with the request id header", async () => {
    const deps = dependencies();
    const route = createGatewayRoute(deps, logger);

    const response = await route(request() as never, endpoint.publicId);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-ID")).toBe("req-123");
    await expect(response.json()).resolves.toEqual({ data: "paid" });
    expect(deps.loadEndpoint).toHaveBeenCalledWith(endpoint.publicId);
    expect(deps.createPaidHandler).toHaveBeenCalledTimes(1);
  });

  it("does not suppress an already-produced response when event persistence fails", async () => {
    const recordPaymentEvent = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const route = createGatewayRoute(dependencies({ recordPaymentEvent }), logger);

    const response = await route(request() as never, endpoint.publicId);

    expect(response.status).toBe(200);
    expect(recordPaymentEvent).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({ data: "paid" });
  });

  it("returns 404 when the endpoint is unknown", async () => {
    const deps = dependencies({ loadEndpoint: vi.fn(async () => null) });
    const route = createGatewayRoute(deps, logger);

    const response = await route(request() as never, endpoint.publicId);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Not Found",
      reason: "endpoint_not_found",
    });
    expect(deps.createPaidHandler).not.toHaveBeenCalled();
  });

  it("returns 404 when the endpoint lookup throws", async () => {
    const deps = dependencies({ loadEndpoint: vi.fn(async () => { throw new Error("db down"); }) });
    const route = createGatewayRoute(deps, logger);

    const response = await route(request() as never, endpoint.publicId);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ reason: "endpoint_not_found" });
  });

  it("returns 503 when infrastructure fails to build", async () => {
    const deps = dependencies({
      infrastructure: vi.fn(async () => { throw new Error("redis down"); }),
    });
    const route = createGatewayRoute(deps, logger);

    const response = await route(request() as never, endpoint.publicId);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      reason: "payment_infrastructure_unavailable",
    });
  });

  it("returns 503 when the policy cannot be built", async () => {
    const deps = dependencies({
      buildPolicy: vi.fn(() => { throw new Error("bad policy"); }),
    });
    const route = createGatewayRoute(deps, logger);

    const response = await route(request() as never, endpoint.publicId);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      reason: "gateway_configuration_unavailable",
    });
  });

  it("returns 503 when the paid handler cannot be built", async () => {
    const deps = dependencies({
      createPaidHandler: vi.fn(() => { throw new Error("bad upstream"); }),
    });
    const route = createGatewayRoute(deps, logger);

    const response = await route(request() as never, endpoint.publicId);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      reason: "gateway_configuration_unavailable",
    });
  });

  it("returns 503 when the composed handler throws", async () => {
    const deps = dependencies({
      guard: vi.fn(() => async () => { throw new Error("boom"); }),
    });
    const route = createGatewayRoute(deps, logger);

    const response = await route(request() as never, endpoint.publicId);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      reason: "payment_infrastructure_unavailable",
    });
  });

  it("maps a settlement failure to a 502", async () => {
    const deps = dependencies({
      createPaidHandler: vi.fn(() => async () =>
        Response.json({ reason: "settlement_failed" }, { status: 402 }),
      ),
    });
    const route = createGatewayRoute(deps, logger);

    const response = await route(request() as never, endpoint.publicId);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Bad Gateway",
      reason: "settlement_failed",
    });
  });

  it("forwards a 402 payment challenge with the request id", async () => {
    const deps = dependencies({
      createPaidHandler: vi.fn(() => async () =>
        Response.json({ error: "Payment Required" }, {
          status: 402,
          headers: { "X-Payment-Req": "abc" },
        }),
      ),
    });
    const route = createGatewayRoute(deps, logger);

    const response = await route(request() as never, endpoint.publicId);

    expect(response.status).toBe(402);
    expect(response.headers.get("X-Request-ID")).toBe("req-123");
    expect(response.headers.get("X-Payment-Req")).toBe("abc");
  });

  it("passes the authorization policy to the guard", async () => {
    const guard = vi.fn((...args: never[]) => args[0] as never);
    const deps = dependencies({
      guard,
      buildPolicy: (record, siteUrl) => buildGatewayPolicy(record, siteUrl),
    });
    const route = createGatewayRoute(deps, logger);

    await route(request() as never, endpoint.publicId);

    const options = guard.mock.calls[0]?.[1] as unknown as { policy: { amount: string; resource: string } };
    expect(options.policy.amount).toBe("1000000");
    expect(options.policy.resource).toBe(
      "https://gateway.example/g/9d4f2e7a-1b3c-4d5e-8f9a-0b1c2d3e4f5a",
    );
  });
});
