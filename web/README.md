# AgentPay web

The Next.js investor site, developer docs, and live `$0.01` Base mainnet x402 v2 API. The app imports the local `@agentpay/client` and `@agentpay/server` workspace packages.

## Local development

```sh
corepack pnpm install
cp web/.env.example web/.env.local
corepack pnpm dev:web
```

An unpaid request is safe to inspect. Its standard x402 terms are in the
`PAYMENT-REQUIRED` header and the same decoded challenge is mirrored into the
JSON body for ordinary curl users:

```sh
curl -i http://localhost:3000/api/premium
```

Protocol clients must continue to read the standard header. The body is a
readability aid generated from that header; AgentPay does not maintain a second
copy of the payment terms.

## Deployment variables

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical public HTTPS origin |
| `AGENTPAY_PAY_TO` | Base recipient for the fixed `$0.01` USDC payment |
| `CDP_API_KEY_ID` | CDP facilitator API key identifier |
| `CDP_API_KEY_SECRET` | CDP facilitator API key secret |
| `REDIS_URL` | Authenticated `redis://` or TLS `rediss://` idempotency store used when running the app directly |

`AGENT_PRIVATE_KEY` is used only by the guarded local client example. Never deploy it with the web server. A real client payment requires both the `--execute` argument and `ALLOW_MAINNET_PAYMENTS=true`.

The API uses the official Next x402 wrapper and CDP facilitator. Redis atomically leases Payment Identifiers and replays completed responses, including the original `PAYMENT-RESPONSE`, without persisting raw payment signatures.

## Single-server production deployment

The production Compose stack runs the non-root, read-only web container and an
authenticated Redis 7 container on one host. Redis is private to the internal
`backend` network, persists AOF data in `agentpay_redis-data`, and publishes no
host port. Only web joins the existing external `web-net` used by Traefik.

Create a secret env file from the documented template. `AGENTPAY_IMAGE` must be
an image tagged with the complete 40-character Git SHA; do not use `latest`.

```sh
cp web/.env.production.example web/.env.production
chmod 600 web/.env.production
# Fill CDP credentials and generate REDIS_PASSWORD, for example:
# openssl rand -hex 32

docker compose --env-file web/.env.production \
  -f web/docker-compose.yml config --quiet
docker compose --env-file web/.env.production \
  -f web/docker-compose.yml pull
docker compose --env-file web/.env.production \
  -f web/docker-compose.yml up -d --remove-orphans --wait
```

The Compose file converts `REDIS_PASSWORD` into the internal authenticated
`REDIS_URL`; it never supplies `AGENT_PRIVATE_KEY`, a buyer RPC URL, or the
quote-only flag to web. Keep `.env.production` mode `0600`, and make a timestamped
backup of the current Compose/env files and prior image reference before every
rollout.

Verify the public challenge without any seller credentials:

```sh
corepack pnpm --dir web verify:production -- \
  https://agentpay.thebestsites.ru \
  0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB
```

To roll back, restore the backed-up Compose/env files (or set
`AGENTPAY_IMAGE` to the recorded prior immutable tag), validate with
`docker compose config --quiet`, and run `docker compose up -d --wait` again.
Do not delete the Redis volume during rollback.

The named volume plus `appendfsync everysec` protects idempotency across
container restarts, not loss of the Docker host. Back up the volume or move
Redis to a managed durable service before the deployment requires host-level
disaster recovery or multiple application hosts.

The seller container intentionally has no payer private key. A real settlement
test needs a separate, low-balance funded payer and the guarded client command
with both `ALLOW_MAINNET_PAYMENTS=true` and `--execute`.

## Verification

```sh
corepack pnpm --dir web test
corepack pnpm --dir web typecheck
corepack pnpm --dir web lint
corepack pnpm --dir web build
corepack pnpm --dir web test:e2e
```
