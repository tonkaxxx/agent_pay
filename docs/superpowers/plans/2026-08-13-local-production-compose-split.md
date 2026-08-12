# Local and Production Compose Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a one-command local Docker Compose workflow, preserve the hardened one-server production stack in an explicit Compose file, and deploy a newly verified immutable AgentPay image.

**Architecture:** `web/docker-compose.yml` becomes a source-built local development stack with private Redis, while the current hardened definition moves to `web/docker-compose.production.yml`. Tests render both Compose models independently, documentation names the correct entry point for each environment, and the verified production file is deployed to the existing server with backup, health, public x402 v2, and rollback checks.

**Tech Stack:** Docker Compose v2, Docker BuildKit, Node.js 22, pnpm 11, Next.js 16, Vitest 4, Redis 7.4, x402 v2, CDP facilitator, SSH, Traefik.

## Global Constraints

- `docker compose down && docker compose up -d` must work from `web/` with `web/.env.local`.
- Local web binds only `127.0.0.1:3000`; Redis publishes no host port.
- Local seller runtime blanks `AGENT_PRIVATE_KEY` and `BASE_MAINNET_RPC_URL` after loading `.env.local`.
- Production remains one Compose project at `worker@192.168.88.44:/home/worker/repos/vibe/agentpay`.
- Production uses a full 40-character Git SHA image, authenticated AOF Redis, internal `backend`, and external `web-net`.
- Production web never receives buyer key/RPC, quote-only, or mainnet execution variables.
- Unpaid public JSON remains concise while `PAYMENT-REQUIRED` remains x402 v2 and exposes no Bazaar premium example.
- No local or production env file, private key, CDP secret, or Redis password is committed or printed.
- Rollout preserves the previous Compose/env/image and never deletes the Redis volume.

---

### Task 1: Split and test the Compose models

**Files:**
- Create: `web/docker-compose.production.yml`
- Modify: `web/docker-compose.yml`
- Modify: `web/docker-compose.test.ts`

**Interfaces:**
- Consumes: `web/Dockerfile` stage `builder`, local `.env.local`, and `.env.production.example` names.
- Produces: default local services `web` and `redis`, plus an explicit hardened production model.

- [ ] **Step 1: Write failing tests for both models**

Extend `ComposeService` with the exact model fields needed by local assertions:

```ts
build?: { context?: string; dockerfile?: string; target?: string };
depends_on?: Record<string, { condition?: string }>;
ports?: Array<{ host_ip?: string; published?: string; target?: number }>;
restart?: string;
```

Render production from `docker-compose.production.yml`. For local rendering,
copy `docker-compose.yml` to a temporary directory, write a mode-`0600`
`.env.local` beside it containing safe fixture values, and render the copy.
Add assertions that local web uses `build.target === "builder"`, publishes
`127.0.0.1:3000`, waits for healthy Redis, sets `NODE_ENV=development` and
`REDIS_URL=redis://redis:6379`, blanks buyer key/RPC, forces
`ALLOW_MAINNET_PAYMENTS=false`, and has no `web-net`. Assert local Redis is
`redis:7.4.7-alpine`, has AOF enabled, a ping healthcheck, no ports, and a named
volume. Keep every existing production hardening assertion.

Use this fixture content and assertion shape (the production tests continue to
use their existing fixture values):

