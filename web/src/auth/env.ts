export type Environment = Readonly<Record<string, string | undefined>>;

export interface AuthEnvironment {
  readonly secret: string;
  readonly url: string;
  readonly trustHost: boolean;
  readonly github?: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly enterpriseBaseUrl?: string;
  };
  readonly email?: {
    readonly server: string;
    readonly from: string;
  };
}

const PLACEHOLDER_SECRET =
  /change_me|changeme|invalid_change_me|replace_me/i;

const MIN_SECRET_LENGTH = 32;

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

function isEmail(value: string): boolean {
  const stripped = value.trim().replace(/^.*<([^>]+)>$/, "$1");
  return EMAIL_RE.test(stripped);
}

const LEGACY_CDP_KEY_ID = ["CDP", "API", "KEY", "ID"].join("_");
const LEGACY_CDP_KEY_SECRET = ["CDP", "API", "KEY", "SECRET"].join("_");

const FORBIDDEN_WEB_SECRETS: readonly string[] = [
  "AGENT_PRIVATE_KEY",
  "FACILITATOR_PRIVATE_KEY",
  LEGACY_CDP_KEY_ID,
  LEGACY_CDP_KEY_SECRET,
];

function configurationError(variable: string): Error {
  return new Error(`Invalid authentication configuration: ${variable}`);
}

function required(environment: Environment, name: string): string {
  const value = environment[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw configurationError(name);
  }
  return value;
}

function optional(environment: Environment, name: string): string | undefined {
  const value = environment[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw configurationError(name);
  }
  return value;
}

function parseSecret(environment: Environment): string {
  const value = required(environment, "AUTH_SECRET");
  if (value.length < MIN_SECRET_LENGTH) {
    throw configurationError("AUTH_SECRET");
  }
  if (PLACEHOLDER_SECRET.test(value)) {
    throw configurationError("AUTH_SECRET");
  }
  return value;
}

function parseBaseUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw configurationError(name);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw configurationError(name);
  }
  if (url.username || url.password) {
    throw configurationError(name);
  }
  if (url.pathname !== "/" || url.search || url.hash || url.port) {
    throw configurationError(name);
  }
  return url.href;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "[::1]"
  );
}

function parseAuthUrl(environment: Environment): string {
  const explicit = optional(environment, "AUTH_URL");
  const fallback = optional(environment, "NEXT_PUBLIC_SITE_URL");
  const raw = explicit ?? fallback ?? "";
  if (raw === "") {
    throw configurationError("AUTH_URL");
  }
  const name = explicit !== undefined ? "AUTH_URL" : "NEXT_PUBLIC_SITE_URL";
  const url = parseBaseUrl(raw, name);
  const local = isLoopbackHostname(new URL(url).hostname);
  const localOverride = environment.AGENTPAY_ALLOW_INSECURE_LOCAL_ORIGIN;
  const allowLocalHttp =
    localOverride === "true" && local && url.startsWith("http://");
  if (localOverride !== undefined && localOverride !== "true") {
    throw configurationError("AGENTPAY_ALLOW_INSECURE_LOCAL_ORIGIN");
  }
  if (!url.startsWith("https://") && !allowLocalHttp) {
    throw configurationError(name);
  }
  return url;
}

function parseTrustHost(environment: Environment): boolean {
  const raw = optional(environment, "AUTH_TRUST_HOST");
  if (raw === "true") {
    return true;
  }
  if (raw === "false") {
    return false;
  }
  if (raw !== undefined) {
    throw configurationError("AUTH_TRUST_HOST");
  }
  if (environment.NODE_ENV === "production") {
    throw configurationError("AUTH_TRUST_HOST");
  }
  return true;
}

