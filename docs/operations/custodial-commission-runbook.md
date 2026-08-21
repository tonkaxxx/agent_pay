# Custodial 5% commission runbook

This mode keeps the public seller gateway compatible with standard x402 v2
`exact`, but changes the on-chain recipient for `GET /g/<public-id>` to an
AgentPay collection wallet. The buyer price is the total: 95% becomes a seller
liability and 5% becomes AgentPay commission. `GET /api/premium` is separate
and continues to settle to `AGENTPAY_PAY_TO`.

## Release gate and key separation

Do not set `AGENTPAY_CUSTODY_LEGAL_APPROVED=true` until counsel has reviewed
the public custody, transmission, sanctions/KYC, tax, and seller-terms model in
every jurisdiction served. Both web and worker fail closed without this flag.

Use three different wallets:

- facilitator gas sponsor: ETH only, `FACILITATOR_PRIVATE_KEY`;
- collection hot wallet: buyer USDC plus payout gas,
  `AGENTPAY_PAYOUT_PRIVATE_KEY`;
- treasury: receives confirmed 5% sweeps, `AGENTPAY_FEE_RECIPIENT`.

The collection key must exist only in the `payout-worker` environment. Never
put it in web, facilitator, source control, shell history, a prompt, or logs.
The configured collection address must match the key or the worker refuses to
start. Keep at least 0.001 ETH in the collection wallet; falling below it
automatically pauses new custodial settlements.

## Configuration and rollout

Start from `web/.env.production.example`. Keep the first deploy in ledger mode:

```dotenv
AGENTPAY_FEE_MODE=ledger
AGENTPAY_CUSTODY_LEGAL_APPROVED=false
AGENTPAY_GATEWAY_COLLECTION_ADDRESS=0x...
AGENTPAY_PAYOUT_PRIVATE_KEY=0x...
AGENTPAY_FEE_RECIPIENT=0x...
```

Back up PostgreSQL, deploy the immutable image, and run migrations:

```sh
docker compose --env-file web/.env.production \
  -f web/docker-compose.production.yml pull
docker compose --env-file web/.env.production \
  -f web/docker-compose.production.yml run --rm migrate
```

After legal approval and wallet funding, set
`AGENTPAY_FEE_MODE=custodial` and `AGENTPAY_CUSTODY_LEGAL_APPROVED=true`, then:

```sh
docker compose --profile custodial --env-file web/.env.production \
  -f web/docker-compose.production.yml up -d
docker compose --profile custodial --env-file web/.env.production \
  -f web/docker-compose.production.yml ps
```

Verify an unpaid seller endpoint. `PAYMENT-REQUIRED` must still advertise
x402 v2, Base, official USDC and the buyer total, but `payTo` must equal the
collection address. The compact unpaid body must not contain upstream data.

## Accounting behavior

- Commission is `floor(gross * 500 / 10000)` atomic USDC units.
- The seller payout address is snapshotted when the obligation is created.
- Schedule changes apply to all settled obligations not yet batched.
- Default schedule is payout at 1 USDC seller net or after seven days.
- `threshold` waits until seller net reaches 1 USDC.
- New batches are prepared once daily after 03:00 UTC.
- Transfers need two Base confirmations. A stuck transaction is replaced after
  ten minutes with the same nonce and higher fees, at most three attempts.
- Seller liability is released only after the seller transfer confirms.
- The 5% treasury sweep is prepared only from confirmed seller batches.
- Unknown direct USDC deposits are ignored by the ledger.
- New settlements fail closed if the worker heartbeat is older than two
  minutes or reserved seller liability would exceed 500 USDC.

## Operations

Run the finance CLI through the worker image so the payout key never enters web:

```sh
COMPOSE='docker compose --profile custodial --env-file web/.env.production -f web/docker-compose.production.yml'
$COMPOSE run --rm payout-worker node /app/web/scripts/finance-cli.mjs status
$COMPOSE run --rm payout-worker node /app/web/scripts/finance-cli.mjs reconcile
$COMPOSE run --rm payout-worker node /app/web/scripts/finance-cli.mjs run-now
$COMPOSE run --rm payout-worker node /app/web/scripts/finance-cli.mjs pause maintenance
$COMPOSE run --rm payout-worker node /app/web/scripts/finance-cli.mjs resume
```

The worker writes a heartbeat every 30 seconds and reconciles pending incoming
authorizations every five minutes. Reconciliation requires both USDC
`AuthorizationUsed` and the matching successful `Transfer` to the collection
wallet before it marks a payment settled. Expired unused authorizations are
cancelled and their reserved liability is released.

## Incident and rollback

On any balance mismatch, unknown outgoing transfer, RPC inconsistency, stuck
transaction, or suspected key exposure, pause immediately. Pausing blocks new
custodial settlement but does not erase liabilities.

To stop accepting custodial payments, change web to
`AGENTPAY_FEE_MODE=ledger` and recreate web. Keep the payout worker running
until `finance-cli.mjs status` shows no unpaid seller liability. Only then may
the worker be stopped. Rotate a compromised collection wallet by pausing,
paying or migrating every recorded liability under operator review, deploying
a newly generated collection key/address pair, and resuming only after ledger
and on-chain balances reconcile.
