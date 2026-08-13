import {
  type Address,
  type Hash,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  TransactionReceiptNotFoundError,
} from "viem";
import { describe, expect, test, vi } from "vitest";

import {
  createPaymentVerifier,
  getUsdcAddress,
  InMemoryReplayStore,
  type PaymentVerifier,
  type ReceiptClient,
  type ReplayStore,
} from "../src/index.js";

const hash = `0x${"a".repeat(64)}` as Hash;
const payTo = "0x1111111111111111111111111111111111111111" as Address;
const from = "0x2222222222222222222222222222222222222222" as Address;
const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const customUsdc = "0x5555555555555555555555555555555555555555" as Address;
type TestReceipt = Awaited<ReturnType<ReceiptClient["getTransactionReceipt"]>>;
const otherToken = "0x3333333333333333333333333333333333333333" as Address;
const otherRecipient = "0x4444444444444444444444444444444444444444" as Address;
const transferAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function makeReceipt({
  status = "success",
  token = usdc,
  to = payTo,
  values = [10_000n],
}: {
  status?: "success" | "reverted";
  token?: Address;
  to?: Address;
  values?: readonly bigint[];
} = {}): TestReceipt {
  return {
    status,
    blockNumber: 100n,
    logs: values.map((value) => ({
      address: token,
      topics: encodeEventTopics({
        abi: transferAbi,
        eventName: "Transfer",
        args: { from, to },
      }),
      data: encodeAbiParameters([{ type: "uint256" }], [value]),
    })),
  };
}

function makeClient(
  testReceipt: TestReceipt,
  latestBlock = testReceipt.blockNumber,
): ReceiptClient {
  return {
    getTransactionReceipt: vi.fn().mockResolvedValue(testReceipt),
    getBlockNumber: vi.fn().mockResolvedValue(latestBlock),
  };
}

function verifierFor(
  client: ReceiptClient,
  confirmations = 1,
  usdcAddress?: Address,
): PaymentVerifier {
  return createPaymentVerifier({
    requirements: { priceUsdc: "0.01", payTo, chainId: 84532 },
    publicClient: client,
    confirmations,
    ...(usdcAddress === undefined ? {} : { usdcAddress }),
    replayStore: new InMemoryReplayStore(),
  });
}

