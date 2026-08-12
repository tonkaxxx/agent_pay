# AgentPay Production Mainnet Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy AgentPay as a hardened single-server Docker Compose stack that accepts real `$0.01` Base Mainnet USDC payments through CDP, persists idempotency in Redis, and returns a readable JSON x402 v2 challenge.

**Architecture:** Keep the official x402 v2 Next adapter as the protocol authority and add narrow AgentPay wrappers for body mirroring and stable failure semantics. Run the immutable web release and an authenticated AOF Redis on private Compose networking, while the existing Traefik instance reaches only the web service through `web-net`.

**Tech Stack:** TypeScript 7, Next.js 16, official `@x402/*` v2 SDKs, Coinbase CDP facilitator, Redis 7, Docker Compose, Traefik 3, Vitest, Playwright, pnpm.

## Global Constraints

- Production origin is exactly `https://agentpay.thebestsites.ru/`.
- Production recipient is exactly `0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB`.
- Payment is native Base USDC, network `eip155:8453`, scheme `exact`, amount `10000` (`$0.01`).
- Preserve `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE` as the only protocol headers.
- Payment Identifier is required in production and Redis failures fail closed before verification or settlement.
- Never log or persist raw `PAYMENT-SIGNATURE`, CDP secrets, Redis credentials, or private keys.
- The web container must not receive `AGENT_PRIVATE_KEY`, RPC URLs, or mainnet client execution gates.
- Redis has no published port, uses authentication, AOF `appendfsync everysec`, a persistent named volume, and a healthcheck.
- The web release uses an immutable full-Git-SHA image tag; `latest` is not used by production Compose.
- Existing external Docker network `web-net` and Traefik route remain the public ingress.
- Production changes must have a recorded prior image digest and file backup before container replacement.
- Do not run a real payment without a separate funded payer wallet and both existing mainnet safety gates.

---

## File Map

- `web/src/features/premium-api/payment-required-response.ts`: mirror the official decoded `PAYMENT-REQUIRED` header into a JSON body without reconstructing payment terms.
- `web/src/features/premium-api/payment-required-response.test.ts`: prove header/body identity and fail-safe behavior.
- `web/src/features/premium-api/runtime.ts`: require Payment Identifier and compose response/error adapters around the official Next handler.
- `web/src/features/premium-api/runtime.test.ts`: prove required identifier and wrapper order.
- `packages/server/src/idempotency.ts`: expose a stable unavailable error and fail closed when Redis atomic operations fail.
- `packages/server/test/idempotency.test.ts`: prove unavailable Redis cannot invoke verification or settlement.
- `web/src/features/premium-api/route-handler.ts`: map typed configuration/idempotency/facilitator failures to non-secret reason codes and structured safe logs.
- `web/src/features/premium-api/route-handler.test.ts`: prove stable status/reason mappings and secret redaction.
- `web/src/features/premium-api/config.ts`: distinguish local quote-only configuration from strict production configuration.
- `web/src/features/premium-api/config.test.ts`: reject production localhost, placeholder recipient, quote-only, and accidental private-key injection.
- `web/docker-compose.yml`: production single-server stack with immutable image variable, authenticated persistent Redis, private network, healthchecks, and hardening.
- `web/docker-compose.test.ts`: inspect the rendered Compose model and assert production invariants.
- `web/.env.production.example`: document non-secret production variables without usable credentials.
- `web/Dockerfile`: provide a lightweight container healthcheck target and preserve the production runner.
- `web/e2e/agentpay.spec.ts`: assert readable 402 JSON equals the decoded header and Payment Identifier is required.
- `web/README.md` and `README.md`: document production deployment, curl behavior, rollback, and real-payment boundary.

### Task 1: Mirror the Official 402 Challenge into JSON

**Files:**
- Create: `web/src/features/premium-api/payment-required-response.ts`
- Create: `web/src/features/premium-api/payment-required-response.test.ts`
- Modify: `web/src/features/premium-api/runtime.ts`
- Modify: `web/src/features/premium-api/runtime.test.ts`

