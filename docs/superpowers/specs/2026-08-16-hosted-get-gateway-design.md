# AgentPay Hosted GET Gateway Design

**Date:** 2026-08-16
**Status:** Approved for handoff
**Owner:** AgentPay
**Implementation target:** a new feature branch created from `main`

## Context

AgentPay currently demonstrates a hardened, standards-compatible x402 v2
payment flow for one fixed resource: `GET /api/premium`, priced at `0.01 USDC`
on Base Mainnet. The public resource server uses the official x402 v2 packages,
an internal self-hosted facilitator, and an atomic Redis authorization lock.

The current implementation is materially safer than a quickstart integration,
but onboarding a new seller still requires code and deployment work. The next
product milestone is a hosted gateway that lets a seller turn an existing GET
API into a paid x402 endpoint without installing an SDK, operating a
facilitator, or changing application code.

This design preserves the current `/api/premium` contract as a live demo while
adding a multi-tenant seller control plane and public GET proxy.

## Product Goal

A seller can publish a paid API endpoint in approximately five minutes by
providing only:

1. an account authenticated through GitHub or a passwordless email link;
2. one canonical HTTPS upstream GET URL;
3. one supported upstream credential, if required;
4. a Base payout address;
5. a fixed USDC price per successful request.

AgentPay returns a public URL of the form:

```text
https://agentpay.thebestsites.ru/g/<public-id>
```

The buyer uses an ordinary x402 v2 client. No AgentPay buyer SDK, account, API
key, browser flow, ETH balance, or buyer RPC URL is required.

## Success Criteria

- A new seller can create, test, activate, pause, and inspect a paid GET
  endpoint through the web dashboard.
- The public gateway passes query parameters to one fixed upstream URL.
- A request without payment receives a canonical compact x402 v2 `402`.
- A valid official x402 v2 client can pay and receive the upstream response.
- An upstream request is executed no more than once for a payment
  authorization, including under concurrency.
- Upstream failure does not settle payment.
- A successful upstream response is not released without confirmed settlement.
- Seller payment goes directly to the configured `payTo` wallet.
- AgentPay calculates a 5% commission in its ledger but does not custody or
  automatically deduct seller funds in this version.
- Request bodies, response bodies, payment signatures, upstream secrets, and
  private keys are never stored or logged.
- Existing `/api/premium` responses and payment behavior remain compatible.

## Non-Goals

The first hosted-gateway release does not include:

- HTTP methods other than `GET`;
- wildcard upstream paths;
- request bodies or file uploads;
- WebSockets or server-sent events;
- arbitrary seller-defined request headers;
- custom seller domains;
- dynamic, metered, subscription, `upto`, or batch pricing;
- networks or assets other than official Base Mainnet USDC;
- automatic fee splitting, custody, refunds, or disputes;
- teams, roles, invitations, or organization accounts;
- public Bazaar metadata;
- sensitive medical, financial, identity, or personal-data APIs;
- a self-hosted seller connector or seller SDK.

## Chosen Approach

### Hosted gateway

AgentPay terminates the buyer HTTPS request, enforces x402, calls the seller's
upstream API, settles the payment, and returns the upstream result.

This approach is selected over an SDK or seller-operated sidecar because it is
the only option that requires no seller code or infrastructure. The trade-off
is that AgentPay processes plaintext upstream responses in memory. The first
release is therefore restricted to non-sensitive APIs, and response bodies are
never persisted or logged.

Future releases may add a managed self-hosted connector for sellers whose data
cannot transit AgentPay infrastructure. That connector is not part of this
implementation.

## Seller Experience

### Authentication

- Use Auth.js with PostgreSQL-backed sessions.
- Support GitHub OAuth and passwordless email magic links.
- Do not implement passwords.
- A seller account and a payout address are separate concepts.
- Wallet connection is not required for initial setup.
- Changing `payTo` on an active endpoint requires recent authentication and a
  confirmation notification to the seller's verified email.

