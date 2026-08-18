import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { migrationsSchema, migrationsTable, runMigrations } from "./migrate";

export interface MigrateCliOptions {
  readonly databaseUrl: string;
  readonly migrationsFolder: string;
}

export type MigrateRunner = (
  databaseUrl: string,
  settings: { readonly migrationsFolder: string },
) => Promise<void>;

export interface MigrateCliDependencies {
  readonly run: MigrateRunner;
}

function fail(reason: string): never {
  throw new Error(reason);
}

export function migrationsFolderForExecutable(executablePath: string): string {
  return resolve(dirname(executablePath), "..", "src", "db", "migrations");
}

export function parseMigrateArgs(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): MigrateCliOptions {
  const explicitFolder = args.find((argument) => argument.startsWith("--migrations-folder="));
  const unsupported = args.find((argument) =>
    argument !== "--help" && !argument.startsWith("--migrations-folder=")
  );
  if (unsupported) fail("invalid_arguments");

  const databaseUrl = environment.DATABASE_URL;
  if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") fail("database_url_required");

  const declared = explicitFolder?.slice("--migrations-folder=".length) ?? "";
  const migrationsFolder = declared
    ? isAbsolute(declared)
      ? declared
      : resolve(dirname(fileURLToPath(import.meta.url)), declared)
    : migrationsFolderForExecutable(fileURLToPath(import.meta.url));

  return { databaseUrl, migrationsFolder };
}

export async function runMigrateCli(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: MigrateCliDependencies = {
    run: (databaseUrl, settings) =>
      runMigrations(databaseUrl, { ...settings, migrationsTable, migrationsSchema }),
  },
): Promise<{ status: "ok"; migrationsFolder: string }> {
  const options = parseMigrateArgs(args, environment);
  await dependencies.run(options.databaseUrl, {
    migrationsFolder: options.migrationsFolder,
  });
  return { status: "ok", migrationsFolder: options.migrationsFolder };
}

export function isDirectlyInvoked(argv: readonly string[]): boolean {
  return Boolean(argv[1]) && import.meta.url === pathToFileURL(argv[1] as string).href;
}

export async function main(argv: readonly string[]): Promise<void> {
  const result = await runMigrateCli(argv, process.env);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (isDirectlyInvoked(process.argv)) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error && /^[a-z_]+$/.test(error.message)
      ? `: ${error.message}`
      : "";
    process.stderr.write(`AgentPay database migration failed${message}\n`);
    process.exitCode = 1;
  });
}