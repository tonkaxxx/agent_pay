import { migrate as pgliteMigrate } from "drizzle-orm/pglite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyMigrations, migrationsFolder, migrationsSchema, migrationsTable } from "@/db/migrate";
import { createTestDatabase, type TestDatabase } from "@/db/test-db";

let tdb: TestDatabase;

beforeEach(async () => {
  tdb = await createTestDatabase();
});

afterEach(async () => {
  await tdb.close();
});

describe("migration runner", () => {
  it("publishes a fixed migration folder and dedicated migrations table", () => {
    expect(migrationsFolder).toContain("src/db/migrations");
    expect(migrationsTable).toBe("agentpay_migrations");
    expect(migrationsSchema).toBe("public");
  });

  it("is idempotent: re-running migrations applies nothing twice", async () => {
    await applyMigrations(tdb.db, pgliteMigrate);

    const before = await tdb.sql.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM agentpay_migrations",
    );
    const beforeCount = before.rows[0]!.count;
    expect(Number(beforeCount)).toBeGreaterThan(0);

    await applyMigrations(tdb.db, pgliteMigrate);

    const after = await tdb.sql.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM agentpay_migrations",
    );
    expect(after.rows[0]!.count).toBe(beforeCount);

    const tables = await tdb.sql.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    expect(tables.rows.some((r) => r.table_name === "merchant_endpoint")).toBe(true);
  });

  it("rejects an invalid migration config early", async () => {
    let rejected = false;
    try {
      await pgliteMigrate(tdb.db, {
        migrationsFolder: "/nonexistent/migrations",
        migrationsTable,
        migrationsSchema,
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
});