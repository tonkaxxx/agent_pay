# AgentPay Hosted GET Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn one existing HTTPS GET API into a paid Base USDC x402 v2 endpoint through a hosted AgentPay gateway, with a passwordless seller dashboard (GitHub OAuth or email magic link), encrypted upstream credentials, an SSRF-safe upstream transport, durable PostgreSQL control-plane records, and a 5% recorded commission per successful settlement.

**Architecture:** The public Next.js app routes `GET /g/<public-id>` through the existing official x402 v2 Next resource-server flow, reusing the same `x402ResourceServer`, internal facilitator client, and atomic Redis authorization store already generalized from the premium demo. The paid handler runs exactly one bounded SSRF-safe upstream GET (pinned DNS, no redirects, 30 s timeout, 5 MiB limit) before settlement; settlement runs only when the upstream handler returns a status `< 400` (official `withX402` behavior). A PostgreSQL service stores Auth.js sessions, `merchant_endpoints`, `payment_events`, and `audit_events`. Upstream secrets are AES-256-GCM encrypted with a versioned application master key.

**Tech Stack:** Node.js 22, TypeScript 6/7, Next.js 16.3, Auth.js `next-auth@5.0.0-beta.32`, `@auth/drizzle-adapter@1.11.3`, Drizzle ORM `0.45.2`, PostgreSQL 16 + `pg` (in-process `@electric-sql/pglite@0.5.5` for tests), `@x402/core@2.22.0`, `@x402/evm@2.22.0`, `@x402/next@2.22.0`, viem 2.55, Redis 7.4, Vitest, Playwright, Docker Compose, Traefik.

## Global Constraints

