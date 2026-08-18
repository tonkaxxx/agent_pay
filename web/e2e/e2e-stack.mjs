import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { connect } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SERVER_ROOT = join(WEB_ROOT, "..", "packages", "server");
const CERTS_DIR = "/tmp/agentpay-e2e-certs";
const NETWORK = "agentpay-e2e-upstream-net";
const UPSTREAM_IP = "1.1.1.7";
const CONTAINERS = ["agentpay-e2e-upstream", "agentpay-e2e-postgres", "agentpay-e2e-redis"];

const POSTGRES_IMAGE = "postgres:16-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685";
const REDIS_IMAGE = "redis:7.4.7-alpine@sha256:02f2cc4882f8bf87c79a220ac958f58c700bdec0dfb9b9ea61b62fb0e8f1bfcf";

const databaseUrl = "postgres://agentpay:local-agentpay-only@127.0.0.1:5432/agentpay";

const children = [];
const PID_FILE = join(WEB_ROOT, "e2e", ".tmp", "stack-pids.json");

function docker(args, options = {}) {
  return spawnSync("docker", args, { stdio: "inherit", ...options });
}

function dockerQuiet(args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

function log(prefix, message) {
  console.log(`[e2e-stack] ${prefix}: ${message}`);
}

function fail(message, error) {
  console.error(`[e2e-stack] FAILED at ${message}`);
  if (error !== undefined) {
    console.error(error);
  }
  cleanup();
  process.exit(1);
}

function waitForTcp(port, host = "127.0.0.1", attempts = 60, delayMs = 500) {
  return new Promise((resolve, reject) => {
    let remaining = attempts;
    const tryConnect = () => {
      const socket = connect({ host, port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        remaining -= 1;
        if (remaining <= 0) {
          reject(new Error(`Timed out waiting for TCP ${host}:${port}`));
          return;
        }
        setTimeout(tryConnect, delayMs);
      });
    };
    tryConnect();
  });
}

async function retry(command, description, attempts = 60, delayMs = 500) {
  for (let remaining = attempts; remaining > 0; remaining -= 1) {
    if (await command()) return;
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function requestHttpsWithCa(caPem, path) {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        host: UPSTREAM_IP,
        port: 443,
        servername: UPSTREAM_IP,
        path,
        method: "GET",
        ca: caPem,
        rejectUnauthorized: true,
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve(response.statusCode));
      },
    );
    request.once("error", reject);
    request.end();
  });
}

function pullImages() {
  for (const image of [POSTGRES_IMAGE, REDIS_IMAGE, "alpine:3.23", "node:22-alpine"]) {
    log("docker", `pulling ${image}`);
    const result = spawnSync("docker", ["pull", image], { stdio: "inherit" });
    if (result.status !== 0) {
      throw new Error(`Failed to pull ${image}`);
    }
  }
}

function cleanupStaleState() {
  try {
    const stale = JSON.parse(readFileSync(PID_FILE, "utf8"));
    if (Array.isArray(stale)) {
      for (const value of stale) {
        if (!Number.isSafeInteger(value) || value <= 1) continue;
        try {
          const command = readFileSync(`/proc/${value}/cmdline`, "utf8");
          if (command.includes(WEB_ROOT) && (command.includes("fake-") || command.includes("next"))) {
            process.kill(value, "SIGTERM");
          }
        } catch {
          // Process already exited or no longer belongs to this test stack.
        }
      }
    }
  } catch {
    // No previous stack metadata.
  }
  rmSync(PID_FILE, { force: true });
  for (const name of ["agentpay-upstream-probe", ...CONTAINERS]) {
    dockerQuiet(["rm", "-f", name]);
  }
  for (const network of [NETWORK, "agentpay-ssrf-test2"]) {
    dockerQuiet(["network", "rm", network]);
  }
}

function startPostgres() {
  log("docker", "starting postgres");
  const result = docker([
    "run",
    "-d",
    "--rm",
    "--name",
    "agentpay-e2e-postgres",
    "-p",
    "5432:5432",
    "-e",
    "POSTGRES_USER=agentpay",
    "-e",
    "POSTGRES_PASSWORD=local-agentpay-only",
    "-e",
    "POSTGRES_DB=agentpay",
    POSTGRES_IMAGE,
  ]);
  if (result.status !== 0) {
    throw new Error("Failed to start postgres (is port 5432 free?)");
  }
}

