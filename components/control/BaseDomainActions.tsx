"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  removeBaseDomainAction,
  verifyBaseDomainAction,
  type BaseDomainState,
} from "@/lib/actions/partner-domain-actions";
import ActionError from "./ActionError";

/**
 * "Check now" and "Remove", for one claimed zone.
 *
 * Two separate `<form>`s rather than one form with two submit buttons: without JS a
 * multi-button form posts whichever button the browser decides is default, and these
 * two do very different things. Each is bound to its own action, each carries the id
 * as a hidden field, and both work as plain POSTs.
 *
 * The check result is rendered here rather than by the parent because it is per-row:
 * a partner with two zones pressing check on the second one must not see the answer
 * appear next to the first.
 */
export default function BaseDomainActions({
  id,
  verified,
}: Readonly<{ id: string; verified: boolean }>) {
  const t = useTranslations("control.baseDomain");
  const [checkState, checkAction, checking] = useActionState<BaseDomainState, FormData>(
    verifyBaseDomainAction,
    {},
  );
  const [removeState, removeAction, removing] = useActionState<BaseDomainState, FormData>(
    removeBaseDomainAction,
    {},
  );

  // Flattened out of the button, not for style: a nested ternary in JSX is the shape
  // that gets misread on the next edit (Sonar S3358).
  const idleLabel = verified ? "recheck" : "verify";

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <form action={checkAction}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" disabled={checking} className="btn-secondary text-sm disabled:opacity-60">
            {checking ? t("verifying") : t(idleLabel)}
          </button>
        </form>
        <form action={removeAction}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            disabled={removing}
            className="font-label text-sm text-muted-foreground underline disabled:opacity-60"
          >
            {removing ? t("removing") : t("remove")}
          </button>
        </form>
        {checkState.verified && (
          <span className="font-label text-sm text-craft-success-text dark:text-craft-success">
            {t("verifiedNow")}
          </span>
        )}
      </div>
      <ActionError code={checkState.error} />
      <ActionError code={removeState.error} />
    </div>
  );
}