- All implementation lives on branch `feat/hosted-get-gateway` created from current clean `main`. Work is never committed to `main` or `dev`, and nothing is pushed, merged, or deployed without explicit user direction.
- `GET /api/basic` stays free. `GET /api/premium` stays exactly `0.01` official Base USDC with its compact unpaid body, x402 v2 headers, Redis locking, consumed-replay behavior, and fail-closed behavior intact.
- The only payment asset/network is official Base USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` on `eip155:8453`; the scheme is x402 v2 `exact`. A transaction hash never grants access.
- The gateway reuses the official `withX402`/`x402ResourceServer` and one internal facilitator client. No second payment protocol, no manual settle path, no transaction-hash bypass.
- Seller-controlled upstream URLs are hostile. The gateway transport: canonical `https:` only, rejects credentials/fragments/malformed ports/non-canonical serialization, rejects localhost/docker-service names and forbidden IPv4/IPv6 ranges (loopback, private, link-local incl. cloud metadata, CGNAT, docs, benchmark, multicast, reserved, unspecified), disables redirects, pins the outbound connection to revalidated public DNS addresses, and never reuses an address across its TTL without revalidation.
- No request body, response body, query value, payment signature, upstream credential, private key, RPC URL, Redis URL, or database credential is stored, logged, echoed, or sent to client-side components. Gateway errors only expose stable codes plus `X-Request-ID`.
- Upstream requests execute at most once per authorization, including under concurrency (Redis atomic lock held across the upstream call; TTL 360 s pending, 86 400 s consumed). A failed upstream never settles. Payment is never withheld after a confirmed successful settlement: event persistence is best-effort and a reconciliation tool restores missing events.
- Price is a USDC decimal string `0.000001..1000`, exactly representable at 6 decimals, stored as an integer atomic-unit string. Payout address is checksummed, non-placeholder. Endpoint activation requires upstream authentication (Bearer or X-API-Key); no-auth mode exists only for drafts. Draft/paused/unknown public IDs are publicly indistinguishable (`404 endpoint_not_found`).
- Automated tests and dev commands never broadcast Base Mainnet transactions and never spend funds. Real settlement stays behind `smoke:mainnet --execute` + `ALLOW_MAINNET_PAYMENTS=true` and is not run here.
- Production variables for PostgreSQL, Auth.js (`AUTH_SECRET`), GitHub OAuth, the email transport (SMTP URL + from address), and the encryption master key are external secrets with placeholder rejection. Migrations run as an explicit one-shot deployment step. PostgreSQL publishes no host port and is a pinned image with a persistent volume.
- No `AGENT_PRIVATE_KEY` ever appears on the server. `FACILITATOR_PRIVATE_KEY` and `BASE_MAINNET_RPC_URL` remain facilitator-only and are rejected in the web environment.
- No `.env`/`*.env.*` (except committed examples) is committed. No OAuth secrets, SMTP credentials, database passwords, or encryption keys are committed.

---

## File Map (target layout)

- `docs/superpowers/plans/2026-08-16-hosted-get-gateway.md` — this plan.
- `packages/server/src/payment-policy.ts` — add validated immutable `PaymentPolicy` value + builder; keep `PREMIUM_PAYMENT_POLICY` fixture.
- `packages/server/src/authorization.ts` — derive `AuthorizationPolicy` from a `PaymentPolicy` once.
- `packages/server/src/resource-server.ts` — add `createResourceRoute(policy)`; keep `createPremiumRoute` as a compat wrapper.
- `packages/server/src/index.ts` — export the new value/route builders and types.
- `web/src/db/schema.ts` — Drizzle schema: Auth.js tables + `merchant_endpoints` + `payment_events` + `audit_events`.
- `web/src/db/client.ts` — `pg` pool + Drizzle instance factory.
- `web/src/db/migrate.ts` — explicit one-shot migration runner.
- `web/src/db/test-db.ts` — shared `pglite` helper for database tests.
- `web/drizzle.config.ts` — Drizzle Kit configuration + generated `web/src/db/migrations/*`.
- `web/src/auth/env.ts` — Auth.js/DB/secret environment parsing with production gating.
- `web/src/auth.ts` — NextAuth config (GitHub + Nodemailer email, Drizzle adapter).
- `web/src/app/api/auth/[...nextauth]/route.ts` — Auth.js route handlers.
- `web/src/app/login/page.tsx` + `web/src/components/login-form.tsx` — passwordless sign-in.
- `web/src/lib/dal.ts` — session verification + user scoping (Server Components/actions).
- `web/src/features/gateway/secrets.ts` — AES-256-GCM encrypt/decrypt with key version.
- `web/src/features/gateway/endpoint.ts` — price/payTo/mode/URL validation and immutable endpoint value.
- `web/src/features/gateway/repository.ts` — typed Drizzle queries, transactions, owner isolation, status transitions, audit-event write.
- `web/src/features/gateway/actions.ts` — dashboard server actions.
- `web/src/features/gateway/policy.ts` — build `PaymentPolicy` + `RouteConfig` from a validated endpoint record.
- `web/src/features/gateway/url.ts` — public-id generation (>=128-bit random base64url), canonical gateway resource URL.
- `web/src/features/gateway/upstream/url-policy.ts` — canonical `https:` URL structural policy.
- `web/src/features/gateway/upstream/ip.ts` — IPv4/IPv6 forbidden-range classifier (pure functions).
- `web/src/features/gateway/upstream/resolve.ts` — resolve all A/AAAA immediately before connect; reject if any forbidden; return pinned set.
- `web/src/features/gateway/upstream/transport.ts` — pinned Undici dispatcher fetch; manual redirects; 30 s timeout; 5 MiB limit; header allowlist; credential injection; typed result.
- `web/src/features/gateway/upstream/connectivity.ts` — non-paying connectivity test sharing the transport.
- `web/src/features/gateway/gateway-handler.ts` — paid handler calling upstream and mapping results to the public model.
- `web/src/features/gateway/gateway-route.ts` — per-request `RouteConfig` + `withX402` + guard composition and stable error mapping.
- `web/src/features/shared/payment-infrastructure.ts` — lazy shared facilitator/x402ResourceServer/Redis store singleton.
- `web/src/features/gateway/events.ts` — best-effort settlement event + 5% commission + aggregate metrics queries.
- `web/src/app/g/[publicId]/route.ts` — public gateway route handler.
- `web/src/app/dashboard/...` — dashboard pages/components (list, create, details+metrics, edit, credential).
- `web/scripts/reconcile-payment.mjs` — idempotent operator reconciliation of missing `payment_events`.
- `web/docker-compose.yml`, `web/docker-compose.production.yml` — add `postgres` and a one-shot `migrate` entry.
- `web/docker-compose.test.ts` — extend policy assertions (4 services, postgres internal, no public ports, secret scoping, image immutability).
- `web/scripts/verify-production.mjs` — extend production verifier (postgres health, 4 services, public contract unchanged).
- `web/.env.example`, `web/.env.production.example` — add placeholders only.
- `docs/operations/hosted-get-gateway-runbook.md` — new operational runbook.
- `README.md`, `web/README.md`, landing/docs components — update public docs and seller CTA.

---

### Task 1: Database and Migration Foundation

**Files:**
- Modify: `web/package.json` (add `drizzle-orm`, `pg`, `drizzle-kit`, `pglite`)
- Create: `web/drizzle.config.ts`
- Create: `web/src/db/schema.ts`
- Create: `web/src/db/client.ts`
- Create: `web/src/db/migrate.ts`
- Create: `web/src/db/migrations/*` (drizzle-kit generated)
- Create: `web/src/db/test-db.ts`
- Create: `web/src/db/schema.test.ts`, `web/src/db/client.test.ts`, `web/src/db/migrate.test.ts`

**Interfaces:**
- Produces: `merchantEndpoints`, `paymentEvents`, `auditEvents`, and Auth.js-compatible `users/accounts/sessions/verificationTokens` tables.
- Produces: `merchantEndpointStatus = "draft" | "active" | "paused"` and auth mode `"none" | "bearer" | "x-api-key"` as checked columns.
- Produces: `createDbClient(databaseUrl: string): { pool, db }`.
- Produces: `runMigrations(databaseUrl: string): Promise<void>` (used by the one-shot deploy step, never at web replica startup).
- Invariant: atomic amounts and public IDs are `text`; safe partial unique indexes on `payment_events.fingerprint` and `payment_events.txHash`.

- [ ] **Step 1: Add database dependencies**
  Add to `web/package.json`: `drizzle-orm@0.45.2`, `pg@8.23.0`; dev: `drizzle-kit@0.31.10`, `@types/pg`, `@electric-sql/pglite@0.5.5`. `corepack pnpm install` to update the lockfile.

- [ ] **Step 2: Write the failing schema and migration tests**
  `schema.test.ts` (pglite): migrate an empty database; assert all 7 tables exist; insert a draft endpoint; enforce unique public-id; enforce partial unique fingerprint/tx-hash; enforce Auth.js account/session uniqueness. `client.test.ts`: pool connect against pglite via `postgresql://` over a `pg-mem`-style shim OR skip (pool requires real server; instead test only migration + schema on pglite). `migrate.test.ts`: `runMigrations` on pglite applies all migrations exactly once (idempotent).

- [ ] **Step 3: Implement schema, client, migrate**
  Use `pgTable` with `uuid` PK `default gen_random_uuid()`, `timestamptz`, `text` atomic amounts, checks, `uniqueIndex`. `client.ts` uses `drizzle-orm/node-postgres` `PgPool`. `migrate.ts` uses `drizzle-orm/node-postgres/migrator`.

- [ ] **Step 4: Generate migrations and make tests green**
  `corepack pnpm --dir web exec drizzle-kit generate --config web/drizzle.config.ts`. Verify `pglite` accepts the emitted DDL. Run `corepack pnpm --dir web test`.

- [ ] **Step 5: Commit**
  `git add -A && git commit -m "feat: add PostgreSQL gateway database foundation"`

---

### Task 2: Auth.js Seller Authentication

**Files:**
- Modify: `web/package.json` (add `next-auth@5.0.0-beta.32`, `@auth/drizzle-adapter@1.11.3`, `nodemailer@8`)
- Create: `web/src/auth/env.ts`
- Create: `web/src/auth.ts`
- Create: `web/src/app/api/auth/[...nextauth]/route.ts`
- Create: `web/src/lib/dal.ts`
- Create: `web/src/app/login/page.tsx`, `web/src/components/login-form.tsx`
- Create: `web/src/auth/env.test.ts`, `web/src/lib/dal.test.ts`, `web/src/app/api/auth/[...nextauth]/route.test.ts`

**Interfaces:**
- Produces: `authConfig(env)` with GitHub + Nodemailer email providers over the Drizzle adapter; local allows one provider, production requires both with a real `AUTH_SECRET`.
- Produces: `/api/auth/[...nextauth]` `GET`/`POST` handlers.
- Produces: `verifySession()` DAL returning the current seller or null; `requireSeller()` redirect for server components/actions.
- Invariant: no passwords; sessions live in PostgreSQL.

- [ ] **Step 1: Failing env/DAL tests**
  Env: missing `AUTH_SECRET` fails in production; placeholder `INVALID_CHANGE_ME_...` secrets rejected; both providers required in production, one tolerated locally; `AUTH_EMAIL_FROM`/`AUTH_EMAIL_SERVER` validity; `AUTH_TRUST_HOST` gating. DAL: returns seller for a valid session on pglite, null otherwise.

- [ ] **Step 2: Implement env parsing, auth config, route, DAL**
  Follow the local Next.js 16 docs (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`) and Auth.js v5 App Router pattern. Strict provider derivation from validated env.

- [ ] **Step 3: Wire a sign-in page and landing CTA**
  `/login` page and a seller CTA on the landing page.

- [ ] **Step 4: GREEN + commit**
  `corepack pnpm --dir web test` and lint pass, then `git add -A && git commit -m "feat: add Auth.js passwordless seller authentication"`

---

### Task 3: Encrypted Upstream Credentials

**Files:**
- Create: `web/src/features/gateway/secrets.ts`
- Create: `web/src/features/gateway/env.ts` (parses `AGENTPAY_MASTER_KEY`, `AGENTPAY_MASTER_KEY_VERSION`)
- Create: `web/src/features/gateway/secrets.test.ts`
- Modify: ~~`web/src/auth/env.ts`~~ (moved to a dedicated `gateway/env.ts` so gateway code does not depend on the heavy Auth.js module graph)

**Interfaces:**
- Produces: `EncryptedSecret = { keyVersion; iv; authTag; ciphertext }`.
- Produces: `encryptSecret(plaintext, keyVersion, keys): EncryptedSecret` and `decryptSecret(record, keys): string` throwing a secret-free `SecretDecryptionError` on wrong key, tamper, or missing version.
- Invariant: one new random 96-bit IV per encryption; AES-256-GCM; ciphertext/IV/tag/version stored; plaintext never logged, returned, or serialized into client props.

- [ ] **Step 1: Failing crypto tests** (round-trip; fresh IV; wrong key; tamper; missing version; error text has no plaintext)
- [ ] **Step 2: Implement `secrets.ts` with `node:crypto`**
- [ ] **Step 3: GREEN + commit** `git add -A && git commit -m "feat: encrypt upstream credentials with AES-256-GCM"`

---

### Task 4: Endpoint Configuration and Dashboard CRUD

**Files:**
- Create: `web/src/features/gateway/url.ts`
- Create: `web/src/features/gateway/endpoint.ts`
- Create: `web/src/features/gateway/repository.ts`
- Create: `web/src/features/gateway/actions.ts`
- Create: `web/src/features/gateway/dashboard/*` (list, create, details+metrics, edit, credential)
- Create: `web/src/features/gateway/endpoint.test.ts`, `repository.test.ts`, `actions.test.ts`; component tests
- Modify: `web/src/lib/dal.ts`

**Interfaces:**
- Produces: `parsePriceUsdc(value): { amountAtomic; amountUsdc }` (regex, 6-decimal representability, range `0.000001..1000`).
- Produces: `parsePayToChecksummed(value): Address`.
- Produces: `canonicalizeUpstreamUrl(value): URL`.
- Produces: `newPublicId(): string` (crypto `randomBytes(16)` base64url).
- Produces: repository CRUD guarded by `ownerId`; status transitions write `audit_events` rows in the same transaction.
- Produces: server actions `createEndpoint`, `updateEndpoint`, `replaceCredential`, `activateEndpoint`, `pauseEndpoint`, `changePrice`/`changePayout` (recent-auth confirmation for active endpoints), `testConnectivity`.
- Invariant: dashboard shows only a "credential configured/absent" flag, never the secret; price/payout change on an active endpoint requires recent-auth confirmation.

- [ ] **Step 1: Failing validator + repository tests**
  Price table (valid/invalid boundary); payTo checksum/placeholder; URL rules; status transition matrix with audit rows; owner isolation; unknown public id null.
- [ ] **Step 2: Implement validators, url, repository**
- [ ] **Step 3: Failing action/UI tests then implement server actions and pages**
  Action tests on pglite with a fake session; component tests assert secrets never render.
- [ ] **Step 4: GREEN + commit** `git add -A && git commit -m "feat: add endpoint configuration and dashboard CRUD"`

---

### Task 5: SSRF-Safe Bounded GET Transport

**Files:**
- Create: `web/src/features/gateway/upstream/url-policy.ts` (+test)
- Create: `web/src/features/gateway/upstream/ip.ts` (+test)
- Create: `web/src/features/gateway/upstream/resolve.ts` (+test)
- Create: `web/src/features/gateway/upstream/transport.ts` (+test)
- Create: `web/src/features/gateway/upstream/connectivity.ts` (+test)
- Modify: `web/package.json` (add `undici` pinned)

**Interfaces:**
- Produces: `validateUpstreamUrl(raw): URL`.
- Produces: `isForbiddenAddress(ip): boolean` covering IPv4/IPv6 ranges and IPv4-mapped IPv6.
- Produces: `resolvePinned(hostname, lookup): Promise<{ address; family }>` rejecting any forbidden candidate.
- Produces: `fetchUpstream(url, { query; credential; accept }, deps): Promise<UpstreamResult>` with manual redirects, 30 s timeout, 5 MiB bounded read, fixed `User-Agent`, syntactically-valid `Accept` only, credential injection, response-header stripping.
- Produces: `runConnectivityTest(url, credential, deps): ConnectivityResult`.
- Invariant: activation tests and paid requests share the same transport.

- [ ] **Step 1: Failing URL/IP/resolve tests**
- [ ] **Step 2: Implement url-policy, ip, resolve**
- [ ] **Step 3: Failing transport tests then implement**
  Local deterministic HTTP servers with an injected resolver that treats loopback as allowed only for tests: success + header allowlist; 3xx/4xx/5xx; redirect rejection; timeout; oversize body; credential sent exactly once; no `Authorization`/cookie/`Host`/payment-header forwarding; `Content-Type` preserved; `Set-Cookie`/cors stripped.
- [ ] **Step 4: Connectivity test module + tests**
- [ ] **Step 5: GREEN + commit** `git add -A && git commit -m "feat: add SSRF-safe bounded GET upstream transport"`

---

### Task 6: Dynamic Policy and Multi-Tenant x402 Gateway

**Files:**
- Modify: `packages/server/src/payment-policy.ts`, `authorization.ts`, `resource-server.ts`, `index.ts` (+tests)
- Create: `web/src/features/gateway/policy.ts`
- Create: `web/src/features/gateway/gateway-handler.ts`
- Create: `web/src/features/gateway/gateway-route.ts`
- Create: `web/src/features/shared/payment-infrastructure.ts`
- Create: `web/src/app/g/[publicId]/route.ts`
- Create: gateway integration tests (fake facilitator + fake Redis `eval` + local upstream test server)

**Interfaces:**
- Produces (server): `createPaymentPolicy(...)` returning a frozen validated `PaymentPolicy`; `createResourceRoute(policy)` producing `RouteConfig`; `createPremiumRoute` delegated onto the premium fixture so `/api/premium` is unchanged.
- Produces: `buildGatewayPolicy(endpoint, siteUrl)` (resource `siteUrl/g/<publicId>`, validated price/payTo).
- Produces: `createGatewayPaidHandler(...)` returning the upstream body with safe headers only on 2xx; every upstream failure maps to a `502 upstream_unavailable` response (status >= 400 so the official flow never settles).
- Produces: `createGatewayRoute(...)` composing `guard(withAuthorizationLock)` around `withX402(handler, route, sharedServer, undefined, undefined, false)`.
- Public errors (stable JSON + `Cache-Control: private, no-store`, `X-Request-ID` on infra errors): `402 payment_required`, `404 endpoint_not_found`, `409 payment_in_progress`/`payment_consumed`, `502 upstream_unavailable`/`settlement_failed`, `503 payment_infrastructure_unavailable`/`gateway_configuration_unavailable`.

- [ ] **Step 1: Failing server-package policy/route tests** (`createPaymentPolicy` validation; `createResourceRoute` parity with premium fields; `createPremiumRoute` output unchanged)
- [ ] **Step 2: Implement server-package policy + route generalization** (keep premium fixture)
- [ ] **Step 3: Failing gateway integration tests then implement route/handler/policy**
  Unpaid 402; valid signed request calls upstream exactly once; concurrent duplicate calls upstream exactly once; upstream failures (`3xx/4xx/5xx/timeout/oversize`) never settle; successful settlement returns the body + standard header; paused/unknown/draft indistinguishable `404`; no secrets or bodies in logs.
- [ ] **Step 4: GREEN + full package + web tests**
- [ ] **Step 5: Commit** `git add -A && git commit -m "feat: add multi-tenant hosted GET gateway"`

---

### Task 7: Payment Events, Commission, and Metrics

**Files:**
- Create: `web/src/features/gateway/events.ts` (+tests)
- Create: `web/src/features/gateway/metrics.ts` (+tests)
- Create: `web/scripts/reconcile-payment.mjs` (+test)
- Modify: dashboard detail page for metrics

**Interfaces:**
- Produces: `recordSettlement(...)` best-effort insert (never suppresses an already-paid response; emits a secret-free reconciliation log line: request id, endpoint id, tx hash).
- Produces: 5% commission computed from atomic amount and stored with the event.
- Produces: `metricsForEndpoint(...)`: paid count, GMV, commission, unique payers, repeated payers, upstream success rate, settlement success rate, median/p95 latency, recent safe error categories.
- Produces: idempotent reconcile command accepting request id/endpoint id/tx hash, verifying onchain transfer, inserting a missing unique event.

- [ ] **Step 1: Failing commission/metrics/events tests** (commission math; best-effort failure; unique constraints; aggregate queries on pglite)
- [ ] **Step 2: Implement events/metrics + reconcile**
- [ ] **Step 3: GREEN + commit** `git add -A && git commit -m "feat: persist payment events, commission, and metrics"`

---

### Task 8: Production Compose and Migration Tooling

**Files:**
- Modify: `web/docker-compose.yml`, `web/docker-compose.production.yml` (add pinned `postgres`, one-shot `migrate`, env wiring)
- Modify: `web/docker-compose.test.ts`, `web/scripts/verify-production.mjs`
- Modify: `web/.env.example`, `web/.env.production.example`, `web/src/auth/env.ts` final gating
- Create: `web/scripts/migrate.mjs` build artifact (runs `runMigrations`)

**Interfaces:**
- Produces: `postgres` service (pinned image with digest, `POSTGRES_PASSWORD`/`POSTGRES_USER`/`POSTGRES_DB`, healthcheck `pg_isready`, backend-only, persistent volume, read-only where compatible, resource limits).
- Produces: one-shot `migrate` service (`restart: "no"`, `depends_on` postgres healthy) for explicit deployment; web never auto-migrates.
- Invariant: only `web` publishes ports / joins the ingress network; migration state is deterministic and verified post-deploy.

- [ ] **Step 1: Update compose files, migrate artifact, docker-compose.test.ts, verify-production.mjs**, all existing assertions still green and new ones added (4 services; postgres no ports; secret scoping; image immutability).
- [ ] **Step 2: Update examples and env gating; run `web test` + `docker-compose.test.ts`.**
- [ ] **Step 3: Commit** `git add -A && git commit -m "build: add PostgreSQL and migration tooling to production stack"`

---

### Task 9: Browser, Compatibility, and Production Verification

**Files:**
- Create: `web/e2e/gateway.spec.ts`
- Modify: `web/e2e/*` (running test providers + fake upstream, fake facilitator)
- Modify: `web/src/app/layout.tsx` / landing CTA gating if needed
- Run: full verification suite

**Interfaces:**
- Produces: Playwright coverage: sign-in through a test provider; create draft; configure Bearer and X-API-Key; test connectivity; activate; copy gateway URL; view metrics; pause; replace credential; cross-user access denied.
- Invariant: existing `agentpay.spec.ts` premium/basic checks remain green; smoke preview unchanged.

- [ ] **Step 1: Failing e2e tests then implement test provider/seeding support**
- [ ] **Step 2: Run full suite** `corepack pnpm test; corepack pnpm typecheck; corepack pnpm build; corepack pnpm --dir web lint; corepack pnpm --dir web test:e2e; corepack pnpm smoke:preview`
- [ ] **Step 3: Commit** `git add -A && git commit -m "test: verify hosted gateway flows end-to-end"`

---

### Task 10: Documentation and Operational Runbook

**Files:**
- Create: `docs/operations/hosted-get-gateway-runbook.md`
- Modify: `README.md`, `web/README.md`, landing/docs components, `web/.env.production.example` (final)

**Interfaces:**
- Produces: runbook covering one-server topology with Postgres, secret management (`AUTH_SECRET`, GitHub/SMTP, `AGENTPAY_MASTER_KEY`), one-shot migration step, postgres backup/restore, `AGENTPAY_MASTER_KEY` rotation, payment-event reconciliation, rollback for the 4-service stack, and incident stop conditions.
- Produces: updated README/landing describing seller onboarding and gateway limits without revealing secrets.

- [ ] **Step 1: Write the runbook and update docs**
- [ ] **Step 2: Final full verification and plan self-review checklist**
- [ ] **Step 3: Commit** `git add -A && git commit -m "docs: document hosted GET gateway operations"`

---

## Plan Self-Review Checklist

- [ ] All success criteria from `docs/superpowers/specs/2026-08-16-hosted-get-gateway-design.md` are demonstrated by tests in this branch.
- [ ] `/api/premium` and `/api/basic` behavior and clean-room smoke previews remain green and unchanged.
- [ ] Full unit, integration, typecheck, lint, build, and Playwright suites pass without spending funds.
- [ ] Concurrency tests prove the upstream executes at most once.
- [ ] Upstream failures never settle; settlement success is never converted into an error by event-persistence failures.
- [ ] No secret, payment signature, query value, or paid body appears in any log, test output, or serialized props.
- [ ] PostgreSQL publishes no host port; only `web` is publicly routed; migrations are an explicit one-shot step.
- [ ] The feature branch is clean and contains only intentional commits; nothing was pushed or merged.