**Interfaces:**
- Consumes: a `PaymentRequestHandler` whose unpaid response is produced by official `withX402`.
- Produces: `withReadablePaymentRequired(handler: PaymentRequestHandler): PaymentRequestHandler`.
- Produces: premium route configuration with `paymentIdentifier: "required"`.

- [ ] **Step 1: Write failing readable-response tests**

Create tests that encode a `PaymentRequired` with `encodePaymentRequiredHeader`, return it from a fake official handler with status `402`, and assert:

```ts
const response = await withReadablePaymentRequired(handler)(request);
expect(response.status).toBe(402);
expect(response.headers.get("payment-required")).toBe(encoded);
await expect(response.json()).resolves.toEqual(decodePaymentRequiredHeader(encoded));
```

Add cases proving non-402 responses are returned by identity and a malformed or absent `PAYMENT-REQUIRED` header remains an unchanged safe official response.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
corepack pnpm --dir web exec vitest run \
  src/features/premium-api/payment-required-response.test.ts \
  src/features/premium-api/runtime.test.ts
```

Expected: FAIL because `withReadablePaymentRequired` does not exist and runtime still declares Payment Identifier optional.

- [ ] **Step 3: Implement the minimal response adapter**

Implement:

```ts
export function withReadablePaymentRequired(
  handler: PaymentRequestHandler,
): PaymentRequestHandler {
  return async request => {
    const response = await handler(request);
    if (response.status !== 402) return response;
    const encoded = response.headers.get("PAYMENT-REQUIRED");
    if (!encoded) return response;
    try {
      const body = decodePaymentRequiredHeader(encoded);
      const headers = new Headers(response.headers);
      headers.set("content-type", "application/json; charset=utf-8");
      headers.set("cache-control", "private, no-store");
      return new Response(JSON.stringify(body), { status: 402, headers });
    } catch {
      return response;
    }
  };
}
```

In `buildPremiumHandler`, set `paymentIdentifier: "required"`, wrap the official protected handler with idempotency first, then place the readable-response wrapper outermost so it can transform only the final unpaid response.

- [ ] **Step 4: Run focused and web tests and verify GREEN**

Run:

```bash
corepack pnpm --dir web exec vitest run \
  src/features/premium-api/payment-required-response.test.ts \
  src/features/premium-api/runtime.test.ts
corepack pnpm --dir web test
```

Expected: all selected tests and the complete web unit suite pass.

- [ ] **Step 5: Commit the readable 402 behavior**

```bash
git add web/src/features/premium-api/payment-required-response.ts \
  web/src/features/premium-api/payment-required-response.test.ts \
  web/src/features/premium-api/runtime.ts \
  web/src/features/premium-api/runtime.test.ts
git commit -m "feat: expose readable x402 payment challenges"
```

### Task 2: Fail Closed with Stable Production Error Semantics

**Files:**
- Modify: `packages/server/src/idempotency.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/test/idempotency.test.ts`
- Modify: `web/src/features/premium-api/route-handler.ts`
- Modify: `web/src/features/premium-api/route-handler.test.ts`
- Modify: `web/src/app/api/premium/route.ts`
- Modify: `web/src/app/api/premium/route.test.ts`

**Interfaces:**
- Produces: `PaymentIdempotencyUnavailableError extends Error` with stable `code = "idempotency_unavailable"`.
- Produces: `PremiumRouteError` union mapping configuration, idempotency, and facilitator infrastructure failures to safe HTTP responses.
- Consumes: official `getFacilitatorResponseError(error)` from `@x402/core/http`.

- [ ] **Step 1: Write failing fail-closed and error-mapping tests**

Add an idempotency test where `store.begin` rejects with `new Error("redis://:secret@redis")`; assert the wrapped handler is never called and the rejection is a `PaymentIdempotencyUnavailableError` whose message and serialization do not contain `secret`.

Add route tests for:

```ts
expect(await errorBody(new PaymentIdempotencyUnavailableError())).toEqual({
  status: 503,
  reason: "idempotency_unavailable",
});
expect(await errorBody(new PremiumConfigurationError())).toEqual({
  status: 503,
  reason: "configuration_unavailable",
});
```

Construct a `FacilitatorResponseError` using the official exported class signature discovered from installed types and assert it maps to `502 facilitator_unavailable`. Assert unknown failures map to `500 internal_error`. Spy on `console.error` and prove logged JSON contains only request ID, route, stage, status, and safe reason—not the original secret-bearing error message.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
corepack pnpm exec vitest run packages/server/test/idempotency.test.ts
corepack pnpm --dir web exec vitest run \
  src/features/premium-api/route-handler.test.ts \
  src/app/api/premium/route.test.ts
```

