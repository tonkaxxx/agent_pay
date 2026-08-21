# Hosted GET Gateway Operations

This runbook covers the single-server production stack in
`web/docker-compose.production.yml`: `web`, `facilitator`, `redis`, `postgres`,
the one-shot `migrate` job, and the private `payout-worker` in the active
`custodial` profile. Only `web` joins the public Traefik network.

## Required secrets

Create `web/.env.production` with mode `0600` from
`web/.env.production.example`. Replace every placeholder. Use separate,
least-privilege values for `AUTH_SECRET`, GitHub OAuth, SMTP, PostgreSQL,
Redis, Base RPC, the gas-only facilitator key, and `AGENTPAY_MASTER_KEY` (32
random bytes encoded as base64). Custodial production additionally requires a
dedicated collection key/address pair, the AgentPay treasury address,
`AGENTPAY_FEE_MODE=custodial`, and
`AGENTPAY_CUSTODY_LEGAL_APPROVED=true`. Never place buyer keys, seller upstream
credentials, or primary-wallet keys in Compose variables. The collection key
belongs only to `payout-worker`.

## Deploy

Build and publish an immutable image tagged with the full Git commit, then set
`AGENTPAY_IMAGE` to that tag:

```sh
docker compose --profile custodial --env-file web/.env.production -f web/docker-compose.production.yml pull
docker compose --profile custodial --env-file web/.env.production -f web/docker-compose.production.yml run --rm migrate
docker compose --profile custodial --env-file web/.env.production -f web/docker-compose.production.yml up -d
node web/scripts/verify-production.mjs --base-url=https://agentpay.thebestsites.ru
```

Do not start a new web image until its idempotent migration job succeeds.

## PostgreSQL backup and restore

Back up before migrations and releases into an operator-only directory outside
the repository:

```sh
install -d -m 0700 ../agentpay-deploy-backups
AGENTPAY_BACKUP_DIR=$(mktemp -d ../agentpay-deploy-backups/release-XXXXXXXX)
docker compose --env-file web/.env.production \
  -f web/docker-compose.production.yml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$AGENTPAY_BACKUP_DIR/agentpay.dump"
chmod 0600 "$AGENTPAY_BACKUP_DIR/agentpay.dump"
```

Encrypt and copy the dump to approved off-server storage. Never add a
production dump to Git or leave it in the repository tree.

Restore only in a maintenance window into a compatible database:

```sh
AGENTPAY_RESTORE_FILE=/absolute/operator-only/path/to/agentpay.dump
test -f "$AGENTPAY_RESTORE_FILE"
docker compose --env-file web/.env.production \
  -f web/docker-compose.production.yml exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
  < "$AGENTPAY_RESTORE_FILE"
```

Keep tested, encrypted off-server backups.

## Master-key rotation

`AGENTPAY_MASTER_KEY_VERSION` identifies the write key. Back up PostgreSQL,
add a higher-version 32-byte key, retain the previous key in
`AGENTPAY_MASTER_KEYS` for reads, re-encrypt or rotate seller credentials, and
remove the old key only after no row references it.

## Settlement and payout reconciliation

Use the finance CLI through the worker image. It validates the collection
key/address pair and keeps the private key out of web:

```sh
COMPOSE='docker compose --profile custodial --env-file web/.env.production -f web/docker-compose.production.yml'
$COMPOSE run --rm payout-worker node /app/web/scripts/finance-cli.mjs status
$COMPOSE run --rm payout-worker node /app/web/scripts/finance-cli.mjs reconcile
$COMPOSE run --rm payout-worker node /app/web/scripts/finance-cli.mjs run-now
```

Incoming obligations remain pending until the reconciler sees the matching
successful official-USDC transfer with two Base confirmations. Seller payouts
release reserved liability only after two confirmations; a treasury sweep is
prepared only from confirmed seller batches.

The legacy payment-event repair command below repairs dashboard metrics in
direct-settlement mode. It does not settle a custodial liability:

For a `reconcile_needed` log, verify and insert the event idempotently:

```sh
DATABASE_URL=<postgres-url> AGENTPAY_RPC_URL=<base-rpc-url> node web/scripts/reconcile-payment.mjs --request-id=<request-id> --endpoint-id=<endpoint-id> --tx-hash=<base-transaction-hash>
```

The command verifies the Base receipt, official USDC transfer, amount, and
direct recipient.

## Rollback

Restore the previous immutable `AGENTPAY_IMAGE`, run the production verifier,
and recreate the stack. To stop accepting new custodial payments, switch web to
`ledger`, but keep `payout-worker` running until recorded seller liabilities
are zero. Prefer a forward-compatible application rollback; never reverse a
migration without a separately tested down migration.

## Incident stop conditions

Pause affected endpoints or stop `web` if paid bodies escape without confirmed
settlement, an authorization executes upstream twice, Redis locks fail, or any
credential, payment signature, query value, or paid body reaches logs. Stop
`facilitator` and rotate its key if the gas sponsor is compromised. Stop new
activations when DNS pinning, TLS verification, SMTP notifications, PostgreSQL,
or credential encryption is unavailable.

Pause finance immediately for a collection-key incident, an unknown outgoing
transfer, a reconciliation mismatch, a stuck payout, or collection gas below
`0.0001 ETH`. See `custodial-commission-runbook.md` for liability-preserving
rollback and wallet rotation.
