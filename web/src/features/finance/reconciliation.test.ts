import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { createTestDatabase, resetTestDatabase, type TestDatabase } from "@/db/test-db";

import { reconcilePendingObligations } from "./reconciliation";

const OWNER_ID = "00000000-0000-0000-0000-000000000001";
const ENDPOINT_ID = "00000000-0000-0000-0000-000000000002";
const SELLER = "0x63A4536BC72c6d17A2ec1e6aa14555e0Ef9044D1";
const COLLECTION = "0x1111111111111111111111111111111111111111";
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
  });
});

afterAll(async () => {
  await tdb.close();
});

async function pending(validBefore: Date) {
  await tdb.db.insert(schema.settlementObligations).values({
    endpointId: ENDPOINT_ID,
    requestId: "request-1",
    fingerprint: "fingerprint-1",
    payerAddress: "0x2222222222222222222222222222222222222222",
    authorizationNonce: `0x${"ab".repeat(32)}`,
    authorizationValidBefore: validBefore,
    sellerPayTo: SELLER,
    grossAtomic: "10000",
    commissionAtomic: "500",
    sellerNetAtomic: "9500",
    settlementStatus: "pending",
  });
  await tdb.db.update(schema.financeState).set({ reservedSellerNetAtomic: "9500" });
}

describe("reconcilePendingObligations", () => {
  it("marks an on-chain authorization transfer as settled", async () => {
    await pending(new Date("2026-08-21T09:05:00Z"));
    const authorizationUsed = vi.fn(async () => `0x${"12".repeat(32)}`);

    await reconcilePendingObligations(tdb.db, { authorizationUsed }, COLLECTION, NOW);

    const rows = await tdb.db.select().from(schema.settlementObligations);
    expect(rows[0]).toMatchObject({
      settlementStatus: "settled",
      settlementTxHash: `0x${"12".repeat(32)}`,
    });
  });

  it("releases an expired authorization that was never used", async () => {
    await pending(new Date("2026-08-21T08:57:59Z"));

    await reconcilePendingObligations(
      tdb.db,
      { authorizationUsed: vi.fn(async () => null) },
      COLLECTION,
      NOW,
    );

    const rows = await tdb.db.select().from(schema.settlementObligations);
    expect(rows[0]?.settlementStatus).toBe("cancelled");
    const state = await tdb.db.select().from(schema.financeState);
    expect(state[0]?.reservedSellerNetAtomic).toBe("0");
  });

  it("keeps an unused unexpired authorization pending", async () => {
    await pending(new Date("2026-08-21T09:05:00Z"));

    await reconcilePendingObligations(
      tdb.db,
      { authorizationUsed: vi.fn(async () => null) },
      COLLECTION,
      NOW,
    );

    const rows = await tdb.db.select().from(schema.settlementObligations);
    expect(rows[0]?.settlementStatus).toBe("pending");
  });
});