If only one authentication provider is configured locally, the configured
provider remains usable. Production must configure GitHub and email.

### Endpoint creation

The form contains:

- display name;
- fixed upstream HTTPS URL;
- upstream authentication mode;
- upstream secret;
- price in USDC;
- Base `payTo` address.

Supported upstream authentication modes are:

1. `Authorization: Bearer <secret>`;
2. `X-API-Key: <secret>`;
3. no authentication, allowed only while the endpoint is a draft.

Arbitrary header names are intentionally unsupported. An endpoint cannot be
activated without upstream authentication because a public upstream URL could
otherwise bypass the AgentPay paywall.

### Activation

Before activation, AgentPay performs a non-paying upstream connectivity test.
The test:

- runs through the same SSRF-safe transport used by the gateway;
- sends the configured upstream credential;
- does not retain the body;
- records only success/failure, HTTP status, response size, and latency;
- succeeds only for an allowed `2xx` response within the configured limits.

After activation, the dashboard displays the immutable public ID and gateway
URL. Pausing an endpoint immediately makes the public route unavailable without
deleting configuration or metrics.

## Public Gateway Contract

### Route

```text
GET /g/<public-id>?<query-string>
```

- `public-id` is at least 128 bits of cryptographically random base64url data.
- It is independent of the seller name and upstream hostname.
- The configured upstream path is fixed.
- All buyer query parameters are forwarded without interpretation, while their
  raw values are excluded from logs and metrics.
- No additional path segments are accepted.

### Incoming headers

The gateway consumes standard x402 headers but never forwards them upstream.
It may forward a syntactically valid `Accept` header. It does not forward
`Authorization`, cookies, `Host`, forwarding headers, payment headers, or
arbitrary buyer headers.

The upstream request uses a fixed AgentPay `User-Agent` and injects only the
seller's configured credential.

### Upstream response

- Treat `200` through `299` as successful resource responses.
- Disable redirects rather than following them.
- Do not settle payment for upstream `3xx`, `4xx`, `5xx`, timeout, network,
  invalid-content, or size-limit failures.
- Do not expose upstream error bodies to buyers.
- Preserve the successful body bytes and a safe `Content-Type`.
- Strip `Set-Cookie`, hop-by-hop, cache-control, CORS, forwarding, server, and
  other non-allowlisted upstream headers.
- Add `Cache-Control: private, no-store` to every gateway response.
- Enforce a 30-second upstream timeout and a 5 MiB response limit.
- Do not retry an upstream request automatically.

The initial safe response-header allowlist is `Content-Type` and, when known
after bounded reading, `Content-Length`. AgentPay generates all other public
headers.

## Payment Flow

The gateway continues to use the official x402 v2 `exact` EVM scheme and the
internal facilitator.

1. Resolve an active endpoint by `public-id`.
2. Construct exact payment requirements from the endpoint's canonical public
   resource URL, price, and `payTo`.
3. If no valid `PAYMENT-SIGNATURE` is present, return a compact `402` with the
   canonical `PAYMENT-REQUIRED` header.
4. Validate version, resource, scheme, network, asset, amount, recipient,
   authorization, payer, and nonce.
5. Atomically acquire the existing Redis fingerprint lock before invoking the
   upstream API.
6. Execute exactly one bounded upstream GET request.
7. If the upstream response is unsuccessful, release the pending lock and do
   not settle payment.
8. If the upstream response is successful, let the official x402 runtime
   settle through the internal facilitator.
9. Release the successful body only when `PAYMENT-RESPONSE` confirms success.
10. Mark the authorization fingerprint consumed.
11. Persist a settlement event best-effort without delaying or suppressing an
    already-paid successful response.

The standard `exact` flow settles after a successful resource handler. This
means an upstream API call may be performed before a settlement that later
fails. The Redis lock prevents duplicate execution, but the seller may still
bear one upstream-call cost for a failed settlement. This trade-off is explicit
for the first release because charging before the upstream call would instead
risk charging buyers for upstream failures.

