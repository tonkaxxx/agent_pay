import { describe, expect, it } from "vitest";

import {
  CUSTODIAL_LIABILITY_CAP_ATOMIC,
  PAYOUT_THRESHOLD_ATOMIC,
  splitCommission,
  payoutEligibleAt,
  type PayoutPolicy,
} from "./policy";

describe("splitCommission", () => {
  it("keeps the buyer price unchanged and splits it 95/5", () => {
    expect(splitCommission("10000")).toEqual({
      grossAtomic: "10000",
      commissionAtomic: "500",
      sellerNetAtomic: "9500",
    });
  });

  it("rounds commission down in atomic USDC units", () => {
    expect(splitCommission("19")).toEqual({
      grossAtomic: "19",
      commissionAtomic: "0",
      sellerNetAtomic: "19",
    });
    expect(splitCommission("20").commissionAtomic).toBe("1");
  });

  it("rejects non-positive and malformed amounts", () => {
    for (const value of ["0", "-1", "1.5", "abc", ""]) {
      expect(() => splitCommission(value)).toThrow("Invalid gross amount");
    }
  });
});

describe("payoutEligibleAt", () => {
  const createdAt = new Date("2026-08-21T03:00:00.000Z");

  it("makes both policies eligible immediately at the one-USDC threshold", () => {
    for (const policy of ["threshold", "threshold_or_weekly"] satisfies PayoutPolicy[]) {
      expect(payoutEligibleAt(policy, PAYOUT_THRESHOLD_ATOMIC, createdAt)).toEqual(createdAt);
    }
  });

  it("gives the weekly policy a seven-day fallback", () => {
    expect(payoutEligibleAt("threshold_or_weekly", "9500", createdAt)).toEqual(
      new Date("2026-08-28T03:00:00.000Z"),
    );
  });

  it("leaves sub-threshold threshold-only balances pending", () => {
    expect(payoutEligibleAt("threshold", "999999", createdAt)).toBeNull();
  });
});

it("uses the approved one-USDC threshold and 500-USDC liability cap", () => {
  expect(PAYOUT_THRESHOLD_ATOMIC).toBe("1000000");
  expect(CUSTODIAL_LIABILITY_CAP_ATOMIC).toBe("500000000");
});
