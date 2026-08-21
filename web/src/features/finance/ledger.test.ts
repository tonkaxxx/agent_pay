import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { createTestDatabase, resetTestDatabase, type TestDatabase } from "@/db/test-db";

import {
  cancelObligation,
  CustodialLiabilityCapError,
  FinancePausedError,
  markObligationSettled,
  ObligationConflictError,
  reserveObligation,
  WorkerUnavailableError,
} from "./ledger";

const OWNER_ID = "00000000-0000-0000-0000-000000000001";
const ENDPOINT_ID = "00000000-0000-0000-0000-000000000002";
const SELLER = "0x63A4536BC72c6d17A2ec1e6aa14555e0Ef9044D1";
const NOW = new Date("2026-08-21T09:00:00.000Z");

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase();
});

beforeEach(async () => {
  await resetTestDatabase(tdb);
  await tdb.db.insert(schema.users).values({ id: OWNER_ID, email: "seller@example.test" });
  await tdb.db.insert(schema.merchantEndpoints).values({
    id: ENDPOINT_ID,
    publicId: "paid-data",
    ownerId: OWNER_ID,
    displayName: "Paid data",
    upstreamUrl: "https://upstream.example/data",
    authMode: "bearer",
    payTo: SELLER,
    amountAtomic: "10000",
    status: "active",
  });
  await tdb.db
    .update(schema.financeState)
    .set({ workerHeartbeatAt: NOW })
    .where(eq(schema.financeState.id, 1));
});

afterAll(async () => {
  await tdb.close();
});

function input(fingerprint = "fingerprint-1") {
  return {
    endpointId: ENDPOINT_ID,
    requestId: "request-1",
    fingerprint,
    payerAddress: "0x1111111111111111111111111111111111111111",
    authorizationNonce: `0x${"ab".repeat(32)}`,
    authorizationValidBefore: new Date("2026-08-21T09:05:00.000Z"),
    sellerPayTo: SELLER,
    grossAtomic: "10000",
  } as const;
}

describe("reserveObligation", () => {
  it("atomically reserves the seller net and persists a 5% split", async () => {
    const obligation = await reserveObligation(tdb.db, input(), { now: NOW });

    expect(obligation).toMatchObject({
      fingerprint: "fingerprint-1",
      grossAtomic: "10000",
      commissionAtomic: "500",
      sellerNetAtomic: "9500",
      settlementStatus: "pending",
    });
    const state = await tdb.db.select().from(schema.financeState);
    expect(state[0]?.reservedSellerNetAtomic).toBe("9500");
  });

  it("is idempotent for the same authorization fingerprint", async () => {
    const first = await reserveObligation(tdb.db, input(), { now: NOW });
    const second = await reserveObligation(tdb.db, input(), { now: NOW });

    expect(second.id).toBe(first.id);
    const state = await tdb.db.select().from(schema.financeState);
    expect(state[0]?.reservedSellerNetAtomic).toBe("9500");
  });

  it("rejects a reservation above the configured liability cap", async () => {
    await expect(
      reserveObligation(tdb.db, input(), {
        now: NOW,
        liabilityCapAtomic: "9499",
      }),
    ).rejects.toBeInstanceOf(CustodialLiabilityCapError);
  });

  it("fails closed while finance is paused or the worker heartbeat is stale", async () => {
    await tdb.db
      .update(schema.financeState)
      .set({ paused: true })
      .where(eq(schema.financeState.id, 1));
    await expect(reserveObligation(tdb.db, input(), { now: NOW })).rejects.toBeInstanceOf(
      FinancePausedError,
    );

    await tdb.db
      .update(schema.financeState)
      .set({ paused: false, workerHeartbeatAt: new Date("2026-08-21T08:57:59.000Z") })
      .where(eq(schema.financeState.id, 1));
    await expect(reserveObligation(tdb.db, input(), { now: NOW })).rejects.toBeInstanceOf(
      WorkerUnavailableError,
    );
  });
});

describe("obligation lifecycle", () => {
  it("marks settlement without releasing the seller liability", async () => {
    const obligation = await reserveObligation(tdb.db, input(), { now: NOW });
    await markObligationSettled(tdb.db, obligation.fingerprint, `0x${"12".repeat(32)}`, NOW);

    const rows = await tdb.db.select().from(schema.settlementObligations);
    expect(rows[0]).toMatchObject({
      settlementStatus: "settled",
      settlementTxHash: `0x${"12".repeat(32)}`,
    });
    const state = await tdb.db.select().from(schema.financeState);
    expect(state[0]?.reservedSellerNetAtomic).toBe("9500");
  });

  it("cancels a pending authorization and releases its liability exactly once", async () => {
    const obligation = await reserveObligation(tdb.db, input(), { now: NOW });
    await cancelObligation(tdb.db, obligation.fingerprint, NOW);
    await cancelObligation(tdb.db, obligation.fingerprint, NOW);

    const rows = await tdb.db.select().from(schema.settlementObligations);
    expect(rows[0]?.settlementStatus).toBe("cancelled");
    const state = await tdb.db.select().from(schema.financeState);
    expect(state[0]?.reservedSellerNetAtomic).toBe("0");
  });

  it("rejects reuse or settlement of an authorization after liability was released", async () => {
    const obligation = await reserveObligation(tdb.db, input(), { now: NOW });
    await cancelObligation(tdb.db, obligation.fingerprint, NOW);

    await expect(reserveObligation(tdb.db, input(), { now: NOW }))
      .rejects.toBeInstanceOf(ObligationConflictError);
    await expect(
      markObligationSettled(tdb.db, obligation.fingerprint, `0x${"56".repeat(32)}`, NOW),
    ).rejects.toBeInstanceOf(ObligationConflictError);
    const state = await tdb.db.select().from(schema.financeState);
    expect(state[0]?.reservedSellerNetAtomic).toBe("0");
  });
});
