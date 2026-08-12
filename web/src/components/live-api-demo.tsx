"use client";

import { ArrowRight, LoaderCircle, Play, RotateCcw } from "lucide-react";
import { useState } from "react";
import { decodePaymentRequiredHeader } from "@x402/core/http";

type Endpoint = "basic" | "premium";

type DemoState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "response"; readonly status: number; readonly payload: unknown }
  | { readonly kind: "error" };

const endpoints: Readonly<Record<Endpoint, { readonly path: string; readonly url: string }>> = {
  basic: { path: "GET /api/basic", url: "/api/basic" },
  premium: { path: "GET /api/premium", url: "/api/premium" },
};

export function LiveApiDemo() {
  const [endpoint, setEndpoint] = useState<Endpoint>("basic");
  const [state, setState] = useState<DemoState>({ kind: "idle" });

  async function callEndpoint() {
    setState({ kind: "loading" });
    try {
      const response = await fetch(endpoints[endpoint].url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const paymentRequired = response.headers.get("PAYMENT-REQUIRED");
      const payload: unknown = paymentRequired === null
        ? await response.json()
        : decodePaymentRequiredHeader(paymentRequired);
      setState({ kind: "response", status: response.status, payload });
    } catch {
      setState({ kind: "error" });
    }
  }

  function selectEndpoint(next: Endpoint) {
    setEndpoint(next);
    setState({ kind: "idle" });
  }

  const isPaid = endpoint === "premium";
  const statusLabel = state.kind === "response"
    ? `${state.status} ${state.status === 402 ? "Payment Required" : "Response"}`
    : "Ready";

  return (
    <div className="api-console" aria-live="polite">
      <div className="api-console__bar">
        <div className="window-dots" aria-hidden="true"><span /><span /><span /></div>
        <div className="api-console__tabs" role="tablist" aria-label="Demo endpoint">
          {(Object.keys(endpoints) as Endpoint[]).map((key) => (
            <button
              key={key}
              className={`api-console__tab${endpoint === key ? " is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={endpoint === key}
              onClick={() => selectEndpoint(key)}
            >
              {endpoints[key].path}
            </button>
          ))}
        </div>
        <span className={`api-console__status${state.kind === "response" ? " is-live" : ""}`}>
          {statusLabel}
        </span>
      </div>
      <div className="api-console__body">
        <div className="request-line"><span>→</span> curl {endpoints[endpoint].url}</div>
        {state.kind === "idle" && (
          <div className="console-placeholder">
            <span className="console-cursor" aria-hidden="true" />
            {isPaid
              ? "Call the endpoint to inspect its live payment requirements."
              : "Call the endpoint to inspect its live free response."}
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
        {isPaid ? (
          <a className="console-docs" href="/docs#agent">Complete the paid request <ArrowRight aria-hidden="true" /></a>
        ) : (
          <span className="console-docs">No payment required</span>
        )}
        <span className="console-network">{isPaid ? "Base Mainnet · real funds" : "Free · no payment required"}</span>
      </div>
    </div>
  );
}
