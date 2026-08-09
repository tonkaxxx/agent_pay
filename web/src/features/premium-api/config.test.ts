import { expect, test } from "vitest";

import { loadPremiumConfig } from "./config";

const validEnvironment = {
  NEXT_PUBLIC_SITE_URL: "https://agentpay.example",
  AGENTPAY_PAY_TO: "0x1111111111111111111111111111111111111111",
  BASE_MAINNET_RPC_URL: "https://mainnet.base.org",
  REDIS_URL: "redis://127.0.0.1:6379",
} as const;

test("loads and normalizes the public premium API configuration", () => {
  expect(loadPremiumConfig(validEnvironment)).toEqual({
    siteUrl: "https://agentpay.example/",
    payTo: "0x1111111111111111111111111111111111111111",
    rpcUrl: "https://mainnet.base.org/",
    redisUrl: "redis://127.0.0.1:6379",
  });
});

test.each([
  ["NEXT_PUBLIC_SITE_URL", undefined],
  ["NEXT_PUBLIC_SITE_URL", "ftp://agentpay.example"],
  ["AGENTPAY_PAY_TO", "not-an-address"],
  ["BASE_MAINNET_RPC_URL", "ws://mainnet.base.org"],
  ["REDIS_URL", "https://redis.example"],
] as const)("rejects invalid %s", (name, value) => {
  expect(() => loadPremiumConfig({ ...validEnvironment, [name]: value })).toThrow(name);
});
