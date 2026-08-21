# AgentPay documentation

This index separates current production documentation from historical design
records. If documents disagree, use the source-of-truth order below.

## Current documentation

1. [`../README.md`](../README.md) — product overview, architecture, and local
   development
2. [`operations/x402-v2-mainnet-runbook.md`](operations/x402-v2-mainnet-runbook.md)
   — authoritative Base Mainnet deployment and incident runbook
3. [`operations/hosted-get-gateway-runbook.md`](operations/hosted-get-gateway-runbook.md)
   — hosted seller API operations, health checks, and recovery
4. [`operations/custodial-commission-runbook.md`](operations/custodial-commission-runbook.md)
   — 95/5 accounting, collection-wallet security, and seller payouts
5. [`../web/README.md`](../web/README.md) — web application configuration and
   deployment details
6. Public product documentation at [`/docs`](https://agentpay.thebestsites.ru/docs)

The public `/docs` page is implemented in
`web/src/components/docs-page.tsx`. Update it whenever the public payment or
seller contract changes.

## Current production summary

- network: Base Mainnet (`eip155:8453`)
- protocol: x402 v2
- hosted route: `GET /g/<publicId>`
- hosted payment split: 95% seller liability and 5% AgentPay commission
- collection wallet: `0x7C04bf9fFd46EAeF9101F4aC558C13fb569923E6`
- treasury wallet: `0x748BB9bDA321B434DA83F402Cc8152eD23668a9a`
- seller payout eligibility: `1 USDC` net or seven days
- automatic payout preparation window: after `03:00 UTC`, plus an explicit
  operator-triggered cycle
- incoming and outgoing finality: two Base confirmations
- emergency collection-wallet gas floor: `0.0001 ETH`

The demo route `GET /api/premium` is a separate direct-settlement example. It
does not use the hosted 95/5 payout pipeline.

## Historical design records

Files under `superpowers/specs/` and `superpowers/plans/` are dated design and
implementation records. They intentionally preserve the decisions and
assumptions that existed when the work was planned. They are useful for context,
but they are not current operational guidance and should not override the
runbooks above.

When a production behavior changes, update the current runbooks, root and web
READMEs, `CLAUDE.md`, this index, and the public `/docs` page in the same change.
