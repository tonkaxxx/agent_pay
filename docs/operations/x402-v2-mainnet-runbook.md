# AgentPay x402 v2 Mainnet Operations Runbook

This runbook operates the `dev` implementation of AgentPay on Base Mainnet.
It handles real USDC. Run commands from `web/` unless a command says otherwise.

## Production topology

One Compose project runs three containers:

- `web` is the only public service. Traefik exposes it at
  `https://agentpay.thebestsites.ru` through the external `web-net` network.
- `facilitator` verifies and settles standard x402 v2 `exact` authorizations.
  It has no published port. Its `egress` network is used only for Base RPC.
- `redis` serializes signed authorizations and records their consumed state. It
  has no published port and persists an authenticated AOF volume.

The facilitator private key is a dedicated, low-balance gas wallet. It is not
the seller payout wallet and never receives buyer keys. A buyer private key is
used only in the buyer's agent process.

## Secret handling

Treat any private key or credential pasted into chat, a prompt, a command line,
shell history, logs, or issue text as compromised. Never fund or reuse it.
Rotate the previously shared buyer key and any legacy provider credentials that
were present in old local environment files.

Keep `web/.env.production` untracked and mode `0600`:

```sh
cd /home/worker/repos/vibe/agentpay/web
umask 077
cp .env.production.example .env.production
chmod 0600 .env.production
```

Populate it without printing values. Use a secret editor or deployment secret
store, not a chat message or a command containing a literal key. Required
values are:

```dotenv
AGENTPAY_IMAGE=agentpay:<full-40-character-dev-commit>
NEXT_PUBLIC_SITE_URL=https://agentpay.thebestsites.ru/
AGENTPAY_PAY_TO=<checksummed-seller-address>
BASE_MAINNET_RPC_URL=<private-or-rate-limited-Base-Mainnet-RPC-URL>
FACILITATOR_PRIVATE_KEY=<new-dedicated-gas-wallet-private-key>
REDIS_PASSWORD=<at-least-32-random-hex-characters>
```

Do not add `AGENT_PRIVATE_KEY` to the server. Do not put the facilitator key in
the `web` container. Use only hexadecimal characters for `REDIS_PASSWORD`, so
it is safe inside the Redis URL.

Record only the facilitator public address in the operations inventory. Fund
it with the minimum operational amount of ETH on Base and alert on its balance.
The seller address should be a separate wallet. Confirm the RPC chain before
deployment:

```sh
curl -fsS -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' \
  "$BASE_MAINNET_RPC_URL"
```

The result must be `0x2105` (chain ID 8453). Avoid this shell check if expanding
the RPC URL would expose a credential through process inspection; use the
provider dashboard or an isolated secret-aware check instead.

## Release and deploy

1. Confirm that the release is an exact commit on `dev`, the worktree is clean,
   and all verification commands pass:

   ```sh
   git switch dev
   git status --short
   corepack pnpm test
   corepack pnpm typecheck
   corepack pnpm lint
   corepack pnpm build
   corepack pnpm --dir web test:e2e
   ```

2. Back up the current Compose file and secret file to an operator-only directory.
   Do not print or diff the environment file:

   ```sh
   install -d -m 0700 ../agentpay-deploy-backups
   cp -p docker-compose.production.yml ../agentpay-deploy-backups/
   cp -p .env.production ../agentpay-deploy-backups/
   chmod 0600 ../agentpay-deploy-backups/.env.production
   ```

   Give each backup directory a timestamp in normal operations so releases do
   not overwrite each other.

3. Build the application image from the exact commit. Set `AGENTPAY_IMAGE` in
   `.env.production` to `agentpay:<full commit SHA>`; mutable tags such as
   `latest` are rejected.

   ```sh
   docker build --pull -t agentpay:<full-40-character-dev-commit> .
   docker image inspect agentpay:<full-40-character-dev-commit>
   ```

4. Ensure the existing Traefik network is present, then validate the resolved
   Compose model without printing it:

   ```sh
   docker network inspect web-net >/dev/null
   docker compose --env-file .env.production \
     -f docker-compose.production.yml config --quiet
   ```

5. Start the immutable release. Compose waits for Redis and facilitator health
   before starting `web`:

   ```sh
   docker compose --env-file .env.production \
     -f docker-compose.production.yml up -d
   ```

6. Run the production verifier. It checks container health, identical web and
   facilitator image IDs, private network policy, Base-only facilitator support,
   and the exact compact public `402` contract:

   ```sh
   node scripts/verify-production.mjs \
     --base-url https://agentpay.thebestsites.ru \
     --compose-file docker-compose.production.yml \
     --env-file .env.production
   ```

7. Inspect only lifecycle and health output. Never enable request-header or
   request-body logging on the payment route:

   ```sh
   docker compose --env-file .env.production \
     -f docker-compose.production.yml ps
   docker compose --env-file .env.production \
     -f docker-compose.production.yml logs --since=10m --no-log-prefix
   ```

Logs must not contain `PAYMENT-SIGNATURE`, authorization payloads, private
keys, RPC URLs, Redis URLs, premium bodies, or environment dumps.

## Public and paid smoke tests

The no-spend preview validates the production challenge using the official
x402 v2 packages:

