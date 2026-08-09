import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="system-page">
      <div className="system-page__code" aria-hidden="true">404</div>
      <div className="section-kicker">Lost request</div>
      <h1>Signal <em>not found.</em></h1>
      <p>The endpoint you requested is outside AgentPay&apos;s current protocol surface.</p>
      <Link className="button button--primary" href="/">
        <ArrowLeft aria-hidden="true" /> Back to AgentPay
      </Link>
    </main>
  );
}
