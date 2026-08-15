import { randomUUID } from "node:crypto";

import { decodePaymentResponseHeader } from "@x402/core/http";

import {
  InvalidAuthorizationError,
  authorizationFingerprint,
  type AuthorizationPolicy,
} from "./authorization.js";
import type { AuthorizationStore } from "./authorization-store.js";

export type PaymentRequestHandler = (request: Request) => Promise<Response>;

export interface WithAuthorizationLockOptions {
  readonly store: AuthorizationStore;
  readonly policy: AuthorizationPolicy;
  readonly pendingTtlSeconds?: number;
  readonly consumedTtlSeconds?: number;
  readonly leaseTokenFactory?: () => string;
}

function positiveTtl(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer.`);
  }
}

const privateNoStore = { "Cache-Control": "private, no-store" } as const;

function conflict(reason: "payment_in_progress" | "payment_consumed"): Response {
  return Response.json({ error: "Conflict", reason }, {
    status: 409,
    headers: {
      ...privateNoStore,
      ...(reason === "payment_in_progress" ? { "Retry-After": "1" } : {}),
    },
  });
}

function infrastructureUnavailable(): Response {
  return Response.json({
    error: "Service Unavailable",
    reason: "payment_infrastructure_unavailable",
  }, { status: 503, headers: privateNoStore });
}

async function safeRelease(
  store: AuthorizationStore,
  fingerprint: string,
  lease: string,
): Promise<void> {
  try {
    await store.release(fingerprint, lease);
  } catch {
    // The short pending TTL remains the fail-safe if Redis cannot release the lease.
  }
}

function hasSuccessfulSettlement(response: Response): boolean {
  const header = response.headers.get("PAYMENT-RESPONSE");
  if (header === null) return false;
  try {
    return decodePaymentResponseHeader(header).success === true;
  } catch {
    return false;
  }
}

export function withAuthorizationLock(
  handler: PaymentRequestHandler,
  {
    store,
    policy,
    pendingTtlSeconds = 360,
    consumedTtlSeconds = 86_400,
    leaseTokenFactory = randomUUID,
  }: WithAuthorizationLockOptions,
): PaymentRequestHandler {
  positiveTtl(pendingTtlSeconds, "pendingTtlSeconds");
  positiveTtl(consumedTtlSeconds, "consumedTtlSeconds");

  return async request => {
    const paymentSignature = request.headers.get("PAYMENT-SIGNATURE");
    if (paymentSignature === null) return handler(request);

    let fingerprint: string;
    try {
      fingerprint = authorizationFingerprint(paymentSignature, policy);
    } catch (error) {
      if (error instanceof InvalidAuthorizationError) return handler(request);
      return infrastructureUnavailable();
    }

    const lease = leaseTokenFactory();
    let state: "acquired" | "pending" | "consumed";
    try {
      state = await store.acquire(fingerprint, lease, pendingTtlSeconds);
    } catch {
      return infrastructureUnavailable();
    }
    if (state === "pending") return conflict("payment_in_progress");
    if (state === "consumed") return conflict("payment_consumed");

    let response: Response;
    try {
      response = await handler(request);
    } catch (error) {
      await safeRelease(store, fingerprint, lease);
      throw error;
    }

    if (response.status < 200 || response.status >= 300) {
      await safeRelease(store, fingerprint, lease);
      return response;
    }
    if (!hasSuccessfulSettlement(response)) {
      await safeRelease(store, fingerprint, lease);
      return infrastructureUnavailable();
    }

    try {
      if (!await store.consume(fingerprint, lease, consumedTtlSeconds)) {
        return infrastructureUnavailable();
      }
    } catch {
      return infrastructureUnavailable();
    }
    return response;
  };
}
