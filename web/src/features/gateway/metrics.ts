import { desc, eq } from "drizzle-orm";

import * as schema from "@/db/schema";

import { commissionAtomic, type SettlementOutcome } from "./events";
import type { GatewayDatabase } from "./repository";

export interface EndpointMetrics {
  readonly paidCount: number;
  readonly gmvAtomic: string;
  readonly commissionAtomic: string;
  readonly uniquePayers: number;
  readonly repeatedPayers: number;
  readonly upstreamSuccessRate: number | null;
  readonly settlementSuccessRate: number | null;
  readonly medianUpstreamLatencyMs: number | null;
  readonly p95UpstreamLatencyMs: number | null;
  readonly recentFailures: ReadonlyArray<{
    readonly outcome: SettlementOutcome;
    readonly upstreamStatus: number | null;
    readonly createdAt: Date;
  }>;
}

interface EventRow {
  readonly amountAtomic: string;
  readonly payerAddress: string | null;
  readonly txHash: string | null;
  readonly upstreamStatus: number | null;
  readonly upstreamDurationMs: number | null;
  readonly outcome: SettlementOutcome;
  readonly createdAt: Date;
}

function percentile(sorted: readonly number[], ratio: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? null;
}

export async function metricsForEndpoint(
  db: GatewayDatabase,
  endpointId: string,
): Promise<EndpointMetrics> {
  const rows = await db
    .select({
      amountAtomic: schema.paymentEvents.amountAtomic,
      payerAddress: schema.paymentEvents.payerAddress,
      txHash: schema.paymentEvents.txHash,
      upstreamStatus: schema.paymentEvents.upstreamStatus,
      upstreamDurationMs: schema.paymentEvents.upstreamDurationMs,
      outcome: schema.paymentEvents.outcome,
      createdAt: schema.paymentEvents.createdAt,
    })
    .from(schema.paymentEvents)
    .where(eq(schema.paymentEvents.endpointId, endpointId))
    .orderBy(desc(schema.paymentEvents.createdAt));

  const events = rows as unknown as EventRow[];
  const settled = events.filter((event) => event.outcome === "settled");

  let gmvAtomic = 0n;
  let commission = 0n;
  const payers = new Set<string>();
  const payerCounts = new Map<string, number>();
  for (const event of settled) {
    gmvAtomic += BigInt(event.amountAtomic);
    commission += BigInt(commissionAtomic(event.amountAtomic));
    if (event.payerAddress !== null) {
      payers.add(event.payerAddress);
      payerCounts.set(event.payerAddress, (payerCounts.get(event.payerAddress) ?? 0) + 1);
    }
  }

  const upstreamTotal = events.filter((event) =>
    event.outcome === "settled" ||
    event.outcome === "settlement_failed" ||
    event.outcome === "upstream_failed"
  ).length;
  const upstreamSuccesses = events.filter((event) =>
    event.outcome === "settled" || event.outcome === "settlement_failed"
  ).length;
  const settlementTotal = events.filter((event) =>
    event.outcome === "settled" || event.outcome === "settlement_failed"
  ).length;

  const latencies = settled
    .map((event) => event.upstreamDurationMs)
    .filter((value): value is number => value !== null && value !== undefined)
    .sort((left, right) => left - right);

  return {
    paidCount: settled.length,
    gmvAtomic: gmvAtomic.toString(),
    commissionAtomic: commission.toString(),
    uniquePayers: payers.size,
    repeatedPayers: [...payerCounts.values()].filter((count) => count > 1).length,
    upstreamSuccessRate: upstreamTotal === 0 ? null : upstreamSuccesses / upstreamTotal,
    settlementSuccessRate: settlementTotal === 0 ? null : settled.length / settlementTotal,
    medianUpstreamLatencyMs: percentile(latencies, 0.5),
    p95UpstreamLatencyMs: percentile(latencies, 0.95),
    recentFailures: events
      .filter((event) => event.outcome !== "settled")
      .slice(0, 10)
      .map((event) => ({
        outcome: event.outcome,
        upstreamStatus: event.upstreamStatus,
        createdAt: event.createdAt,
      })),
  };
}
