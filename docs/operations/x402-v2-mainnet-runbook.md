# AgentPay x402 v2 Mainnet operations

This runbook describes the current `main` production release on Base Mainnet.
It handles real USDC. Run commands from the repository root unless noted.

## Public contracts

- `GET /api/basic` is free.
- `GET /api/premium` is a separate 0.01 USDC demonstration endpoint that
  settles directly to `AGENTPAY_PAY_TO`.
- `GET /g/<public-id>` is the hosted seller gateway. Production uses custodial
  95/5 accounting for these routes.
- All paid routes use standard x402 v2 `exact`, official Base USDC
  `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, and network `eip155:8453`.
- A transaction hash is public evidence, never a bearer token. Paid bodies are
  released only through the signed x402 request flow.

An unpaid response contains a compact JSON body. Full machine-readable terms
are in `PAYMENT-REQUIRED`; the client sends `PAYMENT-SIGNATURE`; a successful
response returns `PAYMENT-RESPONSE`.

## Production topology

One Docker Compose project runs:

- `web`: the only service on public Traefik `web-net`;
- `facilitator`: verifies and submits EIP-3009 authorizations;
- `redis`: authorization locks and consumed state;
- `postgres`: sellers, endpoints, events, finance ledger and payout state;
- `migrate`: one-shot idempotent database migrations;
- `payout-worker`: private reconciliation, seller payouts and fee sweeps.

Only facilitator and payout-worker have Base RPC egress. Redis, PostgreSQL,
facilitator and payout-worker publish no host ports.

## Wallet roles

Keep every role separate:

| Role | Secret owner | Purpose |
| --- | --- | --- |
| Buyer wallet | buyer agent only | Signs exact USDC authorization; needs no ETH |
| Facilitator sponsor | facilitator only | Pays gas to submit buyer authorization |
| Collection wallet | payout-worker only | Receives hosted-route USDC and sends payouts |
| Seller payout | public endpoint config | Receives 95% seller net |
| AgentPay treasury | public worker config | Receives confirmed 5% fee sweeps |

Current public production addresses:

- collection: `0x7C04bf9fFd46EAeF9101F4aC558C13fb569923E6`;
- treasury: `0x748BB9bDA321B434DA83F402Cc8152eD23668a9a`.

Treat any private key pasted into chat, a prompt, command line, shell history,
logs or source control as compromised. Never put a buyer key on the server.
The collection private key must exist only as
`AGENTPAY_PAYOUT_PRIVATE_KEY` in the payout-worker environment.

## Required production configuration

Keep `web/.env.production` untracked and mode `0600`. Start from
`web/.env.production.example` and replace every placeholder. Custodial
production requires:

```dotenv
AGENTPAY_IMAGE=agentpay:<full-40-character-main-commit>
NEXT_PUBLIC_SITE_URL=https://agentpay.thebestsites.ru/
AGENTPAY_FEE_MODE=custodial
AGENTPAY_CUSTODY_LEGAL_APPROVED=true
AGENTPAY_GATEWAY_COLLECTION_ADDRESS=0x7C04bf9fFd46EAeF9101F4aC558C13fb569923E6
AGENTPAY_PAYOUT_PRIVATE_KEY=<secret-collection-key>
AGENTPAY_FEE_RECIPIENT=0x748BB9bDA321B434DA83F402Cc8152eD23668a9a
```

It also requires the facilitator key, Base RPC URL, Redis and PostgreSQL
credentials, Auth.js providers, SMTP and the application master key. Web fails
closed if a payout, facilitator or buyer private key enters its environment.
The worker refuses to start if its key does not derive the configured
collection address or reuses a forbidden key.

## Release and deploy

1. Verify the exact `main` tree:

   ```sh
   git switch main
   git pull --ff-only origin main
   git status --short
   corepack pnpm test
   corepack pnpm typecheck
   corepack pnpm lint
   corepack pnpm build
   ```

2. Back up PostgreSQL before migrations into an operator-only directory outside
   the repository:

   ```sh
   install -d -m 0700 ../agentpay-deploy-backups
   AGENTPAY_BACKUP_DIR=$(mktemp -d ../agentpay-deploy-backups/release-XXXXXXXX)
   docker compose --profile custodial --env-file web/.env.production \
     -f web/docker-compose.production.yml exec -T postgres \
     sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
     > "$AGENTPAY_BACKUP_DIR/agentpay.dump"
   chmod 0600 "$AGENTPAY_BACKUP_DIR/agentpay.dump"
   ```

   Encrypt and copy the dump to approved off-server storage. Never add a
   production dump to Git or leave it in the repository tree.

3. Build an immutable image and set the matching full tag in the environment:

   ```sh
   REVISION=$(git rev-parse HEAD)
   docker build -t "agentpay:$REVISION" -f web/Dockerfile .
   ```

4. Validate without printing resolved secrets, migrate, then recreate:

   ```sh
   docker compose --profile custodial --env-file web/.env.production \
     -f web/docker-compose.production.yml config --quiet
   docker compose --profile custodial --env-file web/.env.production \
     -f web/docker-compose.production.yml run --rm migrate
   docker compose --profile custodial --env-file web/.env.production \
     -f web/docker-compose.production.yml up -d --remove-orphans
   ```

5. Verify `web` and `facilitator` are healthy, `payout-worker` is running, and
   the finance heartbeat is fresh. Never print container environments.

## No-spend public verification

```sh
curl -i https://agentpay.thebestsites.ru/api/premium
corepack pnpm smoke:preview
```

Expected results:

- HTTP 402 with compact JSON and canonical `PAYMENT-REQUIRED`;
- Base Mainnet, official USDC and exact advertised amount;
- no premium or upstream data in an unpaid response;
- smoke preview ends with `PAYMENT NOT SENT`.

For a hosted route, decode `PAYMENT-REQUIRED` and verify `payTo` equals the
collection wallet. Do not expect the seller or treasury address in the buyer
quote.

## Paid verification

Use a new low-balance payer wallet funded only with the Base USDC intended for
the test. The payer needs no ETH. Supply its key through an isolated secret
channel, set `ALLOW_MAINNET_PAYMENTS=true`, run `corepack pnpm smoke:mainnet`,
then unset both variables.

Verify HTTP 200 contains paid data only after settlement and
`PAYMENT-RESPONSE` reports success. Replaying the same authorization must not
return paid data.

## Custodial accounting

- commission: `floor(gross * 500 / 10000)` atomic USDC;
- seller liability: buyer total minus commission;
- payout eligibility: 1 USDC seller net or seven days by default;
- automatic batch preparation: once after 03:00 UTC per uninterrupted worker
  process day; worker restart or operator `run-now` can trigger another
  idempotent eligibility pass;
- incoming and outgoing finality: two Base confirmations;
- collection gas safety floor: `0.0001 ETH`;
- liability cap: 500 USDC reserved seller net;
- stale worker heartbeat: new custodial settlements fail closed.

The low gas floor is a last-resort stop condition, not a funding target. Every
seller payout and treasury sweep consumes collection-wallet ETH.

## Operations and incidents

Use the worker image for finance commands:

```sh
COMPOSE='docker compose --profile custodial --env-file web/.env.production -f web/docker-compose.production.yml'
$COMPOSE run --rm payout-worker node /app/web/scripts/finance-cli.mjs status
$COMPOSE run --rm payout-worker node /app/web/scripts/finance-cli.mjs reconcile
$COMPOSE run --rm payout-worker node /app/web/scripts/finance-cli.mjs run-now
$COMPOSE run --rm payout-worker node /app/web/scripts/finance-cli.mjs pause maintenance
$COMPOSE run --rm payout-worker node /app/web/scripts/finance-cli.mjs resume
```

Pause immediately for a balance mismatch, unknown outgoing transfer, RPC
inconsistency, stuck transaction, stale heartbeat, collection-key exposure or
gas below the safety floor. Pausing blocks new custodial settlement but never
deletes seller liabilities.

For rollback, switch web to `ledger` to stop accepting new custodial payments,
but keep payout-worker running until all recorded liabilities are reconciled
and paid. Never reverse a migration without a separately tested down migration.

Detailed seller/API operations are in
[`hosted-get-gateway-runbook.md`](hosted-get-gateway-runbook.md). Detailed
finance recovery and wallet rotation are in
[`custodial-commission-runbook.md`](custodial-commission-runbook.md).