function startRedis() {
  log("docker", "starting redis");
  const result = docker([
    "run",
    "-d",
    "--rm",
    "--name",
    "agentpay-e2e-redis",
    "-p",
    "6379:6379",
    REDIS_IMAGE,
  ]);
  if (result.status !== 0) {
    throw new Error("Failed to start redis (is port 6379 free?)");
  }
}

function waitForPostgres() {
  return retry(
    () => dockerQuiet(["exec", "agentpay-e2e-postgres", "pg_isready", "-U", "agentpay", "-d", "agentpay"]) !== null,
    "postgres readiness",
  );
}

function waitForRedis() {
  return retry(
    () => dockerQuiet(["exec", "agentpay-e2e-redis", "redis-cli", "ping"]) === "PONG",
    "redis readiness",
  );
}

function runMigrations() {
  log("migrations", "applying schema to postgres");
  const result = spawnSync("node", [join(WEB_ROOT, "scripts", "migrate.mjs")], {
    cwd: WEB_ROOT,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Migrations failed");
  }
}

function seedOAuthIdentity() {
  log("migrations", "seeding deterministic GitHub oauth identity");
  const sql = `
INSERT INTO "user" (name, email) VALUES ('Test Seller', 'seller@agentpay.test')
  ON CONFLICT (email) DO NOTHING;
INSERT INTO account ("userId", type, provider, "providerAccountId", access_token, token_type, scope)
SELECT id, 'oauth', 'github', '1', 'test-e2e-access-token', 'bearer', 'read:user user:email'
  FROM "user" WHERE email = 'seller@agentpay.test'
  ON CONFLICT (provider, "providerAccountId") DO NOTHING;
`;
  const result = spawnSync(
    "docker",
    ["exec", "-i", "agentpay-e2e-postgres", "psql", "-U", "agentpay", "-d", "agentpay"],
    { input: sql, stdio: ["pipe", "inherit", "inherit"] },
  );
  if (result.status !== 0) {
    throw new Error("Failed to seed OAuth identity");
  }
}

function generateUpstreamCertificates() {
  log("certs", `generating test CA and upstream certificate in ${CERTS_DIR}`);
  rmSync(CERTS_DIR, { recursive: true, force: true });
  mkdirSync(CERTS_DIR, { recursive: true });
  const script = [
    "apk add --no-cache openssl >/dev/null 2>&1",
    "openssl genrsa -out /certs/ca.key 2048 >/dev/null 2>&1",
    "openssl req -x509 -new -nodes -key /certs/ca.key -sha256 -days 2 -out /certs/ca.pem -subj '/CN=AgentPay E2E Test CA' >/dev/null 2>&1",
    `openssl genrsa -out /certs/server.key 2048 >/dev/null 2>&1`,
    `openssl req -new -key /certs/server.key -out /certs/server.csr -subj '/CN=${UPSTREAM_IP}' >/dev/null 2>&1`,
    `printf 'subjectAltName=IP:${UPSTREAM_IP}\\nextendedKeyUsage=serverAuth\\n' > /certs/server.ext`,
    `openssl x509 -req -in /certs/server.csr -CA /certs/ca.pem -CAkey /certs/ca.key -CAcreateserial -out /certs/server.pem -days 2 -sha256 -extfile /certs/server.ext >/dev/null 2>&1`,
    "ls /certs",
  ].join(" && ");
  const result = spawnSync(
    "docker",
    ["run", "--rm", "-v", `${CERTS_DIR}:/certs`, "alpine:3.23", "sh", "-c", script],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error("Failed to generate upstream certificates");
  }
}

function startUpstream() {
  log("docker", "starting fake upstream on 1.1.1.7:443");
  const result = docker([
    "run",
    "-d",
    "--rm",
    "--name",
    "agentpay-e2e-upstream",
    "--network",
    NETWORK,
    "--ip",
    UPSTREAM_IP,
    "-v",
    `${CERTS_DIR}:/certs:ro`,
    "-v",
    `${join(WEB_ROOT, "e2e")}:/e2e:ro`,
    "node:22-alpine",
    "node",
    "/e2e/fake-upstream.mjs",
  ]);
  if (result.status !== 0) {
    throw new Error("Failed to start fake upstream");
  }
}

function waitForUpstream() {
  const caPem = readFileSync(join(CERTS_DIR, "ca.pem"), "utf8");
  return retry(
    async () => {
      try {
        const status = await requestHttpsWithCa(caPem, "/healthz");
        return status === 200;
      } catch {
        return false;
      }
    },
    "fake upstream readiness",
    60,
    500,
  );
}

function createNetwork() {
  log("docker", `creating bridge network ${NETWORK}`);
  const result = docker(["network", "create", NETWORK, "--subnet", "1.1.1.0/24", "--gateway", "1.1.1.254"]);
  if (result.status !== 0) throw new Error("Failed to create the E2E upstream network");
}

function saveChildPids() {
  mkdirSync(join(WEB_ROOT, "e2e", ".tmp"), { recursive: true });
  writeFileSync(PID_FILE, JSON.stringify(children.map(child => child.pid).filter(Boolean)), "utf8");
}

function run(nodeScript) {
  log("service", `starting ${nodeScript}`);
  const child = spawn("node", [join(WEB_ROOT, "e2e", nodeScript)], {
    cwd: WEB_ROOT,
    stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(child);
  saveChildPids();
}

function startWeb() {
  log("web", "building @agentpay/server SDK");
  const build = spawnSync("corepack", ["pnpm", "build"], {
    cwd: SERVER_ROOT,
    stdio: "inherit",
  });
  if (build.status !== 0) {
    throw new Error("Failed to build @agentpay/server SDK");
  }
  log("web", "starting `next dev` on http://localhost:3100");
  const child = spawn("node", ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3100"], {
    cwd: WEB_ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      NEXT_PUBLIC_SITE_URL: "http://localhost:3100",
      AGENTPAY_ALLOW_INSECURE_LOCAL_ORIGIN: "true",
      AGENTPAY_PAY_TO: "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB",
      FACILITATOR_URL: "http://127.0.0.1:4022",
      REDIS_URL: "redis://127.0.0.1:6379",
      DATABASE_URL: databaseUrl,
      AUTH_URL: "http://localhost:3100",
      AUTH_SECRET: "test-e2e-auth-secret-with-at-least-32-characters",
      AUTH_TRUST_HOST: "true",
      AUTH_GITHUB_ID: "test-e2e-github-client",
      AUTH_GITHUB_SECRET: "test-e2e-github-client-secret",
      AUTH_GITHUB_ENTERPRISE_URL: "http://127.0.0.1:4200",
      AUTH_EMAIL_SERVER: "smtp://127.0.0.1:2525",
      AUTH_EMAIL_FROM: "AgentPay <agentpay@agentpay.test>",
      AGENTPAY_MASTER_KEY: Buffer.from("a".repeat(32)).toString("base64"),
      NODE_EXTRA_CA_CERTS: join(CERTS_DIR, "ca.pem"),
    },
  });
  children.push(child);
  saveChildPids();
}

async function main() {
  try {
    pullImages();
    cleanupStaleState();
    createNetwork();
    startPostgres();
    await waitForPostgres();
    startRedis();
    await waitForRedis();
    runMigrations();
    seedOAuthIdentity();
    generateUpstreamCertificates();
    startUpstream();
    await waitForUpstream();
    run("fake-facilitator.mjs");
    await waitForTcp(4022);
    run("fake-github.mjs");
    await waitForTcp(4200);
    run("fake-smtp.mjs");
    await waitForTcp(2525);
    startWeb();
    log("ready", "stack is up; Playwright will poll the web server");
  } catch (error) {
    fail("e2e stack startup", error);
  }
}

function cleanup() {
  for (const child of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
  for (const name of CONTAINERS) {
    dockerQuiet(["rm", "-f", name]);
  }
  dockerQuiet(["network", "rm", NETWORK]);
  rmSync(PID_FILE, { force: true });
}

function shutdown() {
  cleanup();
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.once("uncaughtException", (error) => fail("uncaught exception", error));

main();
