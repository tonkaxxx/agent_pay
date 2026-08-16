import { createServer, request as httpRequest } from "node:http";
import type { Server, IncomingMessage } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PinnedConnectionRequest, UpstreamConnection, UpstreamRuntime } from "./transport";
import { runConnectivityTest } from "./connectivity";

let server: Server;
let port: number;

function fakeRuntime(): UpstreamRuntime {
  return {
    async resolve() {
      return [{ address: "127.0.0.1", family: 4 }];
    },
    connect(options: PinnedConnectionRequest): Promise<UpstreamConnection> {
      return new Promise((resolvePromise, rejectPromise) => {
        const req = httpRequest({
          protocol: "http:",
          hostname: "127.0.0.1",
          port,
          method: options.method,
          path: options.path,
          headers: options.headers,
          signal: options.signal,
        });
        req.setTimeout(options.timeoutMs, () => req.destroy(new Error("timeout")));
        req.once("response", (response: IncomingMessage) => {
          resolvePromise({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: response,
            abort: () => response.destroy(),
          });
        });
        req.once("error", rejectPromise);
        req.end();
      });
    },
    now: () => 0,
  };
}

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/ok")) {
      res.writeHead(200, { "content-type": "text/plain", "set-cookie": "secret=1" });
      res.end("ok-body");
      return;
    }
    if (req.url?.startsWith("/fail")) {
      res.writeHead(503, { "content-type": "text/plain" });
      res.end("unavailable");
      return;
    }
    if (req.url?.startsWith("/redirect")) {
      res.writeHead(301, { location: "/ok" });
      res.end();
      return;
    }
    if (req.url?.startsWith("/slow")) {
      setTimeout(() => {
        res.writeHead(200);
        res.end("slow");
      }, 150);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server has no port");
  }
  port = address.port;
});

afterAll(async () => {
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
});

describe("runConnectivityTest", () => {
  it("succeeds only for allowed 2xx responses and reports size", async () => {
    const result = await runConnectivityTest({
      url: new URL("https://upstream.example/ok"),
      credential: null,
      runtime: fakeRuntime(),
    });
    expect(result).toMatchObject({
      ok: true,
      status: "ok",
      httpStatus: 200,
    });
    expect(result.responseSize).toBe(7);
  });

  it("reports server errors as failures with their status", async () => {
    const result = await runConnectivityTest({
      url: new URL("https://upstream.example/fail"),
      credential: null,
      runtime: fakeRuntime(),
    });
    expect(result).toMatchObject({
      ok: false,
      httpStatus: 503,
    });
    expect(result.status).toContain("error:");
  });

  it("rejects redirects", async () => {
    const result = await runConnectivityTest({
      url: new URL("https://upstream.example/redirect"),
      credential: null,
      runtime: fakeRuntime(),
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(301);
  });

  it("reports timeouts", async () => {
    const result = await runConnectivityTest({
      url: new URL("https://upstream.example/slow"),
      credential: null,
      runtime: fakeRuntime(),
      timeoutMs: 30,
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBeNull();
  });

  it("sends the configured credential on the test", async () => {
    const sent: Array<Record<string, string | string[] | undefined>> = [];
    const base = fakeRuntime();
    const runtime: UpstreamRuntime = {
      ...base,
      connect: (options) => {
        sent.push({ ...options.headers });
        return base.connect(options);
      },
    };
    await runConnectivityTest({
      url: new URL("https://upstream.example/ok"),
      credential: { mode: "bearer", value: "secret-tk" },
      runtime,
    });
    expect(sent[0]?.authorization).toBe("Bearer secret-tk");
  });
});