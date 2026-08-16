import { describe, expect, it } from "vitest";

import { loadAuthEnvironment } from "./env";

const goodSecret = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "test",
    AUTH_SECRET: goodSecret,
    NEXT_PUBLIC_SITE_URL: "https://agentpay.test",
    AUTH_TRUST_HOST: "true",
    AUTH_GITHUB_ID: "github-client-id",
    AUTH_GITHUB_SECRET: "github-client-secret",
    AUTH_EMAIL_SERVER: "smtp://user:pass@mail.example.test:587",
    AUTH_EMAIL_FROM: "AgentPay <hello@agentpay.test>",
    ...overrides,
  };
}

describe("loadAuthEnvironment", () => {
  it("accepts a complete non-production configuration", () => {
    const env = loadAuthEnvironment(baseEnv());
    expect(env.secret).toBe(goodSecret);
    expect(env.trustHost).toBe(true);
    expect(env.github?.clientId).toBe("github-client-id");
    expect(env.email?.from).toBe("AgentPay <hello@agentpay.test>");
  });

  it("rejects a missing or placeholder AUTH_SECRET", () => {
    expect(() => loadAuthEnvironment(baseEnv({ AUTH_SECRET: undefined }))).toThrow();
    expect(() =>
      loadAuthEnvironment(baseEnv({ AUTH_SECRET: "INVALID_CHANGE_ME_failure_case_value" })),
    ).toThrow();
    expect(() =>
      loadAuthEnvironment(baseEnv({ AUTH_SECRET: "short" })),
    ).toThrow();
  });

  it("requires a secret of at least 32 characters", () => {
    const short = "a".repeat(31);
    expect(() => loadAuthEnvironment(baseEnv({ AUTH_SECRET: short }))).toThrow();
    expect(loadAuthEnvironment(baseEnv({ AUTH_SECRET: "a".repeat(32) }))).toBeTruthy();
  });

  it("tolerates a single provider outside production", () => {
    const onlyGithub = baseEnv({
      AUTH_EMAIL_SERVER: undefined,
      AUTH_EMAIL_FROM: undefined,
    });
    const env = loadAuthEnvironment(onlyGithub);
    expect(env.github).toBeDefined();
    expect(env.email).toBeUndefined();

    const onlyEmail = baseEnv({
      AUTH_GITHUB_ID: undefined,
      AUTH_GITHUB_SECRET: undefined,
    });
    const env2 = loadAuthEnvironment(onlyEmail);
    expect(env2.github).toBeUndefined();
    expect(env2.email).toBeDefined();
  });

  it("rejects configuration with zero providers", () => {
    expect(() =>
      loadAuthEnvironment(
        baseEnv({
          AUTH_GITHUB_ID: undefined,
          AUTH_GITHUB_SECRET: undefined,
          AUTH_EMAIL_SERVER: undefined,
          AUTH_EMAIL_FROM: undefined,
        }),
      ),
    ).toThrow();
  });

  it("requires both GitHub and email in production", () => {
    const production = baseEnv({ NODE_ENV: "production" });
    expect(loadAuthEnvironment(production)).toBeTruthy();

    expect(() =>
      loadAuthEnvironment(
        baseEnv({
          NODE_ENV: "production",
          AUTH_EMAIL_SERVER: undefined,
          AUTH_EMAIL_FROM: undefined,
        }),
      ),
    ).toThrow(/GitHub/i);

    expect(() =>
      loadAuthEnvironment(
        baseEnv({
          NODE_ENV: "production",
          AUTH_GITHUB_ID: undefined,
          AUTH_GITHUB_SECRET: undefined,
        }),
      ),
    ).toThrow();
  });

  it("rejects a placeholder GitHub secret", () => {
    expect(() =>
      loadAuthEnvironment(
        baseEnv({ AUTH_GITHUB_SECRET: "INVALID_CHANGE_ME_GITHUB_SECRET_VALUE" }),
      ),
    ).toThrow();
  });

  it("rejects a half-configured provider", () => {
    expect(() =>
      loadAuthEnvironment(baseEnv({ AUTH_EMAIL_SERVER: undefined })),
    ).toThrow();
    expect(() =>
      loadAuthEnvironment(baseEnv({ AUTH_GITHUB_ID: undefined })),
    ).toThrow();
  });

  it("validates email server and from", () => {
    expect(() =>
      loadAuthEnvironment(baseEnv({ AUTH_EMAIL_SERVER: "https://mail.example.test" })),
    ).toThrow();
    expect(() =>
      loadAuthEnvironment(baseEnv({ AUTH_EMAIL_SERVER: "smtp://mail.example.test" })),
    ).toThrow(/AUTH_EMAIL_SERVER/);
    expect(() =>
      loadAuthEnvironment(baseEnv({ AUTH_EMAIL_FROM: "not-an-email" })),
    ).toThrow();
  });

  it("gates trustHost for production deployments", () => {
    expect(
      loadAuthEnvironment(baseEnv({ NODE_ENV: "production", AUTH_TRUST_HOST: "true" })).trustHost,
    ).toBe(true);
    expect(() =>
      loadAuthEnvironment(baseEnv({ NODE_ENV: "production", AUTH_TRUST_HOST: undefined })),
    ).toThrow(/AUTH_TRUST_HOST/);
    expect(() =>
      loadAuthEnvironment(baseEnv({ AUTH_TRUST_HOST: "maybe" })),
    ).toThrow(/AUTH_TRUST_HOST/);
  });

  it("rejects forbidden web secrets that must live on the facilitator", () => {
    expect(() =>
      loadAuthEnvironment(baseEnv({ FACILITATOR_PRIVATE_KEY: "0xdeadbeef" })),
    ).toThrow();
    expect(() =>
      loadAuthEnvironment(baseEnv({ AGENT_PRIVATE_KEY: "0xdeadbeef" })),
    ).toThrow();
  });

  it("requires a valid auth URL and rejects URLs with embedded credentials", () => {
    expect(() =>
      loadAuthEnvironment(baseEnv({ NEXT_PUBLIC_SITE_URL: "http://agentpay.test" })),
    ).toThrow();
    expect(() =>
      loadAuthEnvironment(baseEnv({ NEXT_PUBLIC_SITE_URL: "https://user:pass@agentpay.test" })),
    ).toThrow();
    expect(() =>
      loadAuthEnvironment(baseEnv({ NEXT_PUBLIC_SITE_URL: undefined })),
    ).toThrow(/AUTH_URL/);
  });
});