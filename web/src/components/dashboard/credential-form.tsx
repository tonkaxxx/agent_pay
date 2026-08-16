"use client";

import { useActionState } from "react";

import type { ActionState } from "@/features/gateway/actions";

import dashboardStyles from "./dashboard.module.css";

const styles = dashboardStyles as unknown as Record<string, string>;

export interface CredentialFormProps {
  readonly endpointId: string;
  readonly action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
}

export function CredentialForm({ endpointId, action }: CredentialFormProps) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction}>
      <input type="hidden" name="endpointId" value={endpointId} />
      {state.error !== undefined ? (
        <div className={styles.formError} role="alert">
          {state.error}
        </div>
      ) : null}
      <div className={styles.field}>
        <label htmlFor="credential">New upstream secret</label>
        <input
          id="credential"
          name="credential"
          type="password"
          autoComplete="new-password"
          maxLength={2000}
          placeholder="Bearer token or API key"
          aria-invalid={state.fieldErrors?.credential !== undefined}
        />
        {state.fieldErrors?.credential !== undefined ? (
          <span className={styles.fieldError}>{state.fieldErrors.credential}</span>
        ) : null}
        <span className={styles.hint}>
          Encrypted with the gateway master key; rotated immediately and applied to live requests.
        </span>
      </div>
      <div className={styles.field}>
        <button className="button button--secondary" type="submit" disabled={pending}>
          {pending ? "Rotating…" : "Rotate credential"}
        </button>
      </div>
    </form>
  );
}