Expected: FAIL because typed errors and stable mappings do not exist.

- [ ] **Step 3: Implement typed errors and safe route handling**

Wrap `store.begin`, `store.complete`, and required Redis release failures at their operation boundary:

```ts
export class PaymentIdempotencyUnavailableError extends Error {
  readonly code = "idempotency_unavailable";
  constructor(options?: ErrorOptions) {
    super("Payment idempotency is unavailable.", options);
    this.name = "PaymentIdempotencyUnavailableError";
  }
}
```

Do not include the caught error message in the public error. Preserve it only as `cause`, which the route logger must not serialize.

Add a `PremiumConfigurationError` emitted only while constructing the lazy handler. Update `createPremiumRoute` to accept the request, assign `crypto.randomUUID()`, classify typed errors and `getFacilitatorResponseError`, emit one safe structured error record, and return:

```json
{"error":"Service Unavailable","reason":"idempotency_unavailable","requestId":"..."}
```

Use the matching status from the spec and `Cache-Control: no-store`.

- [ ] **Step 4: Run focused and complete root/web tests**

Run:

```bash
corepack pnpm exec vitest run packages/server/test/idempotency.test.ts
corepack pnpm --dir web exec vitest run \
  src/features/premium-api/route-handler.test.ts \
  src/app/api/premium/route.test.ts
corepack pnpm test
```

Expected: all tests pass and no secret-bearing fixture appears in captured logs or response bodies.

- [ ] **Step 5: Commit fail-closed semantics**

```bash
git add packages/server/src/idempotency.ts packages/server/src/index.ts \
  packages/server/test/idempotency.test.ts \
  web/src/features/premium-api/route-handler.ts \
  web/src/features/premium-api/route-handler.test.ts \
  web/src/app/api/premium/route.ts \
  web/src/app/api/premium/route.test.ts
git commit -m "feat: fail closed on payment infrastructure errors"
```

### Task 3: Enforce Strict Production Configuration

**Files:**
- Modify: `web/src/features/premium-api/config.ts`
- Modify: `web/src/features/premium-api/config.test.ts`
- Modify: `web/src/app/api/premium/route.ts`
- Modify: `web/playwright.config.ts`
- Create: `web/.env.production.example`
- Modify: `web/.env.example`

**Interfaces:**
- Produces: `loadPremiumConfig(environment, { production?: boolean }): PremiumConfig`.
- Produces: production-only checks based on `NODE_ENV === "production"` at the route boundary.
- Keeps: quote-only mode available only for explicit local/E2E use.

- [ ] **Step 1: Write failing production-validation tests**

For `{ production: true }`, assert rejection of:

```ts
NEXT_PUBLIC_SITE_URL: "http://localhost:3000"
AGENTPAY_PAY_TO: "0x1111111111111111111111111111111111111111"
AGENTPAY_OFFLINE_QUOTE_ONLY: "true"
AGENT_PRIVATE_KEY: `0x${"11".repeat(32)}`
```

Also assert production accepts the exact public URL and recipient in Global Constraints, CDP values, and an authenticated internal Redis URL. Preserve existing local quote-only success tests.

- [ ] **Step 2: Run config tests and verify RED**

Run:

```bash
corepack pnpm --dir web exec vitest run src/features/premium-api/config.test.ts
```

Expected: FAIL because the loader has no production policy.

- [ ] **Step 3: Implement strict production validation**

Add a second argument:

```ts
export function loadPremiumConfig(
  environment: PremiumEnvironment,
  options: { readonly production?: boolean } = {},
): PremiumConfig
```

