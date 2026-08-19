import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { shortDate } from "@/lib/format";
import type { PlanState } from "@/lib/billing-display";
import StartPaymentButton from "./StartPaymentButton";

/**
 * What a RESELLER can do about a plan right now — the whole state machine, in one
 * place.
 *
 * Lifted out of `PartnerDashboard` when the client detail page needed the same
 * decision: a partner reads their landing page and the client page as one surface, and
 * two copies of this would eventually disagree about the one state where disagreeing
 * costs money.
 *
 * The rule that must survive every edit: **no pay button in the "processing" window.**
 * That window is a first payment that has settled while the mandate is still being
 * validated, and a second button there is a second charge on a card that has already
 * paid. `planState` is what defines the window; nothing here may second-guess it by
 * reading the subscription status directly.
 *
 * The same rule now covers the free period (T-b): during a trial this says what is
 * true — nothing is owed yet, and until when — and offers no button. `trialEndsAt` is
 * carried only to PRINT; whether the plan is in trial was already decided by
 * `planState`, and re-deciding it here is how the hero and the client page would come
 * to disagree about whether a restaurant owes money.
 *
 * Guard clauses rather than nested ternaries (Sonar S3358).
 */
export default async function PartnerPlanAction({
  locale,
  state,
  billingId,
  invoiceable,
  nextCharge,
  trialEndsAt,
}: {
  readonly locale: string;
  readonly state: PlanState;
  readonly billingId: string;
  /** Whether `startPaymentAction` would accept this plan (B5 billing identity). */
  readonly invoiceable: boolean;
  /** Derived next charge for an active plan, or null when it cannot be stated. */
  readonly nextCharge: Date | null;
  /** The free period's end — printed when `state` is "trial", ignored otherwise. */
  readonly trialEndsAt: Date | null;
}) {
  const t = await getTranslations({ locale, namespace: "control.plan" });

  // In trial: the sentence the partner is entitled to, and NO pay button. It comes
  // before the billing-details branch because we are not asking them for anything
  // yet — a form for details we do not need is the same "do something" prompt the
  // free period exists to remove.
  if (state === "trial") {
    return (
      <p className="font-label text-craft-success-text dark:text-craft-success">
        {trialEndsAt ? t("trialFreeUntil", { date: shortDate(trialEndsAt) }) : t("trialFree")}
      </p>
    );
  }

  // Before the pay button, not instead of the gate: `startPaymentAction` refuses a
  // plan with no billing identity, so a button here would be a control that only ever
  // errors. Ask for the details first and the same click works.
  if (state === "pay" && !invoiceable) {
    return (
      <div className="grid gap-2">
        <Link href="/dashboard/billing/details" className="btn-primary w-fit">
          {t("addBillingDetails")}
        </Link>
        <span className="font-label text-sm text-muted-foreground">
          {t("billingDetailsFirst")}
        </span>
      </div>
    );
  }
  if (state === "pay") {
    return (
      <div className="grid gap-2">
        <StartPaymentButton billingId={billingId} />
        <span className="font-label text-sm text-muted-foreground">{t("firstChargeNote")}</span>
      </div>
    );
  }
  if (state === "processing") {
    return <p className="font-label text-muted-foreground">{t("processing")}</p>;
  }
  if (state === "active") {
    return (
      <p className="font-label text-craft-success-text dark:text-craft-success">
        {nextCharge ? t("activeNextCharge", { date: shortDate(nextCharge) }) : t("active")}
      </p>
    );
  }
  if (state === "inactive") {
    return <p className="font-label text-muted-foreground">{t("inactive")}</p>;
  }
  return <p className="font-label text-muted-foreground">{t("noPlan")}</p>;
}
