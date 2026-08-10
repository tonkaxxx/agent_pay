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

const installCommand = `pnpm add @x402/server`;

const middlewareExample = `import { paymentMiddleware } from "@x402/server";
import express from "express";

const app = express();

app.get(
  "/api/data",
  paymentMiddleware({
    priceUsdc: "0.01",                          // 1 US cent
    payTo: "0x1111111111111111111111111111111111111111", // your wallet
    chainId: 84532,                             // Base Sepolia
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL!,
  }),
  (_request, response) => {
    response.json({ data: "Here is your premium data" });
  },
);

app.listen(3000);`;

const paymentRequired = `HTTP/1.1 402 Payment Required
content-type: application/json

{
  "error": "Payment Required",
  "priceUsdc": "0.01",
  "payTo": "0x1111111111111111111111111111111111111111",
  "network": "base-sepolia",
  "chainId": 84532
}`;

const paidRequest = `curl -i $'http://127.0.0.1:3000/api/data' \\
  -H 'X-Payment-Tx: 0x<receipt-transaction-hash>'`;

const agentPrompt = `here is crypto wallet private key: 
[INSERT_PRIVATE_KEY]

Fetch data from the following API endpoint: https://agentpay.thebestsites.ru/api/premium `;

const statuses = [
  ["402", "Payment required", "No X-Payment-Tx header; exact price, chain, and recipient are returned."],
  ["200", "Paid", "Receipt verified and the transaction hash is claimed exactly once."],
  ["403", "Invalid payment", "Malformed, failed, insufficient, or already-used transaction."],
  ["503", "Retry safely", "Receipt, confirmations, or RPC temporarily unavailable."],
] as const;

export function DocsPage() {
  return (
    <div className="docs-shell">
      <header className="docs-header">
        <Link className="wordmark" href="/" aria-label="AgentPay home">
          <span className="wordmark-mark">A</span> AgentPay
        </Link>
        <span className="docs-header-label">Developer docs · v0.1</span>
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
            <a href="#contract">The 402 requirement</a>
            <a href="#status">Status codes</a>
            <a href="#agent">Pay with your agent</a>
          </nav>
        </aside>

        <main className="docs-main">
          <section className="docs-hero" id="quickstart">
            <div className="section-kicker">AgentPay quickstart</div>
            <h1 aria-label="Add a 402 payment gate to any route.">Add a 402 payment gate<br /><em>to any route.</em></h1>
            <p>
              Wrap an Express route with <code>paymentMiddleware</code>. Agents that call it without a
              payment header receive an HTTP 402 body with the exact price, network, and recipient;
              after paying, they retry with <code>X-Payment-Tx</code> and the middleware verifies the
              receipt before your handler runs.
            </p>
          </section>

          <section className="docs-section" id="install">
            <div className="docs-section-number">01</div>
            <div className="docs-section-content">
              <div className="docs-icon"><Package aria-hidden="true" /></div>
              <h2>Install the server package</h2>
              <p>
                <code>@x402/server</code> is framework-agnostic verification plus an Express adapter.
                It requires <code>viem</code> as a dependency.
              </p>
              <CodeBlock label="Terminal" code={installCommand} />
            </div>
          </section>

          <section className="docs-section" id="middleware">
            <div className="docs-section-number">02</div>
            <div className="docs-section-content">
              <div className="docs-icon"><Code2 aria-hidden="true" /></div>
              <h2>Guard a route with the middleware</h2>
              <p>
                Place <code>paymentMiddleware</code> between the URL matcher and your handler. Without a
                <code>X-Payment-Tx</code> header it returns <code>402</code>; with a valid receipt it calls
                <code>next()</code> and your handler runs normally.
              </p>
              <CodeBlock label="TypeScript" code={middlewareExample} />
            </div>
          </section>

          <section className="docs-section" id="contract">
            <div className="docs-section-number">03</div>
            <div className="docs-section-content">
              <div className="docs-icon"><CircleX aria-hidden="true" /></div>
              <h2>The 402 payment requirement</h2>
              <p>
                An unauthenticated request never reaches your data. It receives exact payment terms an
                agent can act on: price in USDC (6-decimal base units), your recipient, and the chain.
              </p>
              <CodeBlock label="Live 402 response" code={paymentRequired} />
              <h3>Paid request</h3>
              <p>The agent pays and retries the same URL with the receipt hash in <code>X-Payment-Tx</code>.</p>
              <CodeBlock label="Terminal" code={paidRequest} />
            </div>
          </section>

          <section className="docs-section" id="status">
            <div className="docs-section-number">04</div>
            <div className="docs-section-content">
              <div className="docs-icon"><ServerCog aria-hidden="true" /></div>
              <h2>Status codes</h2>
              <p>The middleware&apos;s response contract for every request to a guarded route.</p>
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
                The middleware accepts an official-USDC <code>Transfer</code> receipt on the configured
                chain, waits for one confirmation by default, and mounts an in-memory replay claim per
                transaction hash. Raise <code>confirmations</code> and supply durable replay storage for
                production traffic.
              </p>
            </div>
          </section>

          <section className="docs-section" id="agent">
            <div className="docs-section-number">05</div>
            <div className="docs-section-content">
              <div className="docs-icon"><Bot aria-hidden="true" /></div>
              <h2>Pay with your own AI agent</h2>
              <p>
                Give your agent a task to pay the live <code>AgentPay</code> endpoint and fetch the
                premium data. Replace <code>[INSERT_PRIVATE_KEY]</code> with the private key your agent
                should pay from, then paste the prompt into any capable AI agent.
              </p>
              <CodeBlock label="Agent prompt" code={agentPrompt} />
              <div className="docs-warning docs-warning--danger">
                <ShieldAlert aria-hidden="true" />
                <div>
                  <strong>REAL FUNDS · BASE MAINNET</strong>
                  <span>The agent transfers real USDC. Use a dedicated low-balance wallet key, never your main key.</span>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}