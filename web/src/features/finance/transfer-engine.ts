import { and, eq, gt, inArray, lte, ne, sql } from "drizzle-orm";

import * as schema from "@/db/schema";
import type { GatewayDatabase } from "@/features/gateway/repository";

import {
  confirmOutgoingTransfer,
  failOutgoingTransfer,
  prepareEligiblePayoutBatches,
  prepareFeeSweep,
  setFinancePause,
} from "./payouts";

export const MINIMUM_PAYOUT_GAS_WEI = 100_000_000_000_000n;
export const REPLACEMENT_DELAY_MS = 10 * 60 * 1000;
export const MAX_TRANSFER_ATTEMPTS = 3;

export interface SignTransferInput {
  readonly recipient: string;
  readonly amountAtomic: string;
  readonly nonce: bigint;
  readonly attemptNumber: number;
}

export interface SignedTransfer {
  readonly rawTransaction: string;
  readonly transactionHash: string;
}

export interface TransferChain {
  nativeBalance(): Promise<bigint>;
  nextNonce(): Promise<bigint>;
  signUsdcTransfer(input: SignTransferInput): Promise<SignedTransfer>;
  broadcast(rawTransaction: string): Promise<void>;
  receipt(transactionHash: string): Promise<"pending" | "confirmed" | "reverted">;
}

interface TransferJob {
  readonly businessKey: string;
  readonly kind: "seller" | "fee";
  readonly recipient: string;
  readonly amountAtomic: string;
}

async function confirmSubmitted(
  db: GatewayDatabase,
  chain: TransferChain,
  now: Date,
): Promise<void> {
  const attempts = await db
    .select()
    .from(schema.outgoingTransferAttempts)
    .where(inArray(schema.outgoingTransferAttempts.status, ["submitted", "replaced"]));
  for (const attempt of attempts) {
    const receipt = await chain.receipt(attempt.txHash);
    if (receipt === "pending") continue;
    if (receipt === "reverted") {
      await failOutgoingTransfer(db, attempt.id, now);
      continue;
    }

    await confirmOutgoingTransfer(db, attempt.id, now);
  }
}

async function recoverRevertedBusinessState(
  db: GatewayDatabase,
  now: Date,
): Promise<void> {
  const sellerAttempts = await db
    .select({ id: schema.outgoingTransferAttempts.id })
    .from(schema.outgoingTransferAttempts)
    .innerJoin(
      schema.payoutBatches,
      sql`${schema.outgoingTransferAttempts.businessKey} = ${"payout:"} || ${schema.payoutBatches.id}::text`,
    )
    .where(and(
      eq(schema.outgoingTransferAttempts.status, "reverted"),
      inArray(schema.payoutBatches.status, ["prepared", "submitted"]),
    ));
  const feeAttempts = await db
    .select({ id: schema.outgoingTransferAttempts.id })
    .from(schema.outgoingTransferAttempts)
    .innerJoin(
      schema.feeSweeps,
      sql`${schema.outgoingTransferAttempts.businessKey} = ${"fee:"} || ${schema.feeSweeps.id}::text`,
    )
    .where(and(
      eq(schema.outgoingTransferAttempts.status, "reverted"),
      inArray(schema.feeSweeps.status, ["prepared", "submitted"]),
    ));
  for (const attempt of [...sellerAttempts, ...feeAttempts]) {
    await failOutgoingTransfer(db, attempt.id, now);
  }
}

async function recoverConfirmedBusinessState(
  db: GatewayDatabase,
  now: Date,
): Promise<void> {
  const sellerAttempts = await db
    .select({ id: schema.outgoingTransferAttempts.id })
    .from(schema.outgoingTransferAttempts)
    .innerJoin(
      schema.payoutBatches,
      sql`${schema.outgoingTransferAttempts.businessKey} = ${"payout:"} || ${schema.payoutBatches.id}::text`,
    )
    .where(and(
      eq(schema.outgoingTransferAttempts.status, "confirmed"),
      ne(schema.payoutBatches.status, "confirmed"),
    ));
  const feeAttempts = await db
    .select({ id: schema.outgoingTransferAttempts.id })
    .from(schema.outgoingTransferAttempts)
    .innerJoin(
      schema.feeSweeps,
      sql`${schema.outgoingTransferAttempts.businessKey} = ${"fee:"} || ${schema.feeSweeps.id}::text`,
    )
    .where(and(
      eq(schema.outgoingTransferAttempts.status, "confirmed"),
      ne(schema.feeSweeps.status, "confirmed"),
    ));
  for (const attempt of [...sellerAttempts, ...feeAttempts]) {
    await confirmOutgoingTransfer(db, attempt.id, now);
  }
}

