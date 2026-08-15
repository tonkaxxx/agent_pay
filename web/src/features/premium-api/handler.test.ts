import { expect, test } from "vitest";

import { createPremiumHandler } from "./handler";

const legacyReceiptHeader = ["X", "Payment", "Tx"].join("-");

test("returns only the paid resource with private no-store caching", async () => {
  const handle = createPremiumHandler();
  const response = await handle(new Request("https://agentpay.example/api/premium", {
    headers: {
      "PAYMENT-SIGNATURE": "must-not-be-reflected",
      [legacyReceiptHeader]: `0x${"ab".repeat(32)}`,
    },
  }));

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  await expect(response.json()).resolves.toEqual({
    premiumData: "Here's your premium data — paid, verified, and unlocked by AgentPay.",
    paidWith: "USDC",
    network: "eip155:8453",
    protocol: "x402-v2",
  });
});
