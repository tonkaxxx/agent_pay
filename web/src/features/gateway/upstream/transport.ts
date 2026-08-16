import type { IncomingMessage, ClientRequest } from "node:http";
import type { LookupFunction } from "node:net";
import { request as httpsRequest } from "node:https";

import type { PinnedAddress } from "./resolve";

export const UPSTREAM_TIMEOUT_MS = 30_000;
export const UPSTREAM_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export const UPSTREAM_USER_AGENT = "agentpay-upstream/1.0";

export type UpstreamFailureReason =
  | "forbidden"
  | "dns"
  | "network"
  | "timeout"
  | "too_large"
  | "redirect"
  | "client_error"
  | "server_error"
  | "protocol";

export interface UpstreamSuccess {
  readonly ok: true;
  readonly status: number;
  readonly contentType: string | null;
  readonly contentLength: number;
  readonly body: Uint8Array;
  readonly latencyMs: number;
}

export interface UpstreamFailure {
  readonly ok: false;
  readonly reason: UpstreamFailureReason;
  readonly status: number | null;
  readonly latencyMs: number;
}

export type UpstreamResult = UpstreamSuccess | UpstreamFailure;

export interface UpstreamCredential {
  readonly mode: "bearer" | "x-api-key";
  readonly value: string;
}

export interface UpstreamRequestOptions {
  readonly query?: string;
  readonly credential?: UpstreamCredential;
  readonly accept?: string;
  readonly captureBody?: boolean;
}

export interface PinnedConnectionRequest {
  readonly hostname: string;
  readonly address: string;
  readonly family: number;
  readonly port: number;
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

export interface UpstreamConnection {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: AsyncIterable<Uint8Array>;
  readonly abort: () => void;
}

export interface UpstreamRuntime {
  readonly resolve: (hostname: string) => Promise<readonly PinnedAddress[]>;
  readonly connect: (options: PinnedConnectionRequest) => Promise<UpstreamConnection>;
  readonly now: () => number;
}

export class UpstreamTimeoutError extends Error {
  constructor() {
    super("Upstream request timed out");
    this.name = "UpstreamTimeoutError";
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export async function connectHttpsPinned(
  options: PinnedConnectionRequest,
): Promise<UpstreamConnection> {
  return new Promise((resolvePromise, rejectPromise) => {
    const request: ClientRequest = httpsRequest({
      protocol: "https:",
      hostname: options.hostname,
      servername: options.hostname,
      port: options.port,
      method: options.method,
      path: options.path,
      headers: options.headers,
      signal: options.signal,
      lookup: ((host: string, lookupOptions: { all?: boolean }, callback: Parameters<LookupFunction>[2]) => {
        if (lookupOptions?.all === true) {
          callback(null, [
            { address: options.address, family: options.family as 4 | 6 },
          ]);
          return;
        }
        callback(null, options.address, options.family);
      }) as LookupFunction,
    });
    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new UpstreamTimeoutError());
    });
    request.once("response", (response: IncomingMessage) => {
      resolvePromise({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: response,
        abort: () => {
          response.destroy();
        },
      });
    });
    request.once("error", (error) => {
      rejectPromise(error);
    });
    request.end();
  });
}

export function isValidAcceptHeader(value: string): boolean {
  if (typeof value !== "string" || value === "") {
    return false;
  }
  if (value.length > 512) {
    return false;
  }
  return /^[\x20-\x7e]+$/.test(value);
}

function reasonFromStatus(status: number): UpstreamFailureReason {
  if (status >= 300 && status < 400) {
    return "redirect";
  }
  if (status >= 400 && status < 500) {
    return "client_error";
  }
  if (status >= 500) {
    return "server_error";
  }
  return "protocol";
}

function failureTail(reason: UpstreamFailureReason, status: number | null, started: number, now: () => number): UpstreamFailure {
  return { ok: false, reason, status, latencyMs: now() - started };
}

export async function fetchUpstream(
  url: URL,
  requestOptions: UpstreamRequestOptions,
  runtime: UpstreamRuntime,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
  maxBytes = UPSTREAM_MAX_RESPONSE_BYTES,
): Promise<UpstreamResult> {
  const started = runtime.now();

  let pinned: readonly PinnedAddress[];
  try {
    pinned = await runtime.resolve(url.hostname);
  } catch (error) {
    if (error instanceof Error && error.name === "ForbiddenAddressError") {
      return failureTail("forbidden", null, started, runtime.now);
    }
    return failureTail("dns", null, started, runtime.now);
  }
  const target = pinned[0];
  if (target === undefined) {
    return failureTail("dns", null, started, runtime.now);
  }

  const headers: Record<string, string> = {
    "user-agent": UPSTREAM_USER_AGENT,
  };
  if (requestOptions.accept !== undefined && isValidAcceptHeader(requestOptions.accept)) {
    headers.accept = requestOptions.accept;
  }
  if (requestOptions.credential !== undefined) {
    if (requestOptions.credential.mode === "bearer") {
      headers.authorization = `Bearer ${requestOptions.credential.value}`;
    } else {
      headers["x-api-key"] = requestOptions.credential.value;
    }
  }

  const query = requestOptions.query ?? url.search.replace(/^\?/, "");
  const path = `${url.pathname}${query === "" ? "" : `?${query}`}`;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  let connection: UpstreamConnection;
  try {
    connection = await runtime.connect({
      hostname: url.hostname,
      address: target.address,
      family: target.family,
      port: url.port === "" ? 443 : Number(url.port),
      method: "GET",
      path,
      headers,
      signal: controller.signal,
      timeoutMs,
    });
  } catch (error) {
    clearTimeout(timer);
    if (isAbortError(error) || error instanceof UpstreamTimeoutError) {
      return failureTail("timeout", null, started, runtime.now);
    }
    return failureTail("network", null, started, runtime.now);
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  let tooLarge = false;
  const captureBody = requestOptions.captureBody !== false;
  try {
    for await (const chunk of connection.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.byteLength;
      if (size > maxBytes) {
        tooLarge = true;
        connection.abort();
        break;
      }
      if (captureBody) {
        chunks.push(buffer);
      }
    }
  } catch (error) {
    clearTimeout(timer);
    if (tooLarge) {
      return failureTail("too_large", connection.status, started, runtime.now);
    }
    if (isAbortError(error) || error instanceof UpstreamTimeoutError) {
      return failureTail("timeout", connection.status, started, runtime.now);
    }
    return failureTail("network", connection.status, started, runtime.now);
  }
  clearTimeout(timer);

  if (tooLarge) {
    return failureTail("too_large", connection.status, started, runtime.now);
  }

  const status = connection.status;
  if (status < 200 || status > 299) {
    return failureTail(reasonFromStatus(status), status, started, runtime.now);
  }

  const contentTypeHeader = connection.headers["content-type"];
  const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] ?? null : (contentTypeHeader ?? null);
  const body = captureBody ? Buffer.concat(chunks) : Buffer.alloc(0);

  return {
    ok: true,
    status,
    contentType,
    contentLength: size,
    body,
    latencyMs: runtime.now() - started,
  };
}