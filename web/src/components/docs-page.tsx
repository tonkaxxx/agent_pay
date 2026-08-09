import {
  ArrowLeft,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  Code2,
  KeyRound,
  LockKeyhole,
  ServerCog,
  ShieldAlert,
  TerminalSquare,
} from "lucide-react";
import Link from "next/link";

import { CodeBlock } from "./code-block";

const inspectCommand = `export AGENTPAY_API_URL=https://your-domain.example
curl -i "$AGENTPAY_API_URL/api/premium"`;

const paymentRequired = `HTTP/2 402
cache-control: no-store
content-type: application/json

{
  "error": "Payment Required",
  "priceUsdc": "0.01",
  "payTo": "0x...",
  "network": "base",
  "chainId": 8453
}`;

const setupCommand = `git clone https://github.com/tonkaxxx/agent_pay.git
cd agent_pay
corepack pnpm install
cp web/.env.example web/.env.local`;

const environmentExample = `AGENT_PRIVATE_KEY=0x...              # replace; dedicated low-balance wallet
BASE_MAINNET_RPC_URL=https://...   # must report chain 8453
AGENTPAY_API_URL=https://.../api/premium
AGENTPAY_EXPECTED_PAY_TO=0x...     # pin the published recipient
ALLOW_MAINNET_PAYMENTS=false       # preview is the safe default`;

const previewCommand = `pnpm --dir web demo:premium`;

const executeCommand = `ALLOW_MAINNET_PAYMENTS=true \
pnpm --dir web demo:premium -- --execute`;

const clientExample = `const agentFetch = createAgentFetch({
  privateKey,
  rpcUrl,
  maxPaymentUsdc: "0.01",
  confirmations: 2,
  paymentVerificationRetries: 5,
  paymentVerificationRetryDelayMs: 2_000,
  authorizePayment: (payment) =>
    payment.requestUrl === apiUrl &&
    payment.chainId === 8453 &&
    payment.network === "base" &&
    payment.token === USDC_BASE &&
    payment.payTo === expectedPayTo &&
    payment.amount === 10_000n,
});

const response = await agentFetch(apiUrl);`;

const paidResponse = `HTTP/2 200
cache-control: no-store

{
  "premiumData": "Here's your premium data — paid, verified, and unlocked by AgentPay.",
  "paidWith": "USDC",
  "network": "base",
  "txHash": "0x..."
}`;

