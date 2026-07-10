"use client";

import { useTranslations } from "next-intl";
import { ErrorMessage } from "./StatusMessage";

/**
 * Renders a server-action error localized. Actions return message KEYS
 * (resolved here against control.errors / auth.errors — sofra #9); a few
 * paths pass through raw upstream text (Zod issue messages, Mollie API
 * errors) which renders verbatim as a fallback.
 */
export default function ActionError({
  code,
  namespace = "control.errors",
}: {
  code?: string;
  namespace?: "control.errors" | "auth.errors";
}) {
  const t = useTranslations(namespace);
  if (!code) return null;
  return <ErrorMessage>{t.has(code) ? t(code) : code}</ErrorMessage>;
}
