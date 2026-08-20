"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  claimBaseDomainAction,
  type BaseDomainState,
} from "@/lib/actions/partner-domain-actions";
import ActionError from "./ActionError";

/**
 * Claim a zone of your own.
 *
 * Bound directly to the server action so it also works as a plain form POST with no
 * JavaScript (CLAUDE.md §3). Cleared with `form.reset()` rather than a remount key,
 * for the reason `ClientChangeRequestForm` documents: remounting throws away the
 * acknowledgement in the same tick it is earned.
 *
 * No `pattern` on the input. The grammar lives in `normalizeBaseDomain`, which also
 * strips a pasted `https://` and a trailing slash — a browser-side pattern strict
 * enough to be useful would refuse exactly those pastes before the server ever gets
 * to be forgiving about them, and one loose enough to allow them proves nothing.
 */
export default function BaseDomainClaimForm() {
  const t = useTranslations("control.baseDomain");
  const [state, action, pending] = useActionState<BaseDomainState, FormData>(
    claimBaseDomainAction,
    {},
  );
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={action} className="grid gap-3 sm:max-w-xl">
      <label className="grid gap-1 font-label text-sm text-muted-foreground">
        {t("addLabel")}
        <input
          name="domain"
          required
          maxLength={253}
          autoComplete="off"
          spellCheck={false}
          placeholder={t("addPlaceholder")}
          className="input-primary font-mono"
        />
      </label>
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? t("adding") : t("addSubmit")}
        </button>
        {state.ok && (
          <span className="font-label text-craft-success-text dark:text-craft-success">
            {t("added")}
          </span>
        )}
        <ActionError code={state.error} />
      </div>
    </form>
  );
}
