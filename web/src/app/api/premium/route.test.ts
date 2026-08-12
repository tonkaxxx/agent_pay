import { afterEach, expect, test, vi } from "vitest";

vi.mock("@x402/next", () => ({ withX402: vi.fn() }));

import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

test("fails closed without deployment configuration", async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
  vi.stubEnv("AGENTPAY_PAY_TO", "");
  vi.stubEnv("REDIS_URL", "");
  vi.stubEnv("CDP_API_KEY_ID", "");
  vi.stubEnv("CDP_API_KEY_SECRET", "");

  const response = await GET(new Request("https://agentpay.example/api/premium"));

  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual({
    error: "Service Unavailable",
    reason: "configuration_unavailable",
    requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
});