```ts
writeFileSync(join(localDirectory, ".env.local"), [
  "NEXT_PUBLIC_SITE_URL=http://localhost:3000",
  "AGENTPAY_PAY_TO=0x1111111111111111111111111111111111111111",
  "CDP_API_KEY_ID=organizations/test/apiKeys/test",
  "CDP_API_KEY_SECRET=fixture-secret",
  "REDIS_URL=redis://localhost:6379",
  "AGENTPAY_OFFLINE_QUOTE_ONLY=true",
  "AGENT_PRIVATE_KEY=fixture-key-that-must-not-survive",
  "BASE_MAINNET_RPC_URL=https://fixture.invalid",
  "ALLOW_MAINNET_PAYMENTS=true",
  "",
].join("\n"), { mode: 0o600 });

test("renders a source-built local web service with safe seller credentials", () => {
  const web = localModel.services.web!;
  expect(web.build?.target).toBe("builder");
  expect(web.ports).toContainEqual(expect.objectContaining({
    host_ip: "127.0.0.1", published: "3000", target: 3000,
  }));
  expect(web.environment).toMatchObject({
    NODE_ENV: "development",
    REDIS_URL: "redis://redis:6379",
    AGENT_PRIVATE_KEY: "",
    BASE_MAINNET_RPC_URL: "",
    ALLOW_MAINNET_PAYMENTS: "false",
  });
  expect(web.depends_on?.redis?.condition).toBe("service_healthy");
  expect(localModel.networks).not.toHaveProperty("web-net");
});

test("keeps local Redis private, healthy, and persistent", () => {
  const redis = localModel.services.redis!;
  expect(redis.image).toBe("redis:7.4.7-alpine");
  expect(redis.ports).toBeUndefined();
  expect(redis.command?.join(" ")).toContain("appendonly yes");
  expect(redis.healthcheck?.test?.join(" ")).toContain("redis-cli ping");
  expect(redis.volumes).toContainEqual(expect.objectContaining({
    type: "volume", target: "/data",
  }));
  expect(localModel.volumes).toHaveProperty("redis-data");
});
```

- [ ] **Step 2: Confirm the tests fail for the intended reason**

Run:

```sh
corepack pnpm --dir web exec vitest run docker-compose.test.ts
```

Expected: FAIL because the explicit production file is absent and the default
file is still the production-only model.

- [ ] **Step 3: Preserve the current production model**

Create `web/docker-compose.production.yml` with the exact current production
contents. Preserve immutable image interpolation, production variable checks,
read-only filesystems, healthchecks, authenticated AOF Redis, internal backend,
external `web-net`, capability restrictions, and the persistent volume.

- [ ] **Step 4: Implement the local default model**

Replace `web/docker-compose.yml` with:

```yaml
services:
  web:
    build:
      context: ..
      dockerfile: web/Dockerfile
      target: builder
    command: [node, web/node_modules/next/dist/bin/next, dev, web, --hostname, 0.0.0.0, --port, "3000"]
    env_file: [.env.local]
    environment:
      NODE_ENV: development
      NEXT_TELEMETRY_DISABLED: "1"
      REDIS_URL: redis://redis:6379
      AGENT_PRIVATE_KEY: ""
      BASE_MAINNET_RPC_URL: ""
      ALLOW_MAINNET_PAYMENTS: "false"
    ports: ["127.0.0.1:3000:3000"]
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped

  redis:
    image: redis:7.4.7-alpine
    command: [redis-server, --appendonly, "yes", --appendfsync, everysec]
    healthcheck:
      test: [CMD, redis-cli, ping]
      interval: 5s
      timeout: 3s
      retries: 10
    restart: unless-stopped
    volumes: [redis-data:/data]

volumes:
  redis-data:
```

- [ ] **Step 5: Verify green tests and valid rendering**

Run:

```sh
corepack pnpm --dir web exec vitest run docker-compose.test.ts
docker compose -f web/docker-compose.yml config --quiet
docker compose --env-file web/.env.production.example -f web/docker-compose.production.yml config --quiet
```

Expected: all commands exit `0` without printing rendered secrets.

- [ ] **Step 6: Commit the split**

```sh
git add web/docker-compose.yml web/docker-compose.production.yml web/docker-compose.test.ts
git commit -m "fix: separate local and production compose stacks"
```

---

### Task 2: Document local and production entry points

