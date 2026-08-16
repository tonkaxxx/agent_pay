import { beforeAll, describe, expect, it } from "vitest";

const AUTH_SECRET = "route-test-secret-0123456789abcdef0123456789abcdef";

beforeAll(() => {
  process.env.AUTH_SECRET = AUTH_SECRET;
  process.env.NEXT_PUBLIC_SITE_URL = "https://agentpay.test";
  process.env.AUTH_TRUST_HOST = "true";
  process.env.AUTH_GITHUB_ID = "route-test-client-id";
  process.env.AUTH_GITHUB_SECRET = "route-test-client-secret";
  process.env.DATABASE_URL = "postgres://route-test:route-test@db.example.test:5432/agentpay";
});

describe("Auth.js route handler", () => {
  it(
    "exposes GET and POST handlers wired to Auth.js",
    async () => {
      const { GET, POST } = await import("./route");
      expect(typeof GET).toBe("function");
      expect(typeof POST).toBe("function");
    },
    30000,
  );

  it(
    "signs a visible session cookie through the same handler set",
    async () => {
      const { authHandlers } = await import("@/auth");
      const { GET, POST } = await import("./route");
      expect(GET).toBe(authHandlers.GET);
      expect(POST).toBe(authHandlers.POST);
    },
    30000,
  );
});