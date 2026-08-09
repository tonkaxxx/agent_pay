"use client";

import { RotateCcw } from "lucide-react";

export default function ErrorPage({
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return (
    <main className="system-page">
      <div className="system-page__code" aria-hidden="true">503</div>
      <div className="section-kicker">Temporary interruption</div>
      <h1>The signal went <em>quiet.</em></h1>
      <p>The page could not be completed. No payment was initiated by this website.</p>
      <button className="button button--primary" type="button" onClick={reset}>
        <RotateCcw aria-hidden="true" /> Try again
      </button>
    </main>
  );
}