**Files:**
- Modify: `web/README.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: both Compose files from Task 1.
- Produces: copy-pasteable commands that unambiguously select local or production operation.

- [ ] **Step 1: Add local Docker usage**

Document `cd web`, `docker compose up -d --build`, `docker compose ps`, local
curl, and the exact unchanged restart command `docker compose down && docker
compose up -d`. Explain that `--build` is needed after source/dependency changes,
the default reads `.env.local`, binds only loopback, persists Redis, and blanks
buyer signing/RPC values inside the seller container.

- [ ] **Step 2: Point production commands at the explicit file**

Change production examples to `-f web/docker-compose.production.yml`. In the
root README, identify `web/docker-compose.yml` as local and link
`web/docker-compose.production.yml` as the hardened deployment model.

- [ ] **Step 3: Verify docs and commit**

```sh
grep -n "docker-compose.production.yml" README.md web/README.md
grep -n "docker compose down && docker compose up -d" web/README.md
git diff --check
git add README.md web/README.md
git commit -m "docs: distinguish local and production compose usage"
```

Expected: both references and the literal local command are present; the diff
check and commit succeed.

---

### Task 3: Verify the literal local workflow and security boundary

**Files:**
- No repository changes expected.

**Interfaces:**
- Consumes: the local model and existing ignored `web/.env.local`.
- Produces: runtime evidence for local startup, Redis health, secret isolation, concise JSON, and x402 v2 headers.

- [ ] **Step 1: Start with the exact reported command**

From `web/`, run:

```sh
docker compose down && docker compose up -d
```

Expected: no `AGENTPAY_IMAGE` interpolation error; local web and Redis are
created or recreated without deleting the named volume.

- [ ] **Step 2: Verify readiness**

Use `docker compose ps`, then poll `curl --fail --silent
http://localhost:3000/api/basic` in short intervals for no more than 60 seconds.
Expected: Redis is healthy and the basic endpoint returns `200`.

- [ ] **Step 3: Verify secret and port isolation**

Run a boolean-only Node assertion inside web proving that `AGENT_PRIVATE_KEY`
and `BASE_MAINNET_RPC_URL` are empty, `ALLOW_MAINNET_PAYMENTS` is `false`, and
`REDIS_URL` is `redis://redis:6379`. Inspect published ports and prove Redis has
none. Print only a success boolean, never environment values.

- [ ] **Step 4: Verify local response body and protocol header separately**

Create a temporary directory with `mktemp -d`, store curl headers/body there,
and assert status `402`. The body must contain exactly `error`, `priceUsdc`,
`payTo`, `network`, and `chainId`; neither body nor decoded header may contain
`premiumData` or Bazaar. Decode `PAYMENT-REQUIRED` with
`decodePaymentRequiredHeader` and assert x402 version `2`, scheme `exact`,
network `eip155:8453`, amount `10000`, and required Payment Identifier. Delete
only the validated temporary directory.

---

### Task 4: Verify the release and publish an immutable image

**Files:**
- No changes expected; if verification finds a defect, first add a failing regression test, then the smallest fix, and commit it separately.

**Interfaces:**
- Consumes: committed Compose/docs changes and the complete AgentPay test suite.
- Produces: `AGENTPAY_RELEASE_SHA` and pushed image `tonkaxxx/agentpay:$AGENTPAY_RELEASE_SHA` with a matching revision label.

- [ ] **Step 1: Establish the release identity**

Require empty output from `git status --short`. Set task-specific variable
`AGENTPAY_RELEASE_SHA` from `git rev-parse HEAD` and assert it matches exactly 40
lowercase hexadecimal characters.

- [ ] **Step 2: Run the complete release gate**

Run separately:

```sh
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm build
corepack pnpm test:e2e
```

Expected: every command exits `0`.

- [ ] **Step 3: Build and push the immutable runner image**

```sh
docker build --target runner \
  --label "org.opencontainers.image.revision=$AGENTPAY_RELEASE_SHA" \
  -t "tonkaxxx/agentpay:$AGENTPAY_RELEASE_SHA" .
docker push "tonkaxxx/agentpay:$AGENTPAY_RELEASE_SHA"
docker image inspect "tonkaxxx/agentpay:$AGENTPAY_RELEASE_SHA" \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}} {{index .RepoDigests 0}}'
```

Expected: build/push succeed; label equals the SHA; digest begins
`tonkaxxx/agentpay@sha256:`. Stop before deployment on any mismatch.

---

### Task 5: Back up and deploy production on the server

