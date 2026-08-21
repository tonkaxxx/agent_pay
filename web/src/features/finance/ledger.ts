import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import type { GatewayDatabase } from "@/features/gateway/repository";

import { CUSTODIAL_LIABILITY_CAP_ATOMIC, splitCommission } from "./policy";

const WORKER_HEARTBEAT_MAX_AGE_MS = 2 * 60 * 1000;

export class FinancePausedError extends Error {
  constructor() {
    super("Custodial settlement is paused");
    this.name = "FinancePausedError";
  }
}

export class WorkerUnavailableError extends Error {
  constructor() {
    super("Payout worker heartbeat is unavailable or stale");
    this.name = "WorkerUnavailableError";
  }
}

export class CustodialLiabilityCapError extends Error {
  constructor() {
    super("Custodial seller liability cap reached");
    this.name = "CustodialLiabilityCapError";
  }
}

export class ObligationConflictError extends Error {
  constructor() {
    super("Payment authorization conflicts with an existing obligation");
    this.name = "ObligationConflictError";
  }
}

export interface ReserveObligationInput {
  readonly endpointId: string;
  readonly requestId: string;
  readonly fingerprint: string;
  readonly payerAddress: string;
  readonly authorizationNonce: string;
  readonly authorizationValidBefore: Date;
  readonly sellerPayTo: string;
  readonly grossAtomic: string;
}

export interface ReserveObligationOptions {
  readonly now?: Date;
  readonly liabilityCapAtomic?: string;
  readonly heartbeatMaxAgeMs?: number;
}

type Obligation = typeof schema.settlementObligations.$inferSelect;

function sameReservation(row: Obligation, input: ReserveObligationInput): boolean {
  return row.endpointId === input.endpointId &&
    row.payerAddress.toLowerCase() === input.payerAddress.toLowerCase() &&
    row.authorizationNonce.toLowerCase() === input.authorizationNonce.toLowerCase() &&
    row.sellerPayTo.toLowerCase() === input.sellerPayTo.toLowerCase() &&
    row.grossAtomic === input.grossAtomic;
}

export async function reserveObligation(
  db: GatewayDatabase,
  input: ReserveObligationInput,
  options: ReserveObligationOptions = {},
): Promise<Obligation> {
  const now = options.now ?? new Date();
  const cap = BigInt(options.liabilityCapAtomic ?? CUSTODIAL_LIABILITY_CAP_ATOMIC);
  const heartbeatMaxAgeMs = options.heartbeatMaxAgeMs ?? WORKER_HEARTBEAT_MAX_AGE_MS;
  const split = splitCommission(input.grossAtomic);

  return db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(schema.settlementObligations)
      .where(eq(schema.settlementObligations.fingerprint, input.fingerprint))
      .limit(1);
    const existing = existingRows[0];
    if (existing !== undefined) {
      if (!sameReservation(existing, input)) throw new ObligationConflictError();
      if (existing.settlementStatus !== "pending" && existing.settlementStatus !== "settled") {
        throw new ObligationConflictError();
      }
      return existing;
    }

    const stateRows = await tx
      .select()
      .from(schema.financeState)
      .where(eq(schema.financeState.id, 1))
      .for("update")
      .limit(1);
    const state = stateRows[0];
    if (state === undefined || state.paused) throw new FinancePausedError();
    if (
      state.workerHeartbeatAt === null ||
      now.getTime() - state.workerHeartbeatAt.getTime() > heartbeatMaxAgeMs
    ) {
      throw new WorkerUnavailableError();
    }

    const nextReserved = BigInt(state.reservedSellerNetAtomic) + BigInt(split.sellerNetAtomic);
    if (nextReserved > cap) throw new CustodialLiabilityCapError();

    const inserted = await tx
      .insert(schema.settlementObligations)
      .values({
        ...input,
        commissionAtomic: split.commissionAtomic,
        sellerNetAtomic: split.sellerNetAtomic,
        settlementStatus: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await tx
      .update(schema.financeState)
      .set({ reservedSellerNetAtomic: nextReserved.toString(), updatedAt: now })
      .where(eq(schema.financeState.id, 1));
    return inserted[0]!;
  });
}

export async function markObligationSettled(
  db: GatewayDatabase,
  fingerprint: string,
  transactionHash: string,
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.settlementObligations)
      .where(eq(schema.settlementObligations.fingerprint, fingerprint))
      .for("update")
      .limit(1);
    const obligation = rows[0];
    if (obligation === undefined) throw new ObligationConflictError();
    if (obligation.settlementStatus === "settled") {
      if (obligation.settlementTxHash !== transactionHash) throw new ObligationConflictError();
      return;
    }
    if (obligation.settlementStatus !== "pending") throw new ObligationConflictError();
    await tx
      .update(schema.settlementObligations)
      .set({
        settlementStatus: "settled",
        settlementTxHash: transactionHash,
        settledAt: now,
        updatedAt: now,
      })
      .where(eq(schema.settlementObligations.id, obligation.id));
  });
}

export async function cancelObligation(
  db: GatewayDatabase,
  fingerprint: string,
  now = new Date(),
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(schema.settlementObligations)
      .where(eq(schema.settlementObligations.fingerprint, fingerprint))
      .for("update")
      .limit(1);
    const obligation = rows[0];
    if (obligation === undefined || obligation.settlementStatus !== "pending") return;

    const stateRows = await tx
      .select()
      .from(schema.financeState)
      .where(eq(schema.financeState.id, 1))
      .for("update")
      .limit(1);
    const state = stateRows[0];
    if (state === undefined) throw new FinancePausedError();
    const nextReserved = BigInt(state.reservedSellerNetAtomic) - BigInt(obligation.sellerNetAtomic);
    if (nextReserved < 0n) throw new Error("Finance liability invariant violated");

    await tx
      .update(schema.settlementObligations)
      .set({ settlementStatus: "cancelled", updatedAt: now })
      .where(eq(schema.settlementObligations.id, obligation.id));
    await tx
      .update(schema.financeState)
      .set({ reservedSellerNetAtomic: nextReserved.toString(), updatedAt: now })
      .where(eq(schema.financeState.id, 1));
  });
}
