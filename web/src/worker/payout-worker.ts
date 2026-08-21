import { createDbClient } from "@/db/client";
import { loadPayoutWorkerConfig } from "@/features/finance/config";
import {
  createBasePayoutChain,
  createBaseReconciliationChain,
} from "@/features/finance/payout-chain";
import { updateWorkerHeartbeat } from "@/features/finance/payouts";
import { reconcilePendingObligations } from "@/features/finance/reconciliation";
import { processTransfers } from "@/features/finance/transfer-engine";

const HEARTBEAT_INTERVAL_MS = 30_000;
const PAYOUT_POLL_INTERVAL_MS = 60_000;
const RECONCILE_INTERVAL_MS = 5 * 60_000;

export async function runPayoutCycle(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const config = loadPayoutWorkerConfig(environment);
  const handle = createDbClient(config.databaseUrl);
  try {
    await updateWorkerHeartbeat(handle.db);
    await reconcilePendingObligations(
      handle.db,
      createBaseReconciliationChain(config.rpcUrl),
      config.collectionAddress,
    );
    await processTransfers(
      handle.db,
      createBasePayoutChain(config.rpcUrl, config.privateKey),
      new Date(),
      config.feeRecipient,
    );
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  const config = loadPayoutWorkerConfig(process.env);
  const handle = createDbClient(config.databaseUrl);
  const chain = createBasePayoutChain(config.rpcUrl, config.privateKey);
  const reconciliationChain = createBaseReconciliationChain(config.rpcUrl);
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  let lastPayoutRun = 0;
  let lastReconcileRun = 0;
  let lastPreparedUtcDate = "";
  try {
    while (!stopping) {
      const now = new Date();
      await updateWorkerHeartbeat(handle.db, now);
      if (now.getTime() - lastReconcileRun >= RECONCILE_INTERVAL_MS) {
        await reconcilePendingObligations(
          handle.db,
          reconciliationChain,
          config.collectionAddress,
          now,
        );
        lastReconcileRun = now.getTime();
      }
      if (now.getTime() - lastPayoutRun >= PAYOUT_POLL_INTERVAL_MS) {
        const utcDate = now.toISOString().slice(0, 10);
        const prepareNew = now.getUTCHours() >= 3 && lastPreparedUtcDate !== utcDate;
        await processTransfers(
          handle.db,
          chain,
          now,
          config.feeRecipient,
          { prepareNew },
        );
        if (prepareNew) lastPreparedUtcDate = utcDate;
        lastPayoutRun = now.getTime();
      }
      await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_INTERVAL_MS));
    }
  } finally {
    await handle.close();
  }
}

if (process.argv[1]?.endsWith("payout-worker.mjs")) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown_error";
    process.stderr.write(`AgentPay payout worker stopped: ${message}\n`);
    process.exitCode = 1;
  });
}
