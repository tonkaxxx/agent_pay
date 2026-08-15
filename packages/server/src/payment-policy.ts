import type { Address } from "viem";

export const BASE_NETWORK = "eip155:8453" as const;
export const BASE_USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export const PREMIUM_PAYMENT_POLICY = Object.freeze({
  scheme: "exact",
  network: BASE_NETWORK,
  asset: BASE_USDC,
  amountAtomic: "10000",
  amountUsdc: "0.01",
  price: "$0.01",
  maxTimeoutSeconds: 300,
} as const);
