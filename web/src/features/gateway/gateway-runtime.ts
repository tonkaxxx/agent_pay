import { randomUUID } from "node:crypto";

import {
  withAuthorizationLock,
  type PaymentRequestHandler,
} from "@agentpay/server";
import { withX402 } from "@x402/next";
import type { NextRequest } from "next/server";

import { getDatabase } from "@/db";
import { loadMasterKeyConfig } from "@/features/gateway/env";
import { decryptSecret } from "@/features/gateway/secrets";
import { validateUpstreamUrl } from "@/features/gateway/upstream/url-policy";
import type { UpstreamCredential } from "@/features/gateway/upstream/transport";
import {
  getSharedGatewayInfrastructure,
} from "@/features/shared/payment-infrastructure";

import { loadGatewayConfig } from "./gateway-config";
import { createGatewayPaidHandler } from "./gateway-handler";
import { createGatewayRoute, type GatewayRouteLogger } from "./gateway-route";
import { buildGatewayPolicy } from "./policy";
import type { EndpointRecord } from "./repository";

export interface GatewayRuntime {
  route(publicId: string, request: NextRequest): Promise<Response>;
}

export function buildGatewayRuntime(
  environment: Readonly<Record<string, string | undefined>>,
  logger: GatewayRouteLogger,
): GatewayRuntime {
  const db = getDatabase();
  const config = loadGatewayConfig(environment);
  const vault = loadMasterKeyConfig(environment);

  const gatewayRoute = createGatewayRoute(
    {
      requestId: randomUUID,
      log: entry => {
        logger.log(entry);
      },
      infrastructure: () =>
        getSharedGatewayInfrastructure({
          facilitatorUrl: config.facilitatorUrl,
          redisUrl: config.redisUrl,
        }),
      loadEndpoint: publicId =>
        import("./repository").then(({ findActiveByPublicId }) =>
          findActiveByPublicId(db.db, publicId),
        ),
      buildPolicy: buildGatewayPolicy,
      siteUrl: () => config.siteUrl,
      createPaidHandler: (endpoint, request) => {
        const accept = request.headers.get("accept");
        return createGatewayPaidHandler({
          url: validateUpstreamUrl(endpoint.upstreamUrl),
          credential: () => decryptEndpointCredential(endpoint, vault.ring),
          query: request.nextUrl.search.replace(/^\?/, ""),
          ...(accept !== null ? { accept } : {}),
        });
      },
      protect: withX402,
      guard: (handler, options) =>
        withAuthorizationLock(handler as PaymentRequestHandler, options),
    },
    logger,
  );

  return {
    route: (publicId, request) => gatewayRoute(request, publicId),
  };
}

function decryptEndpointCredential(
  endpoint: EndpointRecord,
  ring: ReturnType<typeof loadMasterKeyConfig>["ring"],
): UpstreamCredential | null {
  if (
    endpoint.authMode === "none" ||
    endpoint.secretCiphertext === null ||
    endpoint.secretIv === null ||
    endpoint.secretAuthTag === null ||
    endpoint.secretKeyVersion === null
  ) {
    return null;
  }
  return {
    mode: endpoint.authMode,
    value: decryptSecret(
      {
        keyVersion: endpoint.secretKeyVersion,
        iv: endpoint.secretIv,
        authTag: endpoint.secretAuthTag,
        ciphertext: endpoint.secretCiphertext,
      },
      ring,
    ),
  };
}