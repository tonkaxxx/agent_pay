import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

interface ComposeService {
  image?: string;
  command?: string[];
  environment?: Record<string, string>;
  networks?: Record<string, unknown>;
  ports?: unknown[];
  cap_drop?: string[];
  security_opt?: string[];
  read_only?: boolean;
  restart?: string;
  healthcheck?: unknown;
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
    },
  })) as ComposeConfig;
}

describe("production Compose policy", () => {
  test("contains exactly the web, facilitator, and Redis services", () => {
    const config = renderCompose();
    expect(Object.keys(config.services).sort()).toEqual(["facilitator", "redis", "web"]);
    expect(config.services.web.image).toBe(immutableImage);
    expect(config.services.facilitator.image).toBe(immutableImage);
    expect(config.services.redis.image).toBe(
      "redis:7.4.7-alpine@sha256:02f2cc4882f8bf87c79a220ac958f58c700bdec0dfb9b9ea61b62fb0e8f1bfcf",
    );
  });

  test("keeps the facilitator and Redis private behind an internal network", () => {
    const config = renderCompose();
    expect(config.networks.backend.internal).toBe(true);
    expect(config.networks["web-net"].external).toBe(true);
    expect(Object.keys(config.services.web.networks ?? {}).sort()).toEqual(["backend", "web-net"]);
    expect(Object.keys(config.services.facilitator.networks ?? {}).sort()).toEqual([
      "backend",
      "egress",
    ]);
    expect(Object.keys(config.services.redis.networks ?? {})).toEqual(["backend"]);
    expect(config.services.facilitator.ports).toBeUndefined();
    expect(config.services.redis.ports).toBeUndefined();
    expect(config.networks.egress.internal).not.toBe(true);
  });

  test("separates web, settlement, and Redis secrets", () => {
    const config = renderCompose();
    const web = config.services.web.environment ?? {};
    const facilitator = config.services.facilitator.environment ?? {};
    expect(web).toMatchObject({
      FACILITATOR_URL: "http://facilitator:4022",
      REDIS_URL: "redis://:test-only-redis-password@redis:6379/0",
    });
    expect(Object.keys(web)).not.toEqual(expect.arrayContaining([
      "AGENT_PRIVATE_KEY",
      "FACILITATOR_PRIVATE_KEY",
      "BASE_MAINNET_RPC_URL",
      "AGENTPAY_ALLOW_INSECURE_LOCAL_ORIGIN",
      ["CDP", "API", "KEY", "ID"].join("_"),
      ["CDP", "API", "KEY", "SECRET"].join("_"),
    ]));
    expect(facilitator).toMatchObject({
      BASE_MAINNET_RPC_URL: "https://base-rpc.invalid/",
      FACILITATOR_PRIVATE_KEY: `0x${"12".repeat(32)}`,
    });
    expect(Object.keys(facilitator)).not.toContain("AGENT_PRIVATE_KEY");
  });

  test("hardens every service and persists authenticated Redis AOF", () => {
    const config = renderCompose();
    for (const service of Object.values(config.services)) {
      expect(service.cap_drop).toContain("ALL");
      expect(service.security_opt).toContain("no-new-privileges:true");
      expect(service.read_only).toBe(true);
      expect(service.restart).toBe("unless-stopped");
      expect(service.healthcheck).toBeTruthy();
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
    expect(config.volumes).toHaveProperty("agentpay-redis-data");
  });
});
