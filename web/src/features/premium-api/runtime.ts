import {
  createPaymentVerifier,
  type CreatePaymentVerifierOptions,
  type PaymentVerifier,
  type ReceiptClient,
} from "@x402/server";
import { createClient } from "redis";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

import type { PremiumConfig } from "./config";
import { createPremiumHandler } from "./handler";
import { RedisReplayStore, type RedisSetClient } from "./redis-replay-store";

interface PremiumRuntimeDependencies {
  createReceiptClient(rpcUrl: string): ReceiptClient;
  createRedisClient(redisUrl: string): RedisSetClient;
  createVerifier(options: CreatePaymentVerifierOptions): PaymentVerifier;
}

const defaultDependencies: PremiumRuntimeDependencies = {
  createReceiptClient: (rpcUrl) => createPublicClient({
    chain: base,
    transport: http(rpcUrl),
  }) as ReceiptClient,
  createRedisClient: (redisUrl) => createClient({ url: redisUrl }) as RedisSetClient,
  createVerifier: createPaymentVerifier,
};

export function buildPremiumHandler(
  config: PremiumConfig,
  dependencies: PremiumRuntimeDependencies = defaultDependencies,
) {
  const publicClient = dependencies.createReceiptClient(config.rpcUrl);
  const redis = dependencies.createRedisClient(config.redisUrl);
  const verify = dependencies.createVerifier({
    requirements: {
      priceUsdc: "0.01",
      payTo: config.payTo,
      chainId: 8453,
    },
    publicClient,
    confirmations: 2,
    replayStore: new RedisReplayStore(redis),
  });

  return createPremiumHandler({ payTo: config.payTo, verify });
}
