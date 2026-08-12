import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "vitest";

interface ComposeService {
  build?: { context?: string; dockerfile?: string; target?: string };
  depends_on?: Record<string, { condition?: string }>;
  image?: string;
  ports?: Array<{ host_ip?: string; published?: string; target?: number }>;
  networks?: Record<string, unknown>;
  environment?: Record<string, string>;
  healthcheck?: { test?: string[] };
  security_opt?: string[];
  cap_drop?: string[];
  read_only?: boolean;
  restart?: string;
  command?: string[];
  volumes?: Array<{ target?: string; type?: string }>;
}

interface ComposeModel {
  services: Record<string, ComposeService>;
  networks?: Record<string, { external?: boolean; internal?: boolean }>;
  volumes?: Record<string, unknown>;
}

const releaseSha = "0123456789abcdef0123456789abcdef01234567";
const fixtureDirectory = mkdtempSync(join(tmpdir(), "agentpay-compose-"));

function renderCompose(composePath: string, envPath: string): ComposeModel {
  const output = execFileSync("docker", [
    "compose",
    "--env-file", envPath,
    "-f", composePath,
    "config",
    "--format", "json",
  ], { cwd: process.cwd(), encoding: "utf8" });
  return JSON.parse(output) as ComposeModel;
}

afterAll(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

describe("local Compose", () => {
  let model: ComposeModel;

  beforeAll(() => {
    const localDirectory = join(fixtureDirectory, "local");
    mkdirSync(localDirectory);
    const composePath = join(localDirectory, "docker-compose.yml");
    const envPath = join(localDirectory, ".env.local");
    copyFileSync("docker-compose.yml", composePath);
    writeFileSync(envPath, [
      `AGENTPAY_IMAGE=tonkaxxx/agentpay:${releaseSha}`,
      "NEXT_PUBLIC_SITE_URL=http://localhost:3000",
      "AGENTPAY_PAY_TO=0x1111111111111111111111111111111111111111",
      "CDP_API_KEY_ID=organizations/test/apiKeys/test",
      "CDP_API_KEY_SECRET=fixture-secret",
      "REDIS_URL=redis://localhost:6379",
      "REDIS_PASSWORD=fixture-redis-password",
      "AGENTPAY_OFFLINE_QUOTE_ONLY=true",
      "AGENT_PRIVATE_KEY=fixture-key-that-must-not-survive",
      "BASE_MAINNET_RPC_URL=https://fixture.invalid",
      "ALLOW_MAINNET_PAYMENTS=true",
      "",
    ].join("\n"), { mode: 0o600 });
    model = renderCompose(composePath, envPath);
  });

  test("renders a source-built web service with safe seller credentials", () => {
    const web = model.services.web!;

    expect(web.build?.target).toBe("builder");
    expect(web.ports).toContainEqual(expect.objectContaining({
      host_ip: "127.0.0.1",
      published: "3000",
      target: 3000,
    }));
    expect(web.environment).toMatchObject({
      NODE_ENV: "development",
      REDIS_URL: "redis://redis:6379",
      AGENT_PRIVATE_KEY: "",
      BASE_MAINNET_RPC_URL: "",
      ALLOW_MAINNET_PAYMENTS: "false",
    });
    expect(web.depends_on?.redis?.condition).toBe("service_healthy");
    expect(model.networks ?? {}).not.toHaveProperty("web-net");
  });

  test("starts Next independently of an existing image working directory", () => {
    expect(model.services.web?.command).toEqual([
      "node",
      "/app/web/node_modules/next/dist/bin/next",
      "dev",
      "/app/web",
      "--hostname",
      "0.0.0.0",
      "--port",
      "3000",
    ]);
  });

  test("keeps Redis private, healthy, and persistent", () => {
    const redis = model.services.redis!;

    expect(redis.image).toBe("redis:7.4.7-alpine");
    expect(redis.ports).toBeUndefined();
    expect(redis.command?.join(" ")).toContain("appendonly yes");
    expect(redis.healthcheck?.test?.join(" ")).toContain("redis-cli ping");
    expect(redis.volumes).toContainEqual(expect.objectContaining({
      type: "volume",
      target: "/data",
    }));
    expect(model.volumes).toHaveProperty("redis-data");
  });
});

describe("production Compose", () => {
  let model: ComposeModel;

  beforeAll(() => {
    const envPath = join(fixtureDirectory, "production.env");
    writeFileSync(envPath, [
      `AGENTPAY_IMAGE=tonkaxxx/agentpay:${releaseSha}`,
      "NEXT_PUBLIC_SITE_URL=https://agentpay.thebestsites.ru/",
      "AGENTPAY_PAY_TO=0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB",
      "CDP_API_KEY_ID=organizations/test/apiKeys/test",
      "CDP_API_KEY_SECRET=fixture-secret",
      "REDIS_PASSWORD=fixture-redis-password",
      "",
    ].join("\n"), { mode: 0o600 });
    model = renderCompose("docker-compose.production.yml", envPath);
  });

  test("renders an immutable hardened web service without buyer credentials", () => {
    const web = model.services.web!;

    expect(web.image).toBe(`tonkaxxx/agentpay:${releaseSha}`);
    expect(web.ports).toBeUndefined();
    expect(web.networks).toMatchObject({ backend: {}, "web-net": {} });
    expect(web.healthcheck?.test?.join(" ")).toContain("/api/basic");
    expect(web.security_opt).toContain("no-new-privileges:true");
    expect(web.cap_drop).toContain("ALL");
    expect(web.read_only).toBe(true);
    expect(web.environment).toMatchObject({
      NODE_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "https://agentpay.thebestsites.ru/",
      AGENTPAY_PAY_TO: "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB",
      REDIS_URL: "redis://:fixture-redis-password@redis:6379",
    });
    expect(web.environment).not.toHaveProperty("AGENT_PRIVATE_KEY");
    expect(web.environment).not.toHaveProperty("BASE_MAINNET_RPC_URL");
    expect(web.environment).not.toHaveProperty("AGENTPAY_OFFLINE_QUOTE_ONLY");
  });

  test("keeps authenticated AOF Redis private and persistent", () => {
    const redis = model.services.redis!;
    const command = redis.command?.join(" ") ?? "";

    expect(redis.image).toMatch(/^redis:7\.\d+\.\d+-alpine$/);
    expect(redis.ports).toBeUndefined();
    expect(redis.networks).toMatchObject({ backend: {} });
    expect(redis.networks).not.toHaveProperty("web-net");
    expect(command).toContain("appendonly yes");
    expect(command).toContain("appendfsync everysec");
    expect(command).toContain("requirepass");
    expect(redis.healthcheck?.test?.join(" ")).toContain("REDISCLI_AUTH");
    expect(redis.volumes).toContainEqual(expect.objectContaining({
      type: "volume",
      target: "/data",
    }));
    expect(redis.security_opt).toContain("no-new-privileges:true");
    expect(redis.cap_drop).toContain("ALL");
    expect(redis.read_only).toBe(true);
    expect(model.networks?.backend?.internal).toBe(true);
    expect(model.networks?.["web-net"]?.external).toBe(true);
    expect(model.volumes).toHaveProperty("redis-data");
  });
});
