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
 * Guard clauses rather than nested ternaries (Sonar S3358).
 */
export default async function PartnerPlanAction({
  locale,
  state,
  billingId,
  invoiceable,
  nextCharge,
}: {
  readonly locale: string;
  readonly state: PlanState;
  readonly billingId: string;
  /** Whether `startPaymentAction` would accept this plan (B5 billing identity). */
  readonly invoiceable: boolean;
  /** Derived next charge for an active plan, or null when it cannot be stated. */
  readonly nextCharge: Date | null;
}) {
  const t = await getTranslations({ locale, namespace: "control.plan" });

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
