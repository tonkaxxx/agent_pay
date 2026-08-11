const noStoreHeaders = {
  "Cache-Control": "no-store",
} as const;

export function createBasicHandler() {
  return async (_request: Request): Promise<Response> =>
    Response.json({
      basicData: "Free public data from AgentPay — no payment required.",
      tier: "free",
    }, { status: 200, headers: noStoreHeaders });
}
