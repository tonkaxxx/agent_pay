import express from "express";
import request from "supertest";
import {
  type Address,
  type Hash,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
} from "viem";
import { describe, expect, test } from "vitest";

import { PAYMENT_HEADER, paymentMiddleware, type ReceiptClient } from "../src/index.js";

const hash = `0x${"a".repeat(64)}` as Hash;
const payTo = "0x1111111111111111111111111111111111111111" as Address;
const from = "0x2222222222222222222222222222222222222222" as Address;
const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const transferAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function clientFor({
  paid = 10_000n,
  receiptError,
}: {
  paid?: bigint;
  receiptError?: Error;
} = {}): ReceiptClient {
  return {
    async getTransactionReceipt() {
      if (receiptError) throw receiptError;
      return {
        status: "success",
        blockNumber: 100n,
        logs: [{
          address: usdc,
          topics: encodeEventTopics({
            abi: transferAbi,
            eventName: "Transfer",
            args: { from, to: payTo },
          }),
          data: encodeAbiParameters([{ type: "uint256" }], [paid]),
        }],
      };
    },
    async getBlockNumber() {
      return 100n;
    },
  };
}

function appFor(client: ReceiptClient) {
  const app = express();
  app.get(
    "/api/data",
    paymentMiddleware({
      priceUsdc: "0.01",
      payTo,
      chainId: 84532,
      publicClient: client,
    }),
    (_request, response) => response.json({ data: "paid" }),
  );
  return app;
}

describe("paymentMiddleware", () => {
  test("returns the exact payment requirement payload when the payment header is absent", async () => {
    await request(appFor(clientFor())).get("/api/data").expect(402).expect({
      error: "Payment Required",
      priceUsdc: "0.01",
      payTo,
      network: "base-sepolia",
      chainId: 84532,
    });
  });

  test("allows a request with a receipt that covers the price", async () => {
    await request(appFor(clientFor()))
      .get("/api/data")
      .set(PAYMENT_HEADER, hash)
      .expect(200)
      .expect({ data: "paid" });
  });

  test("returns a 403 for a receipt below the required payment", async () => {
    await request(appFor(clientFor({ paid: 9_999n })))
      .get("/api/data")
      .set(PAYMENT_HEADER, hash)
      .expect(403)
      .expect({ error: "Invalid Payment", reason: "insufficient_payment" });
  });

  test("returns a 503 when receipt verification is temporarily unavailable", async () => {
    await request(appFor(clientFor({ receiptError: new Error("RPC unavailable") })))
      .get("/api/data")
      .set(PAYMENT_HEADER, hash)
      .expect(503)
      .expect({
        error: "Payment Verification Unavailable",
        reason: "verification_unavailable",
      });
  });
});