async function preparedJobs(db: GatewayDatabase, feeRecipient: string): Promise<TransferJob[]> {
  const batches = await db
    .select()
    .from(schema.payoutBatches)
    .where(eq(schema.payoutBatches.status, "prepared"));
  const sweeps = await db
    .select()
    .from(schema.feeSweeps)
    .where(eq(schema.feeSweeps.status, "prepared"));
  return [
    ...batches.map((batch) => ({
      businessKey: `payout:${batch.id}`,
      kind: "seller" as const,
      recipient: batch.sellerPayTo,
      amountAtomic: batch.sellerNetAtomic,
    })),
    ...sweeps.map((sweep) => ({
      businessKey: `fee:${sweep.id}`,
      kind: "fee" as const,
      recipient: feeRecipient,
      amountAtomic: sweep.amountAtomic,
    })),
  ];
}

async function signAndBroadcast(
  db: GatewayDatabase,
  chain: TransferChain,
  jobs: readonly TransferJob[],
  now: Date,
): Promise<void> {
  if (jobs.length === 0) return;
  const persisted = await db.transaction(async (tx) => {
    await tx
      .select({ id: schema.financeState.id })
      .from(schema.financeState)
      .where(eq(schema.financeState.id, 1))
      .for("update");
    const keys = jobs.map((job) => job.businessKey);
    const existing = await tx
      .select({ businessKey: schema.outgoingTransferAttempts.businessKey })
      .from(schema.outgoingTransferAttempts)
      .where(inArray(schema.outgoingTransferAttempts.businessKey, keys));
    const existingKeys = new Set(existing.map((row) => row.businessKey));
    const allAttempts = await tx
      .select({ nonce: schema.outgoingTransferAttempts.nonce })
      .from(schema.outgoingTransferAttempts);
    const highestPersistedNonce = allAttempts.reduce<bigint | null>(
      (highest, attempt) => {
        const value = BigInt(attempt.nonce);
        return highest === null || value > highest ? value : highest;
      },
      null,
    );
    const chainNonce = await chain.nextNonce();
    let nonce = highestPersistedNonce === null || chainNonce > highestPersistedNonce
      ? chainNonce
      : highestPersistedNonce + 1n;
    const records: Array<{ attemptId: string; job: TransferJob; rawTransaction: string }> = [];
    for (const job of jobs) {
      if (existingKeys.has(job.businessKey)) continue;
      const signed = await chain.signUsdcTransfer({
        recipient: job.recipient,
        amountAtomic: job.amountAtomic,
        nonce,
        attemptNumber: 1,
      });
      const inserted = await tx
        .insert(schema.outgoingTransferAttempts)
        .values({
          businessKey: job.businessKey,
          transferKind: job.kind,
          attemptNumber: 1,
          nonce: nonce.toString(),
          recipient: job.recipient,
          amountAtomic: job.amountAtomic,
          rawTransaction: signed.rawTransaction,
          txHash: signed.transactionHash,
          status: "signed",
          createdAt: now,
        })
        .returning();
      records.push({
        attemptId: inserted[0]!.id,
        job,
        rawTransaction: signed.rawTransaction,
      });
      nonce += 1n;
    }
    return records;
  });

  for (const record of persisted) {
    try {
      await chain.broadcast(record.rawTransaction);
      await db
        .update(schema.outgoingTransferAttempts)
        .set({ status: "submitted", submittedAt: now })
        .where(eq(schema.outgoingTransferAttempts.id, record.attemptId));
      if (record.job.kind === "seller") {
        await db
          .update(schema.payoutBatches)
          .set({ status: "submitted", updatedAt: now })
          .where(eq(schema.payoutBatches.id, record.job.businessKey.slice("payout:".length)));
      } else {
        await db
          .update(schema.feeSweeps)
          .set({ status: "submitted", updatedAt: now })
          .where(eq(schema.feeSweeps.id, record.job.businessKey.slice("fee:".length)));
      }
    } catch {
      // The signed transaction remains durable and is retried on the next cycle.
    }
  }
}

