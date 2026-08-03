import express from "express";
import request from "supertest";
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
  PAYMENT_HEADER,
  paymentMiddleware,
  type PaymentMiddlewareOptions,
  type PaymentVerifier,
  type ReceiptClient,
} from "../src/index.js";

const hash = `0x${"a".repeat(64)}` as Hash;
const customTokenHash = `0x${"b".repeat(64)}` as Hash;
const payTo = "0x1111111111111111111111111111111111111111" as Address;
const from = "0x2222222222222222222222222222222222222222" as Address;
const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const customUsdc = "0x5555555555555555555555555555555555555555" as Address;
const transferAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function clientFor({
  paid = 10_000n,
  receiptError,
  token = usdc,
}: {
  paid?: bigint;
  receiptError?: Error;
  token?: Address;
} = {}): ReceiptClient {
  return {
    async getTransactionReceipt() {
      if (receiptError) throw receiptError;
      return {
        status: "success",
        blockNumber: 100n,
        logs: [{
          address: token,
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

function appFor(client: ReceiptClient, usdcAddress?: Address) {
  const app = express();
  app.get(
    "/api/data",
    paymentMiddleware({
      priceUsdc: "0.01",
      payTo,
      chainId: 84532,
      publicClient: client,
      ...(usdcAddress === undefined ? {} : { usdcAddress }),
    }),
    (_request, response) => response.json({ data: "paid" }),
  );
  return app;
}

function appForVerifier(verifier: PaymentVerifier) {
  const app = express();
  app.get(
    "/api/data",
    paymentMiddleware({
      priceUsdc: "0.01",
      payTo,
      chainId: 84532,
      verifier,
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

  test("uses an injected USDC address when verifying a receipt", async () => {
    await request(appFor(clientFor({ token: customUsdc }), customUsdc))
      .get("/api/data")
      .set(PAYMENT_HEADER, customTokenHash)
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

  test("returns a 503 while a newly submitted receipt is not visible yet", async () => {
    await request(appFor(clientFor({
      receiptError: new TransactionReceiptNotFoundError({ hash }),
    })))
      .get("/api/data")
      .set(PAYMENT_HEADER, hash)
      .expect(503)
      .expect({
        error: "Payment Verification Unavailable",
        reason: "transaction_not_found",
      });
  });

  test("uses an injected ready-made verifier without an RPC client", async () => {
    const verifier: PaymentVerifier = vi.fn().mockResolvedValue({ valid: true });

    await request(appForVerifier(verifier))
      .get("/api/data")
      .set(PAYMENT_HEADER, "injected-verifier-hash")
      .expect(200)
      .expect({ data: "paid" });
  });

  test("returns payment requirements from the injected-verifier branch", async () => {
    await request(appForVerifier(vi.fn().mockResolvedValue({ valid: true })))
      .get("/api/data")
      .expect(402)
      .expect({
        error: "Payment Required",
        priceUsdc: "0.01",
        payTo,
        network: "base-sepolia",
        chainId: 84532,
      });
  });

  test("rejects an unsupported chain before selecting an injected verifier", () => {
    expect(() => paymentMiddleware({
      priceUsdc: "0.01",
      payTo,
      chainId: 1 as 84532,
      verifier: vi.fn().mockResolvedValue({ valid: true }),
    } as PaymentMiddlewareOptions)).toThrow(/chainId/);
  });

  test("validates common payment requirements for an injected verifier", () => {
    const verifier: PaymentVerifier = vi.fn().mockResolvedValue({ valid: true });

    expect(() => paymentMiddleware({
      priceUsdc: "0",
      payTo,
      chainId: 84532,
      verifier,
    } as PaymentMiddlewareOptions)).toThrow(/priceUsdc/);
    expect(() => paymentMiddleware({
      priceUsdc: "0.01",
      payTo: "not-an-address" as Address,
      chainId: 84532,
      verifier,
    } as PaymentMiddlewareOptions)).toThrow();
  });

  test("returns a 403 for a structured invalid result from an injected verifier", async () => {
    const verifier: PaymentVerifier = vi.fn().mockResolvedValue({
      valid: false,
      reason: "insufficient_payment",
      retryable: false,
    });

    await request(appForVerifier(verifier))
      .get("/api/data")
      .set(PAYMENT_HEADER, "injected-verifier-hash")
      .expect(403)
      .expect({ error: "Invalid Payment", reason: "insufficient_payment" });
  });

  test.each([
    ["throws", (() => { throw new Error("verifier failed"); }) as PaymentVerifier],
    ["rejects", vi.fn().mockRejectedValue(new Error("verifier failed")) as PaymentVerifier],
  ])("returns a 503 when an injected verifier %s", async (_behavior, verifier) => {
    await request(appForVerifier(verifier))
      .get("/api/data")
      .set(PAYMENT_HEADER, "injected-verifier-hash")
      .expect(503)
      .expect({
        error: "Payment Verification Unavailable",
        reason: "verification_unavailable",
      });
  });

  test.each(["", "not a URL", "ftp://rpc.example"])(
    "rejects invalid rpcUrl %j at middleware creation",
    (rpcUrl) => {
      expect(() => paymentMiddleware({
        priceUsdc: "0.01",
        payTo,
        chainId: 84532,
        rpcUrl,
      })).toThrow(/rpcUrl/);
    },
  );

  test.each([0, 1.5])(
    "rejects invalid confirmations %s at middleware creation",
    (confirmations) => {
      expect(() => paymentMiddleware({
        priceUsdc: "0.01",
        payTo,
        chainId: 84532,
        publicClient: clientFor(),
        confirmations,
      })).toThrow(/confirmations/);
    },
  );

  test.each(["http://localhost:8545", "https://rpc.example"])(
    "accepts HTTP(S) RPC URL %s at middleware creation",
    (rpcUrl) => {
      expect(paymentMiddleware({
        priceUsdc: "0.01",
        payTo,
        chainId: 84532,
        rpcUrl,
      })).toBeTypeOf("function");
    },
  );
});
