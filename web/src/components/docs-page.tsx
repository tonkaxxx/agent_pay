import {
  ArrowLeft,
  ArrowUpRight,
  Bot,
  CircleX,
  Code2,
  Package,
  ServerCog,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";

import { CodeBlock } from "./code-block";

const installCommand = `pnpm add @agentpay/server @x402/core @x402/evm`;

const middlewareExample = `import express from "express";
import {
  HTTPFacilitatorClient,
  createAgentPayResourceServer,
  createAgentPayRoute,
  paymentMiddleware,
} from "@agentpay/server";

const facilitator = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator",
});
const server = createAgentPayResourceServer({
  facilitator,
  networks: ["eip155:84532"],
});
const route = createAgentPayRoute({
  network: "eip155:84532",
  priceUsdc: "0.01",
  payTo: "0x1111111111111111111111111111111111111111",
  description: "Premium data",
  paymentIdentifier: "optional",
  discovery: { outputExample: { data: "premium" } },
});

const app = express();
app.get(
  "/api/data",
  paymentMiddleware({ "GET /api/data": route }, server),
  (_request, response) => response.json({ data: "premium" }),
);`;

const paymentRequired = `HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: <base64-encoded JSON>

// Decoded header
{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:84532",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "amount": "10000",
    "payTo": "0x1111111111111111111111111111111111111111"
  }],
  "extensions": {
    "payment-identifier": { "info": { "required": false } },
    "bazaar": { "info": { "output": { "example": { "data": "premium" } } } }
  }
}`;

const paidRequest = `curl -i 'http://127.0.0.1:3000/api/data' \\
  -H 'PAYMENT-SIGNATURE: <base64-encoded-x402-v2-payload>'

# Successful settlement returns:
# PAYMENT-RESPONSE: <base64-encoded-settlement>`;

const agentExample = `import { createAgentFetch } from "@agentpay/client";
import { privateKeyToAccount } from "viem/accounts";

const agentFetch = createAgentFetch({
  signer: privateKeyToAccount(process.env.AGENT_PRIVATE_KEY),
  networks: ["eip155:84532"],
  maxPaymentUsdc: "0.10",
  authorizePayment: payment =>
    new URL(payment.requestUrl).origin === "https://vendor.example",
  onPaymentEvent: event => console.log(event.type),
});

const response = await agentFetch("https://vendor.example/api/data");`;

const statuses = [
  ["402", "Payment required", "Read PAYMENT-REQUIRED, apply policy, then sign one accepted option."],
  ["200", "Settled", "Read PAYMENT-RESPONSE and consume the protected resource."],
  ["409", "Identifier conflict", "Generate a new Payment Identifier; the old ID belongs to another payload."],
  ["425", "Payment in progress", "Wait for Retry-After, then retry the same signed request."],
  ["502", "Facilitator unavailable", "Retry according to application policy; no local receipt guessing is used."],
] as const;

export function DocsPage() {
  return (
    <div className="docs-shell">
      <header className="docs-header">
        <Link className="wordmark" href="/" aria-label="AgentPay home">
          <span className="wordmark-mark">A</span> AgentPay
        </Link>
        <span className="docs-header-label">Developer docs · v0.2 · x402 v2</span>
        <a href="https://github.com/tonkaxxx/agent_pay" target="_blank" rel="noreferrer">
          View source on GitHub <ArrowUpRight aria-hidden="true" />
        </a>
      </header>

      <div className="docs-layout">
        <aside className="docs-sidebar">
          <Link href="/"><ArrowLeft aria-hidden="true" /> Back to overview</Link>
          <nav aria-label="Documentation sections">
            <a href="#quickstart">Quickstart</a>
            <a href="#install">Install</a>
            <a href="#middleware">Guard a route</a>
            <a href="#contract">The v2 contract</a>
            <a href="#status">Status codes</a>
            <a href="#agent">Pay with your agent</a>
          </nav>
        </aside>

        <main className="docs-main">
          <section className="docs-hero" id="quickstart">
            <div className="section-kicker">AgentPay quickstart</div>
            <h1 aria-label="Add an x402 v2 payment gate to any route.">Add an x402 v2 payment gate<br /><em>to any route.</em></h1>
            <p>
              AgentPay configures the official x402 v2 resource server and transport middleware,
              then adds the layer production agents need: spend policy, security boundaries,
              payment events, Payment Identifier idempotency, and Bazaar discovery.
            </p>
          </section>

          <section className="docs-section" id="install">
            <div className="docs-section-number">01</div>
            <div className="docs-section-content">
              <div className="docs-icon"><Package aria-hidden="true" /></div>
              <h2>Install AgentPay and x402 v2</h2>
              <p><code>@agentpay/server</code> composes the official x402 core, EVM exact scheme, and framework adapter.</p>
              <CodeBlock label="Terminal" code={installCommand} />
            </div>
          </section>

          <section className="docs-section" id="middleware">
            <div className="docs-section-number">02</div>
            <div className="docs-section-content">
              <div className="docs-icon"><Code2 aria-hidden="true" /></div>
              <h2>Guard a route with exact USDC</h2>
              <p>
                Register only the CAIP-2 networks you accept. AgentPay resolves the official USDC
                asset, declares Payment Identifier and Bazaar extensions, and delegates verification
                and settlement to the configured facilitator.
              </p>
              <CodeBlock label="TypeScript" code={middlewareExample} />
            </div>
          </section>

          <section className="docs-section" id="contract">
            <div className="docs-section-number">03</div>
            <div className="docs-section-content">
              <div className="docs-icon"><CircleX aria-hidden="true" /></div>
              <h2>The standard x402 v2 contract</h2>
              <p>
                The first response carries payment terms in <code>PAYMENT-REQUIRED</code>. The client
                signs an EIP-3009 authorization and retries with <code>PAYMENT-SIGNATURE</code>. A
                successful server response carries the facilitator result in <code>PAYMENT-RESPONSE</code>.
              </p>
              <CodeBlock label="Decoded 402 header" code={paymentRequired} />
              <h3>Paid request</h3>
              <CodeBlock label="Terminal" code={paidRequest} />
            </div>
          </section>

          <section className="docs-section" id="status">
            <div className="docs-section-number">04</div>
            <div className="docs-section-content">
              <div className="docs-icon"><ServerCog aria-hidden="true" /></div>
              <h2>Status codes</h2>
              <p>The payment and idempotency contract exposed by an AgentPay-protected route.</p>
              <div className="docs-table-wrap">
                <table>
                  <thead><tr><th>Status</th><th>Meaning</th><th>Client action</th></tr></thead>
                  <tbody>
                    {statuses.map(([status, meaning, action]) => (
                      <tr key={status}><td>{status}</td><td>{meaning}</td><td>{action}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="docs-footnote">
                Redis idempotency stores a SHA-256 signature fingerprint and sanitized response,
                never the raw <code>PAYMENT-SIGNATURE</code>. Completed retries receive the original
                response and settlement header.
              </p>
            </div>
          </section>

          <section className="docs-section" id="agent">
            <div className="docs-section-number">05</div>
            <div className="docs-section-content">
              <div className="docs-icon"><Bot aria-hidden="true" /></div>
              <h2>Pay with a policy-controlled agent</h2>
              <p>
                AgentPay takes a <code>ClientEvmSigner</code>; the SDK does not require a raw key or
                RPC URL. Keep keys in your wallet boundary, allowlist vendors, set a mandatory cap,
                and send <code>onPaymentEvent</code> events to your audit pipeline.
              </p>
              <CodeBlock label="TypeScript" code={agentExample} />
              <div className="docs-warning docs-warning--danger">
                <ShieldAlert aria-hidden="true" />
                <div>
                  <strong>REAL FUNDS · BASE MAINNET</strong>
                  <span>The local mainnet demo additionally requires both --execute and ALLOW_MAINNET_PAYMENTS=true.</span>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
