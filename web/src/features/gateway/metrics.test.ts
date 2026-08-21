import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import * as schema from "@/db/schema";
import { createTestDatabase, resetTestDatabase, type TestDatabase } from "@/db/test-db";
import {
  createEndpoint,
  type EndpointSummary,
  type EndpointSpec,
} from "./repository";
import { recordSettlement, type SettlementEventInput } from "./events";
import { metricsForEndpoint } from "./metrics";

const OWNER_A = "00000000-0000-0000-0000-00000000000a";
const PAYER_A = "0x63A4536BC72c6d17A2ec1e6aa14555e0Ef9044D1";
const PAYER_B = "0x00000000000000000000000000000000000000b2";
const PAYER_C = "0x00000000000000000000000000000000000000c3";

let tdb: TestDatabase;
let endpoint: EndpointSummary;

function spec(overrides: Partial<EndpointSpec> = {}): EndpointSpec {
  return {
    displayName: "Weather",
    upstreamUrl: "https://api.example.com/weather",
    authMode: "none",
    payTo: PAYER_A,
    amountAtomic: "1000000",
    ...overrides,
  };
}

function event(overrides: Partial<SettlementEventInput> = {}): SettlementEventInput {
  return {
    endpointId: endpoint.id,
    requestId: "req",
    fingerprint: "f" + Math.random().toString(36).slice(2),
    payerAddress: PAYER_A,
    txHash: "0x" + Math.floor(Math.random() * 1e15).toString(16).padStart(64, "0"),
    amountAtomic: "1000000",
    upstreamStatus: 200,
    upstreamDurationMs: 100,
    upstreamResponseSize: 100,
    settlementDurationMs: 500,
    outcome: "settled",
    ...overrides,
  };
}

beforeAll(async () => {
  tdb = await createTestDatabase();
});

beforeEach(async () => {
  await resetTestDatabase(tdb);
  await tdb.db.insert(schema.users).values([
    { id: OWNER_A, name: "Seller A", email: "a@example.test" },
  ]);
  endpoint = await createEndpoint(tdb.db, OWNER_A, spec(), "endpoint-1");
});

afterAll(async () => {
  await tdb.close();
});

