"use client";

import { useState } from "react";
import { useLocale } from "next-intl";

/**
 * Shared submit machinery for the public intake forms (partner apply, signup):
 * serialise the form to a string map, run the caller's validation, POST JSON
 * with the active locale, and track status. The validation returns a status
 * string (e.g. "invalidEmail") to short-circuit, or null to proceed; it may
 * normalise `data` in place before the POST.
 */
export type IntakeStatus = "idle" | "sending" | "success" | "error" | (string & {});

export function useIntakeForm(
  endpoint: string,
  validate: (data: Record<string, string>) => string | null,
  /**
   * Fields rendered as a CHECKBOX GROUP (several inputs sharing one name).
   * `Object.fromEntries` keeps only the LAST value of a repeated key, so without
   * naming them here a group of ticked boxes silently collapses to one — the
   * client-side twin of the `formData.get()` bug fixed in provisioning-actions.
   * Listed fields are collected with `getAll` and joined into the comma-separated
   * grammar the registry and the zod schemas already speak.
   */
  multiValueFields: readonly string[] = [],
) {
  const locale = useLocale();
  const [status, setStatus] = useState<IntakeStatus>("idle");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    // FormData values are string | File; the intake forms are all text inputs,
    // so coerce to strings (avoids stringifying a stray File — Sonar S6551).
    const asString = (v: FormDataEntryValue) => (typeof v === "string" ? v : "");
    const data = Object.fromEntries(
      [...formData.entries()].map(([k, v]) => [k, asString(v)]),
    ) as Record<string, string>;
    for (const field of multiValueFields) {
      // Deduplicated: a mandatory value carried by BOTH a hidden input and a
      // ticked checkbox (e.g. the always-on locale) would otherwise appear twice.
      data[field] = [...new Set(formData.getAll(field).map(asString).filter(Boolean))].join(",");
    }

    const invalid = validate(data);
    if (invalid) {
      setStatus(invalid);
      return;
    }

    setStatus("sending");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, locale }),
      });
      if (!res.ok) throw new Error(`${endpoint} ${res.status}`);
      form.reset();
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  return { status, submit };
}

/**
 * Linear "looks like an email" check for client-side UX (the server validates
 * for real with zod `.email()`). Avoids a backtracking regex (Sonar S8786):
 * one `@`, a non-empty local part, and a dot in the domain that isn't at either
 * end. The only regex is a trivial whitespace test.
 */
export function looksLikeEmail(v: string): boolean {
  if (/\s/.test(v)) return false;
  const parts = v.split("@");
  return (
    parts.length === 2 &&
    parts[0].length > 0 &&
    parts[1].includes(".") &&
    !parts[1].startsWith(".") &&
    !parts[1].endsWith(".")
  );
}
