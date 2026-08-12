# Local and Production Compose Split Design

**Date:** 2026-08-13
**Status:** Approved

## Context

`web/docker-compose.yml` currently describes only the hardened production
deployment. It deliberately requires `AGENTPAY_IMAGE`, a public HTTPS origin,
the production recipient, CDP credentials, a Redis password, and the external
Traefik network `web-net`. Docker Compose loads `.env` automatically, not
`.env.local`, so the ordinary local command fails during interpolation before
it can stop or start any services:

```text
docker compose down && docker compose up -d
error while interpolating services.web.image: required variable AGENTPAY_IMAGE is missing
```

The production constraints are correct, but making them the default local
Compose model breaks the expected developer workflow. Local and production
deployments need separate entry points while continuing to use the same
application code and x402 v2 behavior.

## Goals

- Make `docker compose down && docker compose up -d` work from `web/` with the
  existing local `.env.local` file.
- Build and run the checked-out AgentPay source in development mode on
  `http://localhost:3000`.
- Start a private, persistent local Redis service automatically.
- Keep the hardened single-server production topology as an explicit Compose
  file.
- Deploy the newest verified immutable AgentPay image to the existing server.
- Keep the legacy-visible concise unpaid `402` body while retaining x402 v2 in
  the `PAYMENT-REQUIRED` header and payment path.
- Never commit secrets or inject the buyer/agent private key into the seller web
  runtime.

## Non-goals

- Changing the public payment quote, price, recipient, network, or x402
  protocol behavior.
- Adding a private facilitator or a second production server.
- Publishing Redis to the host or Internet in production.
- Moving production secrets into source control.
- Executing a real Base Mainnet payment from the production seller container.

## Selected Structure

### Local default

`web/docker-compose.yml` becomes the default developer Compose file. It:

- builds the repository with `web/Dockerfile` using a development-capable
  stage;
- starts Next.js on `0.0.0.0:3000` and publishes port `3000` to localhost;
- loads `web/.env.local` because that is the existing local configuration
  contract;
- overrides `REDIS_URL` to address the Compose service at `redis:6379`;
- explicitly removes `AGENT_PRIVATE_KEY` and the buyer RPC URL from the web
  container environment;
- forces development and non-execution safety gates;
- waits for a healthy Redis service;
- persists Redis data in a named volume without publishing a Redis port.

This model intentionally does not require an immutable remote image, production
Redis password, public HTTPS URL, or external `web-net` network. Those are
production concerns and should not prevent a local checkout from starting.

### Production explicit file

The current hardened model moves without weakening to
`web/docker-compose.production.yml`. It remains a single Compose project with:

- an immutable full-Git-SHA AgentPay image;
- production-only configuration validation;
- read-only web and Redis filesystems with narrowly scoped writable storage;
- dropped capabilities and `no-new-privileges`;
- authenticated AOF Redis on an internal network and persistent named volume;
- the external `web-net` connection used by Traefik;
- no published application or Redis host ports;
- no buyer private key, buyer RPC URL, or quote-only flag in the web service.

Production commands always select this file explicitly and load the protected
production env file. The file may still be copied to the server under the
operational name `docker-compose.yml`; its semantics remain the explicit
production model.

## Production Deployment

The existing host at `worker@192.168.88.44` and project directory
`/home/worker/repos/vibe/agentpay` remain the only deployment target. The
deployment will:

1. verify the repository and Compose changes locally;
2. build and push a new immutable application image tagged with the verified
   full Git SHA;
3. retain the current production Compose and protected env file as a timestamped
   rollback backup on the server;
4. install the new production Compose definition without exposing secret
   values;
5. render and validate the remote Compose model;
6. pull and start the new image with authenticated Redis in the same Compose
   project;
7. wait for healthchecks and roll back if the new release is unhealthy;
8. verify the public homepage and both surfaces of `/api/premium`.

The public verification checks that the JSON body is the concise legacy quote
and contains no premium payload, while the preserved `PAYMENT-REQUIRED` header
decodes to x402 v2 exact payment terms for Base Mainnet, native USDC, `$0.01`,
the configured production recipient, and required Payment Identifier.

## Tests and Documentation

Compose tests are split by intent:

- local tests render the default file with a temporary non-secret `.env.local`
  fixture and assert the source build, port, Redis dependency, safety overrides,
  and absence of an external production network;
- production tests render `docker-compose.production.yml` with fixture values
  and retain all existing hardening assertions.

Documentation names the local zero-configuration command separately from the
explicit production command. Verification includes Compose rendering, focused
tests, type checking, linting, a production application build, the literal
local start command, local HTTP smoke checks, remote container health, and
public HTTPS/x402 smoke checks.

## Rollback and Secret Handling

No `.env.local` or production env file is committed. Command output used for
verification must not print secret-bearing environment blocks. The server keeps
the immediately previous immutable image reference plus timestamped Compose and
env backups. If remote health or public smoke checks fail, the deployment
restores the prior Compose/env pair and prior immutable image, then re-runs the
health checks.
