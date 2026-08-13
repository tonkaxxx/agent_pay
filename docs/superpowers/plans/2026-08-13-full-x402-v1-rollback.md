# Full x402 v1 Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the tracked repository and deployed AgentPay payment flow to the last pre-v2 state at commit `03c7c26`.

**Architecture:** Git history remains intact while one new rollback commit restores every tracked path from `03c7c26`. The restored v1 server verifies an `X-Payment-Tx` Base transaction through `BASE_MAINNET_RPC_URL` and uses Redis to reject receipt replay; it does not call the CDP facilitator.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Next.js 16, viem, Redis, Docker Compose, Traefik.

## Global Constraints

- The final tracked tree must match commit `03c7c26` exactly.
- Do not rewrite Git history.
- Do not deploy or print any buyer private key.
- Back up the current production Compose/env references before deployment.
- Do not remove the current production Redis volume during rollback.

---

### Task 1: Capture rollback evidence and restore the v1 tree

**Files:**
- Restore: every tracked path from commit `03c7c26`
- Remove: every tracked path absent from commit `03c7c26`

**Interfaces:**
- Consumes: Git commit `03c7c26`
- Produces: an index and worktree identical to `03c7c26`

- [ ] **Step 1: Record the current revisions and clean status**

Run:

```bash
git rev-parse HEAD
git rev-parse 03c7c26
git status --short
```

Expected: `main` contains only committed specification and plan changes before restoration.

- [ ] **Step 2: Restore all tracked paths from the v1 commit**

Run:

```bash
git restore --source=03c7c26 --staged --worktree -- .
```

Expected: files added after v1 are staged for deletion, deleted v1 files are staged for restoration, and changed files contain their v1 versions.

- [ ] **Step 3: Verify exact tree equality**

Run:

```bash
git diff --cached --check
git diff --quiet 03c7c26 -- .
```

Expected: both commands exit `0`; the staged tree matches `03c7c26` exactly.

### Task 2: Verify the restored v1 implementation

**Files:**
- Verify: `packages/client/**`
- Verify: `packages/server/**`
- Verify: `web/**`
- Verify: `examples/**`

**Interfaces:**
- Consumes: restored v1 source and `pnpm-lock.yaml`
- Produces: fresh unit-test, typecheck, lint, and build evidence

- [ ] **Step 1: Synchronize dependencies to the restored lockfile**

Run:

```bash
corepack pnpm install --frozen-lockfile
```

Expected: exit `0` without modifying tracked files.

- [ ] **Step 2: Run all unit tests**

Run:

```bash
corepack pnpm test
```

Expected: exit `0` with no failed tests.

- [ ] **Step 3: Run static checks**

Run:

```bash
corepack pnpm typecheck
corepack pnpm lint
```

Expected: both commands exit `0`.

- [ ] **Step 4: Build the production application**

Run:

```bash
corepack pnpm build
```

Expected: exit `0` and `/api/premium` is included as a dynamic route.

- [ ] **Step 5: Reconfirm that verification did not alter the v1 tree**

Run:

```bash
git diff --quiet 03c7c26 -- .
```

Expected: exit `0`.

### Task 3: Record the rollback without rewriting history

**Files:**
- Commit: the exact staged tree from Task 1

**Interfaces:**
- Consumes: verified staged v1 tree
- Produces: one rollback commit on `main`

- [ ] **Step 1: Commit the rollback**

Run:

```bash
git commit -m "revert: restore AgentPay x402 v1"
```

Expected: one commit restoring the pre-v2 tracked tree.

- [ ] **Step 2: Verify committed tree identity and clean status**

Run:

```bash
git diff --exit-code 03c7c26 HEAD -- .
git status --short
```

Expected: no diff and no worktree changes.

### Task 4: Deploy the verified v1 build to the existing server

**Files:**
- Server repository: `/home/worker/repos/vibe/agentpay`
- Server backup: timestamped directory under `/home/worker/repos/vibe/agentpay-backups`
- Server secret env: existing `.env.production` and/or `web/.env.local`, never printed

**Interfaces:**
- Consumes: local rollback commit and existing seller-only server secrets
- Produces: running v1 web and Redis services on `192.168.88.44`

- [ ] **Step 1: Inspect server state without printing secrets**

Run:

```bash
ssh -o BatchMode=yes worker@192.168.88.44 \
  'cd /home/worker/repos/vibe/agentpay && git rev-parse HEAD && git status --short && sed -n "s/=.*//p" .env.production && docker compose --env-file .env.production -f docker-compose.yml ps && docker inspect agentpay-app --format "{{.Image}}" && grep -nA8 "agentpay-router\|agentpay-service" /home/worker/repos/vibe/traefik/config/dynamic.yml'
```

Expected: no tracked server edits; only environment variable names are printed,
the current containers are identified, and Traefik targets `agentpay-app:3000`.
Stop if tracked server edits would be overwritten.

- [ ] **Step 2: Back up current deployment metadata**

Run on the server with a timestamp captured once:

```bash
deployment_backup=/home/worker/repos/vibe/agentpay-backups/20260813T100000-v2
install -d -m 700 "$deployment_backup"
cp -a /home/worker/repos/vibe/agentpay/docker-compose.yml "$deployment_backup"/
cp -a /home/worker/repos/vibe/agentpay/.env.production "$deployment_backup"/
cp -a /home/worker/repos/vibe/traefik/config/dynamic.yml "$deployment_backup"/traefik-dynamic.yml
git -C /home/worker/repos/vibe/agentpay rev-parse HEAD > "$deployment_backup/revision"
docker inspect agentpay-app --format '{{.Image}}' > "$deployment_backup/web-image-id"
```

Choose the actual timestamp immediately before execution and validate that the
target is below `/home/worker/repos/vibe/agentpay-backups/` before copying. Do
not run Compose with `--volumes` and do not delete `agentpay_redis-data`.

- [ ] **Step 3: Transfer the verified rollback commit**

Run locally and then on the server:

```bash
git bundle create /tmp/agentpay-x402-v1.bundle main
scp /tmp/agentpay-x402-v1.bundle worker@192.168.88.44:/tmp/agentpay-x402-v1.bundle
ssh -o BatchMode=yes worker@192.168.88.44 \
  'cd /home/worker/repos/vibe/agentpay && git fetch /tmp/agentpay-x402-v1.bundle main && git merge --ff-only FETCH_HEAD'
```

Expected: the server fast-forwards to the local rollback commit without
rewriting history or touching untracked secret files.

- [ ] **Step 4: Adapt seller environment names without exposing values**

Generate a server-only Compose file outside the tracked tree and copy it over
the backed-up untracked `/home/worker/repos/vibe/agentpay/docker-compose.yml`.
It must build `web/Dockerfile`, retain `container_name: agentpay-app`, attach web
to `web-net`, retain the existing named `redis-data` volume, and pass only:

```yaml
environment:
  NODE_ENV: production
  NEXT_PUBLIC_SITE_URL: ${NEXT_PUBLIC_SITE_URL:?set NEXT_PUBLIC_SITE_URL}
  AGENTPAY_PAY_TO: ${AGENTPAY_PAY_TO:?set AGENTPAY_PAY_TO}
  BASE_MAINNET_RPC_URL: ${BASE_MAINNET_RPC_URL:-https://mainnet.base.org}
  REDIS_URL: redis://redis:6379
```

Do not pass `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, or `AGENT_PRIVATE_KEY` to
the container. Existing unused CDP values may remain only in the protected host
env backup until separately rotated/deleted.

- [ ] **Step 5: Build and start v1**

Run:

```bash
ssh -o BatchMode=yes worker@192.168.88.44 \
  'cd /home/worker/repos/vibe/agentpay && docker compose --env-file .env.production -f docker-compose.yml config --quiet && docker compose --env-file .env.production -f docker-compose.yml build --pull web && docker compose --env-file .env.production -f docker-compose.yml up -d --remove-orphans --wait'
```

Expected: `agentpay-app` and Redis are healthy/running, and Traefik keeps using
the existing `http://agentpay-app:3000` target.

### Task 5: Verify production v1 behavior

**Files:**
- Verify only: `https://agentpay.thebestsites.ru/api/premium`

**Interfaces:**
- Consumes: deployed v1 endpoint
- Produces: HTTP evidence that v1 is active and v2/CDP is absent

- [ ] **Step 1: Verify the unpaid v1 challenge**

Run:

```bash
curl -sS -D /tmp/agentpay-v1-headers.txt -o /tmp/agentpay-v1-body.json https://agentpay.thebestsites.ru/api/premium
```

Expected: status `402`; JSON contains only `error`, `priceUsdc`, `payTo`, `network`, and `chainId`; no `PAYMENT-REQUIRED`, `x402Version`, facilitator, or premium payload appears.

- [ ] **Step 2: Verify invalid v1 receipt rejection**

Run:

```bash
curl -sS -D /tmp/agentpay-v1-invalid-headers.txt \
  -o /tmp/agentpay-v1-invalid-body.json \
  -H 'X-Payment-Tx: invalid' \
  https://agentpay.thebestsites.ru/api/premium
```

Expected: `403 Invalid Payment` or a fail-closed verification response; premium data is absent.

- [ ] **Step 3: Verify services and safe logs**

Run:

```bash
ssh -o BatchMode=yes worker@192.168.88.44 \
  'cd /home/worker/repos/vibe/agentpay && docker compose --env-file .env.production -f docker-compose.yml ps && docker compose --env-file .env.production -f docker-compose.yml logs --since=10m --no-color web redis'
curl -fsS -o /dev/null https://agentpay.thebestsites.ru/
```

Expected: both services are running, the landing page returns success, and logs
contain no startup errors or secret values.

- [ ] **Step 4: Verify the exact deployed revision**

Run:

```bash
git rev-parse HEAD
ssh -o BatchMode=yes worker@192.168.88.44 \
  'cd /home/worker/repos/vibe/agentpay && git rev-parse HEAD && docker inspect agentpay-app --format "{{.Config.Image}} {{.State.Status}}"'
```

Expected: local and server Git revisions match and `agentpay-app` is running
from the v1 deployment image.