**Files:**
- Deploy: `web/docker-compose.production.yml` to remote `/home/worker/repos/vibe/agentpay/docker-compose.yml`
- Preserve: remote `/home/worker/repos/vibe/agentpay/.env.production`
- Create: one timestamped remote rollback directory under `backups/`

**Interfaces:**
- Consumes: pushed immutable image, existing protected env, `web-net`, and recipient `0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB`.
- Produces: healthy new web and Redis services in one production Compose project.

- [ ] **Step 1: Run read-only remote preflight**

Over SSH, prove the project, Compose file, and env file exist; the env file is
not group/world readable; `web-net` exists; current containers are inspectable;
and disk space is sufficient. Print only modes, container names/statuses, free
space, network existence, and current image reference.

- [ ] **Step 2: Create a recoverable backup**

Generate a remote UTC timestamp using `date -u +%Y%m%dT%H%M%SZ`, validate it
against `^[0-9]{8}T[0-9]{6}Z$`, create exactly the corresponding project
`backups/<timestamp>` directory with mode `0700`, copy Compose and env into it,
set the env copy to `0600`, and store only the current immutable image reference
in `previous-image.txt`.

- [ ] **Step 3: Install and validate production configuration**

Upload the explicit production file to a temporary file inside the project,
compare local and remote SHA-256, then atomically rename it to
`docker-compose.yml`. Change only the `AGENTPAY_IMAGE` value in the remote
mode-`0600` env to `tonkaxxx/agentpay:$AGENTPAY_RELEASE_SHA`. Run:

```sh
docker compose --env-file .env.production -f docker-compose.yml config --quiet
```

Expected: exit `0` with no secret-bearing rendered model.

- [ ] **Step 4: Pull and start the new stack**

```sh
docker compose --env-file .env.production -f docker-compose.yml pull
docker compose --env-file .env.production -f docker-compose.yml up -d --remove-orphans --wait
```

Expected: Redis and `agentpay-app` are healthy, the web image contains the exact
release SHA, Redis publishes no ports, only web joins `web-net`, and both
services belong to the same project.

- [ ] **Step 5: Apply rollback on any failed health gate**

Restore Compose and env from the validated backup, restore env mode `0600`,
validate, pull the recorded prior image, and run `up -d --remove-orphans
--wait`. Do not remove the Redis volume or backup. Report both failed release
and restored image identities without secrets.

---

### Task 6: Verify the public production contract and durability

**Files:**
- No repository changes expected.

**Interfaces:**
- Consumes: the deployed release and `web/scripts/verify-production.mjs`.
- Produces: final evidence for release identity, public legacy JSON, x402 v2, seller secret isolation, and Redis restart durability.

- [ ] **Step 1: Run the production verifier**

```sh
corepack pnpm --dir web verify:production -- \
  https://agentpay.thebestsites.ru \
  0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB
```

Expected: homepage `200`, premium `402`, legacy body true, x402 version `2`,
scheme `exact`, network `eip155:8453`, amount `10000`, Payment Identifier
required, and Bazaar absent.

- [ ] **Step 2: Assert no paid output is public**

Require the unpaid body to equal:

```json
{"error":"Payment Required","priceUsdc":"0.01","payTo":"0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB","network":"base","chainId":8453}
```

Assert `premiumData`, `extensions`, `accepts`, and `resource` are absent from the
body, while `PAYMENT-REQUIRED` is present as a response header.

- [ ] **Step 3: Assert seller credential isolation**

Inside `agentpay-app`, run boolean-only assertions that buyer key/RPC,
quote-only, and mainnet execution variables are absent while required seller
configuration exists. Print only `seller_environment_safe=true`.

- [ ] **Step 4: Verify Redis restart durability**

Confirm AOF is enabled, restart only Redis through Compose, wait for both
healthchecks, and re-run the production verifier. Do not flush Redis or recreate
the volume.

- [ ] **Step 5: Record final release evidence**

Require the local Git SHA, pushed revision label, remote Compose image, and
running image label to match. Require empty `git status --short`. Report the
release SHA, image digest, backup path, service health, and verifier summary
without secrets.
