import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Blocks,
  CircleDollarSign,
  Code2,
  Globe2,
  LockKeyhole,
  Network,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from "lucide-react";
import Link from "next/link";

import { LiveApiDemo } from "./live-api-demo";

const founderMail = "mailto:maltsev.yar@gmail.com?subject=AgentPay%20investment%20conversation";

const proofPoints = [
  ["Status", "Working MVP"],
  ["Settlement", "USDC on Base"],
  ["Protocol", "x402 v2"],
  ["Live price", "$0.01 / request"],
] as const;

const protocolSteps = [
  {
    number: "01",
    title: "Request",
    copy: "An autonomous agent calls an AgentPay-enabled API like any other HTTP resource.",
    code: "GET /api/premium",
  },
  {
    number: "02",
    title: "Discover & pay",
    copy: "HTTP 402 returns exact USDC terms. Wallet policy approves the origin, asset, recipient and spend.",
    code: "402 · 0.01 USDC",
  },
  {
    number: "03",
    title: "Verify & unlock",
    copy: "The API locks the signed authorization, settles it onchain, and only then releases the resource.",
    code: "200 · premium data",
  },
] as const;

const pillars = [
  {
    icon: Globe2,
    number: "01",
    title: "HTTP-native",
    copy: "Pricing travels with the request instead of through accounts, invoices or a separate checkout stack.",
  },
  {
    icon: ShieldCheck,
    number: "02",
    title: "Policy-controlled",
    copy: "Agents enforce origin, chain, recipient, token and maximum spend before signing anything.",
  },
  {
    icon: LockKeyhole,
    number: "03",
    title: "Observable by policy",
    copy: "Standard quotes, authorization state and settlement outcomes create an auditable control plane for every response.",
  },
] as const;

