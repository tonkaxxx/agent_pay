import { eq, or, type SQL } from "drizzle-orm";

import * as schema from "@/db/schema";

import type { GatewayDatabase } from "./repository";

export type SettlementOutcome =
  | "settled"
  | "upstream_failed"
  | "settlement_failed"
  | "challenge"
  | "invalid_authorization"
  | "payment_in_progress"
  | "payment_consumed";

export interface SettlementEventInput {
  readonly endpointId: string;
  readonly requestId: string;
  readonly fingerprint: string | null;
  readonly payerAddress: string | null;
  readonly txHash: string | null;
  readonly amountAtomic: string;
  readonly upstreamStatus: number | null;
  readonly upstreamDurationMs: number | null;
  readonly upstreamResponseSize: number | null;
  readonly settlementDurationMs: number | null;
  readonly outcome: SettlementOutcome;
}

const COMMISSION_BASIS_POINTS = 500n;

export function commissionAtomic(amountAtomic: string): string {
  const amount = BigInt(amountAtomic);
  return ((amount * COMMISSION_BASIS_POINTS) / 10000n).toString();
}

const outcomeCommission: Readonly<Record<SettlementOutcome, boolean>> = {
  settled: true,
  upstream_failed: false,
  settlement_failed: false,
  challenge: false,
  invalid_authorization: false,
  payment_in_progress: false,
  payment_consumed: false,
};

function commissionFor(outcome: SettlementOutcome, amountAtomic: string): string {
  return outcomeCommission[outcome] ? commissionAtomic(amountAtomic) : "0";
}

function alreadyRecordedConditions(
  fingerprint: string | null,
  txHash: string | null,
): SQL | undefined {
  const conditions: SQL[] = [];
  if (fingerprint !== null) {
    conditions.push(eq(schema.paymentEvents.fingerprint, fingerprint));
  }
  if (txHash !== null) {
    conditions.push(eq(schema.paymentEvents.txHash, txHash));
  }
  return conditions.length > 0 ? or(...conditions) : undefined;
}

export async function recordSettlement(
  db: GatewayDatabase,
  event: SettlementEventInput,
  log: (line: string) => void = (line) => console.warn(line),
): Promise<void> {
  try {
    const conditions = alreadyRecordedConditions(event.fingerprint, event.txHash);
    if (conditions !== undefined) {
      const existing = await db
        .select({ id: schema.paymentEvents.id })
        .from(schema.paymentEvents)
        .where(conditions)
        .limit(1);
      if (existing.length > 0) {
        return;
      }
    }
    await db.insert(schema.paymentEvents).values({
      endpointId: event.endpointId,
      requestId: event.requestId,
      fingerprint: event.fingerprint,
      payerAddress: event.payerAddress,
      txHash: event.txHash,
      amountAtomic: event.amountAtomic,
      commissionAtomic: commissionFor(event.outcome, event.amountAtomic),
      upstreamStatus: event.upstreamStatus,
      upstreamDurationMs: event.upstreamDurationMs,
      upstreamResponseSize: event.upstreamResponseSize,
      settlementDurationMs: event.settlementDurationMs,
      outcome: event.outcome,
    });
  } catch {
    log(`reconcile_needed request_id=${event.requestId} endpoint_id=${event.endpointId} tx_hash=${event.txHash ?? ""}`);
  }
}
