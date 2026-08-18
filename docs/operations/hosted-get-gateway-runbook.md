# Hosted GET Gateway Operations

This runbook covers the single-server production stack in
`web/docker-compose.production.yml`: `web`, `facilitator`, `redis`, `postgres`,
and the one-shot `migrate` job. Only `web` joins the public Traefik network.

## Required secrets

Create `web/.env.production` with mode `0600` from
`web/.env.production.example`. Replace every placeholder. Use separate,
least-privilege values for `AUTH_SECRET`, GitHub OAuth, SMTP, PostgreSQL,
Redis, Base RPC, the gas-only facilitator key, and `AGENTPAY_MASTER_KEY` (32
random bytes encoded as base64). Never place buyer keys, seller upstream
credentials, or primary-wallet keys in Compose variables.

## Deploy

Build and publish an immutable image tagged with the full Git commit, then set
`AGENTPAY_IMAGE` to that tag:

```sh
docker compose --env-file web/.env.production -f web/docker-compose.production.yml pull
docker compose --env-file web/.env.production -f web/docker-compose.production.yml run --rm migrate
docker compose --env-file web/.env.production -f web/docker-compose.production.yml up -d web facilitator redis postgres
node web/scripts/verify-production.mjs --base-url=https://agentpay.thebestsites.ru
```

Do not start a new web image until its idempotent migration job succeeds.

## PostgreSQL backup and restore

Back up before migrations and releases:

```sh
docker compose --env-file web/.env.production -f web/docker-compose.production.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > agentpay.dump
```

Restore only in a maintenance window into a compatible database:

```sh
docker compose --env-file web/.env.production -f web/docker-compose.production.yml exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < agentpay.dump
```

Keep tested, encrypted off-server backups.

## Master-key rotation

`AGENTPAY_MASTER_KEY_VERSION` identifies the write key. Back up PostgreSQL,
add a higher-version 32-byte key, retain the previous key in
`AGENTPAY_MASTER_KEYS` for reads, re-encrypt or rotate seller credentials, and
remove the old key only after no row references it.

## Settlement reconciliation

For a `reconcile_needed` log, verify and insert the event idempotently:

```sh
DATABASE_URL=<postgres-url> AGENTPAY_RPC_URL=<base-rpc-url> node web/scripts/reconcile-payment.mjs --request-id=<request-id> --endpoint-id=<endpoint-id> --tx-hash=<base-transaction-hash>
```

The command verifies the Base receipt, official USDC transfer, amount, and
seller payout address.

## Rollback

Restore the previous immutable `AGENTPAY_IMAGE`, run the production verifier,
and recreate `web` and `facilitator`. Prefer a forward-compatible application
rollback; never reverse a migration without a separately tested down migration.

## Incident stop conditions

Pause affected endpoints or stop `web` if paid bodies escape without confirmed
settlement, an authorization executes upstream twice, Redis locks fail, or any
credential, payment signature, query value, or paid body reaches logs. Stop
`facilitator` and rotate its key if the gas sponsor is compromised. Stop new
activations when DNS pinning, TLS verification, SMTP notifications, PostgreSQL,
or credential encryption is unavailable.