async function retrySigned(
  db: GatewayDatabase,
  chain: TransferChain,
  now: Date,
): Promise<void> {
  const attempts = await db
    .select()
    .from(schema.outgoingTransferAttempts)
    .where(eq(schema.outgoingTransferAttempts.status, "signed"));
  for (const attempt of attempts) {
    try {
      await chain.broadcast(attempt.rawTransaction);
      await db
        .update(schema.outgoingTransferAttempts)
        .set({ status: "submitted", submittedAt: now })
        .where(eq(schema.outgoingTransferAttempts.id, attempt.id));
      await db
        .update(schema.outgoingTransferAttempts)
        .set({ status: "replaced" })
        .where(and(
          eq(schema.outgoingTransferAttempts.businessKey, attempt.businessKey),
          eq(schema.outgoingTransferAttempts.status, "submitted"),
          ne(schema.outgoingTransferAttempts.id, attempt.id),
        ));
      if (attempt.transferKind === "seller") {
        await db
          .update(schema.payoutBatches)
          .set({ status: "submitted", updatedAt: now })
          .where(eq(schema.payoutBatches.id, attempt.businessKey.slice("payout:".length)));
      } else {
        await db
          .update(schema.feeSweeps)
          .set({ status: "submitted", updatedAt: now })
          .where(eq(schema.feeSweeps.id, attempt.businessKey.slice("fee:".length)));
      }
    } catch {
      // Retry later using the same signed bytes and nonce.
    }
  }
}

async function replaceStaleTransfers(
  db: GatewayDatabase,
  chain: TransferChain,
  now: Date,
): Promise<void> {
  const staleBefore = new Date(now.getTime() - REPLACEMENT_DELAY_MS);
  const stale = await db
    .select()
    .from(schema.outgoingTransferAttempts)
    .where(and(
      eq(schema.outgoingTransferAttempts.status, "submitted"),
      lte(schema.outgoingTransferAttempts.submittedAt, staleBefore),
    ));
  for (const attempt of stale) {
    if (attempt.attemptNumber >= MAX_TRANSFER_ATTEMPTS) {
      await setFinancePause(db, true, "outgoing_transfer_stuck", now);
      continue;
    }
    const laterAttempts = await db
      .select({ id: schema.outgoingTransferAttempts.id })
      .from(schema.outgoingTransferAttempts)
      .where(and(
        eq(schema.outgoingTransferAttempts.businessKey, attempt.businessKey),
        gt(schema.outgoingTransferAttempts.attemptNumber, attempt.attemptNumber),
      ))
      .limit(1);
    if (laterAttempts.length > 0) continue;
    const replacementNumber = attempt.attemptNumber + 1;
    const signed = await chain.signUsdcTransfer({
      recipient: attempt.recipient,
      amountAtomic: attempt.amountAtomic,
      nonce: BigInt(attempt.nonce),
      attemptNumber: replacementNumber,
    });
    const inserted = await db
      .insert(schema.outgoingTransferAttempts)
      .values({
        businessKey: attempt.businessKey,
        transferKind: attempt.transferKind,
        attemptNumber: replacementNumber,
        nonce: attempt.nonce,
        recipient: attempt.recipient,
        amountAtomic: attempt.amountAtomic,
        rawTransaction: signed.rawTransaction,
        txHash: signed.transactionHash,
        status: "signed",
        createdAt: now,
      })
      .returning();
    try {
      await chain.broadcast(signed.rawTransaction);
      await db
        .update(schema.outgoingTransferAttempts)
        .set({ status: "submitted", submittedAt: now })
        .where(eq(schema.outgoingTransferAttempts.id, inserted[0]!.id));
      await db
        .update(schema.outgoingTransferAttempts)
        .set({ status: "replaced" })
        .where(eq(schema.outgoingTransferAttempts.id, attempt.id));
    } catch {
      // The replacement is durable and retrySigned will rebroadcast it.
    }
  }
}

export async function processTransfers(
  db: GatewayDatabase,
  chain: TransferChain,
  now = new Date(),
  feeRecipient = "0x0000000000000000000000000000000000000000",
  options: { readonly prepareNew?: boolean } = {},
): Promise<void> {
  if (await chain.nativeBalance() < MINIMUM_PAYOUT_GAS_WEI) {
    await setFinancePause(db, true, "payout_gas_balance_low", now);
    return;
  }

  await recoverConfirmedBusinessState(db, now);
  await recoverRevertedBusinessState(db, now);
  await confirmSubmitted(db, chain, now);
  await replaceStaleTransfers(db, chain, now);
  if (options.prepareNew !== false) {
    await prepareEligiblePayoutBatches(db, now);
    await prepareFeeSweep(db, now);
  }
  await retrySigned(db, chain, now);
  await signAndBroadcast(db, chain, await preparedJobs(db, feeRecipient), now);
}
