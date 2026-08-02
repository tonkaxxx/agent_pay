import {
  type Address,
  type Hash,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
} from "viem";
import { describe, expect, test, vi } from "vitest";

import {
  createPaymentVerifier,
  getUsdcAddress,
  type ReceiptClient,
} from "../src/index.js";

describe("createPaymentVerifier", () => {
  test("returns the official checksummed Base USDC address", () => {
    expect(getUsdcAddress(8453)).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  });

  test("accepts a successful USDC Transfer that covers the required price", async () => {
    const hash = `0x${"a".repeat(64)}` as Hash;
    const payTo = "0x1111111111111111111111111111111111111111" as Address;
    const from = "0x2222222222222222222222222222222222222222" as Address;
    const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
    const topics = encodeEventTopics({
      abi: parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]),
      eventName: "Transfer",
      args: { from, to: payTo },
    });
    const data = encodeAbiParameters([{ type: "uint256" }], [10_000n]);
    const client: ReceiptClient = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: "success",
        blockNumber: 100n,
        logs: [{ address: usdc, topics, data }],
      }),
      getBlockNumber: vi.fn().mockResolvedValue(100n),
    };
    const verify = createPaymentVerifier({
      requirements: { priceUsdc: "0.01", payTo, chainId: 84532 },
      publicClient: client,
    });

    await expect(verify(hash)).resolves.toEqual({ valid: true });
  });
});
