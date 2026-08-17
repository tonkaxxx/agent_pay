import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { createTestDatabase, resetTestDatabase, type TestDatabase } from "@/db/test-db";
import {
  createEndpoint,
  type EndpointSummary,
  type EndpointSpec,
} from "./repository";
import { commissionAtomic, recordSettlement, type SettlementEventInput } from "./events";

const OWNER_A = "00000000-0000-0000-0000-00000000000a";
const PAY_TO = "0x63A4536BC72c6d17A2ec1e6aa14555e0Ef9044D1";

let tdb: TestDatabase;
let endpoint: EndpointSummary;

function spec(overrides: Partial<EndpointSpec> = {}): EndpointSpec {
  return {
    displayName: "Weather",
    upstreamUrl: "https://api.example.com/weather",
    authMode: "none",
    payTo: PAY_TO,
    amountAtomic: "1234500",
    ...overrides,
  };
}

function event(overrides: Partial<SettlementEventInput> = {}): SettlementEventInput {
  return {
    endpointId: endpoint.id,
    requestId: "req-1",
    fingerprint: "abc123",
    payerAddress: PAY_TO,
    txHash: "0x" + "1".repeat(64),
    amountAtomic: endpoint.amountAtomic,
    upstreamStatus: 200,
    upstreamDurationMs: 120,
    upstreamResponseSize: 2048,
    settlementDurationMs: 850,
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

describe("commissionAtomic", () => {
  it("computes 5% of the atomic amount", () => {
    expect(commissionAtomic("1000000")).toBe("50000");
    expect(commissionAtomic("10000")).toBe("500");
    expect(commissionAtomic("1234500")).toBe("61725");
  });

  it("rounds down fractional atomic units", () => {
    expect(commissionAtomic("3")).toBe("0");
    expect(commissionAtomic("19")).toBe("0");
    expect(commissionAtomic("20")).toBe("1");
  });
});

describe("recordSettlement", () => {
  it("inserts a settled event with commission", async () => {
    await recordSettlement(tdb.db, event());

    const rows = await tdb.db.select().from(schema.paymentEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      endpointId: endpoint.id,
      requestId: "req-1",
      fingerprint: "abc123",
      payerAddress: PAY_TO,
      amountAtomic: "1234500",
      commissionAtomic: "61725",
      upstreamStatus: 200,
      upstreamDurationMs: 120,
      upstreamResponseSize: 2048,
      settlementDurationMs: 850,
      outcome: "settled",
    });
  });

  it("records failed events with zero commission", async () => {
    await recordSettlement(tdb.db, event({
      outcome: "upstream_failed",
      upstreamStatus: null,
      txHash: null,
    }));

    const rows = await tdb.db.select().from(schema.paymentEvents);
    expect(rows[0]?.commissionAtomic).toBe("0");
    expect(rows[0]?.outcome).toBe("upstream_failed");
    expect(rows[0]?.txHash).toBeNull();
  });

  it("never throws and logs a secret-free reconciliation line when the insert fails", async () => {
    const log = vi.fn();
    const broken = {
      insert: vi.fn().mockRejectedValue(new Error("db down")),
    } as unknown as typeof tdb.db;

    await expect(recordSettlement(broken, event(), log)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0]?.[0] as string;
    expect(line).toContain("req-1");
    expect(line).toContain(endpoint.id);
    expect(line).toContain("0x" + "1".repeat(64));
    expect(line).not.toContain("abc123");
  });

  it("is idempotent for a duplicate fingerprint", async () => {
    await recordSettlement(tdb.db, event());
    await recordSettlement(tdb.db, event());

    const rows = await tdb.db.select().from(schema.paymentEvents);
    expect(rows).toHaveLength(1);
  });

  it("is idempotent for a duplicate transaction hash", async () => {
    await recordSettlement(tdb.db, event());
    await recordSettlement(tdb.db, event({
      requestId: "req-2",
      fingerprint: "another-fingerprint",
    }));

    const rows = await tdb.db.select().from(schema.paymentEvents);
    expect(rows).toHaveLength(1);
  });

  it("does not record a payment event for a different endpoint", async () => {
    const other = await createEndpoint(tdb.db, OWNER_A, spec({ amountAtomic: "10000" }), "endpoint-2");
    await recordSettlement(tdb.db, event({ endpointId: other.id }));

    const rows = await tdb.db.select().from(schema.paymentEvents).where(
      eq(schema.paymentEvents.endpointId, endpoint.id),
    );
    expect(rows).toHaveLength(0);
  });
});
