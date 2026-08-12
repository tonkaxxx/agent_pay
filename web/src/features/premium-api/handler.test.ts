import { expect, test } from "vitest";

import { createPremiumHandler } from "./handler";

test("returns only the premium resource body; x402 verification stays in the outer wrapper", async () => {
  const response = await createPremiumHandler()();

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  await expect(response.json()).resolves.toEqual({
    premiumData: "Here's your premium data — paid, verified, and unlocked by AgentPay.",
    paidWith: "USDC",
    network: "eip155:8453",
    protocol: "x402-v2",
  });
});
