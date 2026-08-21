import { describe, expect, it } from "vitest";

import { hasRequiredConfirmations } from "./payout-chain";

describe("hasRequiredConfirmations", () => {
  it("waits for one block after a successful collection transaction", () => {
    expect(hasRequiredConfirmations(100n, 100n)).toBe(false);
    expect(hasRequiredConfirmations(101n, 100n)).toBe(true);
  });
});