When `production` is true, require HTTPS, forbid loopback hosts, reject the known placeholder recipient, reject quote-only, and reject any present `AGENT_PRIVATE_KEY`. Do not hardcode a single CDP key shape beyond non-empty because official identifiers can evolve.

Call with `{ production: process.env.NODE_ENV === "production" }` from the API route. Keep Playwright explicitly quote-only in development mode.

Create `web/.env.production.example` with only non-secret placeholders and no agent key:

```dotenv
NEXT_PUBLIC_SITE_URL=https://agentpay.thebestsites.ru/
AGENTPAY_PAY_TO=0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB
REDIS_URL=redis://:replace-with-generated-password@redis:6379
CDP_API_KEY_ID=organizations/replace-me/apiKeys/replace-me
CDP_API_KEY_SECRET=replace-me
```

- [ ] **Step 4: Run config, route, E2E unit, and type tests**

Run:

```bash
corepack pnpm --dir web exec vitest run \
  src/features/premium-api/config.test.ts \
  src/app/api/premium/route.test.ts
corepack pnpm typecheck
```

Expected: all tests pass.

- [ ] **Step 5: Commit production configuration policy**

```bash
git add web/src/features/premium-api/config.ts \
  web/src/features/premium-api/config.test.ts \
  web/src/app/api/premium/route.ts \
  web/playwright.config.ts web/.env.example web/.env.production.example
git commit -m "feat: enforce production payment configuration"
```

### Task 4: Harden the Single-Server Docker Compose Stack

**Files:**
- Modify: `web/docker-compose.yml`
- Modify: `web/Dockerfile`
- Create: `web/docker-compose.test.ts`
- Modify: `web/vitest.config.ts`
- Modify: `web/package.json`

**Interfaces:**
- Consumes: `AGENTPAY_IMAGE`, `REDIS_PASSWORD`, CDP credentials, origin, and recipient from the ignored production env file.
- Produces: services `web` and `redis`, private network `backend`, external network `web-net`, and volume `redis-data`.

- [ ] **Step 1: Write a failing Compose invariant test**

Run `docker compose --env-file` against a temporary non-secret env fixture and parse `docker compose config --format json`. Assert:

```ts
expect(web.image).toBe("tonkaxxx/agentpay:0123456789abcdef...");
expect(web.ports).toBeUndefined();
expect(web.networks).toMatchObject({ backend: {}, "web-net": {} });
expect(web.healthcheck).toBeDefined();
expect(web.security_opt).toContain("no-new-privileges:true");
expect(redis.ports).toBeUndefined();
expect(redis.command.join(" ")).toContain("appendonly yes");
expect(redis.command.join(" ")).toContain("appendfsync everysec");
expect(redis.volumes).toContainEqual(expect.objectContaining({ target: "/data" }));
expect(redis.healthcheck.test.join(" ")).toContain("REDISCLI_AUTH");
```

Also assert the web environment contains no `AGENT_PRIVATE_KEY`, `BASE_MAINNET_RPC_URL`, or `AGENTPAY_OFFLINE_QUOTE_ONLY`.

- [ ] **Step 2: Run the Compose test and verify RED**

Run:

```bash
corepack pnpm --dir web exec vitest run docker-compose.test.ts
```

Expected: FAIL because current Compose builds locally, publishes port 3000, and has no persistent authenticated Redis.

- [ ] **Step 3: Implement the hardened Compose model**

Use explicit variable interpolation:

```yaml
services:
  web:
    image: ${AGENTPAY_IMAGE:?set immutable AgentPay image}
    container_name: agentpay-app
    environment:
      NODE_ENV: production
      NEXT_PUBLIC_SITE_URL: ${NEXT_PUBLIC_SITE_URL:?set public URL}
      AGENTPAY_PAY_TO: ${AGENTPAY_PAY_TO:?set recipient}
      CDP_API_KEY_ID: ${CDP_API_KEY_ID:?set CDP API key ID}
      CDP_API_KEY_SECRET: ${CDP_API_KEY_SECRET:?set CDP API key secret}
      REDIS_URL: redis://:${REDIS_PASSWORD:?set Redis password}@redis:6379
```

