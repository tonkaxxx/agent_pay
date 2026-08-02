import request from "supertest";
import { expect, test } from "vitest";

import { createVendorApp } from "./vendor-api.js";

test("returns Base Sepolia payment requirements before any RPC verification", async () => {
  const app = createVendorApp({
    vendorWalletAddress: "0x1111111111111111111111111111111111111111",
    rpcUrl: "https://sepolia.base.org",
  });

  await request(app).get("/api/data").expect(402).expect(({ body }) => {
    expect(body).toMatchObject({
      error: "Payment Required",
      priceUsdc: "0.01",
      network: "base-sepolia",
      chainId: 84532,
    });
  });
});
