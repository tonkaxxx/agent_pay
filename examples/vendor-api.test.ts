import request from "supertest";
import { expect, test } from "vitest";

import { DEMO_NETWORKS } from "./demo-config.js";
import { createVendorApp, vendorRuntimeConfiguration } from "./vendor-api.js";

test.each([
  ["Sepolia", DEMO_NETWORKS.sepolia, "base-sepolia", 84532],
  ["Mainnet", DEMO_NETWORKS.mainnet, "base", 8453],
] as const)("returns Base %s payment requirements without RPC verification", async (
  _label,
  network,
  expectedNetwork,
  expectedChainId,
) => {
  const app = createVendorApp({
    vendorWalletAddress: "0x1111111111111111111111111111111111111111",
    rpcUrl: network.realFunds ? "https://mainnet.base.org" : "https://sepolia.base.org",
    network,
  });

  await request(app).get("/api/data").expect(402).expect(({ body }) => {
    expect(body).toMatchObject({
      error: "Payment Required",
      priceUsdc: "0.01",
      network: expectedNetwork,
      chainId: expectedChainId,
    });
  });
});

test("refuses mainnet Vendor startup without exact opt-in", () => {
  expect(() => vendorRuntimeConfiguration(["--mainnet"], {
    BASE_MAINNET_RPC_URL: "https://mainnet.base.org",
    VENDOR_WALLET_ADDRESS: "0x1111111111111111111111111111111111111111",
    PORT: "3000",
  })).toThrow(/ALLOW_MAINNET_PAYMENTS/);
});
