"use client";

import { decodePaymentRequiredHeader } from "@x402/core/http";
import { ArrowRight, LoaderCircle, Play, RotateCcw } from "lucide-react";
import { useState } from "react";

type Endpoint = "basic" | "premium";

interface PublicPaymentTerms {
  readonly x402Version: number;
  readonly resource: { readonly url: string };
  readonly accepts: readonly [{
    readonly scheme: string;
    readonly network: string;
    readonly amount: string;
    readonly asset: string;
    readonly payTo: string;
    readonly maxTimeoutSeconds: number;
  }];
}

type ProtocolTerms =
  | { readonly kind: "decoded"; readonly value: PublicPaymentTerms }
  | { readonly kind: "missing" }
  | { readonly kind: "none" };

type DemoState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | {
    readonly kind: "response";
    readonly status: number;
    readonly payload: unknown;
    readonly protocolTerms: ProtocolTerms;
  }
  | { readonly kind: "error" };

const endpoints: Readonly<Record<Endpoint, { readonly path: string; readonly url: string }>> = {
  basic: { path: "GET /api/basic", url: "/api/basic" },
  premium: { path: "GET /api/premium", url: "/api/premium" },
};

function publicTerms(response: Response): ProtocolTerms {
  if (response.status !== 402) return { kind: "none" };
  const encoded = response.headers.get("PAYMENT-REQUIRED");
  if (!encoded) return { kind: "missing" };
  try {
    const decoded = decodePaymentRequiredHeader(encoded);
    const accepted = decoded.accepts[0];
    if (!accepted) return { kind: "missing" };
    return {
      kind: "decoded",
      value: {
        x402Version: decoded.x402Version,
        resource: { url: decoded.resource.url },
        accepts: [{
          scheme: accepted.scheme,
          network: accepted.network,
          amount: accepted.amount,
          asset: accepted.asset,
          payTo: accepted.payTo,
          maxTimeoutSeconds: accepted.maxTimeoutSeconds,
        }],
      },
    };
  } catch {
    return { kind: "missing" };
  }
}

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
      const payload: unknown = await response.json();
      setState({
        kind: "response",
        status: response.status,
        payload,
        protocolTerms: publicTerms(response),
      });
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
            {state.protocolTerms.kind === "decoded" && (
              <>
                <div className="response-line">Decoded PAYMENT-REQUIRED</div>
                <pre>{JSON.stringify(state.protocolTerms.value, null, 2)}</pre>
              </>
            )}
            {state.protocolTerms.kind === "missing" && (
              <div className="console-error">Standard payment header unavailable.</div>
            )}
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