```sh
cd /home/worker/repos/vibe/agentpay
corepack pnpm smoke:preview
```

It must report one Base Mainnet option for exactly `0.01` official USDC and
then `PAYMENT NOT SENT`. Plain curl must receive a compact body and a standard
`PAYMENT-REQUIRED` header; it must never receive premium data.

For the one-time paid smoke, create a new low-balance payer wallet outside the
server. Fund it only with slightly more than `0.01` official Base USDC. The
facilitator pays gas, so the payer does not need ETH. Supply the payer key to
the isolated smoke process without putting the value into a command or shell
history, then explicitly enable spending:

```sh
read -rsp 'Temporary payer private key: ' AGENT_PRIVATE_KEY
export AGENT_PRIVATE_KEY
export ALLOW_MAINNET_PAYMENTS=true
corepack pnpm smoke:mainnet
unset AGENT_PRIVATE_KEY ALLOW_MAINNET_PAYMENTS
```

Verify all of the following:

- HTTP `200` contains premium data only after settlement;
- `PAYMENT-RESPONSE` decodes to `success: true` and a Base transaction;
- the seller's USDC balance increased by `10000` atomic units;
- facilitator ETH decreased only by settlement gas; and
- replaying the exact same signed authorization returns
  `payment_consumed` and no premium body.

Never run the paid command from CI or a funded general-purpose wallet.

## Ambiguous settlement and retry policy

A timeout can occur after the facilitator submits a transaction but before the
resource server receives its receipt. In that state, do not retry the same
signature, do not issue a public transaction-hash bypass, and do not manually
mark the request successful.

1. Preserve the incident time and generated request ID, but never copy the raw
   payment header into a ticket.
2. Check Base RPC and the facilitator gas-wallet activity around that time.
3. Reconcile the USDC `transferWithAuthorization` transaction and receipt.
4. Confirm the EIP-3009 nonce state and seller balance before deciding whether
   payment settled.
5. If settlement succeeded but the response was lost, the original signature
   remains consumed. The buyer must create a fresh authorization and pay again;
   handle any refund manually according to the business policy.
6. If no transaction was submitted and the onchain authorization remains
   unused, wait for the Redis pending lease to expire before a fresh attempt.

Fail closed whenever onchain state is uncertain. A transaction hash is public
evidence, not authorization to release premium data.

## Redis backup and recovery

Redis AOF is persisted in the Docker volume `agentpay-redis-data` with
`appendfsync everysec`. Back up that volume with the stack stopped or through a
storage-level snapshot that guarantees a consistent filesystem image. Do not
copy changing AOF files individually.

Before a planned cold snapshot:

```sh
docker compose --env-file .env.production \
  -f docker-compose.production.yml stop web facilitator redis
```

Snapshot `/var/lib/docker/volumes/agentpay-redis-data/_data` with the server's
approved backup system, encrypt the backup, restrict it to operators, and then
restart the stack. Restore only while Redis is stopped and only after preserving
the current volume. Validate AOF startup and run the production verifier after
recovery.

Redis state is defense in depth; Base USDC EIP-3009 nonce state remains the
authoritative settlement barrier. Losing Redis can temporarily weaken
concurrency protection, so take the API out of service during recovery rather
than starting with an empty store.

## Wallet and credential rotation

For a planned facilitator gas-wallet rotation:

1. stop public payment traffic;
2. confirm no payment is `pending` and reconcile recent transactions;
3. create a new dedicated wallet through an approved secret channel;
4. fund it minimally with Base ETH and confirm chain ID 8453;
5. update only `FACILITATOR_PRIVATE_KEY` in `.env.production`;
6. recreate `facilitator`, then run the complete production verifier; and
7. sweep remaining ETH from the old wallet and retire its key.

If any buyer key is disclosed, consider it permanently compromised: move all
assets to a newly generated wallet immediately and do not use the old key for a
test. If the facilitator key is disclosed, stop payment traffic first, rotate
it, sweep its gas balance, inspect recent Base activity, and redeploy. Rotate
RPC or legacy provider credentials through their provider dashboards.

## Rollback

Rollback uses the recorded immutable image and the matching backed-up Compose
and environment files. Never roll back only one of `web` or `facilitator`.

1. stop public payment traffic and reconcile any ambiguous settlements;
2. preserve the current Compose, env, and Redis volume before changing them;
3. restore the previous Compose and mode-`0600` env file;
4. start the previous exact image; and
5. run that release's health and public-contract checks.

Do not delete or reset the Redis volume during rollback. The v2 authorization
keys expire, are namespaced, and are harmless to a version that does not read
them. If rollback changes the public protocol, invalidate any outstanding
payment challenge and communicate the change before accepting traffic again.

## Incident stop conditions

Disable the premium route or roll back if any of these occurs:

- premium data appears in an unpaid or error response;
- the facilitator or Redis becomes publicly reachable;
- the challenge advertises a network, asset, recipient, or amount outside the
  approved policy;
- settlement succeeds without a standard `PAYMENT-RESPONSE`;
- the same authorization releases premium data more than once;
- logs contain a raw signature, key, credential, or premium body; or
- RPC chain ID differs from 8453.
