import {
  createPaymentPolicy,
  canonicalResource,
  type PaymentPolicy,
} from "@agentpay/server";

import type { EndpointRecord } from "./repository";
import type { GatewayFinanceConfig } from "@/features/finance/config";

export function buildGatewayPolicy(
  endpoint: Pick<EndpointRecord, "publicId" | "displayName" | "payTo" | "amountAtomic">,
  siteUrl: string,
  finance: GatewayFinanceConfig = { mode: "ledger" },
): PaymentPolicy {
  const resource = canonicalResource(new URL(`/g/${endpoint.publicId}`, siteUrl).href);
  return createPaymentPolicy({
    resource,
    payTo: finance.mode === "custodial" ? finance.collectionAddress : endpoint.payTo,
    amountAtomic: endpoint.amountAtomic,
    maxTimeoutSeconds: 300,
    description: endpoint.displayName,
  });
}
