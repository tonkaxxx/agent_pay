import { NextResponse } from "next/server";

import type { PaymentRequestHandler } from "@agentpay/server";

import {
  connectHttpsPinned,
  fetchUpstream,
  type UpstreamCredential,
  type UpstreamRuntime,
  type UpstreamResult,
  type UpstreamSuccess,
} from "./upstream/transport";
import { resolvePinned } from "./upstream/resolve";

export interface GatewayUpstreamConfig {
  readonly url: URL;
  readonly credential: () => UpstreamCredential | null;
  readonly query: string;
  readonly accept?: string;
  readonly observe?: (result: UpstreamResult) => void;
}

export interface GatewayHandlerDependencies {
  readonly runtime?: UpstreamRuntime;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

const defaultRuntime: UpstreamRuntime = {
  resolve: resolvePinned,
  connect: connectHttpsPinned,
  now: Date.now,
};

export function upstreamSuccessResponse(
  result: UpstreamSuccess,
): NextResponse {
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store",
  };
  const contentType = result.contentType;
  if (contentType !== null && contentType !== "") {
    headers["Content-Type"] = contentType;
  } else {
    headers["Content-Type"] = "application/octet-stream";
  }
  const contentLength = String(result.contentLength);
  if (Number.isSafeInteger(result.contentLength) && result.contentLength >= 0) {
    headers["Content-Length"] = contentLength;
  }
  return new NextResponse(result.body as unknown as BodyInit, {
    status: 200,
    headers,
  });
}

export function upstreamUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "Bad Gateway", reason: "upstream_unavailable" },
    {
      status: 502,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}

export function createGatewayPaidHandler(
  config: GatewayUpstreamConfig,
  dependencies: GatewayHandlerDependencies = {},
): PaymentRequestHandler {
  const runtime = dependencies.runtime ?? defaultRuntime;
  const timeoutMs = dependencies.timeoutMs;
  const maxBytes = dependencies.maxBytes;

  return async () => {
    const credential = config.credential();
    const result = await fetchUpstream(
      config.url,
      {
        query: config.query,
        ...(config.accept !== undefined ? { accept: config.accept } : {}),
        ...(credential !== null ? { credential } : {}),
      },
      runtime,
      timeoutMs,
      maxBytes,
    );
    config.observe?.(result);

    if (!result.ok) {
      return upstreamUnavailableResponse();
    }
    return upstreamSuccessResponse(result);
  };
}
