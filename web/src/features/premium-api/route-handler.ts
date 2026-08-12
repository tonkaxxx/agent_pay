import { randomUUID } from "node:crypto";

import { PaymentIdempotencyUnavailableError } from "@agentpay/server";
import { getFacilitatorResponseError } from "@x402/core/http";

export type PremiumRequestHandler = (request: Request) => Promise<Response>;

export class PremiumConfigurationError extends Error {
  readonly code = "configuration_unavailable";

  constructor(options?: ErrorOptions) {
    super("Premium API configuration is unavailable.", options);
    this.name = "PremiumConfigurationError";
  }
}

type PremiumFailureReason =
  | "configuration_unavailable"
  | "facilitator_unavailable"
  | "idempotency_unavailable"
  | "internal_error";

interface PremiumFailureLog {
  readonly event: "premium_request_failed";
  readonly requestId: string;
  readonly route: string;
  readonly stage: "configuration" | "payment";
  readonly status: 500 | 502 | 503;
  readonly reason: PremiumFailureReason;
}

interface CreatePremiumRouteOptions {
  readonly requestIdFactory?: () => string;
  readonly logError?: (record: PremiumFailureLog) => void;
}

function classifyFailure(error: unknown): {
  readonly status: 500 | 502 | 503;
  readonly reason: PremiumFailureReason;
  readonly label: "Bad Gateway" | "Internal Server Error" | "Service Unavailable";
} {
  if (error instanceof PremiumConfigurationError) {
    return { status: 503, reason: "configuration_unavailable", label: "Service Unavailable" };
  }
  if (error instanceof PaymentIdempotencyUnavailableError) {
    return { status: 503, reason: "idempotency_unavailable", label: "Service Unavailable" };
  }
  if (getFacilitatorResponseError(error)) {
    return { status: 502, reason: "facilitator_unavailable", label: "Bad Gateway" };
  }
  return { status: 500, reason: "internal_error", label: "Internal Server Error" };
}

export function createPremiumRoute(
  getHandler: () => Promise<PremiumRequestHandler>,
  {
    requestIdFactory = randomUUID,
    logError = record => console.error(JSON.stringify(record)),
  }: CreatePremiumRouteOptions = {},
): PremiumRequestHandler {
  return async (request) => {
    const requestId = requestIdFactory();
    let stage: PremiumFailureLog["stage"] = "configuration";
    try {
      const handler = await getHandler();
      stage = "payment";
      return await handler(request);
    } catch (error) {
      const failure = classifyFailure(error);
      const route = new URL(request.url).pathname;
      logError({
        event: "premium_request_failed",
        requestId,
        route,
        stage,
        status: failure.status,
        reason: failure.reason,
      });
      return Response.json({
        error: failure.label,
        reason: failure.reason,
        requestId,
      }, {
        status: failure.status,
        headers: {
          "Cache-Control": "no-store",
          "X-Request-ID": requestId,
        },
      });
    }
  };
}
