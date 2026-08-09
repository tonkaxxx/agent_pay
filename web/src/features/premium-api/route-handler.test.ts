import { expect, test, vi } from "vitest";

import { createPremiumRoute } from "./route-handler";

test("delegates requests to the configured premium handler", async () => {
  const response = Response.json({ ok: true });
  const handler = vi.fn().mockResolvedValue(response);
  const getHandler = vi.fn().mockResolvedValue(handler);
  const route = createPremiumRoute(getHandler);
  const request = new Request("https://agentpay.example/api/premium");

  await expect(route(request)).resolves.toBe(response);
  expect(handler).toHaveBeenCalledWith(request);
});

test("returns a closed 503 when API configuration cannot be loaded", async () => {
  const route = createPremiumRoute(
    vi.fn().mockRejectedValue(new Error("REDIS_URL contains a secret")),
  );

  const response = await route(new Request("https://agentpay.example/api/premium"));

  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    error: "Service Unavailable",
    reason: "configuration_unavailable",
  });
});
