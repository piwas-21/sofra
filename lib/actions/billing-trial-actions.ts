"use server";

// Extending a plan's free period (workspace docs/plans/SOFRA-PARTNER-FLEXIBILITY-PLAN.md,
// T-c).
//
// `requireAdmin()`, and nothing softer. A partner extending their own trial is a
// partner helping themselves to free product, so this is the one control in the
// programme that must never appear on a partner surface — not disabled there, not
// present. The guard is the boundary; the page is chrome (ADR-008).
//
// EXTENSION ONLY, enforced in `extendTrialVerdict`: a trial may be pushed out and
// never pulled in. A restaurant told "free until October" and charged in September
// is a refund conversation and a lost partner, and a settled charge has no undo.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { extendTrialVerdict } from "@/lib/trial";

/** `error` is a `control.errors` message key, rendered by <ActionError />. */
export type ExtendTrialState = { error?: string; ok?: boolean };

const REASON_MIN = 3;
const REASON_MAX = 300;

export async function extendTrialAction(
  _prev: ExtendTrialState,
  formData: FormData,
): Promise<ExtendTrialState> {
  const admin = await requireAdmin();

  // `typeof === "string"`, not String(): FormData entries are `string | File`,
  // and String(File) is "[object File]" — which a length check would happily
  // accept as a reason.
  const raw = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : "";
  };
  const billingId = raw("billingId");
  const reason = raw("reason");
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) {
    return { error: "trialReasonRequired" };
  }

  const billing = await db.tenantBilling.findUnique({ where: { id: billingId } });
  if (!billing) return { error: "planNotFound" };

  const verdict = extendTrialVerdict({
    current: billing.trialEndsAt,
    requested: raw("trialEndsAt"),
    now: new Date(),
  });
  if (!verdict.ok) return { error: verdict.reason };

  // Conditional on the value we judged. Two founders (or one double-submit) could
  // otherwise interleave, and the LAST write would win — which for a rule that only
  // ever moves outward could quietly land on the EARLIER of two granted dates. The
  // `updateMany` writes nothing if the row moved under us, and the caller is told to
  // look again rather than shown a success for a date that is not stored.
  const written = await db.tenantBilling.updateMany({
    where: { id: billing.id, trialEndsAt: billing.trialEndsAt },
    data: { trialEndsAt: verdict.endsAt },
  });
  if (written.count !== 1) return { error: "trialChangedMeanwhile" };

  // from/to/reason — the three things "why is this tenant still free" needs, and the
  // only record of the decision: the column holds the answer, never the argument.
  await audit(admin.id, "billing.trial.extended", "TenantBilling", billing.id, {
    tenantSlug: billing.tenantSlug,
    from: billing.trialEndsAt?.toISOString() ?? null,
    to: verdict.endsAt.toISOString(),
    reason,
  });

  revalidatePath(`/admin/billing/${billing.id}`);
  revalidatePath("/admin/billing");
  return { ok: true };
}
