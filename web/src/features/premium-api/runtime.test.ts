import { expect, test, vi } from "vitest";

import type { PremiumConfig } from "./config";
import { buildPremiumHandler } from "./runtime";

const config: PremiumConfig = {
  siteUrl: "https://agentpay.example/",
  payTo: "0x1111111111111111111111111111111111111111",
  rpcUrl: "https://mainnet.base.org/",
  redisUrl: "redis://127.0.0.1:6379",
};

test("builds the paid handler with exact mainnet requirements and durable replay storage", async () => {
  const receiptClient = { kind: "receipt-client" };
  const redisClient = { set: vi.fn() };
  const verify = vi.fn();
  const createVerifier = vi.fn().mockReturnValue(verify);
  const createReceiptClient = vi.fn().mockReturnValue(receiptClient);
  const createRedisClient = vi.fn().mockReturnValue(redisClient);

  const handler = buildPremiumHandler(config, {
    createVerifier,
    createReceiptClient,
    createRedisClient,
  });

  expect(createReceiptClient).toHaveBeenCalledWith(config.rpcUrl);
  expect(createRedisClient).toHaveBeenCalledWith(config.redisUrl);
  expect(createVerifier).toHaveBeenCalledWith({
    requirements: {
      priceUsdc: "0.01",
      payTo: config.payTo,
      chainId: 8453,
    },
    publicClient: receiptClient,
    confirmations: 2,
    replayStore: expect.any(Object),
  });
  await expect(handler(new Request("https://agentpay.example/api/premium")))
    .resolves.toMatchObject({ status: 402 });
});
