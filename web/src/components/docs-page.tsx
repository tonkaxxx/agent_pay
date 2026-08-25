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

const installCommand = `pnpm add @x402/core@2.22.0 @x402/evm@2.22.0 @x402/fetch@2.22.0 viem`;

const clientExample = `import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

const signer = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);
const client = new x402Client();
client.register("eip155:*", new ExactEvmScheme(signer));

const paidFetch = wrapFetchWithPayment(fetch, client);
const response = await paidFetch(
  "https://agentpay.thebestsites.ru/api/premium",
);

console.log(await response.json());`;

const paymentRequired = `HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: <base64-encoded-x402-v2-terms>
content-type: application/json

{
  "error": "Payment Required",
  "x402Version": 2,
  "priceUsdc": "0.01",
  "network": "eip155:8453"
}`;

const protocolHeaders = `PAYMENT-REQUIRED   server → agent   price and resource terms
PAYMENT-SIGNATURE  agent → server   signed EIP-3009 authorization
PAYMENT-RESPONSE   server → agent   confirmed settlement result`;

const agentPrompt = `here is crypto wallet private key:
AGENT_PRIVATE_KEY=<YOUR_NEW_LOW_BALANCE_PRIVATE_KEY>

Fetch data from the following API endpoint:
https://agentpay.thebestsites.ru/api/premium`;

const hostedGateway = `Upstream       https://your-api.example/data
Public route   https://agentpay.thebestsites.ru/g/<publicId>
Method         GET
Payment        x402 v2 exact · Base USDC`;

const statuses = [
  ["402", "Payment required", "Read PAYMENT-REQUIRED, apply wallet policy, then sign once."],
  ["200", "Settled", "Read the resource and decode PAYMENT-RESPONSE."],
  ["409", "Authorization consumed", "Create a fresh request; no paid body is replayed."],
  ["502", "Settlement failed", "No resource was released; inspect the settlement result."],
  ["503", "Infrastructure unavailable", "Retry later without assuming payment succeeded."],
] as const;