describe("metricsForEndpoint", () => {
  it("returns zeros for an endpoint without events", async () => {
    const metrics = await metricsForEndpoint(tdb.db, endpoint.id);
    expect(metrics).toEqual({
      paidCount: 0,
      gmvAtomic: "0",
      commissionAtomic: "0",
      sellerNetAtomic: "0",
      pendingPayoutAtomic: "0",
      paidOutAtomic: "0",
      payoutTransactions: [],
      uniquePayers: 0,
      repeatedPayers: 0,
      upstreamSuccessRate: null,
      settlementSuccessRate: null,
      medianUpstreamLatencyMs: null,
      p95UpstreamLatencyMs: null,
      recentFailures: [],
    });
  });

  it("aggregates paid counts, GMV and commission", async () => {
    await recordSettlement(tdb.db, event({ amountAtomic: "1000000", payerAddress: PAYER_A }));
    await recordSettlement(tdb.db, event({ amountAtomic: "2000000", payerAddress: PAYER_B }));
    await recordSettlement(tdb.db, event({ amountAtomic: "500000", payerAddress: PAYER_A }));

    const metrics = await metricsForEndpoint(tdb.db, endpoint.id);
    expect(metrics.paidCount).toBe(3);
    expect(metrics.gmvAtomic).toBe("3500000");
    expect(metrics.commissionAtomic).toBe("175000");
    expect(metrics.uniquePayers).toBe(2);
    expect(metrics.repeatedPayers).toBe(1);
  });

  it("counts repeated payers once per unique payer", async () => {
    await recordSettlement(tdb.db, event({ payerAddress: PAYER_A }));
    await recordSettlement(tdb.db, event({ payerAddress: PAYER_A }));
    await recordSettlement(tdb.db, event({ payerAddress: PAYER_B }));
    await recordSettlement(tdb.db, event({ payerAddress: PAYER_B }));
    await recordSettlement(tdb.db, event({ payerAddress: PAYER_C }));

    const metrics = await metricsForEndpoint(tdb.db, endpoint.id);
    expect(metrics.uniquePayers).toBe(3);
    expect(metrics.repeatedPayers).toBe(2);
  });

  it("excludes failed events from GMV and payers", async () => {
    await recordSettlement(tdb.db, event({ amountAtomic: "1000000", payerAddress: PAYER_A }));
    await recordSettlement(tdb.db, event({
      amountAtomic: "2000000",
      payerAddress: PAYER_B,
      outcome: "upstream_failed",
      txHash: null,
    }));

    const metrics = await metricsForEndpoint(tdb.db, endpoint.id);
    expect(metrics.paidCount).toBe(1);
    expect(metrics.gmvAtomic).toBe("1000000");
    expect(metrics.commissionAtomic).toBe("50000");
    expect(metrics.uniquePayers).toBe(1);
    expect(metrics.repeatedPayers).toBe(0);
  });

  it("computes upstream and settlement success rates", async () => {
    await recordSettlement(tdb.db, event({ outcome: "settled" }));
    await recordSettlement(tdb.db, event({ outcome: "upstream_failed", txHash: null }));
    await recordSettlement(tdb.db, event({ outcome: "settlement_failed", txHash: null }));

    const metrics = await metricsForEndpoint(tdb.db, endpoint.id);
    expect(metrics.upstreamSuccessRate).toBeCloseTo(2 / 3);
    expect(metrics.settlementSuccessRate).toBeCloseTo(1 / 2);
  });

  it("computes median and p95 upstream latency", async () => {
    for (const durationMs of [100, 200, 300, 400, 500]) {
      await recordSettlement(tdb.db, event({ upstreamDurationMs: durationMs }));
    }

    const metrics = await metricsForEndpoint(tdb.db, endpoint.id);
    expect(metrics.medianUpstreamLatencyMs).toBe(300);
    expect(metrics.p95UpstreamLatencyMs).toBe(500);
  });

  it("reports recent safe failures with timestamps", async () => {
    await recordSettlement(tdb.db, event({ outcome: "settled" }));
    await recordSettlement(tdb.db, event({
      outcome: "upstream_failed",
      txHash: null,
      upstreamStatus: 503,
    }));

    const metrics = await metricsForEndpoint(tdb.db, endpoint.id);
    expect(metrics.recentFailures).toHaveLength(1);
    expect(metrics.recentFailures[0]).toMatchObject({
      outcome: "upstream_failed",
      upstreamStatus: 503,
    });
  });

  it("only aggregates events for the requested endpoint", async () => {
    const other = await createEndpoint(tdb.db, OWNER_A, spec({ amountAtomic: "500" }), "endpoint-2");
    await recordSettlement(tdb.db, event());
    await recordSettlement(tdb.db, event({ endpointId: other.id }));

    const metrics = await metricsForEndpoint(tdb.db, endpoint.id);
    expect(metrics.paidCount).toBe(1);
    expect(metrics.gmvAtomic).toBe("1000000");
  });

  it("reports custodial seller balances and confirmed payout transactions", async () => {
    const [batch] = await tdb.db.insert(schema.payoutBatches).values({
      sellerPayTo: PAYER_A,
      sellerNetAtomic: "950000",
      commissionAtomic: "50000",
      status: "confirmed",
      confirmedAt: new Date(),
    }).returning();
    await tdb.db.insert(schema.settlementObligations).values({
      endpointId: endpoint.id,
      payoutBatchId: batch!.id,
      requestId: "custodial-request",
      fingerprint: "custodial-fingerprint",
      payerAddress: PAYER_B,
      authorizationNonce: `0x${"ab".repeat(32)}`,
      authorizationValidBefore: new Date("2026-08-21T10:00:00Z"),
      sellerPayTo: PAYER_A,
      grossAtomic: "1000000",
      commissionAtomic: "50000",
      sellerNetAtomic: "950000",
      settlementStatus: "settled",
      settlementTxHash: `0x${"12".repeat(32)}`,
    });
    await tdb.db.insert(schema.outgoingTransferAttempts).values({
      businessKey: `payout:${batch!.id}`,
      transferKind: "seller",
      attemptNumber: 1,
      nonce: "1",
      recipient: PAYER_A,
      amountAtomic: "950000",
      rawTransaction: "0x02",
      txHash: `0x${"34".repeat(32)}`,
      status: "confirmed",
    });

    const metrics = await metricsForEndpoint(tdb.db, endpoint.id);
    expect(metrics).toMatchObject({
      sellerNetAtomic: "950000",
      pendingPayoutAtomic: "0",
      paidOutAtomic: "950000",
      payoutTransactions: [`0x${"34".repeat(32)}`],
    });
  });
});
