import {
  createPaymentPolicy,
  canonicalResource,
  type PaymentPolicy,
} from "@agentpay/server";

import type { EndpointRecord } from "./repository";

export function buildGatewayPolicy(
  endpoint: Pick<EndpointRecord, "publicId" | "displayName" | "payTo" | "amountAtomic">,
  siteUrl: string,
): PaymentPolicy {
  const resource = canonicalResource(new URL(`/g/${endpoint.publicId}`, siteUrl).href);
  return createPaymentPolicy({
    resource,
    payTo: endpoint.payTo,
    amountAtomic: endpoint.amountAtomic,
    maxTimeoutSeconds: 300,
    description: endpoint.displayName,
  });
}