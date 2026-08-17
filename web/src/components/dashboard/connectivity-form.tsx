"use client";

import { useActionState } from "react";

import type { ActionState } from "@/features/gateway/actions";

import dashboardStyles from "./dashboard.module.css";

const styles = dashboardStyles as unknown as Record<string, string>;

export interface ConnectivityFormProps {
  readonly endpointId: string;
  readonly action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
}

export function ConnectivityForm({ endpointId, action }: ConnectivityFormProps) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction}>
      <input type="hidden" name="endpointId" value={endpointId} />
      {state.error !== undefined ? (
        <div className={styles.formError} role="alert">
          {state.error}
        </div>
      ) : null}
      {state.success !== undefined ? (
        <div className={styles.formSuccess} role="status">
          {state.success}
        </div>
      ) : null}
      <div className={styles.field}>
        <button className="button button--secondary" type="submit" disabled={pending}>
          {pending ? "Testing…" : "Test upstream connection"}
        </button>
        <span className={styles.hint}>
          Sends a real GET to your upstream with the saved credential. Nothing is billed.
        </span>
      </div>
    </form>
  );
}