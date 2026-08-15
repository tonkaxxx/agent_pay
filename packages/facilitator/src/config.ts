import { createHash } from "node:crypto";
import type { Hex } from "viem";

const BASE_NETWORK = "eip155:8453";
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

export interface FacilitatorConfig {
  host: string;
  port: number;
  rpcUrl: string;
  privateKey: Hex;
}

type Environment = Readonly<Record<string, string | undefined>>;

function configurationError(variable: string): Error {
  return new Error(`Invalid facilitator configuration: ${variable}`);
}

function parseRpcUrl(value: string | undefined): string {
  if (!value) {
    throw configurationError("BASE_MAINNET_RPC_URL");
  }

  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      throw configurationError("BASE_MAINNET_RPC_URL");
    }
    return url.href;
  } catch {
    throw configurationError("BASE_MAINNET_RPC_URL");
  }
}

function parsePrivateKey(
  value: string | undefined,
  forbiddenFingerprints: ReadonlySet<string>,
): Hex {
  if (!value || !PRIVATE_KEY_PATTERN.test(value) || /^0x0{64}$/i.test(value)) {
    throw configurationError("FACILITATOR_PRIVATE_KEY");
  }

  const normalized = value.toLowerCase() as Hex;
  const fingerprint = createHash("sha256").update(normalized).digest("hex");
  if (forbiddenFingerprints.has(fingerprint)) {
    throw configurationError("FACILITATOR_PRIVATE_KEY");
  }

  return normalized;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 4022;
  }
  if (!/^\d+$/.test(value)) {
    throw configurationError("PORT");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw configurationError("PORT");
  }
  return port;
}

function parseHost(value: string | undefined): string {
  const host = value ?? "0.0.0.0";
  if (!host || /[\s/:]/.test(host)) {
    throw configurationError("HOST");
  }
  return host;
}

function parseForbiddenFingerprints(value: string | undefined): Set<string> {
  if (!value) {
    return new Set();
  }
  const fingerprints = value.split(",").map(item => item.trim().toLowerCase());
  if (fingerprints.some(item => !FINGERPRINT_PATTERN.test(item))) {
    throw configurationError("FACILITATOR_FORBIDDEN_KEY_SHA256");
  }
  return new Set(fingerprints);
}

export function loadFacilitatorConfig(
  env: Environment = process.env,
  injectedForbiddenFingerprints: ReadonlySet<string> = new Set(),
): FacilitatorConfig {
  if (env.AGENT_PRIVATE_KEY !== undefined) {
    throw configurationError("AGENT_PRIVATE_KEY");
  }
  if (env.FACILITATOR_NETWORK !== undefined && env.FACILITATOR_NETWORK !== BASE_NETWORK) {
    throw configurationError("FACILITATOR_NETWORK");
  }

  const forbiddenFingerprints = parseForbiddenFingerprints(
    env.FACILITATOR_FORBIDDEN_KEY_SHA256,
  );
  for (const fingerprint of injectedForbiddenFingerprints) {
    forbiddenFingerprints.add(fingerprint.toLowerCase());
  }

  return {
    host: parseHost(env.HOST),
    port: parsePort(env.PORT),
    rpcUrl: parseRpcUrl(env.BASE_MAINNET_RPC_URL),
    privateKey: parsePrivateKey(env.FACILITATOR_PRIVATE_KEY, forbiddenFingerprints),
  };
}