export function LandingPage() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <Link className="wordmark" href="/" aria-label="AgentPay home">
          <span className="wordmark-mark">A</span>
          AgentPay
        </Link>
        <nav className="desktop-nav" aria-label="Primary navigation">
          <a href="#thesis">Thesis</a>
          <a href="#protocol">Protocol</a>
          <a href="#live-api">Live API</a>
          <Link href="/docs">Docs <ArrowUpRight aria-hidden="true" /></Link>
          <Link href="/login">Sell an API <ArrowUpRight aria-hidden="true" /></Link>
        </nav>
        <a className="header-cta" href={founderMail}>
          Talk to the founder <ArrowUpRight aria-hidden="true" />
        </a>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-orbit hero-orbit--one" aria-hidden="true" />
          <div className="hero-orbit hero-orbit--two" aria-hidden="true" />
          <div className="hero-watermark" aria-hidden="true">402</div>
          <div className="eyebrow"><span /> Payment infrastructure for autonomous software</div>
          <h1 id="hero-title" aria-label="APIs can now charge themselves.">
            APIs can now<br /><em>charge themselves.</em>
          </h1>
          <div className="hero-bottom">
            <p>
              AgentPay turns HTTP 402 into an autonomous USDC payment flow for AI agents.
              Discover a price, pay within policy, and continue — no accounts, invoices, or human checkout.
            </p>
            <div className="hero-actions">
              <a className="button button--primary" href="#live-api">
                Inspect the live API <ArrowDownRight aria-hidden="true" />
              </a>
              <Link className="button button--secondary" href="/docs">
                Read the docs <ArrowUpRight aria-hidden="true" />
              </Link>
              <Link className="button button--primary" href="/login">
                Start selling your API <ArrowUpRight aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        <section className="proof-strip" aria-label="Product proof points">
          {proofPoints.map(([label, value]) => (
            <div className="proof-item" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>

        <section className="thesis-section" id="thesis" aria-labelledby="thesis-title">
          <div className="section-intro">
            <div className="section-kicker">The thesis</div>
            <h2 id="thesis-title">Software is becoming an <em>economic actor.</em></h2>
            <div className="thesis-symbol" aria-hidden="true"><Sparkles /></div>
          </div>
          <div className="thesis-copy">
            <p className="lead-copy">
              Agents can browse, reason, and act — but they still hit a human checkout when value must move.
            </p>
            <p>
              AgentPay gives APIs a machine-native price and agents a policy-controlled way to pay it.
              One familiar HTTP status becomes a market primitive: ask, quote, settle, continue.
            </p>
            <p>
              AgentPay is the policy, security and observability layer for agentic commerce —
              the control plane between autonomous wallets and paid APIs.
            </p>
            <div className="thesis-note">
              <Network aria-hidden="true" />
              <span>Built for the point where API infrastructure becomes agent commerce.</span>
            </div>
          </div>
        </section>

        <section className="protocol-section" id="protocol" aria-labelledby="protocol-title">
          <div className="protocol-heading">
            <div>
              <div className="section-kicker">The protocol</div>
              <h2 id="protocol-title">One request.<br />One payment.<br /><em>No friction.</em></h2>
            </div>
            <div className="protocol-badge"><Waypoints aria-hidden="true" /> HTTP 402 → USDC → HTTP 200</div>
          </div>
          <div className="protocol-steps">
            {protocolSteps.map((step) => (
              <article className="protocol-step" key={step.number}>
                <span className="step-number">{step.number}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.copy}</p>
                </div>
                <code>{step.code}</code>
                <ArrowRight className="step-arrow" aria-hidden="true" />
              </article>
            ))}
          </div>
        </section>

        <section className="live-api-section" id="live-api" aria-labelledby="live-api-title">
          <div className="api-grid-pattern" aria-hidden="true" />
          <div className="live-api-copy">
            <div className="section-kicker section-kicker--light"><span /> Live mainnet proof</div>
            <h2 id="live-api-title">Not a mockup.<br /><em>A paid API.</em></h2>
            <p>
              Call the public endpoint. It quotes exactly $0.01 in real USDC on Base.
              A signed x402 v2 authorization is locked, verified and settled exactly once.
              Self-hosted settlement keeps the payment path on the same production server,
              while the facilitator&apos;s gas-only wallet sponsors the Base transaction.
            </p>
            <div className="funds-warning"><CircleDollarSign aria-hidden="true" /> REAL FUNDS · BASE MAINNET</div>
            <div className="api-stack" aria-label="API infrastructure">
              <span><Blocks aria-hidden="true" /> Base</span>
              <span><CircleDollarSign aria-hidden="true" /> USDC</span>
              <span><Code2 aria-hidden="true" /> HTTP 402</span>
            </div>
          </div>
          <LiveApiDemo />
        </section>

        <section className="pillars-section" aria-labelledby="pillars-title">
          <div className="pillars-heading">
            <div className="section-kicker">Built, not promised</div>
            <h2 id="pillars-title">The primitive is<br /><em>already working.</em></h2>
          </div>
          <div className="pillars-grid">
            {pillars.map(({ icon: Icon, number, title, copy }) => (
              <article className="pillar-card" key={number}>
                <div className="pillar-top"><Icon aria-hidden="true" /><span>{number}</span></div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="vision-strip" aria-label="Product vision">
          <div className="vision-track" aria-hidden="true">
            <span>REQUEST</span><i>→</i><span>PRICE</span><i>→</i><span>PAY</span><i>→</i><span>VERIFY</span><i>→</i><span>UNLOCK</span>
          </div>
        </section>

        <section className="founder-section" aria-labelledby="founder-title">
          <div>
            <div className="section-kicker">Pre-seed · Open to conversations</div>
            <h2 id="founder-title">The transaction layer<br />for the <em>agent economy.</em></h2>
            <a className="button button--primary founder-button" href={founderMail}>
              Email the founder <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
          <aside className="founder-card">
            <div className="founder-monogram" aria-hidden="true">YM</div>
            <div>
              <strong>Yaroslav Maltsev</strong>
              <span>Founder, AgentPay</span>
              <p>Building machine-native commerce infrastructure for autonomous software.</p>
            </div>
          </aside>
        </section>
      </main>

      <footer className="site-footer">
        <Link className="wordmark wordmark--footer" href="/">AgentPay</Link>
        <p>APIs that can price, settle and continue.</p>
        <div className="footer-links">
          <a href="https://github.com/tonkaxxx/agent_pay" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <Link href="/docs">Docs</Link>
          <Link href="/login">Sell an API</Link>
          <a href={founderMail}>Contact</a>
        </div>
        <div className="footer-bottom"><span>© 2026 AgentPay</span><span>Base Mainnet · USDC · HTTP 402</span></div>
      </footer>
    </div>
  );
}
