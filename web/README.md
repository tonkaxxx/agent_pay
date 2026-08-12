# AgentPay web

The Next.js investor site, developer docs, and live `$0.01` Base mainnet x402 v2 API. The app imports the local `@agentpay/client` and `@agentpay/server` workspace packages.

## Local development

```sh
corepack pnpm install
cp web/.env.example web/.env.local
corepack pnpm dev:web
```

To run the complete local stack, including persistent Redis, use the default
Compose file:

```sh
cd web
docker compose down
docker compose up -d --build
docker compose ps
curl -i http://localhost:3000/api/premium
```

After the image has been built and the source and dependencies have not
changed, the short restart command works as-is:

```sh
docker compose down && docker compose up -d
```

The local stack reads `.env.local`, binds the application only to
`127.0.0.1:3000`, and keeps Redis on the private Compose network with a named
volume. It overrides the buyer private key and Base RPC URL with empty values
inside the seller container and forces `ALLOW_MAINNET_PAYMENTS=false`. Use
`--build` again after source or dependency changes.

An unpaid request is safe to inspect. For compatibility with the pre-v2 public
API, an ordinary request receives the concise AgentPay quote in its JSON body:

```sh
curl -i http://localhost:3000/api/premium
```

```json
{
  "error": "Payment Required",
  "priceUsdc": "0.01",
  "payTo": "0x58B0fF9Fd53C854f3779acdE649a7FAc2de2d1CB",
  "network": "base",
  "chainId": 8453
}
```

Under the hood, protocol clients continue to read the standard
`PAYMENT-REQUIRED` header and pay through x402 v2. The compatibility body does
not replace that header and the obsolete `X-Payment-Tx` flow is not supported.
Bazaar output discovery is intentionally disabled for this endpoint so an
unpaid challenge never contains a copy or example of the premium response.

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
  -f web/docker-compose.production.yml config --quiet
docker compose --env-file web/.env.production \
  -f web/docker-compose.production.yml pull
docker compose --env-file web/.env.production \
  -f web/docker-compose.production.yml up -d --remove-orphans --wait
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
`AGENTPAY_IMAGE` to the recorded prior immutable tag), then validate and restart
the explicit production stack:

```sh
docker compose --env-file web/.env.production \
  -f web/docker-compose.production.yml config --quiet
docker compose --env-file web/.env.production \
  -f web/docker-compose.production.yml up -d --remove-orphans --wait
```

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
