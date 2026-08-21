type GatewayEnvironment = Readonly<Record<string, string | undefined>>;

const FORBIDDEN_WEB_SECRETS: readonly string[] = [
  "AGENT_PRIVATE_KEY",
  "FACILITATOR_PRIVATE_KEY",
  "AGENTPAY_PAYOUT_PRIVATE_KEY",
  ["CDP", "API", "KEY", "ID"].join("_"),
  ["CDP", "API", "KEY", "SECRET"].join("_"),
];

export interface GatewayConfig {
  readonly siteUrl: string;
  readonly facilitatorUrl: string;
  readonly redisUrl: string;
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

function parseHttpUrl(value: string, name: string): string {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password
    ) {
      throw configurationError(name);
    }
    return url.href;
  } catch {
    throw configurationError(name);
  }
}

function parseSiteUrl(environment: GatewayEnvironment): string {
  const url = new URL(parseHttpUrl(
    required(environment, "NEXT_PUBLIC_SITE_URL"),
    "NEXT_PUBLIC_SITE_URL",
  ));
  const hostname = url.hostname.toLowerCase();
  const local = hostname === "localhost" || hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" || hostname === "0.0.0.0" || hostname === "[::1]";
  const allowLocal = environment.AGENTPAY_ALLOW_INSECURE_LOCAL_ORIGIN === "true";
  if (environment.NODE_ENV === "production" && local && !allowLocal) {
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

export function loadGatewayConfig(environment: GatewayEnvironment): GatewayConfig {
  for (const variable of FORBIDDEN_WEB_SECRETS) {
    if (environment[variable] !== undefined) {
      throw configurationError(variable);
    }
  }
  return {
    siteUrl: parseSiteUrl(environment),
    facilitatorUrl: parseHttpUrl(
      required(environment, "FACILITATOR_URL"),
      "FACILITATOR_URL",
    ),
    redisUrl: parseRedisUrl(required(environment, "REDIS_URL")),
  };
}
