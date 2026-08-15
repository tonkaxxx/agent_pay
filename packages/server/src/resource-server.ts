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
} from "./payment-policy.js";

export { BASE_NETWORK, BASE_USDC } from "./payment-policy.js";

export function createAgentPayResourceServer(
  facilitator: FacilitatorClient,
): x402ResourceServer {
  return new x402ResourceServer(facilitator).register(
    BASE_NETWORK,
    new ExactEvmScheme(),
  );
}

function canonicalResource(resource: string): string {
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

export function createPremiumRoute(payTo: Address, resource: string): RouteConfig {
  let recipient: Address;
  try {
    recipient = getAddress(payTo);
  } catch {
    throw new TypeError("payTo must be a valid EVM address.");
  }

  return {
    accepts: {
      scheme: PREMIUM_PAYMENT_POLICY.scheme,
      network: PREMIUM_PAYMENT_POLICY.network,
      price: PREMIUM_PAYMENT_POLICY.price,
      payTo: recipient,
      maxTimeoutSeconds: PREMIUM_PAYMENT_POLICY.maxTimeoutSeconds,
    },
    resource: canonicalResource(resource),
    description: "AgentPay premium API",
    mimeType: "application/json",
    unpaidResponseBody: () => ({
      contentType: "application/json",
      body: {
        error: "Payment Required",
        x402Version: 2,
        priceUsdc: PREMIUM_PAYMENT_POLICY.amountUsdc,
        network: PREMIUM_PAYMENT_POLICY.network,
      },
    }),
    settlementFailedResponseBody: () => ({
      contentType: "application/json",
      body: { error: "Bad Gateway", reason: "settlement_failed" },
    }),
  };
}
