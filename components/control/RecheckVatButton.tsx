"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { recheckVatAction, type IdentityActionState } from "@/lib/actions/billing-identity-actions";
import ActionError from "./ActionError";

/**
 * Ask VIES again.
 *
 * This is the exit from `UNAVAILABLE`, which is a routine outcome rather than an
 * edge case — the French node throttled 5 of 8 calls while the plan was being
 * researched. Without it the badge tells an operator to "try again later" with
 * nothing to press, and the only way to retry would be re-submitting the whole
 * identity form, which invites editing an address just to repeat a lookup.
 *
 * It is also the control that closes the trigger case: the first partner's VAT
 * number is real but not yet published to VIES, and on the day their tax office
 * activates it nothing else about their record changes.
 *
 * Its own <form>, so it stays a plain POST and never nests inside the identity
 * form — a nested form is invalid HTML and would submit the wrong action.
 */
export default function RecheckVatButton({ identityId }: Readonly<{ identityId: string }>) {
  const t = useTranslations("control.admin.identity");
  const [state, action, pending] = useActionState<IdentityActionState, FormData>(
    recheckVatAction,
    {},
  );

  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="identityId" value={identityId} />
      <button type="submit" className="btn-secondary text-sm" disabled={pending}>
        {pending ? t("rechecking") : t("recheck")}
      </button>
      <ActionError code={state.error} />
    </form>
  );
}
