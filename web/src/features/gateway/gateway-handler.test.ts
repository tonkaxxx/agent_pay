import { describe, expect, it, vi } from "vitest";

import {
  createGatewayPaidHandler,
  upstreamSuccessResponse,
  upstreamUnavailableResponse,
} from "./gateway-handler";
import type { PinnedConnectionRequest, UpstreamRuntime, UpstreamSuccess } from "./upstream/transport";

function runtime(): { rt: UpstreamRuntime; connect: ReturnType<typeof vi.fn> } {
  const connect = vi.fn(async () => {
    throw new Error("not connected");
  });
  return {
    connect,
    rt: {
      resolve: async () => [{ address: "203.0.113.10", family: 4 }],
      connect,
      now: () => 0,
    },
  };
}

describe("upstreamSuccessResponse", () => {
  it("passes through the body with a private cache header and content type", () => {
    const result: UpstreamSuccess = {
      ok: true,
      status: 200,
      contentType: "application/json",
      contentLength: 5,
      body: new TextEncoder().encode("hello"),
      latencyMs: 12,
    };

    const response = upstreamSuccessResponse(result);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Content-Length")).toBe("5");
  });

  it("defaults the content type when the upstream sends none", () => {
    const result: UpstreamSuccess = {
      ok: true,
      status: 200,
      contentType: null,
      contentLength: 0,
      body: new TextEncoder().encode(""),
      latencyMs: 1,
    };

    const response = upstreamSuccessResponse(result);

    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.has("Content-Length")).toBe(true);
  });
});

describe("upstreamUnavailableResponse", () => {
  it("returns a 502 with a stable reason", () => {
    const response = upstreamUnavailableResponse();

    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("createGatewayPaidHandler", () => {
  it("reports the bounded upstream result for payment observability", async () => {
    const { rt, connect } = runtime();
    vi.mocked(connect).mockResolvedValue({
      status: 200,
      headers: { "content-type": "application/json" },
      body: (async function* body() {
        yield new TextEncoder().encode("{}");
      })(),
      abort: () => {},
    });
    const observe = vi.fn();
    const handler = createGatewayPaidHandler(
      {
        url: new URL("https://upstream.example/data"),
        credential: () => null,
        query: "",
        observe,
      },
      { runtime: rt },
    );

    await handler(new Request("https://gateway.example/g/x"));

    expect(observe).toHaveBeenCalledWith(expect.objectContaining({
      ok: true,
      status: 200,
      contentLength: 2,
    }));
  });

  it("fetches the upstream and forwards the success body", async () => {
    const { rt, connect } = runtime();
    const encoder = new TextEncoder();
    vi.mocked(connect).mockResolvedValue({
      status: 200,
      headers: { "content-type": "application/json", "content-length": "2" },
      body: (async function* body() {
        yield encoder.encode("{}");
      })(),
      abort: () => {},
    });

    const handler = createGatewayPaidHandler(
      {
        url: new URL("https://upstream.example/data"),
        credential: () => null,
        query: "a=1",
      },
      { runtime: rt },
    );

    const response = await handler(new Request("https://gateway.example/g/x"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    await expect(response.text()).resolves.toBe("{}");
  });

  it("fails closed with a 502 when the upstream errors", async () => {
    const { rt, connect } = runtime();
    vi.mocked(connect).mockRejectedValue(new Error("dns failed"));

    const handler = createGatewayPaidHandler(
      {
        url: new URL("https://upstream.example/data"),
        credential: () => null,
        query: "",
      },
      { runtime: rt },
    );

    const response = await handler(new Request("https://gateway.example/g/x"));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Bad Gateway",
      reason: "upstream_unavailable",
    });
  });

  it("applies the upstream credential when provided", async () => {
    const { rt, connect } = runtime();
    const encoder = new TextEncoder();
    let captured: PinnedConnectionRequest | undefined;
    vi.mocked(connect).mockImplementation(async (options) => {
      captured = options;
      return {
        status: 200,
        headers: {},
        body: (async function* body() {
          yield encoder.encode("ok");
        })(),
        abort: () => {},
      };
    });

    const credential = vi.fn(() => ({ mode: "bearer" as const, value: "tok-123" }));
    const handler = createGatewayPaidHandler(
      {
        url: new URL("https://upstream.example/data"),
        credential,
        query: "",
      },
      { runtime: rt },
    );

    await handler(new Request("https://gateway.example/g/x"));

    expect(credential).toHaveBeenCalledTimes(1);
    expect(captured?.headers["authorization"]).toBe("Bearer tok-123");
  });
});
