import { createHash } from "node:crypto";

import { decodePaymentSignatureHeader } from "@x402/core/http";
import { getAddress, type Address } from "viem";

import { BASE_NETWORK, BASE_USDC } from "./resource-server.js";
import type { PaymentPolicy } from "./payment-policy.js";

export interface AuthorizationPolicy {
  readonly resource: string;
  readonly network: typeof BASE_NETWORK;
  readonly asset: Address;
  readonly payTo: Address;
  readonly amount: string;
}

export function authorizationPolicyFromPolicy(
  policy: PaymentPolicy,
): AuthorizationPolicy {
  return {
    resource: policy.resource,
    network: policy.network,
    asset: policy.asset,
    payTo: policy.payTo,
    amount: policy.amountAtomic,
  };
}

export class InvalidAuthorizationError extends Error {
  readonly code = "invalid_payment_authorization";

  constructor() {
    super("The payment authorization is invalid.");
    this.name = "InvalidAuthorizationError";
  }
}

export interface AuthorizationDetails {
  readonly fingerprint: string;
  readonly payer: Address;
}

function fail(): never {
  throw new InvalidAuthorizationError();
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}

function address(value: unknown): Address {
  if (typeof value !== "string") fail();
  try {
    return getAddress(value);
  } catch {
    return fail();
  }
}

function sameAddress(left: unknown, right: Address): boolean {
  return address(left) === getAddress(right);
}

export function authorizationDetails(
  encodedHeader: string,
  policy: AuthorizationPolicy,
): AuthorizationDetails {
  try {
    const payment = decodePaymentSignatureHeader(encodedHeader);
    if (payment.x402Version !== 2) fail();
    if (payment.resource?.url !== policy.resource) fail();
    if (payment.accepted.scheme !== "exact") fail();
    if (payment.accepted.network !== policy.network || policy.network !== BASE_NETWORK) fail();
    if (!sameAddress(payment.accepted.asset, policy.asset) || getAddress(policy.asset) !== BASE_USDC) {
      fail();
    }
    if (!sameAddress(payment.accepted.payTo, policy.payTo)) fail();
    if (payment.accepted.amount !== policy.amount) fail();

    const schemePayload = record(payment.payload);
    if (!("authorization" in schemePayload) || "permit2Authorization" in schemePayload) fail();
    const signature = schemePayload.signature;
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) fail();
    const authorization = record(schemePayload.authorization);
    const payer = address(authorization.from);
    if (!sameAddress(authorization.to, policy.payTo)) fail();
    if (authorization.value !== policy.amount) fail();
    const nonce = authorization.nonce;
    if (typeof nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(nonce)) fail();

    const material = [
      policy.network,
      getAddress(policy.asset).toLowerCase(),
      payer.toLowerCase(),
      nonce.toLowerCase(),
    ].join(":");
    return {
      fingerprint: createHash("sha256").update(material).digest("hex"),
      payer,
    };
  } catch (error) {
    if (error instanceof InvalidAuthorizationError) throw error;
    throw new InvalidAuthorizationError();
  }
}

export function authorizationFingerprint(
  encodedHeader: string,
  policy: AuthorizationPolicy,
): string {
  return authorizationDetails(encodedHeader, policy).fingerprint;
}
