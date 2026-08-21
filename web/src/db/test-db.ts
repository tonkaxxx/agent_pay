import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import * as schema from "@/db/schema";

export interface TestDatabase {
  readonly sql: PGlite;
  readonly db: PgliteDatabase<typeof schema>;
  close(): Promise<void>;
}

const migrationsFolder = path.resolve(process.cwd(), "src/db/migrations");
const migrationsTable = "agentpay_migrations";
const migrationsSchema = "public";

export async function createTestDatabase(): Promise<TestDatabase> {
  const sql = new PGlite();
  const db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder, migrationsTable, migrationsSchema });
  return {
    sql,
    db,
    close: () => sql.close(),
  };
}

export async function resetTestDatabase(tdb: TestDatabase): Promise<void> {
  await tdb.sql.exec(
    'TRUNCATE TABLE account, audit_event, authenticator, fee_sweep, merchant_endpoint, outgoing_transfer_attempt, payment_event, payout_batch, session, settlement_obligation, "user", "verificationToken" RESTART IDENTITY CASCADE',
  );
  await tdb.sql.exec(
    "UPDATE finance_state SET paused = false, pause_reason = NULL, reserved_seller_net_atomic = '0', worker_heartbeat_at = NULL, reconciled_at = NULL, updated_at = now() WHERE id = 1",
  );
}
