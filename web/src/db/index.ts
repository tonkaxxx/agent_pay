import { createDbClient, type DbHandle } from "./client";

declare global {
  var __agentpayDb: DbHandle | undefined;
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (typeof url !== "string" || url.trim() === "") {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

export function getDatabase(): DbHandle {
  globalThis.__agentpayDb ??= createDbClient(databaseUrl());
  return globalThis.__agentpayDb;
}

export async function closeDatabase(): Promise<void> {
  if (globalThis.__agentpayDb !== undefined) {
    const handle = globalThis.__agentpayDb;
    globalThis.__agentpayDb = undefined;
    await handle.close();
  }
}