## Dynamic Payment Policy

Generalize the current fixed premium policy without changing it:

- keep `PREMIUM_PAYMENT_POLICY` and `/api/premium` as compatibility fixtures;
- introduce a validated immutable `PaymentPolicy` value for a resource URL,
  Base USDC atomic amount, display amount, `payTo`, and timeout;
- build gateway policies only from validated database records;
- reuse one initialized `x402ResourceServer` and internal facilitator client;
- avoid an unbounded per-endpoint middleware or server cache;
- keep authorization fingerprint validation policy-driven;
- retain standard x402 headers and official SDK compatibility.

The implementation must use official x402 resource-server APIs for verify and
settle. It must not create a new payment protocol or accept transaction hashes
as credentials.

## SSRF and Network Security

Seller-controlled upstream URLs are hostile input.

### URL policy

- Require an absolute canonical `https://` URL.
- Reject credentials, fragments, non-default schemes, malformed ports, and
  non-canonical serialization.
- Reject localhost names and names ending in `.localhost`, `.local`, or
  internal Docker service names.
- Reject literal and resolved loopback, private, link-local, carrier-grade NAT,
  documentation, benchmark, multicast, reserved, unspecified, and cloud
  metadata IP ranges for both IPv4 and IPv6.
- Disable redirects.

### DNS rebinding protection

Validation followed by ordinary `fetch` is insufficient. The gateway transport
must:

1. resolve all A and AAAA records immediately before connecting;
2. reject the request if any candidate address is forbidden;
3. pin the outbound connection to a validated public address through a custom
   Undici dispatcher or equivalent lookup callback;
4. preserve the original hostname for TLS SNI and certificate validation;
5. never reuse a resolved address across its DNS TTL without revalidation.

Activation tests and paid requests use the same transport implementation.

### Egress

The web gateway requires outbound HTTPS access. The facilitator retains its
separate Base RPC egress. PostgreSQL, Redis, and the facilitator API remain on
the internal Docker network with no published ports.

## Secret Handling

Add an application-only environment variable containing a versioned 32-byte
base64 master key. Use AES-256-GCM with a new random 96-bit IV for each stored
upstream secret.

Store:

- ciphertext;
- IV;
- authentication tag;
- key version.

Never store plaintext secrets, include them in serialized server-component
props, return them from an API, or log caught decryption errors. Decrypt only in
the server process immediately before constructing the upstream request.

The seller UI displays only whether a credential is configured. Editing a
credential replaces it; the existing value can never be retrieved.

## Persistence

Add PostgreSQL to the existing single-server Docker Compose deployment. Redis
remains the short-lived authorization and replay store; PostgreSQL becomes the
durable control-plane and reporting store.

Use Drizzle ORM with PostgreSQL, the Auth.js Drizzle adapter, and committed
Drizzle SQL migrations. Application code uses typed Drizzle queries and
database transactions for endpoint configuration and audit-event updates.

### Core records

#### Seller and authentication records

Use the standard Auth.js user, account, session, and verification-token records.
The first release has one owner per endpoint.

#### `merchant_endpoints`

- internal UUID primary key;
- cryptographically random unique public ID;
- owner user ID;
- display name;
- canonical upstream URL;
- authentication mode;
- encrypted-secret fields and key version;
- checksummed Base payout address;
- USDC amount as an integer atomic-unit string;
- status: `draft`, `active`, or `paused`;
- configuration version;
- created and updated timestamps;
- last connectivity-test status and timestamp.

USDC prices must be positive, exactly representable at six decimals, and
bounded by an application limit. The initial allowed range is `0.000001` to
`1000` USDC per request.

#### `payment_events`

- UUID primary key;
- endpoint ID;
- request ID;
- safe authorization fingerprint, never the raw signature;
- payer address;
- Base transaction hash;
- amount in atomic units;
- calculated AgentPay commission in atomic units;
- upstream status, duration, and bounded response size;
- settlement duration;
- outcome;
- created timestamp.

