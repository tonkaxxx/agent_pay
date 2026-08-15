import { getAddress, type Address } from "viem";

type PremiumEnvironment = Readonly<Record<string, string | undefined>>;

const FORBIDDEN_WEB_SECRETS = [
  "AGENT_PRIVATE_KEY",
  "FACILITATOR_PRIVATE_KEY",
  "CDP_API_KEY_ID",
  "CDP_API_KEY_SECRET",
] as const;

const PLACEHOLDER_PAYEES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x1111111111111111111111111111111111111111",
]);

export interface PremiumConfig {
  readonly siteUrl: string;
  readonly resourceUrl: string;
  readonly payTo: Address;
  readonly facilitatorUrl: string;
  readonly redisUrl: string;
}

function configurationError(variable: string): Error {
  return new Error(`Invalid premium API configuration: ${variable}`);
}

function required(environment: PremiumEnvironment, name: string): string {
  const value = environment[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw configurationError(name);
  }
  return value;
}

function parseHttpUrl(value: string, name: string): URL {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      throw configurationError(name);
    }
    return url;
  } catch {
    throw configurationError(name);
  }
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "[::1]";
}

function parseSiteUrl(environment: PremiumEnvironment): string {
  const url = parseHttpUrl(
    required(environment, "NEXT_PUBLIC_SITE_URL"),
    "NEXT_PUBLIC_SITE_URL",
  );
  const local = isLocalHostname(url.hostname);
  const localOverride = environment.AGENTPAY_ALLOW_INSECURE_LOCAL_ORIGIN;
  if (localOverride !== undefined && localOverride !== "true") {
    throw configurationError("AGENTPAY_ALLOW_INSECURE_LOCAL_ORIGIN");
  }
  const allowLocalHttp = localOverride === "true" && local && url.protocol === "http:";
  if (localOverride === "true" && !allowLocalHttp) {
    throw configurationError("AGENTPAY_ALLOW_INSECURE_LOCAL_ORIGIN");
  }
  if (environment.NODE_ENV === "production" &&
    ((local && !allowLocalHttp) || (!local && url.protocol !== "https:"))) {
    throw configurationError("NEXT_PUBLIC_SITE_URL");
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw configurationError("NEXT_PUBLIC_SITE_URL");
  }
  return url.href;
}

function parseRedisUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
      throw configurationError("REDIS_URL");
    }
    return url.href;
  } catch {
    throw configurationError("REDIS_URL");
  }
}

function parsePayTo(value: string): Address {
  try {
    const address = getAddress(value);
    if (PLACEHOLDER_PAYEES.has(address.toLowerCase())) {
      throw configurationError("AGENTPAY_PAY_TO");
    }
    return address;
  } catch {
    throw configurationError("AGENTPAY_PAY_TO");
  }
}

export function loadPremiumConfig(environment: PremiumEnvironment): PremiumConfig {
  for (const variable of FORBIDDEN_WEB_SECRETS) {
    if (environment[variable] !== undefined) {
      throw configurationError(variable);
    }
  }

  const siteUrl = parseSiteUrl(environment);
  return {
    siteUrl,
    resourceUrl: new URL("/api/premium", siteUrl).href,
    payTo: parsePayTo(required(environment, "AGENTPAY_PAY_TO")),
    facilitatorUrl: parseHttpUrl(
      required(environment, "FACILITATOR_URL"),
      "FACILITATOR_URL",
    ).href,
    redisUrl: parseRedisUrl(required(environment, "REDIS_URL")),
  };
}
