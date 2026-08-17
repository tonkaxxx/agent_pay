import { describe, expect, it } from "vitest";

import { loadGatewayConfig } from "./gateway-config";

const base = {
  NEXT_PUBLIC_SITE_URL: "https://gateway.example",
  FACILITATOR_URL: "https://facilitator.example",
  REDIS_URL: "rediss://cache.example:6379",
  NODE_ENV: "production",
} as const;

describe("loadGatewayConfig", () => {
  it("loads a valid production configuration", () => {
    const config = loadGatewayConfig(base);

    expect(config.siteUrl).toBe("https://gateway.example/");
    expect(config.facilitatorUrl).toBe("https://facilitator.example/");
    expect(config.redisUrl).toBe("rediss://cache.example:6379");
  });

  it("rejects missing required variables", () => {
    expect(() => loadGatewayConfig({ ...base, FACILITATOR_URL: undefined }))
      .toThrowError(/Invalid gateway configuration: FACILITATOR_URL/);
  });

  it("rejects a local origin in production without an override", () => {
    expect(() =>
      loadGatewayConfig({
        ...base,
        NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      }),
    ).toThrowError(/Invalid gateway configuration: NEXT_PUBLIC_SITE_URL/);
  });

  it("allows a local origin in production with an explicit override", () => {
    const config = loadGatewayConfig({
      ...base,
      NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
      AGENTPAY_ALLOW_INSECURE_LOCAL_ORIGIN: "true",
    });

    expect(config.siteUrl).toBe("http://localhost:3000/");
  });

  it("rejects a site URL with a path, search or hash", () => {
    expect(() =>
      loadGatewayConfig({
        ...base,
        NEXT_PUBLIC_SITE_URL: "https://gateway.example/some/path?q=1#frag",
      }),
    ).toThrowError(/Invalid gateway configuration: NEXT_PUBLIC_SITE_URL/);
  });

  it("rejects a non-redis URL", () => {
    expect(() =>
      loadGatewayConfig({
        ...base,
        REDIS_URL: "https://cache.example:6379",
      }),
    ).toThrowError(/Invalid gateway configuration: REDIS_URL/);
  });

  it("forbids payment secrets in the web runtime", () => {
    expect(() =>
      loadGatewayConfig({ ...base, FACILITATOR_PRIVATE_KEY: "secret" }),
    ).toThrowError(/Invalid gateway configuration: FACILITATOR_PRIVATE_KEY/);

    expect(() =>
      loadGatewayConfig({ ...base, AGENT_PRIVATE_KEY: "secret" }),
    ).toThrowError(/Invalid gateway configuration: AGENT_PRIVATE_KEY/);
  });
});
