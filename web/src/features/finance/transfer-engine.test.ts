import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";
import { createTestDatabase, resetTestDatabase, type TestDatabase } from "@/db/test-db";

import { processTransfers, type TransferChain } from "./transfer-engine";

const NOW = new Date("2026-08-21T09:00:00.000Z");
const SELLER = "0x63A4536BC72c6d17A2ec1e6aa14555e0Ef9044D1";

let tdb: TestDatabase;

beforeAll(async () => {
  tdb = await createTestDatabase();
});

beforeEach(async () => {
  await resetTestDatabase(tdb);
});

afterAll(async () => {
  await tdb.close();
});

function chain(receipt: "pending" | "confirmed" = "pending"): TransferChain {
  return {
    nativeBalance: vi.fn(async () => 10n ** 18n),
    nextNonce: vi.fn(async () => 7n),
    signUsdcTransfer: vi.fn(async ({ attemptNumber, nonce }) => ({
      rawTransaction: `0x02${attemptNumber}`,
      transactionHash: `0x${nonce.toString(16).padStart(64, "0")}`,
    })),
    broadcast: vi.fn(async () => undefined),
    receipt: vi.fn(async () => receipt),
  };
}

describe("processTransfers", () => {
  it("stores a signed raw transaction before broadcasting it", async () => {
    const [batch] = await tdb.db.insert(schema.payoutBatches).values({
      sellerPayTo: SELLER,
      sellerNetAtomic: "1000000",
      commissionAtomic: "52631",
    }).returning();
    const fake = chain();
    vi.mocked(fake.broadcast).mockImplementation(async () => {
      const attempts = await tdb.db.select().from(schema.outgoingTransferAttempts);
      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({ status: "signed", rawTransaction: "0x021" });
    });

    await processTransfers(tdb.db, fake, NOW);

    expect(fake.broadcast).toHaveBeenCalledWith("0x021");
    const attempts = await tdb.db.select().from(schema.outgoingTransferAttempts);
    expect(attempts[0]).toMatchObject({
      businessKey: `payout:${batch!.id}`,
      nonce: "7",
      status: "submitted",
    });
  });

  it("confirms a seller payout and releases the reserved liability", async () => {
    const [batch] = await tdb.db.insert(schema.payoutBatches).values({
      sellerPayTo: SELLER,
      sellerNetAtomic: "1000000",
      commissionAtomic: "52631",
      status: "submitted",
    }).returning();
    await tdb.db.update(schema.financeState).set({ reservedSellerNetAtomic: "1000000" });
    await tdb.db.insert(schema.outgoingTransferAttempts).values({
      businessKey: `payout:${batch!.id}`,
      transferKind: "seller",
      attemptNumber: 1,
      nonce: "7",
      recipient: SELLER,
      amountAtomic: "1000000",
      rawTransaction: "0x021",
      txHash: `0x${"11".repeat(32)}`,
      status: "submitted",
      submittedAt: NOW,
    });

    await processTransfers(tdb.db, chain("confirmed"), NOW);

    const batches = await tdb.db.select().from(schema.payoutBatches);
    expect(batches[0]?.status).toBe("confirmed");
    const state = await tdb.db.select().from(schema.financeState);
    expect(state[0]?.reservedSellerNetAtomic).toBe("0");
  });

  it("repairs business accounting after a crash that persisted only attempt confirmation", async () => {
    const [batch] = await tdb.db.insert(schema.payoutBatches).values({
      sellerPayTo: SELLER,
      sellerNetAtomic: "1000000",
      commissionAtomic: "52631",
      status: "submitted",
    }).returning();
    await tdb.db.update(schema.financeState).set({ reservedSellerNetAtomic: "1000000" });
    await tdb.db.insert(schema.outgoingTransferAttempts).values({
      businessKey: `payout:${batch!.id}`,
      transferKind: "seller",
      attemptNumber: 1,
      nonce: "7",
      recipient: SELLER,
      amountAtomic: "1000000",
      rawTransaction: "0x021",
      txHash: `0x${"22".repeat(32)}`,
      status: "confirmed",
      confirmedAt: NOW,
    });

    await processTransfers(tdb.db, chain(), NOW, SELLER, { prepareNew: false });

    const batches = await tdb.db.select().from(schema.payoutBatches);
    expect(batches[0]?.status).toBe("confirmed");
    const state = await tdb.db.select().from(schema.financeState);
    expect(state[0]?.reservedSellerNetAtomic).toBe("0");
  });

  it("atomically repairs a reverted transfer after a worker crash", async () => {
    const [batch] = await tdb.db.insert(schema.payoutBatches).values({
      sellerPayTo: SELLER,
      sellerNetAtomic: "1000000",
      commissionAtomic: "52631",
      status: "submitted",
    }).returning();
    await tdb.db.update(schema.financeState).set({
      paused: false,
      pauseReason: null,
      reservedSellerNetAtomic: "1000000",
    });
    await tdb.db.insert(schema.outgoingTransferAttempts).values({
      businessKey: `payout:${batch!.id}`,
      transferKind: "seller",
      attemptNumber: 1,
      nonce: "7",
      recipient: SELLER,
      amountAtomic: "1000000",
      rawTransaction: "0x021",
      txHash: `0x${"33".repeat(32)}`,
      status: "reverted",
      errorCode: "transaction_reverted",
      submittedAt: NOW,
    });

    await processTransfers(tdb.db, chain(), NOW, SELLER, { prepareNew: false });

    const batches = await tdb.db.select().from(schema.payoutBatches);
    expect(batches[0]?.status).toBe("failed");
    const state = await tdb.db.select().from(schema.financeState);
    expect(state[0]).toMatchObject({
      paused: true,
      pauseReason: "outgoing_transfer_reverted",
      reservedSellerNetAtomic: "1000000",
    });
  });

  it("pauses finance when the hot wallet has less than 0.0001 ETH for gas", async () => {
    const fake = chain();
    vi.mocked(fake.nativeBalance).mockResolvedValue(99_999_999_999_999n);

    await processTransfers(tdb.db, fake, NOW);

    const state = await tdb.db.select().from(schema.financeState);
    expect(state[0]).toMatchObject({ paused: true, pauseReason: "payout_gas_balance_low" });
  });

  it("keeps finance running with the funded production gas balance", async () => {
    const fake = chain();
    vi.mocked(fake.nativeBalance).mockResolvedValue(141_372_722_440_496n);

    await processTransfers(tdb.db, fake, NOW);

    const state = await tdb.db.select().from(schema.financeState);
    expect(state[0]).toMatchObject({ paused: false, pauseReason: null });
  });

  it("serializes overlapping cycles so distinct payouts never share a wallet nonce", async () => {
    await tdb.db.insert(schema.payoutBatches).values([
      {
        sellerPayTo: SELLER,
        sellerNetAtomic: "1000000",
        commissionAtomic: "52631",
        status: "prepared",
      },
      {
        sellerPayTo: "0x1111111111111111111111111111111111111111",
        sellerNetAtomic: "2000000",
        commissionAtomic: "105263",
        status: "prepared",
      },
    ]);
    const first = chain();
    const second = chain();

    await Promise.all([
      processTransfers(tdb.db, first, NOW, SELLER, { prepareNew: false }),
      processTransfers(tdb.db, second, NOW, SELLER, { prepareNew: false }),
    ]);

    const attempts = await tdb.db.select().from(schema.outgoingTransferAttempts);
    expect(attempts).toHaveLength(2);
    expect(new Set(attempts.map((attempt) => attempt.nonce))).toEqual(new Set(["7", "8"]));
    expect(new Set(attempts.map((attempt) => attempt.businessKey)).size).toBe(2);
  });
});