export function DocsPage() {
  return (
    <div className="docs-shell">
      <header className="docs-header">
        <Link className="wordmark" href="/" aria-label="AgentPay home">
          <span className="wordmark-mark">A</span> AgentPay
        </Link>
        <span className="docs-header-label">Developer docs · x402 v2</span>
        <a href="https://github.com/tonkaxxx/agent_pay" target="_blank" rel="noreferrer">
          View source on GitHub <ArrowUpRight aria-hidden="true" />
        </a>
      </header>

      <div className="docs-layout">
        <aside className="docs-sidebar">
          <Link href="/"><ArrowLeft aria-hidden="true" /> Back to overview</Link>
          <nav aria-label="Documentation sections">
            <a href="#quickstart">Quickstart</a>
            <a href="#install">Official client</a>
            <a href="#client">Fetch the resource</a>
            <a href="#contract">Protocol contract</a>
            <a href="#status">Status codes</a>
            <a href="#agent">Pay with an agent</a>
            <a href="#seller">Sell a GET API</a>
          </nav>
        </aside>

        <main className="docs-main">
          <section className="docs-hero" id="quickstart">
            <div className="section-kicker">AgentPay quickstart</div>
            <h1 aria-label="Standard x402 payments from any capable agent.">
              Standard x402 payments<br /><em>from any capable agent.</em>
            </h1>
            <p>
              AgentPay exposes an ordinary x402 v2 resource on Base Mainnet. A compatible client
              reads the standard quote, signs an exact 0.01 USDC authorization, and receives the
              resource only after the server verifies and settles it.
            </p>
          </section>

          <section className="docs-section" id="install">
            <div className="docs-section-number">01</div>
            <div className="docs-section-content">
              <div className="docs-icon"><Package aria-hidden="true" /></div>
              <h2>Use the official x402 client</h2>
              <p>
                No AgentPay buyer SDK is required. The official x402 client creates a gasless
                EIP-3009 USDC authorization; the buyer needs USDC but no buyer RPC or ETH.
              </p>
              <CodeBlock label="Terminal" code={installCommand} />
            </div>
          </section>

          <section className="docs-section" id="client">
            <div className="docs-section-number">02</div>
            <div className="docs-section-content">
              <div className="docs-icon"><Code2 aria-hidden="true" /></div>
              <h2>Fetch the protected resource</h2>
              <p>
                Register the official <code>exact</code> EVM scheme and wrap standard
                <code>fetch</code>. Apply your own origin, asset, recipient and maximum-spend
                policy before allowing an autonomous agent to sign.
              </p>
              <CodeBlock label="TypeScript" code={clientExample} />
            </div>
          </section>

          <section className="docs-section" id="contract">
            <div className="docs-section-number">03</div>
            <div className="docs-section-content">
              <div className="docs-icon"><CircleX aria-hidden="true" /></div>
              <h2>The standard HTTP contract</h2>
              <p>
                The JSON body stays intentionally compact. Machine-readable resource, asset,
                recipient, amount and timeout terms travel in the canonical header.
              </p>
              <CodeBlock label="Unpaid response" code={paymentRequired} />
              <h3>Three standard headers</h3>
              <CodeBlock label="x402 v2" code={protocolHeaders} />
              <p className="docs-footnote">
                AgentPay runs a self-hosted facilitator on the same server. Its dedicated
                gas sponsor submits the USDC authorization on Base; it cannot change the signed
                amount or recipient.
              </p>
            </div>
          </section>

          <section className="docs-section" id="status">
            <div className="docs-section-number">04</div>
            <div className="docs-section-content">
              <div className="docs-icon"><ServerCog aria-hidden="true" /></div>
              <h2>Status codes</h2>
              <p>The public, fail-closed response contract for the protected route.</p>
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
                Authorization state is locked in Redis across verify, handler execution and
                settlement. Consumed signatures never act as public bearer tokens, and AgentPay
                never caches or replays the paid response body.
              </p>
            </div>
          </section>

          <section className="docs-section" id="agent">
            <div className="docs-section-number">05</div>
            <div className="docs-section-content">
              <div className="docs-icon"><Bot aria-hidden="true" /></div>
              <h2>Pay with any capable agent</h2>
              <p>
                The prompt is enough for an agent that can execute code and make outbound HTTPS requests,
                using an installed or temporary x402 client. A text-only agent cannot access a wallet
                or perform the payment by itself.
              </p>
              <CodeBlock label="Agent prompt" code={agentPrompt} />
              <div className="docs-warning docs-warning--danger">
                <ShieldAlert aria-hidden="true" />
                <div>
                  <strong>REAL FUNDS · BASE MAINNET</strong>
                  <span>Use a new dedicated low-balance wallet. Never paste a primary or previously shared key.</span>
                </div>
              </div>
            </div>
          </section>

          <section className="docs-section" id="seller">
            <div className="docs-section-number">06</div>
            <div className="docs-section-content">
              <div className="docs-icon"><Package aria-hidden="true" /></div>
              <h2>Sell an existing GET API</h2>
              <p>
                Sign in, paste one existing HTTPS GET upstream, choose Bearer or{" "}
                <code>X-API-Key</code> authentication, set a fixed USDC price and seller payout
                address, test connectivity, and activate. AgentPay returns a public
                <code>/g/&lt;publicId&gt;</code> URL that any standard x402 v2 client can call.
              </p>
              <CodeBlock label="Hosted gateway" code={hostedGateway} />
              <p>
                <Link href="/dashboard">Open seller dashboard</Link>. Upstream credentials stay
                encrypted and are never returned by the dashboard or exposed in the unpaid 402.
              </p>
            </div>
          </section>

        </main>
      </div>
    </div>
  );
}