Successful transaction hash and authorization fingerprint values are unique.
Do not store query strings or response bodies.

#### `audit_events`

Record endpoint creation, activation, pause, price change, payout change, and
credential replacement. Store actor, endpoint, event type, timestamp, and safe
structured metadata only.

## Commission and Metrics

The seller continues to receive 100% of each onchain payment directly. AgentPay
calculates 5% of successfully settled GMV and records it in `payment_events`.
No commission is recorded for a challenge, invalid authorization, in-progress
request, upstream failure, failed settlement, or consumed replay.

The dashboard reports per endpoint and account:

- successful paid requests;
- GMV;
- calculated AgentPay commission;
- unique payer addresses;
- repeated payer addresses;
- upstream success rate;
- settlement success rate;
- median and p95 upstream latency;
- recent safe error categories.

Metrics are derived from durable events. The first release does not implement
automatic invoicing or collection.

If persistence fails after a confirmed payment, return the already-paid
resource rather than converting success into a paid error. Emit a secret-free
reconciliation log containing only request ID, endpoint ID, and transaction
hash. The first release includes an operator reconciliation command that
accepts those identifiers, verifies the Base receipt and transfer, and inserts
the missing idempotent event. Payment delivery must not depend on metrics
availability.

## Dashboard

Add authenticated routes for:

- endpoint list;
- create endpoint;
- endpoint details and metrics;
- edit draft or paused endpoint;
- test connectivity;
- activate or pause;
- replace credential;
- change price or payout with recent-auth confirmation.

The endpoint details page shows:

- public gateway URL with copy action;
- active/draft/paused status;
- price and payout address;
- upstream hostname and path, without credential;
- last connectivity-test result;
- successful request count, GMV, commission, unique payers, and success rates;
- recent safe failures;
- test, pause, and edit actions.

Keep the existing public landing page, docs, free endpoint, and premium demo.
Add a seller-oriented call to action that links to sign-in/dashboard only after
the gateway runtime is functional.

## Public Error Model

Use compact stable JSON bodies and `Cache-Control: private, no-store`:

- `402 payment_required` or canonical invalid-payment response from x402;
- `404 endpoint_not_found` for unknown, draft, or paused public IDs;
- `409 payment_in_progress`;
- `409 payment_consumed`;
- `502 upstream_unavailable` for DNS, connection, TLS, timeout, redirect,
  response-status, or body-limit failures;
- `502 settlement_failed`;
- `503 payment_infrastructure_unavailable`;
- `503 gateway_configuration_unavailable`.

Do not reveal upstream hostnames, IP addresses, response bodies, credentials,
RPC details, Redis details, PostgreSQL details, or internal exception messages.
Every infrastructure error includes a generated `X-Request-ID`.

## Deployment

Production remains one server and one Docker Compose project. Extend the stack
to contain:

1. `web` — public site, dashboard, x402 resource server, and GET gateway;
2. `facilitator` — internal Base exact verifier and settlement service;
3. `redis` — authenticated persistent authorization store;
4. `postgres` — authenticated persistent control-plane database.

Only `web` joins the public Traefik network. PostgreSQL publishes no host port.
Use a pinned PostgreSQL image, persistent volume, healthcheck, read-only
container filesystem where compatible, explicit resource limits, and a
documented backup/restore procedure.

Add production variables for PostgreSQL, Auth.js, GitHub OAuth, email provider,
and secret encryption. Example env files contain only placeholders. Production
verification must reject placeholder secrets, mutable image tags, invalid
origins, public internal-service ports, and missing encryption configuration.

Migrations run as an explicit one-shot deployment step, not automatically in
every web replica startup.

## Backward Compatibility

The following behavior is an invariant:

