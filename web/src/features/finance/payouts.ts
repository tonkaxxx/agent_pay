import { and, eq, inArray, isNull, ne } from "drizzle-orm";

import * as schema from "@/db/schema";
import type { GatewayDatabase } from "@/features/gateway/repository";

import { payoutEligibleAt, type PayoutPolicy } from "./policy";

type PayoutBatch = typeof schema.payoutBatches.$inferSelect;
type FeeSweep = typeof schema.feeSweeps.$inferSelect;

interface Candidate {
  readonly id: string;
  readonly endpointId: string;
  readonly sellerPayTo: string;
  readonly sellerNetAtomic: string;
  readonly commissionAtomic: string;
  readonly createdAt: Date;
  readonly payoutPolicy: PayoutPolicy;
}

export async function prepareEligiblePayoutBatches(
  db: GatewayDatabase,
  now = new Date(),
): Promise<PayoutBatch[]> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: schema.financeState.id })
      .from(schema.financeState)
      .where(eq(schema.financeState.id, 1))
      .for("update");

    const rows = await tx
      .select({
        id: schema.settlementObligations.id,
        endpointId: schema.settlementObligations.endpointId,
        sellerPayTo: schema.settlementObligations.sellerPayTo,
        sellerNetAtomic: schema.settlementObligations.sellerNetAtomic,
        commissionAtomic: schema.settlementObligations.commissionAtomic,
        createdAt: schema.settlementObligations.createdAt,
        payoutPolicy: schema.merchantEndpoints.payoutPolicy,
      })
      .from(schema.settlementObligations)
      .innerJoin(
        schema.merchantEndpoints,
        eq(schema.settlementObligations.endpointId, schema.merchantEndpoints.id),
      )
      .where(and(
        eq(schema.settlementObligations.settlementStatus, "settled"),
        isNull(schema.settlementObligations.payoutBatchId),
      ));

    const groups = new Map<string, Candidate[]>();
    for (const row of rows as Candidate[]) {
      const key = `${row.endpointId}:${row.sellerPayTo.toLowerCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    const created: PayoutBatch[] = [];
    for (const candidates of groups.values()) {
      const first = candidates[0]!;
      const sellerNet = candidates.reduce(
        (sum, row) => sum + BigInt(row.sellerNetAtomic),
        0n,
      );
      const commission = candidates.reduce(
        (sum, row) => sum + BigInt(row.commissionAtomic),
        0n,
      );
      const oldest = candidates.reduce(
        (value, row) => row.createdAt < value ? row.createdAt : value,
        first.createdAt,
      );
      const eligibleAt = payoutEligibleAt(first.payoutPolicy, sellerNet.toString(), oldest);
      if (eligibleAt === null || eligibleAt > now) continue;

      const inserted = await tx
        .insert(schema.payoutBatches)
        .values({
          sellerPayTo: first.sellerPayTo,
          sellerNetAtomic: sellerNet.toString(),
          commissionAtomic: commission.toString(),
          status: "prepared",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const batch = inserted[0]!;
      await tx
        .update(schema.settlementObligations)
        .set({ payoutBatchId: batch.id, updatedAt: now })
        .where(inArray(
          schema.settlementObligations.id,
          candidates.map((candidate) => candidate.id),
        ));
      created.push(batch);
    }
    return created;
  });
}

export async function confirmPayoutBatch(
  db: GatewayDatabase,
  batchId: string,
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const batches = await tx
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.id, batchId))
      .for("update")
      .limit(1);
    const batch = batches[0];
    if (batch === undefined || batch.status === "confirmed") return;

    const stateRows = await tx
      .select()
      .from(schema.financeState)
      .where(eq(schema.financeState.id, 1))
      .for("update")
      .limit(1);
    const state = stateRows[0];
    if (state === undefined) throw new Error("Finance state unavailable");
    const nextReserved = BigInt(state.reservedSellerNetAtomic) - BigInt(batch.sellerNetAtomic);
    if (nextReserved < 0n) throw new Error("Finance liability invariant violated");

    await tx
      .update(schema.payoutBatches)
      .set({ status: "confirmed", confirmedAt: now, updatedAt: now })
      .where(eq(schema.payoutBatches.id, batch.id));
    await tx
      .update(schema.financeState)
      .set({ reservedSellerNetAtomic: nextReserved.toString(), updatedAt: now })
      .where(eq(schema.financeState.id, 1));
  });
}

export async function confirmOutgoingTransfer(
  db: GatewayDatabase,
  attemptId: string,
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const attempts = await tx
      .select()
      .from(schema.outgoingTransferAttempts)
      .where(eq(schema.outgoingTransferAttempts.id, attemptId))
      .for("update")
      .limit(1);
    const attempt = attempts[0];
    if (attempt === undefined || !["submitted", "replaced", "confirmed"].includes(attempt.status)) {
      throw new Error("Outgoing transfer is not confirmable");
    }

    if (attempt.transferKind === "seller") {
      const batchId = attempt.businessKey.slice("payout:".length);
      const batches = await tx
        .select()
        .from(schema.payoutBatches)
        .where(eq(schema.payoutBatches.id, batchId))
        .for("update")
        .limit(1);
      const batch = batches[0];
      if (batch === undefined) throw new Error("Payout batch unavailable");
      if (batch.status !== "confirmed") {
        const stateRows = await tx
          .select()
          .from(schema.financeState)
          .where(eq(schema.financeState.id, 1))
          .for("update")
          .limit(1);
        const state = stateRows[0];
        if (state === undefined) throw new Error("Finance state unavailable");
        const nextReserved = BigInt(state.reservedSellerNetAtomic) - BigInt(batch.sellerNetAtomic);
        if (nextReserved < 0n) throw new Error("Finance liability invariant violated");
        await tx
          .update(schema.financeState)
          .set({ reservedSellerNetAtomic: nextReserved.toString(), updatedAt: now })
          .where(eq(schema.financeState.id, 1));
        await tx
          .update(schema.payoutBatches)
          .set({ status: "confirmed", confirmedAt: now, updatedAt: now })
          .where(eq(schema.payoutBatches.id, batch.id));
      }
    } else {
      const sweepId = attempt.businessKey.slice("fee:".length);
      await tx
        .update(schema.feeSweeps)
        .set({ status: "confirmed", confirmedAt: now, updatedAt: now })
        .where(eq(schema.feeSweeps.id, sweepId));
    }

    await tx
      .update(schema.outgoingTransferAttempts)
      .set({ status: "confirmed", confirmedAt: now })
      .where(eq(schema.outgoingTransferAttempts.id, attempt.id));
    await tx
      .update(schema.outgoingTransferAttempts)
      .set({ status: "replaced" })
      .where(and(
        eq(schema.outgoingTransferAttempts.businessKey, attempt.businessKey),
        inArray(schema.outgoingTransferAttempts.status, ["signed", "submitted"]),
        ne(schema.outgoingTransferAttempts.id, attempt.id),
      ));
  });
}

export async function failOutgoingTransfer(
  db: GatewayDatabase,
  attemptId: string,
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const attempts = await tx
      .select()
      .from(schema.outgoingTransferAttempts)
      .where(eq(schema.outgoingTransferAttempts.id, attemptId))
      .for("update")
      .limit(1);
    const attempt = attempts[0];
    if (attempt === undefined || !["submitted", "replaced", "reverted"].includes(attempt.status)) {
      throw new Error("Outgoing transfer is not failable");
    }

    if (attempt.transferKind === "seller") {
      if (!attempt.businessKey.startsWith("payout:")) {
        throw new Error("Invalid seller transfer business key");
      }
      const batchId = attempt.businessKey.slice("payout:".length);
      const batches = await tx
        .select({ id: schema.payoutBatches.id, status: schema.payoutBatches.status })
        .from(schema.payoutBatches)
        .where(eq(schema.payoutBatches.id, batchId))
        .for("update")
        .limit(1);
      const batch = batches[0];
      if (batch === undefined) throw new Error("Payout batch unavailable");
      if (batch.status === "confirmed") throw new Error("Confirmed payout cannot fail");
      await tx
        .update(schema.payoutBatches)
        .set({ status: "failed", updatedAt: now })
        .where(eq(schema.payoutBatches.id, batch.id));
    } else {
      if (!attempt.businessKey.startsWith("fee:")) {
        throw new Error("Invalid fee transfer business key");
      }
      const sweepId = attempt.businessKey.slice("fee:".length);
      const sweeps = await tx
        .select({ id: schema.feeSweeps.id, status: schema.feeSweeps.status })
        .from(schema.feeSweeps)
        .where(eq(schema.feeSweeps.id, sweepId))
        .for("update")
        .limit(1);
      const sweep = sweeps[0];
      if (sweep === undefined) throw new Error("Fee sweep unavailable");
      if (sweep.status === "confirmed") throw new Error("Confirmed fee sweep cannot fail");
      await tx
        .update(schema.feeSweeps)
        .set({ status: "failed", updatedAt: now })
        .where(eq(schema.feeSweeps.id, sweep.id));
    }

    await tx
      .update(schema.outgoingTransferAttempts)
      .set({ status: "reverted", errorCode: "transaction_reverted" })
      .where(eq(schema.outgoingTransferAttempts.id, attempt.id));
    await tx
      .update(schema.financeState)
      .set({
        paused: true,
        pauseReason: "outgoing_transfer_reverted",
        updatedAt: now,
      })
      .where(eq(schema.financeState.id, 1));
  });
}

export async function prepareFeeSweep(
  db: GatewayDatabase,
  now = new Date(),
): Promise<FeeSweep | null> {
  return db.transaction(async (tx) => {
    await tx
      .select({ id: schema.financeState.id })
      .from(schema.financeState)
      .where(eq(schema.financeState.id, 1))
      .for("update");
    const batches = await tx
      .select()
      .from(schema.payoutBatches)
      .where(and(
        eq(schema.payoutBatches.status, "confirmed"),
        isNull(schema.payoutBatches.feeSweepId),
      ));
    if (batches.length === 0) return null;
    const amount = batches.reduce(
      (sum, batch) => sum + BigInt(batch.commissionAtomic),
      0n,
    );
    if (amount <= 0n) return null;

    const inserted = await tx
      .insert(schema.feeSweeps)
      .values({ amountAtomic: amount.toString(), status: "prepared", createdAt: now, updatedAt: now })
      .returning();
    const sweep = inserted[0]!;
    await tx
      .update(schema.payoutBatches)
      .set({ feeSweepId: sweep.id, updatedAt: now })
      .where(inArray(schema.payoutBatches.id, batches.map((batch) => batch.id)));
    return sweep;
  });
}

export async function updateWorkerHeartbeat(
  db: GatewayDatabase,
  now = new Date(),
): Promise<void> {
  await db
    .update(schema.financeState)
    .set({ workerHeartbeatAt: now, updatedAt: now })
    .where(eq(schema.financeState.id, 1));
}

export async function setFinancePause(
  db: GatewayDatabase,
  paused: boolean,
  reason: string | null,
  now = new Date(),
): Promise<void> {
  await db
    .update(schema.financeState)
    .set({ paused, pauseReason: paused ? reason : null, updatedAt: now })
    .where(eq(schema.financeState.id, 1));
}
