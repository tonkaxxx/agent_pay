import type { PaymentVerificationResult } from "@x402/server";
import type { Address } from "viem";

const PAYMENT_HEADER = "X-Payment-Tx";

export interface PremiumHandlerDependencies {
  readonly payTo: Address;
  readonly verify: (txHash: string) => Promise<PaymentVerificationResult>;
}

const noStoreHeaders = {
  "Cache-Control": "no-store",
} as const;

export function createPremiumHandler({ payTo, verify }: PremiumHandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    const txHash = request.headers.get(PAYMENT_HEADER);
    if (txHash !== null) {
      let result: PaymentVerificationResult;
      try {
        result = await verify(txHash);
      } catch {
        return Response.json({
          error: "Payment Verification Unavailable",
          reason: "verification_unavailable",
        }, {
          status: 503,
          headers: { ...noStoreHeaders, "Retry-After": "2" },
        });
      }
      if (result.valid) {
        return Response.json({
          premiumData: "Here's your premium data — paid, verified, and unlocked by AgentPay.",
          paidWith: "USDC",
          network: "base",
          txHash,
        }, { status: 200, headers: noStoreHeaders });
      }
      if (result.retryable) {
        return Response.json({
          error: "Payment Verification Unavailable",
          reason: result.reason,
        }, {
          status: 503,
          headers: { ...noStoreHeaders, "Retry-After": "2" },
        });
      }
      return Response.json({
        error: "Invalid Payment",
        reason: result.reason,
      }, { status: 403, headers: noStoreHeaders });
    }

    return Response.json({
      error: "Payment Required",
      priceUsdc: "0.01",
      payTo,
      network: "base",
      chainId: 8453,
    }, { status: 402, headers: noStoreHeaders });
  };
}