const statuses = [
  ["200", "Paid", "Receipt verified and transaction hash claimed exactly once."],
  ["402", "Payment required", "No X-Payment-Tx header; exact mainnet terms are returned."],
  ["403", "Invalid payment", "Malformed, failed, insufficient, or already-used transaction."],
  ["503", "Retry safely", "Receipt, confirmations, RPC, Redis, or deployment config is unavailable."],
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
            <a href="#inspect">Inspect the 402</a>
            <a href="#pay">Run the client</a>
            <a href="#contract">API contract</a>
            <a href="#security">Security model</a>
          </nav>
          <div className="docs-network-card">
            <span className="signal-dot" />
            <div><strong>Base Mainnet</strong><small>Chain ID 8453</small></div>
          </div>
        </aside>

        <main className="docs-main">
          <section className="docs-hero" id="quickstart">
            <div className="section-kicker">AgentPay quickstart</div>
            <h1 aria-label="Ship your first paid request.">Ship your first<br /><em>paid request.</em></h1>
            <p>
              Inspect a real HTTP 402 endpoint, run a fail-closed preview, then explicitly authorize
              one $0.01 USDC payment from your own agent.
            </p>
            <div className="docs-warning docs-warning--danger">
              <ShieldAlert aria-hidden="true" />
              <div>
                <strong>REAL FUNDS · BASE MAINNET</strong>
                <span>The execute command transfers real USDC and Base ETH is required for gas. No refunds.</span>
              </div>
            </div>
          </section>

          <section className="docs-section" id="inspect">
            <div className="docs-section-number">01</div>
            <div className="docs-section-content">
              <div className="docs-icon"><TerminalSquare aria-hidden="true" /></div>
              <h2>Inspect the payment requirements</h2>
              <p>
                Start with a read-only request. Without a transaction header the API never returns premium data;
                it publishes the exact amount, network, and recipient instead.
              </p>
              <CodeBlock label="Terminal" code={inspectCommand} />
              <CodeBlock label="Live 402 response" code={paymentRequired} />
            </div>
          </section>

          <section className="docs-section" id="pay">
            <div className="docs-section-number">02</div>
            <div className="docs-section-content">
              <div className="docs-icon"><KeyRound aria-hidden="true" /></div>
              <h2>Run the guarded client</h2>
              <p>
                Clone the SDK and configure a dedicated low-balance wallet. The private key remains local;
                AgentPay&apos;s server only verifies public transaction receipts.
              </p>
              <CodeBlock label="Clone and install" code={setupCommand} />
              <CodeBlock label="web/.env.local" code={environmentExample} />
              <h3>Preview first</h3>
              <p>The default command validates the live quote and prints <code>PAYMENT NOT SENT</code>.</p>
              <CodeBlock label="Safe preview" code={previewCommand} />
              <h3>Authorize one payment</h3>
              <p>
                Payment requires two explicit signals: the environment opt-in and the <code>--execute</code> flag.
              </p>
              <CodeBlock label="Real payment" code={executeCommand} />
              <div className="docs-warning">
                <CircleAlert aria-hidden="true" />
                <div><strong>After a transaction hash appears</strong><span>Never rerun until you inspect that hash on BaseScan.</span></div>
              </div>
            </div>
          </section>

          <section className="docs-section">
            <div className="docs-section-number">03</div>
            <div className="docs-section-content">
              <div className="docs-icon"><Code2 aria-hidden="true" /></div>
              <h2>The policy-controlled request</h2>
              <p>
                The example pins every payment boundary before signing: URL, network, token, recipient,
                and the exact 10,000 base-unit amount.
              </p>
              <CodeBlock label="TypeScript" code={clientExample} />
              <CodeBlock label="Paid response" code={paidResponse} />
            </div>
          </section>

          <section className="docs-section" id="contract">
            <div className="docs-section-number">04</div>
            <div className="docs-section-content">
              <div className="docs-icon"><ServerCog aria-hidden="true" /></div>
              <h2>API contract</h2>
              <p><code>GET /api/premium</code> is dynamic, mainnet-only, and always returns <code>Cache-Control: no-store</code>.</p>
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
            </div>
          </section>

          <section className="docs-section" id="security">
            <div className="docs-section-number">05</div>
            <div className="docs-section-content">
              <div className="docs-icon"><LockKeyhole aria-hidden="true" /></div>
              <h2>Security model</h2>
              <div className="security-list">
                <div><CircleCheck aria-hidden="true" /><span><strong>Official USDC only</strong>Token logs are checked against the Base Mainnet contract.</span></div>
                <div><CircleCheck aria-hidden="true" /><span><strong>Two confirmations</strong>The resource remains closed while a receipt is too recent.</span></div>
                <div><CircleCheck aria-hidden="true" /><span><strong>Atomic replay claim</strong>Redis SET NX makes one transaction hash valid for one response.</span></div>
                <div><CircleCheck aria-hidden="true" /><span><strong>No server wallet</strong>The public API stores no payer private key and cannot initiate transfers.</span></div>
              </div>
              <p className="docs-bearer-warning">
                A transaction hash is a public bearer receipt in this fixed-response demonstration.
                Do not use this demo for secrets or user-specific entitlements without binding a unique
                quote and authenticated payer identity to the request.
              </p>
              <p className="docs-footnote">
                This endpoint demonstrates the payment primitive with a fixed response. Apply deployment-level
                rate limiting, monitoring, and a dedicated RPC provider before wider production traffic.
              </p>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
