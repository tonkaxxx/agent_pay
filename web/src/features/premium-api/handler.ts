import { NextResponse } from "next/server";

export function createPremiumHandler() {
  return async (request: Request): Promise<NextResponse> => {
    void request;
    return NextResponse.json({
      premiumData: "Here's your premium data — paid, verified, and unlocked by AgentPay.",
      paidWith: "USDC",
      network: "eip155:8453",
      protocol: "x402-v2",
    }, {
      status: 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  };
}
