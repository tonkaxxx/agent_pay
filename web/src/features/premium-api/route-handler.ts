import { randomUUID } from "node:crypto";

export type PremiumRequestHandler = (request: Request) => Promise<Response>;

interface PremiumRouteDependencies {
  requestId(): string;
  log(entry: PremiumRouteLog): void;
}

interface PremiumRouteLog {
  requestId: string;
  route: "/api/premium";
  stage: "configuration" | "payment" | "settlement";
  status: 502 | 503;
  reason:
    | "configuration_unavailable"
    | "payment_infrastructure_unavailable"
    | "settlement_failed";
}

const defaults: PremiumRouteDependencies = {
  requestId: randomUUID,
  log: entry => console.info(entry),
};

function stableError(
  requestId: string,
  status: 502 | 503,
  reason: PremiumRouteLog["reason"],
): Response {
  return Response.json({
    error: status === 502 ? "Bad Gateway" : "Service Unavailable",
    reason,
  }, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Request-ID": requestId,
    },
  });
}

function failure(
  log: PremiumRouteDependencies["log"],
  entry: PremiumRouteLog,
): Response {
  log(entry);
  return stableError(entry.requestId, entry.status, entry.reason);
}

async function hasSettlementFailure(response: Response): Promise<boolean> {
  if (response.status !== 402 && response.status !== 502) return false;
  try {
    const value = await response.clone().json() as unknown;
    return typeof value === "object" && value !== null &&
      "reason" in value && value.reason === "settlement_failed";
  } catch {
    return false;
  }
}

export function createPremiumRoute(
  getHandler: () => Promise<PremiumRequestHandler>,
  dependencies: Partial<PremiumRouteDependencies> = {},
): PremiumRequestHandler {
  const requestIdFactory = dependencies.requestId ?? defaults.requestId;
  const log = dependencies.log ?? defaults.log;

  return async request => {
    const requestId = requestIdFactory();
    let handler: PremiumRequestHandler;
    try {
      handler = await getHandler();
    } catch {
      const entry = {
        requestId,
        route: "/api/premium",
        stage: "configuration",
        status: 503,
        reason: "configuration_unavailable",
      } as const;
      return failure(log, entry);
    }

    let response: Response;
    try {
      response = await handler(request);
    } catch {
      const entry = {
        requestId,
        route: "/api/premium",
        stage: "payment",
        status: 503,
        reason: "payment_infrastructure_unavailable",
      } as const;
      return failure(log, entry);
    }

    if (await hasSettlementFailure(response)) {
      const entry = {
        requestId,
        route: "/api/premium",
        stage: "settlement",
        status: 502,
        reason: "settlement_failed",
      } as const;
      return failure(log, entry);
    }

    if (response.status === 402 && response.headers.has("PAYMENT-REQUIRED")) {
      return response;
    }
    if (response.status >= 500 || response.status === 402) {
      const entry = {
        requestId,
        route: "/api/premium",
        stage: "payment",
        status: 503,
        reason: "payment_infrastructure_unavailable",
      } as const;
      return failure(log, entry);
    }
    return response;
  };
}
