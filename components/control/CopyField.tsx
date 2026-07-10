"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/** Read-only value with a copy button — for handing links to tenants. */
export default function CopyField({ value }: { value: string }) {
  const t = useTranslations("control.copy");
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={value}
        aria-label={t("aria")}
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
        {copied ? t("copied") : t("copy")}
      </button>
    </div>
  );
}
