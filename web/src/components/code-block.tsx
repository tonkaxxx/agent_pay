"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CodeBlock({ label, code }: Readonly<{ label: string; code: string }>) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="docs-code-block">
      <div className="docs-code-bar">
        <span>{label}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={`${copied ? "Copied" : "Copy"} ${label}`}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}
