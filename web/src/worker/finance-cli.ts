import { createDbClient } from "@/db/client";
import * as schema from "@/db/schema";
import { loadPayoutWorkerConfig } from "@/features/finance/config";
import {
  createBasePayoutChain,
  createBaseReconciliationChain,
} from "@/features/finance/payout-chain";
import { setFinancePause, updateWorkerHeartbeat } from "@/features/finance/payouts";
import { reconcilePendingObligations } from "@/features/finance/reconciliation";
import { processTransfers } from "@/features/finance/transfer-engine";

export type FinanceCommand =
  | { readonly command: "status" | "resume" | "reconcile" | "run-now" }
  | { readonly command: "pause"; readonly reason: string };

export function parseFinanceCommand(args: readonly string[]): FinanceCommand {
  if (args.length === 1 && ["status", "resume", "reconcile", "run-now"].includes(args[0]!)) {
    return { command: args[0] as "status" | "resume" | "reconcile" | "run-now" };
  }
  if (args[0] === "pause" && args.length === 2 && args[1]!.trim()) {
    return { command: "pause", reason: args[1]!.trim() };
  }
  throw new Error("invalid_arguments");
}

function requiredDatabaseUrl(environment: Readonly<Record<string, string | undefined>>): string {
  const value = environment.DATABASE_URL;
  if (!value) throw new Error("database_url_required");
  return value;
}

export async function runFinanceCommand(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Record<string, unknown>> {
  const command = parseFinanceCommand(args);
  const handle = createDbClient(requiredDatabaseUrl(environment));
  try {
    if (command.command === "pause") {
      await setFinancePause(handle.db, true, command.reason);
      return { status: "paused", reason: command.reason };
    }
    if (command.command === "resume") {
      await setFinancePause(handle.db, false, null);
      return { status: "resumed" };
    }
    if (command.command === "status") {
      const [state, obligations, batches, sweeps, attempts] = await Promise.all([
        handle.db.select().from(schema.financeState),
        handle.db.select().from(schema.settlementObligations),
        handle.db.select().from(schema.payoutBatches),
        handle.db.select().from(schema.feeSweeps),
        handle.db.select().from(schema.outgoingTransferAttempts),
      ]);
      return {
        state: state[0] ?? null,
        obligations: obligations.length,
        payoutBatches: batches.length,
        feeSweeps: sweeps.length,
        outgoingAttempts: attempts.length,
      };
    }

    const config = loadPayoutWorkerConfig(environment);
    const now = new Date();
    await updateWorkerHeartbeat(handle.db, now);
    await reconcilePendingObligations(
      handle.db,
      createBaseReconciliationChain(config.rpcUrl),
      config.collectionAddress,
      now,
    );
    if (command.command === "run-now") {
      await processTransfers(
        handle.db,
        createBasePayoutChain(config.rpcUrl, config.privateKey),
        now,
        config.feeRecipient,
      );
    }
    return { status: command.command === "reconcile" ? "reconciled" : "cycle_complete" };
  } finally {
    await handle.close();
  }
}

if (process.argv[1]?.endsWith("finance-cli.mjs")) {
  runFinanceCommand(process.argv.slice(2)).then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error: unknown) => {
    const message = error instanceof Error && /^[a-z_]+$/.test(error.message)
      ? error.message
      : "finance_command_failed";
    process.stderr.write(`AgentPay finance command failed: ${message}\n`);
    process.exitCode = 1;
  });
}
