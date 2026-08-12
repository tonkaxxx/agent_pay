import { expect, test } from "vitest";

import { loadPremiumConfig } from "./config";

const validEnvironment = {
  NEXT_PUBLIC_SITE_URL: "https://agentpay.example",
  AGENTPAY_PAY_TO: "0x1111111111111111111111111111111111111111",
  REDIS_URL: "redis://127.0.0.1:6379",
  CDP_API_KEY_ID: "organizations/test/apiKeys/key",
  CDP_API_KEY_SECRET: "test-secret",
} as const;

const productionEnvironment = {
  NEXT_PUBLIC_SITE_URL: "https://agentpay.thebestsites.ru/",
  AGENTPAY_PAY_TO: "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB",
  REDIS_URL: "redis://:generated-password@redis:6379",
  CDP_API_KEY_ID: "organizations/production/apiKeys/key",
  CDP_API_KEY_SECRET: "production-secret",
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

test("accepts a strict Base Mainnet production configuration", () => {
  expect(loadPremiumConfig(productionEnvironment, { production: true })).toMatchObject({
    siteUrl: "https://agentpay.thebestsites.ru/",
    payTo: "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB",
    redisUrl: "redis://:generated-password@redis:6379",
    offlineQuoteOnly: false,
  });
});

test.each([
  ["localhost origin", { NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }],
  ["placeholder recipient", { AGENTPAY_PAY_TO: "0x1111111111111111111111111111111111111111" }],
  ["quote-only facilitator", { AGENTPAY_OFFLINE_QUOTE_ONLY: "true" }],
  ["agent private key", { AGENT_PRIVATE_KEY: `0x${"11".repeat(32)}` }],
  ["unauthenticated Redis", { REDIS_URL: "redis://redis:6379" }],
] as const)("rejects %s in production", (_label, override) => {
  expect(() => loadPremiumConfig(
    { ...productionEnvironment, ...override },
    { production: true },
  )).toThrow();
});
