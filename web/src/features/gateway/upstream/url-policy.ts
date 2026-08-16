import { canonicalizeUpstreamUrl, InvalidUpstreamUrlError } from "../url";
import { expandIpv6, ipv4ToBigInt, isForbiddenAddress } from "./ip";

const LOCAL_HOSTNAME_SUFFIXES = [".localhost", ".local"];
const LOCAL_HOSTNAME_EXACT = new Set(["localhost"]);

export class UpstreamUrlPolicyError extends Error {
  constructor(reason: string) {
    super(`Upstream URL rejected: ${reason}`);
    this.name = "UpstreamUrlPolicyError";
  }
}

export function hostnameIpAddress(hostname: string): string | null {
  const clean = hostname.length >= 2 && hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (ipv4ToBigInt(clean) !== null) {
    return clean;
  }
  if (expandIpv6(clean) !== null) {
    return clean;
  }
  return null;
}

function isIpv6Format(hostname: string): boolean {
  return hostname.includes(":");
}

function throwPolicy(reason: string): never {
  throw new UpstreamUrlPolicyError(reason);
}

export function validateUpstreamUrl(raw: string): URL {
  let canonical;
  try {
    canonical = canonicalizeUpstreamUrl(raw);
  } catch (error) {
    if (error instanceof InvalidUpstreamUrlError) {
      throw new UpstreamUrlPolicyError("structural validation failed");
    }
    throw error;
  }

  const hostname = canonical.hostname;

  if (isIpv6Format(hostname)) {
    const literal = hostnameIpAddress(hostname);
    if (literal === null) {
      throwPolicy("unsupported IPv6 literal");
    }
    if (isForbiddenAddress(literal)) {
      throwPolicy("address is in a forbidden range");
    }
    return new URL(canonical.normalized);
  }

  const literal = hostnameIpAddress(hostname);
  if (literal !== null) {
    if (isForbiddenAddress(literal)) {
      throwPolicy("address is in a forbidden range");
    }
    return new URL(canonical.normalized);
  }

  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (LOCAL_HOSTNAME_EXACT.has(normalized)) {
    throwPolicy("hostname is localhost");
  }
  if (LOCAL_HOSTNAME_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    throwPolicy("hostname is a local name");
  }
  if (!normalized.includes(".")) {
    throwPolicy("hostname is not fully qualified");
  }
  return new URL(canonical.normalized);
}