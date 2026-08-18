import {
  authorizationDetails,
  authorizationPolicyFromPolicy,
  InvalidAuthorizationError,
  type PaymentPolicy,
} from "@agentpay/server";
import { decodePaymentResponseHeader } from "@x402/core/http";

import type { SettlementEventInput } from "./events";
import type { UpstreamResult } from "./upstream/transport";

export interface PaymentEventContext {
  readonly endpointId: string;
  readonly requestId: string;
  readonly paymentHeader: string | null;
  readonly response: Response;
  readonly policy: PaymentPolicy;
  readonly upstream: UpstreamResult | null;
}

export async function buildPaymentEvent(
  context: PaymentEventContext,
): Promise<SettlementEventInput> {
  let fingerprint: string | null = null;
  let payerAddress: string | null = null;
  let authorizationValid = false;
  if (context.paymentHeader !== null) {
    try {
      const details = authorizationDetails(
        context.paymentHeader,
        authorizationPolicyFromPolicy(context.policy),
      );
      fingerprint = details.fingerprint;
      payerAddress = details.payer;
      authorizationValid = true;
    } catch (error) {
      if (!(error instanceof InvalidAuthorizationError)) throw error;
    }
  }

  const settlement = decodeSettlement(context.response);
  if (settlement?.payer) payerAddress = settlement.payer;
  const eventOutcome = await outcome(
    context,
    authorizationValid,
    settlement?.success === true,
  );

  return {
    endpointId: context.endpointId,
    requestId: context.requestId,
    fingerprint: eventOutcome === "settled" ? fingerprint : null,
    payerAddress,
    txHash: settlement?.success === true && settlement.transaction
      ? settlement.transaction
      : null,
    amountAtomic: settlement?.amount ?? context.policy.amountAtomic,
    upstreamStatus: context.upstream?.status ?? null,
    upstreamDurationMs: context.upstream?.latencyMs ?? null,
    upstreamResponseSize: context.upstream?.ok === true
      ? context.upstream.contentLength
      : null,
    settlementDurationMs: null,
    outcome: eventOutcome,
  };
}

function decodeSettlement(response: Response) {
  const encoded = response.headers.get("PAYMENT-RESPONSE");
  if (encoded === null) return null;
  try {
    return decodePaymentResponseHeader(encoded);
  } catch {
    return null;
  }
}

async function responseReason(response: Response): Promise<string | null> {
  try {
    const body = await response.clone().json() as unknown;
    if (typeof body === "object" && body !== null && "reason" in body) {
      return typeof body.reason === "string" ? body.reason : null;
    }
  } catch {
    // Non-JSON paid upstream responses are expected.
  }
  return null;
}

async function outcome(
  context: PaymentEventContext,
  authorizationValid: boolean,
  settled: boolean,
): Promise<SettlementEventInput["outcome"]> {
  if (settled) return "settled";
  if (context.paymentHeader === null) return "challenge";
  if (!authorizationValid) return "invalid_authorization";
  if (context.upstream?.ok === false) return "upstream_failed";
  const reason = await responseReason(context.response);
  if (reason === "payment_in_progress") return "payment_in_progress";
  if (reason === "payment_consumed") return "payment_consumed";
  return "settlement_failed";
}
