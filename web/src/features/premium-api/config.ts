import { getAddress, type Address } from "viem";

type PremiumEnvironment = Readonly<Record<string, string | undefined>>;

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

export function loadPremiumConfig(environment: PremiumEnvironment): PremiumConfig {
  let payTo: Address;
  try {
    payTo = getAddress(required(environment, "AGENTPAY_PAY_TO"));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("AGENTPAY_PAY_TO")) throw error;
    throw new Error("AGENTPAY_PAY_TO must be a valid EVM address.");
  }

  return {
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
}
