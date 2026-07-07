"use client";

import { useState } from "react";

/** Read-only value with a copy button — for handing links to tenants. */
export default function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={value}
        aria-label="Link"
        className="input-primary flex-1 min-w-[16rem] font-mono text-sm"
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button"
        className="btn-secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Clipboard blocked (permissions/http) — the field selects on
            // focus, so manual copy still works.
          }
        }}
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}
