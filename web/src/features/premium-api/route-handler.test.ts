import { PaymentIdempotencyUnavailableError } from "@agentpay/server";
import { FacilitatorResponseError } from "@x402/core/http";
import { expect, test, vi } from "vitest";

import { PremiumConfigurationError, createPremiumRoute } from "./route-handler";

const request = new Request("https://agentpay.example/api/premium");
const requestId = "123e4567-e89b-42d3-a456-426614174000";

function failingRoute(error: Error) {
  const logError = vi.fn();
  return {
    logError,
    route: createPremiumRoute(vi.fn().mockRejectedValue(error), {
      requestIdFactory: () => requestId,
      logError,
    }),
  };
}

test("delegates requests to the configured premium handler", async () => {
  const response = Response.json({ ok: true });
  const handler = vi.fn().mockResolvedValue(response);
  const getHandler = vi.fn().mockResolvedValue(handler);
  const route = createPremiumRoute(getHandler);
  await expect(route(request)).resolves.toBe(response);
  expect(handler).toHaveBeenCalledWith(request);
});

test.each([
  [new PremiumConfigurationError({ cause: new Error("CDP secret") }), 503, "configuration_unavailable"],
  [new PaymentIdempotencyUnavailableError({ cause: new Error("Redis secret") }), 503, "idempotency_unavailable"],
  [new FacilitatorResponseError("CDP secret"), 502, "facilitator_unavailable"],
  [new Error("unexpected secret"), 500, "internal_error"],
] as const)("returns a safe $1 for %s", async (error, status, reason) => {
  const { route, logError } = failingRoute(error);

  const response = await route(request);

  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-request-id")).toBe(requestId);
  await expect(response.json()).resolves.toEqual({
    error: status === 502
      ? "Bad Gateway"
      : status === 500 ? "Internal Server Error" : "Service Unavailable",
    reason,
    requestId,
  });
  expect(logError).toHaveBeenCalledWith({
    event: "premium_request_failed",
    requestId,
    route: "/api/premium",
    stage: "configuration",
    status,
    reason,
  });
  expect(JSON.stringify(logError.mock.calls)).not.toContain("secret");
});
