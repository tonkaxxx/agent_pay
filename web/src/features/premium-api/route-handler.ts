export type PremiumRequestHandler = (request: Request) => Promise<Response>;

export function createPremiumRoute(
  getHandler: () => Promise<PremiumRequestHandler>,
): PremiumRequestHandler {
  return async (request) => {
    try {
      const handler = await getHandler();
      return await handler(request);
    } catch {
      return Response.json({
        error: "Service Unavailable",
        reason: "configuration_unavailable",
      }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
  };
}
