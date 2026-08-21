import Link from "next/link";

import { atomicToUsdc } from "@/features/gateway/endpoint";
import type { EndpointSummary } from "@/features/gateway/repository";
import type { ActionState } from "@/features/gateway/actions";

import { CopyField } from "./copy-field";
import { ConnectivityForm } from "./connectivity-form";
import { CredentialForm } from "./credential-form";
import { MoneyForm } from "./money-form";
import { PayoutPolicyForm } from "./payout-policy-form";
import { StatusForm } from "./status-form";
import dashboardStyles from "./dashboard.module.css";

const styles = dashboardStyles as unknown as Record<string, string>;

const AUTH_LABELS: Record<EndpointSummary["authMode"], string> = {
  none: "No auth",
  bearer: "Bearer token",
  "x-api-key": "X-API-Key",
};

const STATUS_LABELS: Record<EndpointSummary["status"], string> = {
  draft: "Draft",
  active: "Live",
  paused: "Paused",
};

export interface EndpointDetailsProps {
  readonly endpoint: EndpointSummary;
  readonly gatewayUrl: string;
  readonly recent: boolean;
  readonly custodial?: boolean;
  readonly statusAction: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  readonly credentialAction: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  readonly payoutAction: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  readonly priceAction: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  readonly payoutPolicyAction: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  readonly connectivityAction: (previous: ActionState, formData: FormData) => Promise<ActionState>;
}

export function EndpointDetails({
  endpoint,
  gatewayUrl,
  recent,
  custodial = false,
  statusAction,
  credentialAction,
  payoutAction,
  priceAction,
  payoutPolicyAction,
  connectivityAction,
}: EndpointDetailsProps) {
  const editable = endpoint.status !== "active";
  const armed = editable || recent;

  return (
    <div>
      <span className={`${styles.badge} ${statusBadge(endpoint.status)}`}>
        {STATUS_LABELS[endpoint.status]}
      </span>

      <div className="thesis-copy" style={{ minHeight: 0, padding: "24px 0" }}>
        <p className="lead-copy">{endpoint.displayName}</p>
        <p className={styles.mono}>{endpoint.upstreamUrl}</p>
        <p className="hint">
          {AUTH_LABELS[endpoint.authMode]} upstream · {atomicToUsdc(endpoint.amountAtomic)} USDC per
          request
        </p>
      </div>

      <div className="thesis-note">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2" />
        </svg>
        <span className="hint">
          {custodial
            ? "Buyers pay the displayed price in USDC on Base. AgentPay deducts 5% and sends 95% to your snapshotted payout address on the selected schedule."
            : "Transactions settle directly to your payout address on Base. Commission is recorded for analytics but is not collected in ledger mode."}
        </span>
      </div>

      <div className="thesis-note">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
        </svg>
        <span className="hint">
          Your upstream call runs exactly once per payment, guarded by the AgentPay authorization
          lock.
        </span>
      </div>

      {endpoint.status === "active" ? (
        <div>
          <p className="hint">Your paid gateway URL</p>
          <CopyField value={gatewayUrl} />
        </div>
      ) : (
        <p className="hint">
          {endpoint.status === "draft"
            ? "Draft. Add your upstream secret and activate to go live."
            : "Paused. Payments are not accepted until you reactivate."}
        </p>
      )}

      <StatusForm endpointId={endpoint.id} status={endpoint.status} action={statusAction} />

      {editable ? (
        <p>
          <Link className="button button--secondary" href={`/dashboard/${endpoint.id}/edit`}>
            Edit endpoint
          </Link>
        </p>
      ) : null}

      <hr style={{ border: "1px solid var(--line)", margin: "28px 0" }} />

      <h2 className="protocol-heading" style={{ margin: 0, fontSize: 28 }}>
        Payout &amp; price
      </h2>

      {!armed ? (
        <p className={styles.warn}>
          Live payouts and prices can only change after a fresh sign-in in the last 24 hours. Sign
          out and back in to unlock, or pause the endpoint first.
        </p>
      ) : null}

      <MoneyForm
        endpointId={endpoint.id}
        action={payoutAction}
        fieldName="payTo"
        label="Base payout address"
        explainer={custodial
          ? "Your 95% seller payouts go here. The address is snapshotted for each payment."
          : "Direct x402 settlement goes here in ledger mode."}
        defaultValue={endpoint.payTo}
      />

      {custodial ? (
        <PayoutPolicyForm
          endpointId={endpoint.id}
          defaultValue={endpoint.payoutPolicy}
          disabled={!armed}
          action={payoutPolicyAction}
        />
      ) : null}

      <MoneyForm
        endpointId={endpoint.id}
        action={priceAction}
        fieldName="price"
        label="Price (USDC)"
        explainer="Between 0.000001 and 1000 USDC, six decimal places."
        defaultValue={atomicToUsdc(endpoint.amountAtomic)}
      />

      <hr style={{ border: "1px solid var(--line)", margin: "28px 0" }} />

      <h2 className="protocol-heading" style={{ margin: 0, fontSize: 28 }}>
        Upstream connectivity
      </h2>

      <p className={styles.hint}>
        {lastTestText(endpoint)}
      </p>

      <ConnectivityForm endpointId={endpoint.id} action={connectivityAction} />

      <hr style={{ border: "1px solid var(--line)", margin: "28px 0" }} />

      <h2 className="protocol-heading" style={{ margin: 0, fontSize: 28 }}>
        Upstream credential
      </h2>

      <CredentialForm endpointId={endpoint.id} action={credentialAction} />

      <p className={styles.hint}>
        <Link href="/dashboard">Back to all endpoints</Link>
      </p>
    </div>
  );
}

function statusBadge(status: EndpointSummary["status"]): string {
  if (status === "active") {
    return styles.badgeActive!;
  }
  if (status === "paused") {
    return styles.badgePaused!;
  }
  return styles.badgeDraft!;
}

function lastTestText(endpoint: EndpointSummary): string {
  if (endpoint.lastTestAt === null) {
    return "No connectivity test recorded yet.";
  }
  const when = endpoint.lastTestAt.toISOString().split("T")[0];
  if (endpoint.lastTestStatus === "ok") {
    return `Last test passed (HTTP ${endpoint.lastTestHttpStatus}, ${endpoint.lastTestResponseSize} bytes, ${endpoint.lastTestLatencyMs} ms) on ${when}.`;
  }
  return `Last test failed (${endpoint.lastTestStatus}) on ${when}.`;
}
