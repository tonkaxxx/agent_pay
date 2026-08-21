import {
  authorizationDetails,
  BASE_NETWORK,
  BASE_USDC,
  type AuthorizationPolicy,
} from "@agentpay/server";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import type {
  AfterSettleHook,
  AfterVerifyHook,
  OnVerifiedPaymentCanceledHook,
} from "@x402/core/server";
import type { PaymentPayload } from "@x402/core/types";
import { getAddress, type Address } from "viem";

import {
  CustodialLiabilityCapError,
  FinancePausedError,
  type ReserveObligationInput,
  WorkerUnavailableError,
} from "./ledger";

export interface CustodialEndpoint {
  readonly id: string;
  readonly publicId: string;
  readonly payTo: string;
  readonly amountAtomic: string;
}

export interface CustodialSettlementHookDependencies {
  readonly collectionAddress: Address;
  requestId(): string;
  loadEndpoint(publicId: string): Promise<CustodialEndpoint | null>;
  reserve(input: ReserveObligationInput): Promise<unknown>;
  cancelled(fingerprint: string): Promise<void>;
}

export interface CustodialSettlementHooks {
  readonly afterVerify: AfterVerifyHook;
  readonly afterSettle: AfterSettleHook;
  readonly paymentCanceled: OnVerifiedPaymentCanceledHook;
}

function resourceUrl(payload: Readonly<PaymentPayload>): string | null {
  return payload.x402Version === 2 && payload.resource?.url
    ? payload.resource.url
    : null;
}

function publicIdFromResource(resource: string): string | null {
  try {
    const segments = new URL(resource).pathname.split("/").filter(Boolean);
    if (segments.length !== 2 || segments[0] !== "g") return null;
    const publicId = decodeURIComponent(segments[1]!);
    return publicId && !publicId.includes("/") ? publicId : null;
  } catch {
    return null;
  }
}

function authorization(
  paymentPayload: Readonly<PaymentPayload>,
  requirements: Readonly<{
    network: string;
    asset: string;
    payTo: string;
    amount: string;
  }>,
) {
  const resource = resourceUrl(paymentPayload);
  if (resource === null) throw new Error("invalid custodial resource");
  const policy: AuthorizationPolicy = {
    resource,
    network: requirements.network as typeof BASE_NETWORK,
    asset: getAddress(requirements.asset),
    payTo: getAddress(requirements.payTo),
    amount: requirements.amount,
  };
  if (policy.network !== BASE_NETWORK || policy.asset !== BASE_USDC) {
    throw new Error("invalid custodial payment policy");
  }
  const encoded = encodePaymentSignatureHeader(paymentPayload as PaymentPayload);
  return authorizationDetails(encoded, policy);
}

function abortReason(error: unknown): string {
  if (error instanceof FinancePausedError) return "finance_paused";
  if (error instanceof WorkerUnavailableError) return "payout_worker_unavailable";
  if (error instanceof CustodialLiabilityCapError) return "liability_cap_reached";
  return "finance_unavailable";
}

export function createCustodialSettlementHooks(
  dependencies: CustodialSettlementHookDependencies,
): CustodialSettlementHooks {
  return {
    afterVerify: async context => {
      try {
        const resource = resourceUrl(context.paymentPayload as PaymentPayload);
        const publicId = resource === null ? null : publicIdFromResource(resource);
        if (publicId === null) {
          return { abort: true, reason: "finance_resource_invalid" };
        }
        const endpoint = await dependencies.loadEndpoint(publicId);
        if (
          endpoint === null ||
          endpoint.amountAtomic !== context.requirements.amount ||
          getAddress(context.requirements.payTo) !== dependencies.collectionAddress
        ) {
          return { abort: true, reason: "finance_terms_changed" };
        }
        const details = authorization(
          context.paymentPayload as PaymentPayload,
          context.requirements,
        );
        await dependencies.reserve({
          endpointId: endpoint.id,
          requestId: dependencies.requestId(),
          fingerprint: details.fingerprint,
          payerAddress: details.payer,
          authorizationNonce: details.nonce,
          authorizationValidBefore: details.validBefore,
          sellerPayTo: endpoint.payTo,
          grossAtomic: endpoint.amountAtomic,
        });
      } catch (error) {
        return { abort: true, reason: abortReason(error) };
      }
    },
    afterSettle: async () => {
      // The facilitator success response only proves first inclusion. Keep the
      // obligation pending until the reconciler observes the required depth.
    },
    paymentCanceled: async context => {
      const details = authorization(
        context.paymentPayload as PaymentPayload,
        context.requirements,
      );
      await dependencies.cancelled(details.fingerprint);
    },
  };
}
