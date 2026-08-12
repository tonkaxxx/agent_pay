import { getAddress, type Address } from "viem";

type PremiumEnvironment = Readonly<Record<string, string | undefined>>;

interface LoadPremiumConfigOptions {
  readonly production?: boolean;
}

export interface PremiumConfig {
  readonly siteUrl: string;
  readonly payTo: Address;
  readonly redisUrl: string;
  readonly cdpApiKeyId: string;
  readonly cdpApiKeySecret: string;
  readonly offlineQuoteOnly: boolean;
}

function required(environment: PremiumEnvironment, name: string): string {
  const value = environment[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} must be set.`);
  }
  return value;
}

function httpUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }
  return url.href;
}

function redisUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("REDIS_URL must be a valid Redis URL.");
  }
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis or rediss.");
  }
  return url.href;
}

function assertProductionConfig(
  environment: PremiumEnvironment,
  config: PremiumConfig,
): void {
  const siteUrl = new URL(config.siteUrl);
  const loopback = siteUrl.hostname === "localhost"
    || siteUrl.hostname.endsWith(".localhost")
    || siteUrl.hostname === "[::1]"
    || /^127(?:\.\d{1,3}){3}$/.test(siteUrl.hostname);
  if (siteUrl.protocol !== "https:" || loopback) {
    throw new Error("NEXT_PUBLIC_SITE_URL must use a public HTTPS origin in production.");
  }
  if (config.payTo.toLowerCase() === "0x1111111111111111111111111111111111111111") {
    throw new Error("AGENTPAY_PAY_TO must not use the placeholder recipient in production.");
  }
  if (config.offlineQuoteOnly) {
    throw new Error("AGENTPAY_OFFLINE_QUOTE_ONLY must not be enabled in production.");
  }
  if (environment.AGENT_PRIVATE_KEY?.trim()) {
    throw new Error("AGENT_PRIVATE_KEY must not be present in the production web environment.");
  }
  if (new URL(config.redisUrl).password === "") {
    throw new Error("REDIS_URL must include authentication in production.");
  }
}

export function loadPremiumConfig(
  environment: PremiumEnvironment,
  { production = false }: LoadPremiumConfigOptions = {},
): PremiumConfig {
  let payTo: Address;
  try {
    payTo = getAddress(required(environment, "AGENTPAY_PAY_TO"));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("AGENTPAY_PAY_TO")) throw error;
    throw new Error("AGENTPAY_PAY_TO must be a valid EVM address.");
  }

  const config = {
    siteUrl: httpUrl(
      required(environment, "NEXT_PUBLIC_SITE_URL"),
      "NEXT_PUBLIC_SITE_URL",
    ),
    payTo,
    redisUrl: redisUrl(required(environment, "REDIS_URL")),
    cdpApiKeyId: required(environment, "CDP_API_KEY_ID"),
    cdpApiKeySecret: required(environment, "CDP_API_KEY_SECRET"),
    offlineQuoteOnly: environment.AGENTPAY_OFFLINE_QUOTE_ONLY === "true",
  };
  if (production) assertProductionConfig(environment, config);
  return config;
}
