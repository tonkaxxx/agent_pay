import { afterEach, expect, test, vi } from "vitest";

import { createPremiumRoute } from "./route-handler";

afterEach(() => vi.restoreAllMocks());

test("delegates requests to the configured premium handler", async () => {
  const response = Response.json({ ok: true });
  const handler = vi.fn().mockResolvedValue(response);
  const getHandler = vi.fn().mockResolvedValue(handler);
  const route = createPremiumRoute(getHandler, { requestId: () => "request-1" });
  const request = new Request("https://agentpay.example/api/premium");

  await expect(route(request)).resolves.toBe(response);
  expect(handler).toHaveBeenCalledWith(request);
});

test("returns a closed 503 when API configuration cannot be loaded", async () => {
  const log = vi.fn();
  const route = createPremiumRoute(
    vi.fn().mockRejectedValue(new Error("REDIS_URL contains a secret")),
    { requestId: () => "request-2", log },
  );

  const response = await route(new Request("https://agentpay.example/api/premium"));

  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-request-id")).toBe("request-2");
  await expect(response.json()).resolves.toEqual({
    error: "Service Unavailable",
    reason: "configuration_unavailable",
  });
  expect(log).toHaveBeenCalledWith({
    requestId: "request-2",
    route: "/api/premium",
    stage: "configuration",
    status: 503,
    reason: "configuration_unavailable",
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
});

test("maps runtime failures to a stable infrastructure response", async () => {
  const log = vi.fn();
  const route = createPremiumRoute(
    vi.fn().mockResolvedValue(vi.fn().mockRejectedValue(new Error("facilitator secret"))),
    { requestId: () => "request-3", log },
  );

  const response = await route(new Request("https://agentpay.example/api/premium"));

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({
    error: "Service Unavailable",
    reason: "payment_infrastructure_unavailable",
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
});

test("preserves official 402 challenges and their protocol header", async () => {
  const challenge = Response.json({ error: "Payment Required" }, {
    status: 402,
    headers: { "PAYMENT-REQUIRED": "encoded-v2-challenge" },
  });
  const route = createPremiumRoute(
    vi.fn().mockResolvedValue(vi.fn().mockResolvedValue(challenge)),
  );

  const response = await route(new Request("https://agentpay.example/api/premium"));
  expect(response).toBe(challenge);
});

test("maps opaque SDK failures but preserves confirmed settlement failure", async () => {
  const opaque = createPremiumRoute(
    vi.fn().mockResolvedValue(vi.fn().mockResolvedValue(
      Response.json({}, { status: 402 }),
    )),
  );
  const settlement = createPremiumRoute(
    vi.fn().mockResolvedValue(vi.fn().mockResolvedValue(
      Response.json({ error: "Bad Gateway", reason: "settlement_failed" }, { status: 402 }),
    )),
  );

  const opaqueResponse = await opaque(new Request("https://agentpay.example/api/premium"));
  expect(opaqueResponse.status).toBe(503);
  await expect(opaqueResponse.json()).resolves.toMatchObject({
    reason: "payment_infrastructure_unavailable",
  });

  const settlementResponse = await settlement(new Request("https://agentpay.example/api/premium"));
  expect(settlementResponse.status).toBe(502);
  await expect(settlementResponse.json()).resolves.toEqual({
    error: "Bad Gateway",
    reason: "settlement_failed",
  });
});
