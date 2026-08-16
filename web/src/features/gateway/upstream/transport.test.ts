import { createServer, request as httpRequest } from "node:http";
import type { Server, IncomingMessage } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PinnedConnectionRequest, UpstreamConnection, UpstreamRuntime } from "./transport";
import { fetchUpstream, isValidAcceptHeader } from "./transport";

let server: Server;
let port: number;
const seenUpstream: Array<{ path: string; headers: Record<string, string | string[] | undefined> }> = [];

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
        req.setTimeout(options.timeoutMs, () => {
          req.destroy(new Error("timeout"));
        });
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
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname + url.search;
    seenUpstream.push({ path, headers: { ...req.headers } });
    const route = url.pathname;
    if (route === "/slow") {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("slow");
      }, 150);
      return;
    }
    if (route === "/large") {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.write(Buffer.alloc(64, 97));
      return;
    }
    if (route === "/redirect") {
      res.writeHead(302, { location: "/moved", "set-cookie": "secret=1" });
      res.end();
      return;
    }
    if (route === "/error") {
      res.writeHead(500, { "content-type": "text/plain", "set-cookie": "x=1" });
      res.end("boom");
      return;
    }
    if (route === "/missing") {
      res.writeHead(404);
      res.end("nope");
      return;
    }
    if (route === "/echo") {
      res.writeHead(200, {
        "content-type": "application/json",
        "x-powered-by": "test",
        "access-control-allow-origin": "*",
        "set-cookie": "secret=1",
      });
      res.end(JSON.stringify({ ok: true, path: url.pathname, search: url.search }));
      return;
    }
    res.writeHead(404);
    res.end("nope");
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

describe("fetchUpstream", () => {
  it("returns the body and preserves content-type only", async () => {
    const result = await fetchUpstream(
      new URL("https://upstream.example/echo?q=abc%201"),
      { accept: "application/json" },
      fakeRuntime(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("application/json");
    expect(result.contentLength).toBeGreaterThan(0);
    expect(JSON.parse(Buffer.from(result.body).toString("utf8"))).toMatchObject({
      ok: true,
      path: "/echo",
      search: "?q=abc%201",
    });
  });

  it("does not forward arbitrary buyer headers, cookies, or payment headers", async () => {
    seenUpstream.length = 0;
    await fetchUpstream(
      new URL("https://upstream.example/echo"),
      { accept: "text/plain" },
      fakeRuntime(),
    );
    const headers = seenUpstream[0]?.headers ?? {};
    expect(headers.accept ?? String(headers.accept)).toBe("text/plain");
    expect(headers.cookie).toBeUndefined();
    expect(headers.authorization).toBeUndefined();
    expect(headers["x-pay"]).toBeUndefined();
    expect(headers["x-payment-signature"]).toBeUndefined();
  });

  it("injects the bearer credential", async () => {
    seenUpstream.length = 0;
    await fetchUpstream(
      new URL("https://upstream.example/echo"),
      { credential: { mode: "bearer", value: "tok" } },
      fakeRuntime(),
    );
    expect(seenUpstream[0]?.headers.authorization).toBe("Bearer tok");
  });

  it("injects the x-api-key credential", async () => {
    seenUpstream.length = 0;
    await fetchUpstream(
      new URL("https://upstream.example/echo"),
      { credential: { mode: "x-api-key", value: "key" } },
      fakeRuntime(),
    );
    expect(seenUpstream[0]?.headers["x-api-key"]).toBe("key");
  });

  it("rejects redirects without following them", async () => {
    seenUpstream.length = 0;
    const result = await fetchUpstream(new URL("https://upstream.example/redirect"), {}, fakeRuntime());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("redirect");
    expect(result.status).toBe(302);
    expect(seenUpstream.map((s) => s.path)).not.toContain("/moved");
  });

  it("reports client and server errors", async () => {
    const missing = await fetchUpstream(new URL("https://upstream.example/missing"), {}, fakeRuntime());
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.reason).toBe("client_error");
    const error = await fetchUpstream(new URL("https://upstream.example/error"), {}, fakeRuntime());
    expect(error.ok).toBe(false);
    if (error.ok) return;
    expect(error.reason).toBe("server_error");
  });

  it("times out", async () => {
    const start = Date.now();
    const result = await fetchUpstream(
      new URL("https://upstream.example/slow"),
      { captureBody: true },
      fakeRuntime(),
      30,
    );
    expect(Date.now() - start).toBeLessThan(200);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("timeout");
  });

  it("enforces the response size limit", async () => {
    const result = await fetchUpstream(
      new URL("https://upstream.example/large"),
      {},
      fakeRuntime(),
      500,
      32,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("too_large");
  });
});

describe("isValidAcceptHeader", () => {
  it("accepts simple mime types", () => {
    expect(isValidAcceptHeader("application/json")).toBe(true);
    expect(isValidAcceptHeader("text/plain;q=0.9")).toBe(true);
    expect(isValidAcceptHeader("*/*")).toBe(true);
  });

  it("rejects control characters and non-ascii", () => {
    expect(isValidAcceptHeader("application/json\n")).toBe(false);
    expect(isValidAcceptHeader("application/json\u0000")).toBe(false);
    expect(isValidAcceptHeader("application/json\u00e8")).toBe(false);
    expect(isValidAcceptHeader("")).toBe(false);
    expect(isValidAcceptHeader("a".repeat(600))).toBe(false);
  });
});