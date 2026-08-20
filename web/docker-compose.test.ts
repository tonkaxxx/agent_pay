import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

interface ComposeService {
  image?: string;
  container_name?: string;
  command?: string[];
  environment?: Record<string, string>;
  networks?: Record<string, unknown>;
  ports?: unknown[];
  cap_drop?: string[];
  security_opt?: string[];
  read_only?: boolean;
  restart?: string;
  healthcheck?: unknown;
  depends_on?: Record<string, { condition: string }>;
  labels?: Record<string, string>;
  volumes?: Array<{
    type: string;
    source: string;
    target: string;
    read_only?: boolean;
  }>;
}

interface ComposeConfig {
  services: {
    web: ComposeService;
    facilitator: ComposeService;
    redis: ComposeService;
    postgres: ComposeService;
    migrate: ComposeService;
  };
  networks: {
    backend: { external?: boolean; internal?: boolean };
    egress: { external?: boolean; internal?: boolean };
    "web-net": { external?: boolean; internal?: boolean };
  };
  volumes: Record<string, unknown>;
}

const composeFile = resolve(process.cwd(), "docker-compose.production.yml");
const immutableImage = `agentpay:${"a".repeat(40)}`;

function renderCompose(): ComposeConfig {
  return JSON.parse(execFileSync("docker", [
    "compose",
    "--file",
    composeFile,
    "config",
    "--format",
    "json",
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      AGENTPAY_IMAGE: immutableImage,
      NEXT_PUBLIC_SITE_URL: "https://agentpay.thebestsites.ru/",
      AGENTPAY_PAY_TO: "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB",
      BASE_MAINNET_RPC_URL: "https://base-rpc.invalid/",
      FACILITATOR_PRIVATE_KEY: `0x${"12".repeat(32)}`,
      REDIS_PASSWORD: "test-only-redis-password",
      POSTGRES_USER: "agentpay",
      POSTGRES_PASSWORD: "test-only-postgres-password",
      POSTGRES_DB: "agentpay",
      AUTH_SECRET: "test-only-auth-secret-with-at-least-32-characters",
      AUTH_GITHUB_ID: "test-only-oauth-client-id",
      AUTH_GITHUB_SECRET: "test-only-oauth-client-secret",
      AUTH_EMAIL_SERVER: "smtp://test-only@localhost:587",
      AUTH_EMAIL_FROM: "agentpay@example.invalid",
      AGENTPAY_MASTER_KEY: Buffer.from("a".repeat(32)).toString("base64"),
    },
  })) as ComposeConfig;
}