Add Redis `--requirepass`, AOF options, `${REDIS_PASSWORD}` only as its environment, a healthcheck using `REDISCLI_AUTH`, `redis-data:/data`, a private internal backend network, and `web-net` only on web. Use `depends_on: condition: service_healthy`. Add container hardening that remains compatible with Next and Redis.

Pin Redis to an explicit patch tag available from the registry, not `redis:7-alpine`.

- [ ] **Step 4: Verify the rendered Compose model and container build**

Run:

```bash
corepack pnpm --dir web exec vitest run docker-compose.test.ts
docker build -f web/Dockerfile -t agentpay:production-test .
docker image inspect agentpay:production-test --format '{{.Id}}'
```

Expected: Compose invariant test passes and the image builds successfully.

- [ ] **Step 5: Commit Compose hardening**

```bash
git add web/docker-compose.yml web/Dockerfile \
  web/docker-compose.test.ts web/vitest.config.ts web/package.json
git commit -m "feat: harden single-server production stack"
```

### Task 5: Update E2E Coverage and Operations Documentation

**Files:**
- Modify: `web/e2e/agentpay.spec.ts`
- Modify: `web/README.md`
- Modify: `README.md`
- Create: `web/scripts/verify-production.mjs`
- Modify: `web/package.json`

**Interfaces:**
- Produces: `pnpm --dir web verify:production -- <origin> <recipient>` read-only smoke command.
- Consumes: public HTTPS endpoint only; never requires CDP or Redis secrets.

- [ ] **Step 1: Write failing E2E and smoke assertions**

Update the API E2E to assert:

```ts
const body = await response.json();
expect(body).toEqual(decodePaymentRequiredHeader(encoded!));
expect(body.extensions["payment-identifier"].info.required).toBe(true);
```

Create a smoke script that exits nonzero unless homepage is `200`, premium is `402`, `PAYMENT-REQUIRED` decodes, body equals the decoded challenge, and requirement fields match the provided origin and recipient plus the fixed global network/scheme/amount/asset.

- [ ] **Step 2: Run E2E HTTP test and smoke script against current local stack to verify RED**

Run:

```bash
corepack pnpm --dir web exec playwright test e2e/agentpay.spec.ts \
  --grep "actual API route"
node web/scripts/verify-production.mjs \
  http://localhost:3000 \
  0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB
```

Expected: FAIL because the current body is `{}`, identifier is optional, and local recipient is a placeholder.

- [ ] **Step 3: Implement the read-only production verifier and docs**

The script must print only safe fields:

```json
{"homepage":200,"premium":402,"x402Version":2,"scheme":"exact","network":"eip155:8453","amount":"10000","paymentIdentifierRequired":true}
```

Document:

- why ordinary curl now sees JSON and protocol clients still use the header;
- required production env variables;
- single-host durability and host-loss limitation;
- immutable release tag and rollback commands;
- that the seller container never receives a payer private key;
- that a separate guarded funded client is required for an actual settlement test.

- [ ] **Step 4: Run unit, type, lint, build, and browser E2E gates**

Run:

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm lint
env -u HTTP_PROXY -u HTTPS_PROXY corepack pnpm build
corepack pnpm test:e2e
```

Expected: all tests pass; lint has no errors; build completes; all Playwright desktop/mobile scenarios pass.

- [ ] **Step 5: Commit verification tooling and docs**

```bash
git add web/e2e/agentpay.spec.ts web/scripts/verify-production.mjs \
  web/package.json web/README.md README.md
