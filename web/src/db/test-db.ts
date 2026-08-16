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
    'TRUNCATE TABLE account, audit_event, authenticator, merchant_endpoint, payment_event, session, "user", "verificationToken" RESTART IDENTITY CASCADE',
  );
}