- `GET /api/basic` remains free;
- `GET /api/premium` keeps its compact unpaid body;
- the premium price remains `0.01` official Base USDC;
- existing premium `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and
  `PAYMENT-RESPONSE` semantics remain standard;
- existing premium replay and fail-closed behavior remains intact;
- facilitator and Redis remain private;
- clean-room TypeScript and Python smoke clients continue to pass.

Gateway changes should generalize existing packages rather than copy payment
logic into a second implementation.

## Testing Strategy

Implementation follows test-driven development.

### Unit tests

- price parsing and atomic conversion;
- endpoint configuration validation;
- secret encryption, replacement, wrong-key, and tamper rejection;
- URL canonicalization;
- IPv4 and IPv6 forbidden-range classification;
- DNS rebinding and pinned lookup behavior;
- safe request-header construction;
- safe response-header filtering;
- timeout and response-size limits;
- commission calculation;
- authorization policy construction;
- stable public error mapping and secret redaction.

### Database tests

- migrations from an empty database;
- owner isolation;
- endpoint status transitions;
- unique public IDs;
- unique successful fingerprints and transaction hashes;
- transactional updates and audit events;
- aggregate metrics.

### Integration tests

- draft connectivity test against a controlled public test upstream;
- unpaid compact 402;
- valid signed request calls upstream exactly once;
- concurrent duplicate authorization calls upstream exactly once;
- upstream `3xx`, `4xx`, `5xx`, timeout, invalid DNS, and oversize response do
  not settle;
- successful settlement returns the upstream body and standard response header;
- event persistence failure does not suppress an already-paid response;
- paused and unknown endpoints are indistinguishable publicly;
- no upstream secrets or response bodies appear in logs.

Use local deterministic test servers and injected DNS/transport dependencies.
Automated tests must not broadcast Base Mainnet transactions.

### Browser tests

- GitHub/email authentication boundary through test providers;
- create draft;
- configure Bearer and X-API-Key modes;
- test connectivity;
- activate;
- copy gateway URL;
- view metrics;
- pause;
- replace credential;
- cross-user access is denied.

### Production verification

- existing premium verifier remains green;
- PostgreSQL is healthy and internal;
- migration state matches the release;
- seller gateway configuration fails closed when dependencies are unavailable;
- only web is publicly routed;
- application and database images are immutable;
- no secret is printed by verification output.

## Git and Delivery Strategy

- Start from a clean current `main`.
- Create `feat/hosted-get-gateway`; do not implement directly on `main` or
  `dev`.
- Commit the implementation in small, reviewable units.
- Keep database migrations in the same commit as the model change they support.
- Never commit `.env`, private keys, RPC credentials, OAuth secrets, email
  credentials, database passwords, encryption keys, or generated production
  data.
- Do not add local roadmaps or Obsidian notes to git.
- Do not rewrite or delete unrelated user changes.
- Run focused tests before each commit and the full verification suite before
  requesting merge.
- Do not push, merge, deploy, or execute a Mainnet payment without explicit
  user direction.

Suggested commit sequence:

1. database and migration foundation;
2. Auth.js seller authentication;
3. encrypted upstream credentials;
4. endpoint configuration and dashboard CRUD;
5. SSRF-safe bounded GET transport;
6. dynamic policy and multi-tenant x402 gateway;
7. payment events, commission, and metrics;
8. production Compose and migration tooling;
9. browser, compatibility, and production verification;
10. documentation and operational runbook.

## Acceptance Gate

The feature is ready for review only when:

- all success criteria in this document are demonstrated by tests;
- the full unit, integration, typecheck, lint, build, and Playwright suites pass;
- existing clean-room x402 preview checks pass without spending funds;
- a seller can activate a GET endpoint without editing code;
- an official x402 client can pay the gateway in a controlled test;
- concurrency cannot execute the upstream more than once;
- no tested failure charges a buyer and withholds a successful resource except
  the documented ambiguous-settlement condition;
- no secret or paid body appears in application logs;
- the feature branch is clean and contains only intentional commits.
