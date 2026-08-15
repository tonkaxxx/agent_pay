const noStoreHeaders = {
  "Cache-Control": "no-store",
} as const;

export function createBasicHandler() {
  return async (request: Request): Promise<Response> => {
    void request;
    return Response.json({
      basicData: "Free public data from AgentPay — no payment required.",
      tier: "free",
    }, { status: 200, headers: noStoreHeaders });
  };
}
