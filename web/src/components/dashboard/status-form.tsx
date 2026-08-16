"use client";

import { useActionState } from "react";

import type { ActionState } from "@/features/gateway/actions";
import type { EndpointStatus } from "@/features/gateway/repository";

import dashboardStyles from "./dashboard.module.css";

const styles = dashboardStyles as unknown as Record<string, string>;

export interface StatusFormProps {
  readonly endpointId: string;
  readonly status: EndpointStatus;
  readonly action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
}

export function StatusForm({ endpointId, status, action }: StatusFormProps) {
  const [state, formAction, pending] = useActionState(action, {});

  if (status === "active") {
    return (
      <form action={formAction} className={styles.field}>
        <input type="hidden" name="endpointId" value={endpointId} />
        <input type="hidden" name="status" value="paused" />
        <button className="button button--secondary" type="submit" disabled={pending}>
          {pending ? "Pausing…" : "Pause endpoint"}
        </button>
        {state.error !== undefined ? (
          <p className={styles.hint} role="alert">
            {state.error}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <form action={formAction} className={styles.field}>
      <input type="hidden" name="endpointId" value={endpointId} />
      <input type="hidden" name="status" value="active" />
      <button className="button button--primary" type="submit" disabled={pending}>
        {pending ? "Activating…" : "Activate endpoint"}
      </button>
      {state.error !== undefined ? (
        <p className={styles.hint} role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}