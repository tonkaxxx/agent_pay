import { eq } from "drizzle-orm";

import * as schema from "@/db/schema";
import type { GatewayDatabase } from "@/features/gateway/repository";

import { cancelObligation, markObligationSettled } from "./ledger";

export const AUTHORIZATION_EXPIRY_GRACE_MS = 2 * 60 * 1000;

export interface SettlementReconciliationChain {
  authorizationUsed(input: {
    readonly payerAddress: string;
    readonly nonce: string;
    readonly collectionAddress: string;
    readonly amountAtomic: string;
    readonly createdAt: Date;
    readonly validBefore: Date;
  }): Promise<string | null>;
}

export async function reconcilePendingObligations(
  db: GatewayDatabase,
  chain: SettlementReconciliationChain,
  collectionAddress: string,
  now = new Date(),
): Promise<void> {
  const pending = await db
    .select()
    .from(schema.settlementObligations)
    .where(eq(schema.settlementObligations.settlementStatus, "pending"));

  for (const obligation of pending) {
    const transactionHash = await chain.authorizationUsed({
      payerAddress: obligation.payerAddress,
      nonce: obligation.authorizationNonce,
      collectionAddress,
      amountAtomic: obligation.grossAtomic,
      createdAt: obligation.createdAt,
      validBefore: obligation.authorizationValidBefore,
    });
    if (transactionHash !== null) {
      await markObligationSettled(db, obligation.fingerprint, transactionHash, now);
    } else if (
      obligation.authorizationValidBefore.getTime() + AUTHORIZATION_EXPIRY_GRACE_MS <= now.getTime()
    ) {
      await cancelObligation(db, obligation.fingerprint, now);
    }
  }

  await db
    .update(schema.financeState)
    .set({ reconciledAt: now, updatedAt: now })
    .where(eq(schema.financeState.id, 1));
}
