import { expect, test } from "vitest";

import { loadPremiumConfig } from "./config";

const validEnvironment = {
  NEXT_PUBLIC_SITE_URL: "https://agentpay.example",
  AGENTPAY_PAY_TO: "0x1111111111111111111111111111111111111111",
  REDIS_URL: "redis://127.0.0.1:6379",
  CDP_API_KEY_ID: "organizations/test/apiKeys/key",
  CDP_API_KEY_SECRET: "test-secret",
} as const;

test("loads and normalizes the public premium API configuration", () => {
  expect(loadPremiumConfig(validEnvironment)).toEqual({
    siteUrl: "https://agentpay.example/",
    payTo: "0x1111111111111111111111111111111111111111",
    redisUrl: "redis://127.0.0.1:6379",
    cdpApiKeyId: "organizations/test/apiKeys/key",
    cdpApiKeySecret: "test-secret",
    offlineQuoteOnly: false,
  });
});

test.each([
  ["NEXT_PUBLIC_SITE_URL", undefined],
  ["NEXT_PUBLIC_SITE_URL", "ftp://agentpay.example"],
  ["AGENTPAY_PAY_TO", "not-an-address"],
  ["REDIS_URL", "https://redis.example"],
  ["CDP_API_KEY_ID", undefined],
  ["CDP_API_KEY_SECRET", undefined],
] as const)("rejects invalid %s", (name, value) => {
  expect(() => loadPremiumConfig({ ...validEnvironment, [name]: value })).toThrow(name);
});
