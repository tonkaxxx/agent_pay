import { getAddress, type Address } from "viem";

export const BASE_NETWORK = "eip155:8453" as const;
export const BASE_USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export const PREMIUM_PAYMENT_POLICY = Object.freeze({
  scheme: "exact",
  network: BASE_NETWORK,
  asset: BASE_USDC,
  amountAtomic: "10000",
  amountUsdc: "0.01",
  price: "$0.01",
  maxTimeoutSeconds: 300,
} as const);

export interface PaymentPolicy {
  readonly scheme: "exact";
  readonly network: typeof BASE_NETWORK;
  readonly asset: Address;
  readonly resource: string;
  readonly payTo: Address;
  readonly amountAtomic: string;
  readonly amountUsdc: string;
  readonly price: string;
  readonly maxTimeoutSeconds: number;
  readonly description: string;
}

export interface PaymentPolicyInput {
  readonly resource: string;
  readonly payTo: string;
  readonly amountAtomic: string;
  readonly maxTimeoutSeconds?: number;
  readonly description: string;
}

export class InvalidPaymentPolicyError extends Error {
  constructor(reason: string) {
    super(`Invalid payment policy: ${reason}`);
    this.name = "InvalidPaymentPolicyError";
  }
}

export function canonicalResource(resource: string): string {
  let url: URL;
  try {
    url = new URL(resource);
  } catch {
    throw new TypeError("resource must be a canonical HTTP(S) URL.");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:")
    || url.username !== ""
    || url.password !== ""
    || url.hash !== ""
    || url.href !== resource
  ) {
    throw new TypeError("resource must be a canonical HTTP(S) URL.");
  }
  return url.href;
}

export function atomicAmountToUsdc(amountAtomic: string): string {
  const value = BigInt(amountAtomic);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed === "" ? `${whole}` : `${whole}.${trimmed}`;
}

function parseAtomicAmount(raw: string): string {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    throw new InvalidPaymentPolicyError("amount must be a non-negative integer string");
  }
  const value = BigInt(raw);
  if (value < 1n) {
    throw new InvalidPaymentPolicyError("amount must be positive");
  }
  if (value > 1_000_000_000n) {
    throw new InvalidPaymentPolicyError("amount exceeds the allowed range");
  }
  return raw;
}

function parsePayTo(raw: string): Address {
  try {
    return getAddress(raw);
  } catch {
    throw new InvalidPaymentPolicyError("payTo must be a valid EVM address");
  }
}

function parseTimeout(raw: number | undefined): number {
  if (raw === undefined) {
    throw new InvalidPaymentPolicyError("maxTimeoutSeconds is required");
  }
  if (!Number.isSafeInteger(raw) || raw <= 0) {
    throw new InvalidPaymentPolicyError("maxTimeoutSeconds must be a positive integer");
  }
  return raw;
}

function parseDescription(raw: string): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new InvalidPaymentPolicyError("description is required");
  }
  return raw.trim();
}

export function createPaymentPolicy(input: PaymentPolicyInput): PaymentPolicy {
  const amountAtomic = parseAtomicAmount(input.amountAtomic);
  const payTo = parsePayTo(input.payTo);
  const maxTimeoutSeconds = parseTimeout(input.maxTimeoutSeconds);
  const description = parseDescription(input.description);
  let resource: string;
  try {
    resource = canonicalResource(input.resource);
  } catch {
    throw new InvalidPaymentPolicyError("resource must be a canonical HTTP(S) URL");
  }
  const amountUsdc = atomicAmountToUsdc(amountAtomic);
  const price = `$${amountUsdc}`;
  return Object.freeze({
    scheme: "exact",
    network: BASE_NETWORK,
    asset: BASE_USDC,
    resource,
    payTo,
    amountAtomic,
    amountUsdc,
    price,
    maxTimeoutSeconds,
    description,
  } satisfies PaymentPolicy);
}