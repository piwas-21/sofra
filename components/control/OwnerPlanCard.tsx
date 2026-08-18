import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { eur, shortDate } from "@/lib/format";
import {
  intervalKeyOf,
  nextChargeDate,
  paymentStatusKey,
  planState,
  sequenceKey,
  type PlanState,
} from "@/lib/billing-display";
import { visibleTenantStage, type TenantStage } from "@/lib/tenant-liveness";
import StartPaymentButton from "./StartPaymentButton";
import ActivatingPanel from "./ActivatingPanel";
import TenantReadyPanel from "./TenantReadyPanel";
import PaymentsPendingPanel from "./PaymentsPendingPanel";

/**
 * An owner's single plan, in full (SOFRA-ONBOARDING-PLAN O4 — the gap O2 named and
 * deliberately left open).
 *
 * Until this existed, an owner whose plan went ACTIVE saw one sentence: *"Your
 * subscription is active — nothing to do here right now."* No amount, no next-charge
 * date, no payment history, no mention of the app they are paying for. Not broken —
 * but a defaulted "nothing to do", which is the shape this funnel keeps having to
 * remove now that no founder is on the call to fill it in. Someone whose card is
 * charged monthly is entitled to see what for and when next.
 *
 * The fix is NOT to loosen `/dashboard/billing`. That page is `requirePartner()`
 * because it is the reseller's book — every plan under their partner id, priced as a
 * pipeline. An owner needs their own plan, and the panel that tells them where their
 * restaurant is; those are one card, not a page they share with a reseller.
 */
export interface OwnerPlanCardProps {
  readonly locale: string;
  readonly billingId: string;
  readonly restaurant: string;
  readonly ownerName: string;
  readonly subscription: { readonly status: string; readonly amountCents: number; readonly interval: string; readonly startDate: Date | null } | null;
  /** `first`-sequence payments only — what `planState` reads. */
  readonly firstPayments: ReadonlyArray<{ readonly sequenceType: string; readonly status: string }>;
  /** Newest-first, bounded: every payment, for the history list. */
  readonly history: ReadonlyArray<{ readonly id: string; readonly createdAt: Date; readonly sequenceType: string; readonly status: string; readonly amountCents: number }>;
  readonly liveSince: Date | null;
  readonly stage: TenantStage;
  readonly tenantDomain: string | null;
  /** Whether this plan has the legal details an invoice needs (B5). False sends
   *  the owner to the form INSTEAD of a pay button — `startPaymentAction` refuses
   *  without them, so offering the button here would be a control that only ever
   *  errors. */
  readonly invoiceable: boolean;
  /** Bought online payments, not granted them yet (O7 P4) — see `isPaymentsPending`. */
  readonly paymentsPending: boolean;
}

/**
 * What the owner can do about this plan right now. Guard clauses rather than nested
 * ternaries (Sonar S3358), and no pay button in the "processing" window — a second
 * payment there is the double-charge trap `ActivatingPanel` exists to prevent.
 */
function planAction(args: {
  state: PlanState;
  billingId: string;
  locale: string;
  restaurant: string;
  nextCharge: Date | null;
  invoiceable: boolean;
  t: (key: string, values?: Record<string, string>) => string;
}) {
  const { state, billingId, locale, restaurant, nextCharge, invoiceable, t } = args;
  // Before the pay button, not instead of the gate. `startPaymentAction` refuses
  // a plan with no billing identity, because no charge may settle that cannot
  // then be invoiced — so without this branch a self-serve owner meets a pay
  // button that only ever returns an error, with no hint of what to do. Ask for
  // the details first and the same click works.
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
  if (state === "processing") return <ActivatingPanel locale={locale} restaurant={restaurant} />;
  if (state === "active") {
    return (
      <p className="font-label text-craft-success-text dark:text-craft-success">
        {nextCharge ? t("activeNextCharge", { date: shortDate(nextCharge) }) : t("active")}
      </p>
    );
  }
  return <p className="font-label text-muted-foreground">{t("inactive")}</p>;
}

export default async function OwnerPlanCard(props: OwnerPlanCardProps) {
  const { locale, billingId, restaurant, ownerName, subscription, firstPayments, history } = props;
  const t = await getTranslations({ locale, namespace: "control.plan" });
  const state = planState(subscription ?? undefined, [...firstPayments]);

  return (
    <section className="hand-drawn-border bg-card p-6 sm:p-8 grid gap-4">
      <p className="font-label text-xs uppercase tracking-[0.15em] text-primary">
        {t("welcomeKicker")}
      </p>
      <h2 className="font-display font-bold text-4xl">{t("welcomeTitle", { name: ownerName })}</h2>

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-hand text-3xl font-bold">{restaurant}</h3>
        {props.liveSince && (
          <span className="font-label text-sm text-muted-foreground">
            {t("liveSinceShort", { date: shortDate(props.liveSince) })}
          </span>
        )}
      </div>

      {subscription ? (
        <>
          <p className="font-hand text-3xl font-bold">
            {t("amountLine", {
              amount: eur(subscription.amountCents),
              interval: t(`interval.${intervalKeyOf(subscription.interval)}`),
            })}
          </p>
          {planAction({
            state,
            billingId,
            locale,
            restaurant,
            nextCharge: nextChargeDate(subscription.startDate, subscription.interval, new Date()),
            invoiceable: props.invoiceable,
            t,
          })}
        </>
      ) : (
        <p className="font-label text-muted-foreground">{t("noPlan")}</p>
      )}

      <TenantReadyPanel
        locale={locale}
        stage={visibleTenantStage(props.stage, state === "processing")}
        domain={props.tenantDomain}
      />

      {/* After the readiness panel on purpose: "where is my app" is the bigger
          question, and this one is only meaningful once there is an app to take a
          card in. */}
      {props.paymentsPending && <PaymentsPendingPanel locale={locale} />}

      {history.length > 0 && (
        <div className="grid gap-1">
          <h4 className="font-label text-sm uppercase tracking-wide text-muted-foreground">
            {t("history")}
          </h4>
          <ul className="grid gap-1 font-label text-sm">
            {history.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-2 text-muted-foreground">
                <span>
                  {shortDate(p.createdAt)} · {t(`sequence.${sequenceKey(p.sequenceType)}`)}
                </span>
                <span>
                  {eur(p.amountCents)} ·{" "}
                  {t(`paymentStatus.${paymentStatusKey(p.status)}`, { status: p.status })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
