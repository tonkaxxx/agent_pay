import type { PaymentRequestHandler } from "@agentpay/server";
import { decodePaymentRequiredHeader } from "@x402/core/http";

export interface LegacyPaymentQuote {
  readonly priceUsdc: string;
  readonly payTo: string;
  readonly network: "base";
  readonly chainId: 8453;
}

export function withLegacyPaymentRequired(
  handler: PaymentRequestHandler,
  quote: LegacyPaymentQuote,
): PaymentRequestHandler {
  return async request => {
    const response = await handler(request);
    if (response.status !== 402) return response;

    const encoded = response.headers.get("PAYMENT-REQUIRED");
    if (!encoded) return response;

    try {
      decodePaymentRequiredHeader(encoded);
      const headers = new Headers(response.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      headers.set("cache-control", "no-store");
      return new Response(JSON.stringify({
        error: "Payment Required",
        ...quote,
      }), { status: 402, headers });
    } catch {
      return response;
    }
  };
}
