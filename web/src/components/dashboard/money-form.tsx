"use client";

import { useActionState } from "react";

import type { ActionState } from "@/features/gateway/actions";

import dashboardStyles from "./dashboard.module.css";

const styles = dashboardStyles as unknown as Record<string, string>;

export interface MoneyFormProps {
  readonly endpointId: string;
  readonly action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  readonly fieldName: string;
  readonly label: string;
  readonly explainer: string;
  readonly defaultValue: string;
}

export function MoneyForm({
  endpointId,
  action,
  fieldName,
  label,
  explainer,
  defaultValue,
}: MoneyFormProps) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction}>
      <input type="hidden" name="endpointId" value={endpointId} />
      <div className={styles.field}>
        <label htmlFor={fieldName}>{label}</label>
        <input
          id={fieldName}
          name={fieldName}
          type="text"
          required
          defaultValue={defaultValue}
          aria-invalid={state.fieldErrors?.[fieldName] !== undefined}
        />
        {state.fieldErrors?.[fieldName] !== undefined ? (
          <span className={styles.fieldError}>{state.fieldErrors[fieldName]}</span>
        ) : null}
        <span className={styles.hint}>{explainer}</span>
      </div>
      <div className={styles.field}>
        <button className="button button--secondary" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {state.error !== undefined ? (
        <div className={styles.formError} role="alert">
          {state.error}
        </div>
      ) : null}
    </form>
  );
}