describe("createPaymentVerifier", () => {
  test("returns the official checksummed Base USDC address", () => {
    expect(getUsdcAddress(8453)).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
  });

  test("accepts a successful USDC Transfer that covers the required price", async () => {
    await expect(verifierFor(makeClient(makeReceipt()))(hash)).resolves.toEqual({ valid: true });
  });

  test("accepts an overpayment above the required price", async () => {
    await expect(
      verifierFor(makeClient(makeReceipt({ values: [10_001n] })))(hash),
    ).resolves.toEqual({ valid: true });
  });

  test("rejects an unsupported chain at verifier creation", () => {
    expect(() => createPaymentVerifier({
      requirements: { priceUsdc: "0.01", payTo, chainId: 1 as 84532 },
      publicClient: makeClient(makeReceipt()),
      usdcAddress: customUsdc,
    })).toThrow(/chainId/);
  });

  test.each([0, 1.5])(
    "rejects invalid confirmations %s at verifier creation",
    (confirmations) => {
      expect(() => createPaymentVerifier({
        requirements: { priceUsdc: "0.01", payTo, chainId: 84532 },
        publicClient: makeClient(makeReceipt()),
        confirmations,
      })).toThrow(/confirmations/);
    },
  );

  test("rejects malformed transaction hashes", async () => {
    const verify = verifierFor(makeClient(makeReceipt()));

    await expect(verify("not-a-hash")).resolves.toMatchObject({
      valid: false,
      reason: "invalid_tx_hash",
      retryable: false,
    });
  });

  test("rejects reverted transactions", async () => {
    await expect(verifierFor(makeClient(makeReceipt({ status: "reverted" })))(hash)).resolves.toMatchObject({
      valid: false,
      reason: "transaction_failed",
    });
  });

  test("rejects transfers from another token", async () => {
    await expect(verifierFor(makeClient(makeReceipt({ token: otherToken })))(hash)).resolves.toMatchObject({
      valid: false,
      reason: "insufficient_payment",
    });
  });

  test("uses the injected USDC address instead of the default token address", async () => {
    const verify = verifierFor(
      makeClient(makeReceipt({ token: customUsdc })),
      1,
      customUsdc,
    );

    await expect(verify(hash)).resolves.toEqual({ valid: true });
    await expect(
      verifierFor(makeClient(makeReceipt()), 1, customUsdc)(hash),
    ).resolves.toMatchObject({ valid: false, reason: "insufficient_payment" });
  });

  test("rejects transfers to another recipient", async () => {
    await expect(verifierFor(makeClient(makeReceipt({ to: otherRecipient })))(hash)).resolves.toMatchObject({
      valid: false,
      reason: "insufficient_payment",
    });
  });

  test("rejects transfers below the required amount", async () => {
    await expect(verifierFor(makeClient(makeReceipt({ values: [9_999n] })))(hash)).resolves.toMatchObject({
      valid: false,
      reason: "insufficient_payment",
    });
  });

  test("accepts a payment split across matching transfer logs", async () => {
    await expect(verifierFor(makeClient(makeReceipt({ values: [6_000n, 4_000n] })))(hash)).resolves.toEqual({
      valid: true,
    });
  });

  test("marks transactions without enough confirmations as retryable", async () => {
    await expect(verifierFor(makeClient(makeReceipt(), 100n), 2)(hash)).resolves.toEqual({
      valid: false,
      reason: "insufficient_confirmations",
      retryable: true,
    });
  });

  test("marks missing receipts as retryable", async () => {
    const client: ReceiptClient = {
      getTransactionReceipt: vi.fn().mockRejectedValue(new TransactionReceiptNotFoundError({ hash })),
      getBlockNumber: vi.fn(),
    };

    await expect(verifierFor(client)(hash)).resolves.toEqual({
      valid: false,
      reason: "transaction_not_found",
      retryable: true,
    });
  });

  test("maps RPC failures to a retryable failure", async () => {
    const client: ReceiptClient = {
      getTransactionReceipt: vi.fn().mockRejectedValue(new Error("RPC unavailable")),
      getBlockNumber: vi.fn(),
    };

    await expect(verifierFor(client)(hash)).resolves.toMatchObject({
      valid: false,
      reason: "verification_unavailable",
      retryable: true,
    });
  });

  test.each([
    ["throws", { claim: () => { throw new Error("store unavailable"); } }],
    ["rejects", { claim: vi.fn().mockRejectedValue(new Error("store unavailable")) }],
  ] satisfies [string, ReplayStore][])(
    "maps a replay-store claim that %s to a retryable failure",
    async (_behavior, replayStore) => {
      const verify = createPaymentVerifier({
        requirements: { priceUsdc: "0.01", payTo, chainId: 84532 },
        publicClient: makeClient(makeReceipt()),
        replayStore,
      });

      await expect(verify(hash)).resolves.toEqual({
        valid: false,
        reason: "verification_unavailable",
        retryable: true,
      });
    },
  );

  test("rejects a previously accepted transaction hash", async () => {
    const verify = verifierFor(makeClient(makeReceipt()));

    await expect(verify(hash)).resolves.toEqual({ valid: true });
    await expect(verify(hash)).resolves.toMatchObject({
      valid: false,
      reason: "transaction_replayed",
      retryable: false,
    });
  });

  test("atomically rejects one of two concurrent claims for the same hash", async () => {
    const verify = verifierFor(makeClient(makeReceipt()));

    const results = await Promise.all([verify(hash), verify(hash)]);

    expect(results).toEqual(expect.arrayContaining([
      { valid: true },
      { valid: false, reason: "transaction_replayed", retryable: false },
    ]));
  });
});
