import { randomBytes } from "node:crypto";

import { getAddress, type Address } from "viem";

import { canonicalizeUpstreamUrl } from "./url";

export interface ParsedUsdcPrice {
  readonly amountAtomic: string;
  readonly amountUsdc: string;
}

export const AUTH_MODES = ["none", "bearer", "x-api-key"] as const;
export type EndpointAuthMode = (typeof AUTH_MODES)[number];

const PRICE_RE = /^\d+(?:\.\d+)?$/;

export const USDC_DECIMALS = 6;
export const MIN_PRICE_ATOMIC = 1n;
export const MAX_PRICE_ATOMIC = 1_000_000_000n; // 1000 USDC

export class InvalidPriceError extends Error {
  constructor() {
    super("Invalid USDC price");
    this.name = "InvalidPriceError";
  }
}

export function parsePriceUsdc(value: string): ParsedUsdcPrice {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!PRICE_RE.test(trimmed)) {
    throw new InvalidPriceError();
  }
  const parts = trimmed.split(".");
  const whole = parts[0]!;
  const fraction = parts[1] ?? "";
  if (fraction.length > USDC_DECIMALS) {
    throw new InvalidPriceError();
  }
  if (whole.length > 12) {
    throw new InvalidPriceError();
  }
  const unit = "1" + "0".repeat(USDC_DECIMALS);
  const fractionPadded = fraction.padEnd(USDC_DECIMALS, "0");
  const decimal = BigInt(whole) * BigInt(unit) + BigInt(fractionPadded);
  if (decimal < MIN_PRICE_ATOMIC || decimal > MAX_PRICE_ATOMIC) {
    throw new InvalidPriceError();
  }
  return {
    amountAtomic: decimal.toString(),
    amountUsdc: atomicToUsdc(decimal),
  };
}

export function atomicToUsdc(amountAtomic: string | bigint): string {
  const value = typeof amountAtomic === "bigint" ? amountAtomic : BigInt(amountAtomic);
  const sign = value < 0n ? "-" : "";
  const magnitude = value < 0n ? -value : value;
  const whole = magnitude / 1000000n;
  const fraction = (magnitude % 1000000n).toString().padStart(6, "0");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed === "" ? `${sign}${whole}` : `${sign}${whole}.${trimmed}`;
}

const PLACEHOLDER_PAYEES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x1111111111111111111111111111111111111111",
]);

export class InvalidPayoutError extends Error {
  constructor() {
    super("Invalid payout address");
    this.name = "InvalidPayoutError";
  }
}

export function parsePayToChecksummed(value: string): Address {
  let checksummed: Address;
  try {
    checksummed = getAddress(value);
  } catch {
    throw new InvalidPayoutError();
  }
  if (PLACEHOLDER_PAYEES.has(checksummed.toLowerCase())) {
    throw new InvalidPayoutError();
  }
  return checksummed;
}

export function newPublicId(): string {
  return randomBytes(16).toString("base64url");
}

export interface EndpointDraftInput {
  readonly displayName: string;
  readonly upstreamUrl: string;
  readonly authMode: string;
  readonly price: string;
  readonly payTo: string;
  readonly credential?: string;
}

export interface ParsedEndpointDraft {
  readonly displayName: string;
  readonly upstreamUrl: string;
  readonly authMode: EndpointAuthMode;
  readonly payTo: Address;
  readonly amountAtomic: string;
  readonly amountUsdc: string;
  readonly credential?: string;
}

export class EndpointValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "EndpointValidationError";
    this.field = field;
  }
}

const DISPLAY_NAME_MAX = 80;
const CREDENTIAL_MAX = 2000;

export function parseEndpointDraft(input: EndpointDraftInput): ParsedEndpointDraft {
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  if (displayName === "" ) {
    throw new EndpointValidationError("displayName", "Display name is required");
  }
  if (displayName.length > DISPLAY_NAME_MAX) {
    throw new EndpointValidationError("displayName", "Display name is too long");
  }

  let upstreamUrl: string;
  try {
    upstreamUrl = canonicalizeUpstreamUrl(input.upstreamUrl).normalized;
  } catch {
    throw new EndpointValidationError("upstreamUrl", "Enter a valid HTTPS URL");
  }

  const authMode = input.authMode as EndpointAuthMode;
  if (!AUTH_MODES.includes(authMode)) {
    throw new EndpointValidationError("authMode", "Unsupported authentication mode");
  }

  let price: ParsedUsdcPrice;
  try {
    price = parsePriceUsdc(input.price);
  } catch {
    throw new EndpointValidationError("price", "Enter a price from 0.000001 to 1000 USDC");
  }

  let payTo: Address;
  try {
    payTo = parsePayToChecksummed(input.payTo);
  } catch {
    throw new EndpointValidationError("payTo", "Enter a valid checksummed Base payout address");
  }

  const credential = input.credential;
  if (credential !== undefined && credential.trim() === "") {
    throw new EndpointValidationError("credential", "Upstream secret cannot be blank");
  }
  if (credential !== undefined && credential.length > CREDENTIAL_MAX) {
    throw new EndpointValidationError("credential", "Upstream secret is too long");
  }

  return {
    displayName,
    upstreamUrl,
    authMode,
    payTo,
    amountAtomic: price.amountAtomic,
    amountUsdc: price.amountUsdc,
    ...(credential !== undefined ? { credential: credential.trim() } : {}),
  } satisfies ParsedEndpointDraft;
}