import { expect, test } from "vitest";

import { metadata } from "./page";

test("keeps custodial commission details out of public docs metadata", () => {
  expect(metadata.description).toBe(
    "Buy or sell paid GET APIs with x402 v2, Base USDC, and AgentPay's hosted GET gateway.",
  );
});
