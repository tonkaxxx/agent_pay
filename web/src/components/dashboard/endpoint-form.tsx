"use client";

import Link from "next/link";
import { useActionState } from "react";

import type { ActionState } from "@/features/gateway/actions";

import dashboardStyles from "./dashboard.module.css";

const styles = dashboardStyles as unknown as Record<string, string>;

export interface EndpointFormInitial {
  readonly displayName: string;
  readonly upstreamUrl: string;
  readonly authMode: string;
  readonly price: string;
  readonly payTo: string;
}

const EMPTY: EndpointFormInitial = {
  displayName: "",
  upstreamUrl: "",
  authMode: "bearer",
  price: "0.01",
  payTo: "",
};

export interface EndpointFormProps {
  readonly mode: "create" | "edit";
  readonly endpointId?: string;
  readonly initial?: EndpointFormInitial;
  readonly existingSecret: boolean;
  readonly armed: boolean;
  readonly action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
}

export function EndpointForm({
  mode,
  endpointId,
  initial = EMPTY,
  existingSecret,
  armed,
  action,
}: EndpointFormProps) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction}>
      {mode === "edit" && endpointId !== undefined ? (
        <input type="hidden" name="endpointId" value={endpointId} />
      ) : null}

      {state.error !== undefined ? (
        <div className={styles.formError} role="alert">
          {state.error}
        </div>
      ) : null}

      <div className={styles.field}>
        <label htmlFor="displayName">Display name</label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          required
          maxLength={80}
          defaultValue={initial.displayName}
          placeholder="Weather API"
          aria-invalid={state.fieldErrors?.displayName !== undefined}
        />
        {state.fieldErrors?.displayName !== undefined ? (
          <span className={styles.fieldError}>{state.fieldErrors.displayName}</span>
        ) : null}
      </div>

      <div className={styles.field}>
        <label htmlFor="upstreamUrl">Your HTTPS GET endpoint</label>
        <input
          id="upstreamUrl"
          name="upstreamUrl"
          type="text"
          required
          defaultValue={initial.upstreamUrl}
          placeholder="https://api.example.com/weather"
          aria-invalid={state.fieldErrors?.upstreamUrl !== undefined}
        />
        {state.fieldErrors?.upstreamUrl !== undefined ? (
          <span className={styles.fieldError}>{state.fieldErrors.upstreamUrl}</span>
        ) : null}
        <span className={styles.hint}>
          Query strings, ports, credentials, and fragments are not supported.
        </span>
      </div>

      <div className={styles.field}>
        <label htmlFor="authMode">Upstream authentication</label>
        <select id="authMode" name="authMode" defaultValue={initial.authMode}>
          <option value="bearer">Bearer token</option>
          <option value="x-api-key">X-API-Key header</option>
          <option value="none">No auth (draft only)</option>
        </select>
        {state.fieldErrors?.authMode !== undefined ? (
          <span className={styles.fieldError}>{state.fieldErrors.authMode}</span>
        ) : null}
      </div>

      <div className={styles.field}>
        <label htmlFor="credential">
          {existingSecret && mode === "edit"
            ? "Replace upstream secret (leave blank to keep)"
            : "Upstream secret"}
        </label>
        <input
          id="credential"
          name="credential"
          type="password"
          autoComplete="new-password"
          defaultValue=""
          maxLength={2000}
          placeholder="Your upstream Bearer or API key"
          aria-invalid={state.fieldErrors?.credential !== undefined}
        />
        {state.fieldErrors?.credential !== undefined ? (
          <span className={styles.fieldError}>{state.fieldErrors.credential}</span>
        ) : null}
        <span className={styles.hint}>Encrypted at rest; never shown again.</span>
      </div>

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="price">Price (USDC)</label>
          <input
            id="price"
            name="price"
            type="number"
            required
            min="0.000001"
            max="1000"
            step="0.000001"
            defaultValue={initial.price}
            aria-invalid={state.fieldErrors?.price !== undefined}
          />
          {state.fieldErrors?.price !== undefined ? (
            <span className={styles.fieldError}>{state.fieldErrors.price}</span>
          ) : null}
        </div>

        <div className={styles.field}>
          <label htmlFor="payTo">Base payout address</label>
          <input
            id="payTo"
            name="payTo"
            type="text"
            required
            defaultValue={initial.payTo}
            placeholder="0x…"
            aria-invalid={state.fieldErrors?.payTo !== undefined}
          />
          {state.fieldErrors?.payTo !== undefined ? (
            <span className={styles.fieldError}>{state.fieldErrors.payTo}</span>
          ) : null}
        </div>
      </div>

      <div className={styles.field}>
        <button className="button button--primary" type="submit" disabled={pending}>
          {pending
            ? mode === "create"
              ? "Creating…"
              : "Saving…"
            : mode === "create"
              ? "Create draft endpoint"
              : "Save changes"}
        </button>
      </div>

      {!armed ? (
        <p className={styles.warn}>
          Price and payout changes to an active endpoint require a fresh sign-in. You can edit them
          freely while the endpoint is a draft.
        </p>
      ) : null}

      {mode === "edit" ? (
        <p className={styles.hint}>
          <Link href={`/dashboard/${endpointId ?? ""}`}>Back to endpoint</Link>
        </p>
      ) : (
        <p className={styles.hint}>
          Drafts cost nothing. Activate after your first “Test connectivity”.
        </p>
      )}
    </form>
  );
}