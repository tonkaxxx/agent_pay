import { afterEach, expect, test, vi } from "vitest";

import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

test("fails closed without deployment configuration", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
  vi.stubEnv("AGENTPAY_PAY_TO", "");
  vi.stubEnv("FACILITATOR_URL", "");
  vi.stubEnv("REDIS_URL", "");

  const response = await GET(new Request("https://agentpay.example/api/premium") as never);

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({
    error: "Service Unavailable",
    reason: "configuration_unavailable",
  });
});