git commit -m "docs: add production payment operations guide"
```

### Task 6: Build, Publish, Deploy, and Verify the Immutable Release

**Files:**
- Modify remotely: `/home/worker/repos/vibe/agentpay/docker-compose.yml`
- Modify remotely: `/home/worker/repos/vibe/agentpay/.env.production`
- Preserve remotely: timestamped backups under `/home/worker/repos/vibe/agentpay/backups/<timestamp>/`

**Interfaces:**
- Consumes: verified Git commit, Docker Hub auth already configured locally, verified CDP credentials already present on the remote host, external `web-net`, and Traefik route.
- Produces: running `agentpay-app` and authenticated persistent Redis on the production server.

- [ ] **Step 1: Run a clean release gate and create the immutable tag**

Run all Task 5 verification commands on a clean Git tree. Then:

```bash
release_sha=$(git rev-parse HEAD)
docker build -f web/Dockerfile -t "tonkaxxx/agentpay:${release_sha}" .
docker push "tonkaxxx/agentpay:${release_sha}"
docker inspect "tonkaxxx/agentpay:${release_sha}" --format '{{index .RepoDigests 0}}'
```

Expected: push succeeds and prints an immutable repository digest.

- [ ] **Step 2: Capture remote rollback state before mutation**

Over SSH, compute a timestamp, create a mode-`0700` backup directory, and copy the existing Compose/env files into it. Record:

```bash
docker inspect agentpay-app --format '{{.Config.Image}} {{.Image}}'
docker inspect agentpay-redis-1 --format '{{.Image}}'
docker volume ls --filter label=com.docker.compose.project=agentpay
```

Do not print the env contents. Abort if backup file modes cannot be set to `0600`.

- [ ] **Step 3: Generate Redis credentials and write production files safely**

Generate the password on the remote host:

```bash
umask 077
redis_password=$(openssl rand -hex 32)
```

Preserve the already verified CDP ID/secret by reading them from the existing ignored env file without echoing them. Write `.env.production` through a mode-`0600` temporary file containing:

```dotenv
AGENTPAY_IMAGE=tonkaxxx/agentpay:<full-release-sha>
NEXT_PUBLIC_SITE_URL=https://agentpay.thebestsites.ru/
AGENTPAY_PAY_TO=0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB
CDP_API_KEY_ID=<preserved-value>
CDP_API_KEY_SECRET=<preserved-value>
REDIS_PASSWORD=<generated-value>
```

Upload the reviewed production Compose file to a temporary path, validate it with:

```bash
docker compose --env-file .env.production -f docker-compose.yml config --quiet
```

and atomically rename both temporary files into place. Confirm only their names, modes, and ownership—not contents.

- [ ] **Step 4: Pull and start the production stack**

Run:

```bash
docker compose --env-file .env.production pull
docker compose --env-file .env.production up -d --remove-orphans
docker compose --env-file .env.production ps
```

Wait until Redis and web are healthy. Confirm Redis has no published host ports, web is attached to `web-net` and backend, and the running web image equals the intended SHA tag/digest.

- [ ] **Step 5: Run remote and external production smoke checks**

From the local machine:

```bash
corepack pnpm --dir web verify:production -- \
  https://agentpay.thebestsites.ru \
  0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB
```

On the server, verify CDP `getSupported()` with credentials injected into a one-off web command but never printed. Assert Base Mainnet x402 v2 exact support.

Expected public result: homepage `200`, premium `402`, body/header equality, Base Mainnet exact `10000`, production recipient, Payment Identifier required.

- [ ] **Step 6: Prove Redis authentication and persistence**

Inside the Redis container, use `REDISCLI_AUTH` to set a namespaced deployment probe key, force `WAITAOF`, restart only Redis, wait for health, and assert the probe value survives. Delete the probe afterward. From the host and an unrelated container/network, confirm Redis port 6379 is not published.

- [ ] **Step 7: Roll back automatically on any failed remote gate**

If Steps 4–6 fail:

1. restore the backed-up Compose and env files;
2. restore the prior image reference;
3. run the prior Compose project;
4. verify the homepage and previous premium behavior;
5. leave the new Redis volume intact for diagnosis;
6. report the exact failed gate without exposing secrets.

Do not continue to a real payment test after rollback.

- [ ] **Step 8: Report deployment status and settlement-test boundary**

Report the release SHA/digest, healthy services, safe smoke fields, Redis persistence result, and backup directory. State explicitly that the production seller is live but not end-to-end settlement-tested unless a separate funded payer wallet was used with both mainnet safety gates. Do not include CDP credentials, Redis password, or payment signatures.
