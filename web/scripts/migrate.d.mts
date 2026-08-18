export interface MigrateCliOptions {
  databaseUrl: string;
  migrationsFolder: string;
}

export type MigrateRunner = (
  databaseUrl: string,
  settings: { readonly migrationsFolder: string },
) => Promise<void>;

export interface MigrateCliDependencies {
  readonly run: MigrateRunner;
}

export interface MigrateResult {
  status: "ok";
  migrationsFolder: string;
}

export function migrationsFolderForExecutable(executablePath: string): string;
export function parseMigrateArgs(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
): MigrateCliOptions;
export function runMigrateCli(
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  dependencies?: MigrateCliDependencies,
): Promise<MigrateResult>;
export function isDirectlyInvoked(argv: readonly string[]): boolean;
export function main(argv: readonly string[]): Promise<void>;
