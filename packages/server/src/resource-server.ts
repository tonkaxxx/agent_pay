import {
  type FacilitatorClient,
  type RouteConfig,
  x402ResourceServer,
} from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { getAddress, type Address } from "viem";

export const BASE_NETWORK = "eip155:8453" as const;
export const BASE_USDC: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

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
      scheme: "exact",
      network: BASE_NETWORK,
      price: "$0.01",
      payTo: recipient,
      maxTimeoutSeconds: 300,
    },
    resource: canonicalResource(resource),
    description: "AgentPay premium API",
    mimeType: "application/json",
    unpaidResponseBody: () => ({
      contentType: "application/json",
      body: {
        error: "Payment Required",
        x402Version: 2,
        priceUsdc: "0.01",
        network: BASE_NETWORK,
      },
    }),
    settlementFailedResponseBody: () => ({
      contentType: "application/json",
      body: { error: "Bad Gateway", reason: "settlement_failed" },
    }),
  };
}
