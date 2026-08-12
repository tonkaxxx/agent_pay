import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, expect, test } from "vitest";

interface ComposeService {
  image?: string;
  ports?: unknown;
  networks?: Record<string, unknown>;
  environment?: Record<string, string>;
  healthcheck?: { test?: string[] };
  security_opt?: string[];
  cap_drop?: string[];
  read_only?: boolean;
  command?: string[];
  volumes?: Array<{ target?: string; type?: string }>;
}

interface ComposeModel {
  services: Record<string, ComposeService>;
  networks?: Record<string, { external?: boolean; internal?: boolean }>;
  volumes?: Record<string, unknown>;
}

const releaseSha = "0123456789abcdef0123456789abcdef01234567";
let fixtureDirectory: string;
let model: ComposeModel;

beforeAll(() => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), "agentpay-compose-"));
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

  const output = execFileSync("docker", [
    "compose",
    "--env-file", envPath,
    "-f", "docker-compose.yml",
    "config",
    "--format", "json",
  ], { cwd: process.cwd(), encoding: "utf8" });
  model = JSON.parse(output) as ComposeModel;
});

afterAll(() => rmSync(fixtureDirectory, { recursive: true, force: true }));

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
