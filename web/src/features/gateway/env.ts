import { keyRingFromBase64, type KeyRing } from "./secrets";

export type GatewayEnvironment = Readonly<Record<string, string | undefined>>;

export interface MasterKeyConfig {
  readonly version: number;
  readonly ring: KeyRing;
}

function configurationError(variable: string): Error {
  return new Error(`Invalid gateway configuration: ${variable}`);
}

function required(environment: GatewayEnvironment, name: string): string {
  const value = environment[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw configurationError(name);
  }
  return value;
}

function parseVersion(environment: GatewayEnvironment): number {
  const raw = environment.AGENTPAY_MASTER_KEY_VERSION;
  if (raw === undefined || raw.trim() === "") {
    return 1;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || String(parsed) !== raw.trim() || parsed < 0) {
    throw configurationError("AGENTPAY_MASTER_KEY_VERSION");
  }
  return parsed;
}

function parseMasterKeyBase64(value: string, name: string): string {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw configurationError(name);
  }
  if (/change_me|changeme|invalid_change_me|replace_me/i.test(value)) {
    throw configurationError(name);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength !== 32) {
    throw configurationError(name);
  }
  return value;
}

export function loadMasterKeyConfig(environment: GatewayEnvironment): MasterKeyConfig {
  const version = parseVersion(environment);
  const base64 = parseMasterKeyBase64(
    required(environment, "AGENTPAY_MASTER_KEY"),
    "AGENTPAY_MASTER_KEY",
  );
  return {
    version,
    ring: keyRingFromBase64(version, base64),
  };
}