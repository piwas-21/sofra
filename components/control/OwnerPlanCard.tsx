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
  t: (key: string, values?: Record<string, string>) => string;
}) {
  const { state, billingId, locale, restaurant, nextCharge, t } = args;
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
