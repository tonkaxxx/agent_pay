import type { PaymentRequestHandler } from "@agentpay/server";
import { decodePaymentRequiredHeader } from "@x402/core/http";

export function withReadablePaymentRequired(
  handler: PaymentRequestHandler,
): PaymentRequestHandler {
  return async request => {
    const response = await handler(request);
    if (response.status !== 402) return response;

    const encoded = response.headers.get("PAYMENT-REQUIRED");
    if (!encoded) return response;

    try {
      const body = decodePaymentRequiredHeader(encoded);
      const headers = new Headers(response.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      headers.set("cache-control", "private, no-store");
      return new Response(JSON.stringify(body), { status: 402, headers });
    } catch {
      return response;
    }
  };
}
