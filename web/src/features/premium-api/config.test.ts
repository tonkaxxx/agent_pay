import { expect, test } from "vitest";

import { loadPremiumConfig } from "./config";

const validEnvironment = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SITE_URL: "https://agentpay.example",
  AGENTPAY_PAY_TO: "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB",
  FACILITATOR_URL: "http://facilitator:4022",
  REDIS_URL: "redis://redis:6379",
} as const;

test("loads the canonical production premium API configuration", () => {
  expect(loadPremiumConfig(validEnvironment)).toEqual({
    siteUrl: "https://agentpay.example/",
    resourceUrl: "https://agentpay.example/api/premium",
    payTo: "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB",
    facilitatorUrl: "http://facilitator:4022/",
    redisUrl: "redis://redis:6379",
  });
});

test.each([
  ["NEXT_PUBLIC_SITE_URL", undefined],
  ["NEXT_PUBLIC_SITE_URL", "http://agentpay.example"],
  ["NEXT_PUBLIC_SITE_URL", "https://agentpay.example/not-root"],
  ["NEXT_PUBLIC_SITE_URL", "https://localhost"],
  ["NEXT_PUBLIC_SITE_URL", "https://127.0.0.1"],
  ["AGENTPAY_PAY_TO", "not-an-address"],
  ["AGENTPAY_PAY_TO", "0x0000000000000000000000000000000000000000"],
  ["AGENTPAY_PAY_TO", "0x1111111111111111111111111111111111111111"],
  ["FACILITATOR_URL", "ws://facilitator:4022"],
  ["REDIS_URL", "https://redis.example"],
] as const)("rejects invalid %s", (name, value) => {
  expect(() => loadPremiumConfig({ ...validEnvironment, [name]: value })).toThrow(name);
});

test.each([
  "AGENT_PRIVATE_KEY",
  "FACILITATOR_PRIVATE_KEY",
  "CDP_API_KEY_ID",
  "CDP_API_KEY_SECRET",
] as const)("rejects buyer or infrastructure secret %s in the web environment", name => {
  expect(() => loadPremiumConfig({ ...validEnvironment, [name]: "secret-value" })).toThrow(name);
});

test("does not include secret configuration values in errors", () => {
  const secret = "redis://default:private-password@redis:6379";
  expect(() => loadPremiumConfig({
    ...validEnvironment,
    REDIS_URL: secret,
    AGENT_PRIVATE_KEY: "must-never-be-here",
  })).toThrowError(expect.not.stringContaining(secret));
});
