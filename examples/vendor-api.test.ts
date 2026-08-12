import request from "supertest";
import { decodePaymentRequiredHeader } from "@x402/core/http";
import type { FacilitatorClient } from "@agentpay/server";
import { expect, test, vi } from "vitest";

import { DEMO_NETWORKS } from "./demo-config.js";
import {
  createVendorApp,
  startVendorApp,
  vendorRuntimeConfiguration,
} from "./vendor-api.js";

function facilitator(network: "eip155:8453" | "eip155:84532"): FacilitatorClient {
  return {
    verify: vi.fn(),
    settle: vi.fn(),
    getSupported: vi.fn().mockResolvedValue({
      kinds: [{ x402Version: 2, scheme: "exact", network }],
      extensions: ["payment-identifier"],
      signers: {},
    }),
  };
}

test.each([
  ["Sepolia", DEMO_NETWORKS.sepolia, "eip155:84532"],
  ["Mainnet", DEMO_NETWORKS.mainnet, "eip155:8453"],
] as const)("returns standard x402 v2 Base %s payment requirements", async (
  _label,
  network,
  expectedNetwork,
) => {
  const app = createVendorApp({
    vendorWalletAddress: "0x1111111111111111111111111111111111111111",
    network,
  }, facilitator(network.network));

  await request(app).get("/api/data").expect(402).expect(({ headers }) => {
    const encoded = headers["payment-required"];
    expect(encoded).toBeTypeOf("string");
    expect(decodePaymentRequiredHeader(encoded as string)).toMatchObject({
      x402Version: 2,
      accepts: [{
        scheme: "exact",
        amount: "10000",
        network: expectedNetwork,
      }],
      extensions: {
        "payment-identifier": { info: { required: false } },
      },
    });
  });
});

test("refuses mainnet Vendor startup without exact opt-in", () => {
  expect(() => vendorRuntimeConfiguration("mainnet", {
    BASE_MAINNET_RPC_URL: "https://mainnet.base.org",
    VENDOR_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
    PORT: "3000",
  })).toThrow(/ALLOW_MAINNET_PAYMENTS/);
});

test("starts the mainnet Vendor server only on loopback and prints real-funds warnings", () => {
  const calls: Array<{ port: number; hostname?: string }> = [];
  const messages: string[] = [];
  const server = {
    listen(port: number, hostnameOrCallback: string | (() => void), callback?: () => void): void {
      if (typeof hostnameOrCallback === "function") {
        calls.push({ port });
        hostnameOrCallback();
      } else {
        calls.push({ port, hostname: hostnameOrCallback });
        callback?.();
      }
    },
  };

  startVendorApp(vendorRuntimeConfiguration("mainnet", {
    ALLOW_MAINNET_PAYMENTS: "true",
    BASE_MAINNET_RPC_URL: "https://mainnet.base.org",
    VENDOR_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
    PORT: "3000",
  }), server, (message) => messages.push(message));

  expect(calls).toEqual([{ port: 3000, hostname: "127.0.0.1" }]);
  expect(messages).toEqual(expect.arrayContaining([
    "BASE MAINNET / REAL FUNDS",
    "Price: 0.01 USDC",
    "Idempotency store: in-memory only",
    "Refunds: unavailable",
  ]));
});

test("starts the Sepolia Vendor server without a hostname", () => {
  const calls: Array<{ port: number; hostname?: string }> = [];
  const server = {
    listen(port: number, hostnameOrCallback: string | (() => void), callback?: () => void): void {
      if (typeof hostnameOrCallback === "function") {
        calls.push({ port });
        hostnameOrCallback();
      } else {
        calls.push({ port, hostname: hostnameOrCallback });
        callback?.();
      }
    },
  };

  startVendorApp(vendorRuntimeConfiguration("sepolia", {
    BASE_SEPOLIA_RPC_URL: "https://sepolia.base.org",
    VENDOR_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
    PORT: "3000",
  }), server, () => {});

  expect(calls).toEqual([{ port: 3000 }]);
});
