export const COMMISSION_BASIS_POINTS = 500n;
export const BASIS_POINTS_DENOMINATOR = 10_000n;
export const PAYOUT_THRESHOLD_ATOMIC = "1000000";
export const CUSTODIAL_LIABILITY_CAP_ATOMIC = "500000000";
export const WEEKLY_PAYOUT_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

export const PAYOUT_POLICIES = ["threshold", "threshold_or_weekly"] as const;
export type PayoutPolicy = (typeof PAYOUT_POLICIES)[number];

export interface PaymentSplit {
  readonly grossAtomic: string;
  readonly commissionAtomic: string;
  readonly sellerNetAtomic: string;
}

export function splitCommission(grossAtomic: string): PaymentSplit {
  if (!/^\d+$/.test(grossAtomic) || BigInt(grossAtomic) <= 0n) {
    throw new Error("Invalid gross amount");
  }
  const gross = BigInt(grossAtomic);
  const commission = (gross * COMMISSION_BASIS_POINTS) / BASIS_POINTS_DENOMINATOR;
  return {
    grossAtomic: gross.toString(),
    commissionAtomic: commission.toString(),
    sellerNetAtomic: (gross - commission).toString(),
  };
}

export function payoutEligibleAt(
  policy: PayoutPolicy,
  unpaidNetAtomic: string,
  oldestCreatedAt: Date,
): Date | null {
  if (BigInt(unpaidNetAtomic) >= BigInt(PAYOUT_THRESHOLD_ATOMIC)) {
    return oldestCreatedAt;
  }
  if (policy === "threshold_or_weekly") {
    return new Date(oldestCreatedAt.getTime() + WEEKLY_PAYOUT_DELAY_MS);
  }
  return null;
}
