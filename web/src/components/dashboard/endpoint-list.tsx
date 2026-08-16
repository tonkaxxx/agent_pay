import Link from "next/link";

import { atomicToUsdc } from "@/features/gateway/endpoint";
import type { EndpointSummary } from "@/features/gateway/repository";

import dashboardStyles from "./dashboard.module.css";

const styles = dashboardStyles as unknown as Record<string, string>;

const STATUS_LABELS: Record<EndpointSummary["status"], string> = {
  draft: "Draft",
  active: "Live",
  paused: "Paused",
};

export interface EndpointListProps {
  readonly endpoints: readonly EndpointSummary[];
}

export function EndpointList({ endpoints }: EndpointListProps) {
  if (endpoints.length === 0) {
    return (
      <div className={styles.card}>
        <h2>No endpoints yet</h2>
        <p>
          Paste an HTTPS GET API, set a USDC price, and activate to receive a ready-to-use paid
          gateway URL.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.cards}>
      {endpoints.map((endpoint) => (
        <Link
          key={endpoint.id}
          href={`/dashboard/${endpoint.id}`}
          className={styles.card}
          data-testid="endpoint-card"
        >
          <h2>{endpoint.displayName}</h2>
          <p className={styles.mono}>{endpoint.upstreamUrl}</p>
          <p>
            {atomicToUsdc(endpoint.amountAtomic)} USDC per request · {STATUS_LABELS[endpoint.status]}
          </p>
          <span className={`${styles.badge} ${statusBadge(endpoint.status)}`}>
            {STATUS_LABELS[endpoint.status]}
          </span>
        </Link>
      ))}
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