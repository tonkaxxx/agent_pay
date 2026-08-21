"use client";

import { useActionState } from "react";

import type { ActionState } from "@/features/gateway/actions";
import type { PayoutPolicy } from "@/features/finance/policy";

import dashboardStyles from "./dashboard.module.css";

const styles = dashboardStyles as unknown as Record<string, string>;

export function PayoutPolicyForm({
  endpointId,
  defaultValue,
  disabled,
  action,
}: {
  readonly endpointId: string;
  readonly defaultValue: PayoutPolicy;
  readonly disabled: boolean;
  readonly action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction}>
      <input type="hidden" name="endpointId" value={endpointId} />
      <div className={styles.field}>
        <label htmlFor="payoutPolicy">Payout schedule</label>
        <select
          id="payoutPolicy"
          name="payoutPolicy"
          defaultValue={defaultValue}
          disabled={disabled || pending}
        >
          <option value="threshold_or_weekly">At 1 USDC or every 7 days</option>
          <option value="threshold">Only after reaching 1 USDC</option>
        </select>
        <span className={styles.hint}>
          The 5% AgentPay fee is included in the buyer price; you receive 95%.
        </span>
        {state.error ? <span className={styles.fieldError}>{state.error}</span> : null}
        {state.success ? <span className={styles.hint}>{state.success}</span> : null}
      </div>
      <button className="button button--secondary" type="submit" disabled={disabled || pending}>
        {pending ? "Saving…" : "Save payout schedule"}
      </button>
    </form>
  );
}
