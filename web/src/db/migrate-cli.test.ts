import { describe, expect, it, vi } from "vitest";

import {
  migrationsFolderForExecutable,
  parseMigrateArgs,
  runMigrateCli,
} from "@/db/migrate-cli";

const DATABASE_URL = "postgres://agentpay:test-local@127.0.0.1:5432/agentpay";

describe("migrationsFolderForExecutable", () => {
  it("points to the sibling migrations folder of the bundled script", () => {
    expect(migrationsFolderForExecutable("/app/web/scripts/migrate.mjs")).toBe(
      "/app/web/src/db/migrations",
    );
    expect(migrationsFolderForExecutable("/repo/web/scripts/migrate.mjs")).toBe(
      "/repo/web/src/db/migrations",
    );
  });
});

describe("parseMigrateArgs", () => {
  it("requires a DATABASE_URL", () => {
    expect(() => parseMigrateArgs([], {})).toThrow("database_url_required");
    expect(() => parseMigrateArgs([], { DATABASE_URL: "  " })).toThrow("database_url_required");
  });

  it("rejects unknown arguments", () => {
    expect(() => parseMigrateArgs(["--explode"], { DATABASE_URL })).toThrow("invalid_arguments");
  });

  it("accepts an explicit absolute migrations folder", () => {
    const options = parseMigrateArgs(["--migrations-folder=/tmp/migrations"], { DATABASE_URL });
    expect(options).toEqual({ databaseUrl: DATABASE_URL, migrationsFolder: "/tmp/migrations" });
  });

  it("resolves the default migrations folder relative to the executable", () => {
    const options = parseMigrateArgs([], { DATABASE_URL });
    expect(options.databaseUrl).toBe(DATABASE_URL);
    expect(options.migrationsFolder).toMatch(/migrations$/);
  });
});

describe("runMigrateCli", () => {
  it("runs migrations through the injected runner and reports the folder", async () => {
    const run = vi.fn(async () => undefined);
    const result = await runMigrateCli(
      ["--migrations-folder=/tmp/migrations"],
      { DATABASE_URL },
      { run },
    );
    expect(result).toEqual({ status: "ok", migrationsFolder: "/tmp/migrations" });
    expect(run).toHaveBeenCalledWith(DATABASE_URL, { migrationsFolder: "/tmp/migrations" });
  });

  it("fails fast without a DATABASE_URL before touching the runner", async () => {
    const run = vi.fn(async () => undefined);
    await expect(
      runMigrateCli([], { DATABASE_URL: undefined }, { run }),
    ).rejects.toThrow("database_url_required");
    expect(run).not.toHaveBeenCalled();
  });
});
