import {
  authorizationPolicyFromPolicy,
  createResourceRoute,
  type AuthorizationPolicy,
  type PaymentPolicy,
  type PaymentRequestHandler,
} from "@agentpay/server";
import type { x402ResourceServer } from "@x402/core/server";
import type { NextRequest } from "next/server";

import type {
  GatewayPaymentInfrastructure,
} from "@/features/shared/payment-infrastructure";

import type { EndpointRecord } from "./repository";
import type { PaymentEventContext } from "./payment-event";
import type { UpstreamResult } from "./upstream/transport";

const privateNoStore = { "Cache-Control": "private, no-store" } as const;

type RequestHandler = (request: NextRequest) => Promise<Response>;

export interface GatewayRouteDependencies {
  requestId(): string;
  log(entry: GatewayRouteEntry): void;
  infrastructure(): Promise<GatewayPaymentInfrastructure>;
  loadEndpoint(publicId: string): Promise<EndpointRecord | null>;
  buildPolicy(endpoint: EndpointRecord, siteUrl: string): PaymentPolicy;
  siteUrl(): string;
  createPaidHandler(
    endpoint: EndpointRecord,
    request: NextRequest,
    observe: (result: UpstreamResult) => void,
  ): PaymentRequestHandler;
  recordPaymentEvent(context: PaymentEventContext): Promise<void>;
  protect(
    handler: PaymentRequestHandler,
    route: ReturnType<typeof createResourceRoute>,
    server: x402ResourceServer,
  ): RequestHandler;
  guard(
    handler: RequestHandler,
    options: { store: GatewayPaymentInfrastructure["store"]; policy: AuthorizationPolicy },
  ): RequestHandler;
}

export interface GatewayRouteEntry {
  readonly requestId: string;
  readonly publicId: string;
  readonly stage: "lookup" | "configuration" | "payment" | "settlement";
  readonly status: number;
  readonly reason: string;
}

export interface GatewayRouteLogger {
  log(entry: GatewayRouteEntry): void;
}

function error(
  requestId: string,
  log: GatewayRouteLogger["log"],
  publicId: string,
  entry: Omit<GatewayRouteEntry, "requestId" | "publicId">,
): Response {
  log({ ...entry, requestId, publicId });
  return Response.json(
    { error: errorLabel(entry.status), reason: entry.reason },
    {
      status: entry.status,
      headers: {
        ...privateNoStore,
        "X-Request-ID": requestId,
      },
    },
  );
}

function errorLabel(status: number): string {
  if (status === 404) return "Not Found";
  if (status === 502) return "Bad Gateway";
  return "Service Unavailable";
}

function forwarded(response: Response, requestId: string): Response {
  return new Response(response.body, {
    status: response.status,
    headers: {
      ...Object.fromEntries(response.headers),
      "X-Request-ID": requestId,
    },
  });
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

export function createGatewayRoute(
  dependencies: GatewayRouteDependencies,
  logger: GatewayRouteLogger,
): (request: NextRequest, publicId: string) => Promise<Response> {
  return async (request, publicId) => {
    const requestId = dependencies.requestId();

    let endpoint: EndpointRecord | null;
    try {
      endpoint = await dependencies.loadEndpoint(publicId);
    } catch {
      return error(requestId, logger.log, publicId, {
        stage: "lookup",
        status: 404,
        reason: "endpoint_not_found",
      });
    }
    if (endpoint === null) {
      return error(requestId, logger.log, publicId, {
        stage: "lookup",
        status: 404,
        reason: "endpoint_not_found",
      });
    }

    let infrastructure: GatewayPaymentInfrastructure;
    try {
      infrastructure = await dependencies.infrastructure();
    } catch {
      return error(requestId, logger.log, publicId, {
        stage: "payment",
        status: 503,
        reason: "payment_infrastructure_unavailable",
      });
    }

    let policy: PaymentPolicy;
    try {
      policy = dependencies.buildPolicy(endpoint, dependencies.siteUrl());
    } catch {
      return error(requestId, logger.log, publicId, {
        stage: "configuration",
        status: 503,
        reason: "gateway_configuration_unavailable",
      });
    }
    const route = createResourceRoute(policy);

    let paid: PaymentRequestHandler;
    let upstream: UpstreamResult | null = null;
    try {
      paid = dependencies.createPaidHandler(endpoint, request, result => {
        upstream = result;
      });
    } catch {
      return error(requestId, logger.log, publicId, {
        stage: "configuration",
        status: 503,
        reason: "gateway_configuration_unavailable",
      });
    }

    let composed: RequestHandler;
    try {
      composed = dependencies.guard(
        dependencies.protect(paid, route, infrastructure.server),
        {
          store: infrastructure.store,
          policy: authorizationPolicyFromPolicy(policy),
        },
      );
    } catch {
      return error(requestId, logger.log, publicId, {
        stage: "payment",
        status: 503,
        reason: "payment_infrastructure_unavailable",
      });
    }

    let response: Response;
    try {
      response = await composed(request);
    } catch {
      return error(requestId, logger.log, publicId, {
        stage: "payment",
        status: 503,
        reason: "payment_infrastructure_unavailable",
      });
    }

    try {
      await dependencies.recordPaymentEvent({
        endpointId: endpoint.id,
        requestId,
        paymentHeader: request.headers.get("PAYMENT-SIGNATURE"),
        response,
        policy,
        upstream,
      });
    } catch {
      // Payment delivery must never depend on observability persistence.
    }

    if (await hasSettlementFailure(response)) {
      return error(requestId, logger.log, publicId, {
        stage: "settlement",
        status: 502,
        reason: "settlement_failed",
      });
    }
    return forwarded(response, requestId);
  };
}