describe("production Compose policy", () => {
  test("contains exactly the web, facilitator, Redis, PostgreSQL, and migrate services", () => {
    const config = renderCompose();
    expect(Object.keys(config.services).sort()).toEqual([
      "facilitator",
      "migrate",
      "postgres",
      "redis",
      "web",
    ]);
    expect(config.services.web.image).toBe(immutableImage);
    expect(config.services.facilitator.image).toBe(immutableImage);
    expect(config.services.migrate.image).toBe(immutableImage);
    expect(config.services.redis.image).toBe(
      "redis:7.4.7-alpine@sha256:02f2cc4882f8bf87c79a220ac958f58c700bdec0dfb9b9ea61b62fb0e8f1bfcf",
    );
    expect(config.services.postgres.image).toBe(
      "postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685",
    );
  });

  test("keeps the internal services private behind an internal network", () => {
    const config = renderCompose();
    expect(config.networks.backend.internal).toBe(true);
    expect(config.networks["web-net"].external).toBe(true);
    expect(Object.keys(config.services.web.networks ?? {}).sort()).toEqual(["backend", "web-net"]);
    expect(Object.keys(config.services.facilitator.networks ?? {}).sort()).toEqual([
      "backend",
      "egress",
    ]);
    expect(Object.keys(config.services.redis.networks ?? {})).toEqual(["backend"]);
    expect(Object.keys(config.services.postgres.networks ?? {})).toEqual(["backend"]);
    expect(Object.keys(config.services.migrate.networks ?? {})).toEqual(["backend"]);
    expect(config.services.facilitator.ports).toBeUndefined();
    expect(config.services.redis.ports).toBeUndefined();
    expect(config.services.postgres.ports).toBeUndefined();
    expect(config.services.migrate.ports).toBeUndefined();
    expect(config.networks.egress.internal).not.toBe(true);
  });

  test("matches the production Traefik service name and certificate resolver", () => {
    const web = renderCompose().services.web;
    expect(web.container_name).toBe("agentpay-app");
    expect(web.labels).toMatchObject({
      "traefik.http.routers.agentpay.tls.certresolver": "myresolver",
    });
  });

  test("separates web, settlement, Redis, and PostgreSQL secrets", () => {
    const config = renderCompose();
    const web = config.services.web.environment ?? {};
    const facilitator = config.services.facilitator.environment ?? {};
    const postgres = config.services.postgres.environment ?? {};
    expect(web).toMatchObject({
      FACILITATOR_URL: "http://facilitator:4022",
      REDIS_URL: "redis://:test-only-redis-password@redis:6379/0",
      DATABASE_URL:
        "postgres://agentpay:test-only-postgres-password@postgres:5432/agentpay",
      AUTH_TRUST_HOST: "true",
    });
    expect(Object.keys(web)).not.toEqual(expect.arrayContaining([
      "AGENT_PRIVATE_KEY",
      "FACILITATOR_PRIVATE_KEY",
      "BASE_MAINNET_RPC_URL",
      "AGENTPAY_ALLOW_INSECURE_LOCAL_ORIGIN",
      "POSTGRES_PASSWORD",
      ["CDP", "API", "KEY", "ID"].join("_"),
      ["CDP", "API", "KEY", "SECRET"].join("_"),
    ]));
    expect(facilitator).toMatchObject({
      BASE_MAINNET_RPC_URL: "https://base-rpc.invalid/",
      FACILITATOR_PRIVATE_KEY: `0x${"12".repeat(32)}`,
    });
    expect(Object.keys(facilitator)).not.toContain("AGENT_PRIVATE_KEY");
    expect(postgres).toMatchObject({
      POSTGRES_USER: "agentpay",
      POSTGRES_PASSWORD: "test-only-postgres-password",
      POSTGRES_DB: "agentpay",
    });
    expect(Object.keys(postgres)).not.toEqual(expect.arrayContaining([
      "REDIS_PASSWORD",
      "FACILITATOR_PRIVATE_KEY",
    ]));
  });

  test("runs migrations once as a one-shot service after PostgreSQL is healthy", () => {
    const config = renderCompose();
    const migrate = config.services.migrate;
    expect(migrate.command).toEqual(["node", "/app/web/scripts/migrate.mjs"]);
    expect(migrate.restart).toBe("no");
    expect(migrate.depends_on).toMatchObject({
      postgres: { condition: "service_healthy" },
    });
  });

  test("hardens every service and persists authenticated Redis and PostgreSQL data", () => {
    const config = renderCompose();
    for (const service of Object.values(config.services)) {
      expect(service.cap_drop).toContain("ALL");
      expect(service.security_opt).toContain("no-new-privileges:true");
      expect(service.read_only).toBe(true);
    }
    const redis = config.services.redis;
    expect(redis.command?.join(" ")).toContain("--requirepass");
    expect(redis.command?.join(" ")).toContain("--appendonly yes");
    expect(redis.command?.join(" ")).toContain("--appendfsync everysec");
    expect(redis.volumes).toContainEqual(expect.objectContaining({
      type: "volume",
      source: "agentpay-redis-data",
      target: "/data",
    }));
    const postgres = config.services.postgres;
    expect(postgres.volumes).toContainEqual(expect.objectContaining({
      type: "volume",
      source: "agentpay-postgres-data",
      target: "/var/lib/postgresql/data",
    }));
    expect(config.volumes).toHaveProperty("agentpay-redis-data");
    expect(config.volumes).toHaveProperty("agentpay-postgres-data");
  });
});
