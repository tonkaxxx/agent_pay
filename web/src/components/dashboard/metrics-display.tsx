import { atomicToUsdc } from "@/features/gateway/endpoint";
import type { EndpointMetrics } from "@/features/gateway/metrics";

import dashboardStyles from "./dashboard.module.css";

const styles = dashboardStyles as unknown as Record<string, string>;

function usdc(amountAtomic: string): string {
  const value = Number(atomicToUsdc(amountAtomic));
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
}

function percent(value: number | null): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function latency(value: number | null): string {
  if (value === null) return "—";
  return `${value} ms`;
}

export interface MetricsDisplayProps {
  readonly metrics: EndpointMetrics;
}

export function MetricsDisplay({ metrics }: MetricsDisplayProps) {
  return (
    <div className={styles.metricsGrid}>
      <section className={styles.metricCard}>
        <span className={styles.metricValue}>{metrics.paidCount}</span>
        <span className={styles.metricLabel}>Paid requests</span>
      </section>

      <section className={styles.metricCard}>
        <span className={styles.metricValue}>{usdc(metrics.gmvAtomic)} USDC</span>
        <span className={styles.metricLabel}>GMV</span>
      </section>

      <section className={styles.metricCard}>
        <span className={styles.metricValue}>{usdc(metrics.commissionAtomic)} USDC</span>
        <span className={styles.metricLabel}>AgentPay commission (5%)</span>
      </section>

      <section className={styles.metricCard}>
        <span className={styles.metricValue}>{metrics.uniquePayers}</span>
        <span className={styles.metricLabel}>Unique payers</span>
      </section>

      <section className={styles.metricCard}>
        <span className={styles.metricValue}>{metrics.repeatedPayers}</span>
        <span className={styles.metricLabel}>Repeated payers</span>
      </section>

      <section className={styles.metricCard}>
        <span className={styles.metricValue}>{percent(metrics.upstreamSuccessRate)}</span>
        <span className={styles.metricLabel}>Upstream success rate</span>
      </section>

      <section className={styles.metricCard}>
        <span className={styles.metricValue}>{percent(metrics.settlementSuccessRate)}</span>
        <span className={styles.metricLabel}>Settlement success rate</span>
      </section>

      <section className={styles.metricCard}>
        <span className={styles.metricValue}>{latency(metrics.medianUpstreamLatencyMs)}</span>
        <span className={styles.metricLabel}>Median upstream latency</span>
      </section>

      <section className={styles.metricCard}>
        <span className={styles.metricValue}>{latency(metrics.p95UpstreamLatencyMs)}</span>
        <span className={styles.metricLabel}>p95 upstream latency</span>
      </section>

      {metrics.recentFailures.length > 0 ? (
        <section className={styles.metricSpan}>
          <span className={styles.metricLabel}>Recent failures</span>
          <ul className={styles.recentFailures}>
            {metrics.recentFailures.map((failure) => (
              <li key={`${failure.createdAt.toISOString()}-${failure.outcome}`}>
                {failure.outcome}
                {failure.upstreamStatus !== null
                  ? ` (HTTP ${failure.upstreamStatus})`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}