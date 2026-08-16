import { fetchUpstream, type UpstreamCredential, type UpstreamRuntime } from "./transport";
import { resolvePinned } from "./resolve";
import { connectHttpsPinned } from "./transport";

export interface ConnectivityResult {
  readonly ok: boolean;
  readonly status: string;
  readonly httpStatus: number | null;
  readonly responseSize: number;
  readonly latencyMs: number;
}

export interface ConnectivityOptions {
  readonly url: URL;
  readonly credential: UpstreamCredential | null;
  readonly runtime?: UpstreamRuntime;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

const defaultRuntime: UpstreamRuntime = {
  resolve: resolvePinned,
  connect: connectHttpsPinned,
  now: Date.now,
};

export async function runConnectivityTest(
  options: ConnectivityOptions,
): Promise<ConnectivityResult> {
  const runtime = options.runtime ?? defaultRuntime;
  const result = await fetchUpstream(
    options.url,
    {
      ...(options.credential !== null ? { credential: options.credential } : {}),
      captureBody: false,
    },
    runtime,
    options.timeoutMs,
    options.maxBytes,
  );

  return {
    ok: result.ok,
    status: result.ok ? "ok" : `error:${result.reason}`,
    httpStatus: result.ok ? result.status : result.status,
    responseSize: result.ok ? result.contentLength : 0,
    latencyMs: result.latencyMs,
  };
}