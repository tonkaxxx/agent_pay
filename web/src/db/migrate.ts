import path from "node:path";

import type { MigrationConfig } from "drizzle-orm/migrator";

export const migrationsFolder = path.resolve(process.cwd(), "src/db/migrations");
export const migrationsTable = "agentpay_migrations";
export const migrationsSchema = "public";

export interface MigrationSettings {
  migrationsFolder: string;
  migrationsTable: string;
  migrationsSchema: string;
}

export const migrationSettings: MigrationSettings = {
  migrationsFolder,
  migrationsTable,
  migrationsSchema,
};

export type MigrateRunner<TDb> = (
  db: TDb,
  config: MigrationConfig,
) => Promise<void>;

export async function applyMigrations<TDb>(
  db: TDb,
  run: MigrateRunner<TDb>,
): Promise<void> {
  await run(db, migrationSettings);
}

export async function runMigrations(
  databaseUrl: string,
  overrides: Partial<MigrationSettings> = {},
): Promise<void> {
  const { createDbClient } = await import("@/db/client");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const handle = createDbClient(databaseUrl);
  const settings: MigrationSettings = { ...migrationSettings, ...overrides };
  try {
    await migrate(handle.db, settings);
  } finally {
    await handle.close();
  }
}