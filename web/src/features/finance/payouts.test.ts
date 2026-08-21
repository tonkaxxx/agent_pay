import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import { createTestDatabase, resetTestDatabase, type TestDatabase } from "@/db/test-db";

import {
  confirmPayoutBatch,
  prepareEligiblePayoutBatches,
  prepareFeeSweep,
} from "./payouts";

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
    amountAtomic: "1000000",
    payoutPolicy: "threshold_or_weekly",
    status: "active",
  });
});

afterAll(async () => {
  await tdb.close();
});

async function obligation(
  id: string,
  sellerNetAtomic: string,
  commissionAtomic: string,
  createdAt: Date,
) {
  await tdb.db.insert(schema.settlementObligations).values({
    id,
    endpointId: ENDPOINT_ID,
    requestId: `request-${id}`,
    fingerprint: `fingerprint-${id}`,
    payerAddress: "0x1111111111111111111111111111111111111111",
    authorizationNonce: `0x${id.replaceAll("-", "").padEnd(64, "a").slice(0, 64)}`,
    authorizationValidBefore: new Date("2026-08-21T10:00:00.000Z"),
    sellerPayTo: SELLER,
    grossAtomic: (BigInt(sellerNetAtomic) + BigInt(commissionAtomic)).toString(),
    commissionAtomic,
    sellerNetAtomic,
    settlementStatus: "settled",
    settlementTxHash: `0x${id.replaceAll("-", "").padEnd(64, "b").slice(0, 64)}`,
    settledAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  });
  const state = (await tdb.db.select().from(schema.financeState))[0]!;
  await tdb.db
    .update(schema.financeState)
    .set({
      reservedSellerNetAtomic: (
        BigInt(state.reservedSellerNetAtomic) + BigInt(sellerNetAtomic)
      ).toString(),
    })
    .where(eq(schema.financeState.id, 1));
}

describe("prepareEligiblePayoutBatches", () => {
  it("prepares a weekly fallback payout below the 1 USDC threshold", async () => {
    await obligation(
      "00000000-0000-0000-0000-000000000010",
      "950000",
      "50000",
      new Date("2026-08-14T08:59:59.000Z"),
    );

    const batches = await prepareEligiblePayoutBatches(tdb.db, NOW);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({
      sellerPayTo: SELLER,
      sellerNetAtomic: "950000",
      commissionAtomic: "50000",
      status: "prepared",
    });
  });

  it("does not pay below threshold when the endpoint is threshold-only", async () => {
    await tdb.db
      .update(schema.merchantEndpoints)
      .set({ payoutPolicy: "threshold" })
      .where(eq(schema.merchantEndpoints.id, ENDPOINT_ID));
    await obligation(
      "00000000-0000-0000-0000-000000000011",
      "950000",
      "50000",
      new Date("2026-08-01T00:00:00.000Z"),
    );

    expect(await prepareEligiblePayoutBatches(tdb.db, NOW)).toEqual([]);
  });

  it("binds all eligible obligations to one idempotent batch", async () => {
    await obligation(
      "00000000-0000-0000-0000-000000000012",
      "600000",
      "31579",
      new Date("2026-08-21T08:00:00.000Z"),
    );
    await obligation(
      "00000000-0000-0000-0000-000000000013",
      "500000",
      "26315",
      new Date("2026-08-21T08:30:00.000Z"),
    );

    const first = await prepareEligiblePayoutBatches(tdb.db, NOW);
    const second = await prepareEligiblePayoutBatches(tdb.db, NOW);

    expect(first).toHaveLength(1);
    expect(second).toEqual([]);
    const rows = await tdb.db.select().from(schema.settlementObligations);
    expect(new Set(rows.map((row) => row.payoutBatchId))).toEqual(new Set([first[0]!.id]));
  });
});

describe("payout confirmation and fee sweep", () => {
  it("releases seller liability only after payout confirmation, then prepares the fee sweep", async () => {
    await obligation(
      "00000000-0000-0000-0000-000000000014",
      "1000000",
      "52631",
      new Date("2026-08-21T08:00:00.000Z"),
    );
    const [batch] = await prepareEligiblePayoutBatches(tdb.db, NOW);
    expect(batch).toBeDefined();

    await confirmPayoutBatch(tdb.db, batch!.id, NOW);
    await confirmPayoutBatch(tdb.db, batch!.id, NOW);

    const state = await tdb.db.select().from(schema.financeState);
    expect(state[0]?.reservedSellerNetAtomic).toBe("0");
    const sweep = await prepareFeeSweep(tdb.db, NOW);
    expect(sweep).toMatchObject({ amountAtomic: "52631", status: "prepared" });
    expect(await prepareFeeSweep(tdb.db, NOW)).toBeNull();
  });
});
