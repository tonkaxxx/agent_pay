import {
  type FacilitatorClient,
  type RouteConfig,
  x402ResourceServer,
} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { getAddress, type Address } from "viem";

import {
  BASE_NETWORK,
  PREMIUM_PAYMENT_POLICY,
  canonicalResource,
  createPaymentPolicy,
  type PaymentPolicy,
} from "./payment-policy.js";

export { BASE_NETWORK, BASE_USDC, canonicalResource } from "./payment-policy.js";

export function createAgentPayResourceServer(
  facilitator: FacilitatorClient,
): x402ResourceServer {
  return new x402ResourceServer(facilitator).register(
    BASE_NETWORK,
    new ExactEvmScheme(),
  );
}

export function createResourceRoute(policy: PaymentPolicy): RouteConfig {
  return {
    accepts: {
      scheme: policy.scheme,
      network: policy.network,
      price: policy.price,
      payTo: policy.payTo,
      maxTimeoutSeconds: policy.maxTimeoutSeconds,
    },
    resource: policy.resource,
    description: policy.description,
    mimeType: "application/json",
    unpaidResponseBody: () => ({
      contentType: "application/json",
      body: {
        error: "Payment Required",
        x402Version: 2,
        priceUsdc: policy.amountUsdc,
        network: policy.network,
      },
    }),
    settlementFailedResponseBody: () => ({
      contentType: "application/json",
      body: { error: "Bad Gateway", reason: "settlement_failed" },
    }),
  };
}

export function createPremiumRoute(payTo: Address, resource: string): RouteConfig {
  let recipient: Address;
  try {
    recipient = getAddress(payTo);
  } catch {
    throw new TypeError("payTo must be a valid EVM address.");
  }

  const policy = createPaymentPolicy({
    resource: canonicalResource(resource),
    payTo: recipient,
    amountAtomic: PREMIUM_PAYMENT_POLICY.amountAtomic,
    maxTimeoutSeconds: PREMIUM_PAYMENT_POLICY.maxTimeoutSeconds,
    description: "AgentPay premium API",
  });
  return createResourceRoute(policy);
}