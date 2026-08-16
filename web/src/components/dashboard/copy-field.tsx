"use client";

import { useState } from "react";

import dashboardStyles from "./dashboard.module.css";

const styles = dashboardStyles as unknown as Record<string, string>;

export interface CopyFieldProps {
  readonly value: string;
}

export function CopyField({ value }: CopyFieldProps) {
  const [copied, setCopied] = useState(false);

  return (
    <div className={styles.gatewayUrl}>
      <code className={styles.mono}>{value}</code>
      <button
        className="console-button"
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}