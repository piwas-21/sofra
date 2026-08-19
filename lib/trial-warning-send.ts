// From a plan row to a sent mail — the adapter between the sweep
// (`trial-warning-notify.ts`) and the templates (`trial-warning-email.ts`).
//
// It exists so that the ONE rule both sends must obey lives in one place: every send
// is `.catch()`ed to a verdict, because `sendEmail` swallows a non-2xx but a
// DNS/connect failure REJECTS — and an escaping rejection would lose the audit row
// the sweep writes afterwards, which is the very record that stops the next run from
// mailing the same partner again.

import { emailLocale } from "@/lib/email-locale";
import { payerGreetingName, type PayerContact } from "@/lib/payer-contact";
import { sendTrialEndingEmail, sendTrialEndingFounderEmail } from "@/lib/trial-warning-email";
import type { TrialWarningVerdict } from "@/lib/trial-warning-policy";

/** A trial verdict that decided to speak. */
export type DueWarning = Extract<TrialWarningVerdict, { warn: true }>;

/** The plan columns a warning needs — the sweep's `select`, named. */
export type WarnablePlan = PayerContact & {
  id: string;
  tenantSlug: string;
  /** The lead a self-serve plan was minted from; carries the locale it was made in. */
  signupRequest?: { locale: string } | null;
};

/** The priced half of the plan. Non-optional: a plan with no subscription is
 *  `planState` "none" and never reaches here. */
export type WarnableSubscription = { amountCents: number; interval: string };

const caught = { sent: false };

/** The founder's heads-up. `{sent:false}` when no `WAITLIST_TO` is configured —
 *  the same honest reading `requestOnboardingAction` records: nobody was told. */
export async function sendFounderNotice(
  inbox: string | undefined,
  plan: WarnablePlan,
  sub: WarnableSubscription,
  verdict: DueWarning,
): Promise<{ sent: boolean }> {
  if (!inbox) return caught;
  return sendTrialEndingFounderEmail({
    to: inbox,
    billingId: plan.id,
    tenantSlug: plan.tenantSlug,
    restaurantName: plan.name,
    payerName: payerGreetingName(plan),
    payerEmail: plan.client?.partner?.email ?? plan.payer?.email ?? plan.email,
    endsAt: verdict.endsAt,
    daysLeft: verdict.daysLeft,
    amountCents: sub.amountCents,
    interval: sub.interval,
  }).catch(() => caught);
}

/** The payer's own warning, in the language the control plane holds for them. */
export async function sendPayerWarning(
  to: string,
  plan: WarnablePlan,
  sub: WarnableSubscription,
  verdict: DueWarning,
  heldLocale: string | undefined,
): Promise<{ sent: boolean }> {
  return sendTrialEndingEmail({
    to,
    locale: emailLocale(heldLocale, plan.signupRequest?.locale),
    contactName: payerGreetingName(plan),
    restaurantName: plan.name,
    phase: verdict.phase,
    endsAt: verdict.endsAt,
    daysLeft: verdict.daysLeft,
    amountCents: sub.amountCents,
    interval: sub.interval,
  }).catch(() => caught);
}