function parseOAuthPair(
  environment: Environment,
  idName: string,
  secretName: string,
): { clientId: string; clientSecret: string } | undefined {
  const clientId = optional(environment, idName);
  const clientSecret = optional(environment, secretName);
  if (clientId === undefined && clientSecret === undefined) {
    return undefined;
  }
  if (clientId === undefined || clientSecret === undefined) {
    throw configurationError(idName);
  }
  if (PLACEHOLDER_SECRET.test(clientId) || PLACEHOLDER_SECRET.test(clientSecret)) {
    throw configurationError(idName);
  }
  return { clientId, clientSecret };
}

function parseEnterpriseBaseUrl(environment: Environment): string | undefined {
  const raw = optional(environment, "AUTH_GITHUB_ENTERPRISE_URL");
  if (raw === undefined) {
    return undefined;
  }
  const name = "AUTH_GITHUB_ENTERPRISE_URL";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw configurationError(name);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw configurationError(name);
  }
  if (url.username || url.password) {
    throw configurationError(name);
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    throw configurationError(name);
  }
  if (url.search || url.hash) {
    throw configurationError(name);
  }
  if (url.protocol === "http:") {
    if (environment.NODE_ENV === "production") {
      throw configurationError(name);
    }
    if (!isLoopbackHostname(url.hostname)) {
      throw configurationError(name);
    }
  }
  return url.href;
}

function parseEmailServer(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw configurationError(name);
  }
  if (url.protocol !== "smtp:" && url.protocol !== "smtps:") {
    throw configurationError(name);
  }
  if (url.port === "") {
    throw configurationError(name);
  }
  if (PLACEHOLDER_SECRET.test(value)) {
    throw configurationError(name);
  }
  return value;
}

function parseEmailFrom(value: string, name: string): string {
  if (!isEmail(value)) {
    throw configurationError(name);
  }
  if (PLACEHOLDER_SECRET.test(value)) {
    throw configurationError(name);
  }
  return value;
}

export function loadAuthEnvironment(
  environment: Environment,
): AuthEnvironment {
  for (const variable of FORBIDDEN_WEB_SECRETS) {
    if (environment[variable] !== undefined) {
      throw configurationError(variable);
    }
  }

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return {
      secret: "agentpay-build-placeholder-secret-not-usable-at-runtime",
      url: "https://placeholder.invalid/",
      trustHost: false,
    };
  }

  const githubBase = parseOAuthPair(
    environment,
    "AUTH_GITHUB_ID",
    "AUTH_GITHUB_SECRET",
  );
  const enterpriseBaseUrl = parseEnterpriseBaseUrl(environment);
  if (enterpriseBaseUrl !== undefined && githubBase === undefined) {
    throw configurationError("AUTH_GITHUB_ID");
  }
  let github: AuthEnvironment["github"];
  if (githubBase !== undefined) {
    github = {
      ...githubBase,
      ...(enterpriseBaseUrl !== undefined ? { enterpriseBaseUrl } : {}),
    };
  }

  let email: AuthEnvironment["email"];
  const emailServer = optional(environment, "AUTH_EMAIL_SERVER");
  const emailFrom = optional(environment, "AUTH_EMAIL_FROM");
  if (emailServer !== undefined || emailFrom !== undefined) {
    if (emailServer === undefined || emailFrom === undefined) {
      throw configurationError("AUTH_EMAIL_SERVER");
    }
    email = {
      server: parseEmailServer(emailServer, "AUTH_EMAIL_SERVER"),
      from: parseEmailFrom(emailFrom, "AUTH_EMAIL_FROM"),
    };
  }

  if (github === undefined && email === undefined) {
    throw configurationError("AUTH_GITHUB_ID");
  }
  if (
    environment.NODE_ENV === "production" &&
    (github === undefined || email === undefined)
  ) {
    throw configurationError("AUTH_GITHUB_ID");
  }

  return {
    secret: parseSecret(environment),
    url: parseAuthUrl(environment),
    trustHost: parseTrustHost(environment),
    ...(github !== undefined ? { github } : {}),
    ...(email !== undefined ? { email } : {}),
  };
}