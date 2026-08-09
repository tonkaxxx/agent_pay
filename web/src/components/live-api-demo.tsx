"use client";

import { ArrowRight, LoaderCircle, Play, RotateCcw } from "lucide-react";
import { useState } from "react";

type DemoState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "response"; readonly status: number; readonly payload: unknown }
  | { readonly kind: "error" };

export function LiveApiDemo() {
  const [state, setState] = useState<DemoState>({ kind: "idle" });

  async function callEndpoint() {
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/premium", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload: unknown = await response.json();
      setState({ kind: "response", status: response.status, payload });
    } catch {
      setState({ kind: "error" });
    }
  }

  const statusLabel = state.kind === "response"
    ? `${state.status} ${state.status === 402 ? "Payment Required" : "Response"}`
    : "Ready";

  return (
    <div className="api-console" aria-live="polite">
      <div className="api-console__bar">
        <div className="window-dots" aria-hidden="true"><span /><span /><span /></div>
        <span className="api-console__endpoint">GET /api/premium</span>
        <span className={`api-console__status${state.kind === "response" ? " is-live" : ""}`}>
          {statusLabel}
        </span>
      </div>
      <div className="api-console__body">
        <div className="request-line"><span>→</span> curl /api/premium</div>
        {state.kind === "idle" && (
          <div className="console-placeholder">
            <span className="console-cursor" aria-hidden="true" />
            Call the endpoint to inspect its live payment requirements.
          </div>
        )}
        {state.kind === "loading" && (
          <div className="console-loading"><LoaderCircle aria-hidden="true" /> Contacting AgentPay…</div>
        )}
        {state.kind === "response" && (
          <>
            <div className={`response-line status-${state.status}`}>
              <span>←</span> {statusLabel}
            </div>
            <pre>{JSON.stringify(state.payload, null, 2)}</pre>
          </>
        )}
        {state.kind === "error" && (
          <div className="console-error" role="alert">
            The live endpoint is temporarily unavailable.
          </div>
        )}
      </div>
      <div className="api-console__footer">
        <button
          className="console-button"
          type="button"
          onClick={callEndpoint}
          disabled={state.kind === "loading"}
        >
          {state.kind === "idle" ? <Play aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
          {state.kind === "idle" ? "Call live endpoint" : "Run again"}
        </button>
        <a className="console-docs" href="/docs">Complete the paid request <ArrowRight aria-hidden="true" /></a>
        <span className="console-network">Base Mainnet · real funds</span>
      </div>
    </div>
  );
}
