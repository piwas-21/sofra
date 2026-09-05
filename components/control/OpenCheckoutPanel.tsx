import { getTranslations } from "next-intl/server";
import CopyField from "@/components/control/CopyField";

/**
 * The copyable link for a plan's still-open first checkout, on the founder's
 * billing detail page.
 *
 * Extracted for the reason `PlanPaymentsList` was — the page reached its §4
 * length limit — and this section was the next most mechanical one on it: it
 * needs the payment list and nothing else the page computes, and it decides one
 * thing (is there an unpaid checkout still worth sending someone).
 *
 * "Open" is `open` OR `pending`: Mollie reports a checkout the payer has landed
 * on but not completed as `pending`, and that link is still the one to resend.
 * Renders nothing at all when there is none — an absent link is not a state
 * worth a sentence.
 */
export default async function OpenCheckoutPanel({
  locale,
  payments,
}: {
  readonly locale: string;
  readonly payments: ReadonlyArray<{
    readonly checkoutUrl: string | null;
    readonly status: string;
  }>;
}) {
  const open = payments.find((p) => p.checkoutUrl && (p.status === "open" || p.status === "pending"));
  if (!open?.checkoutUrl) return null;

  const t = await getTranslations({ locale, namespace: "control.admin.billingDetail" });
  return (
    <section className="hand-drawn-border bg-card p-5">
      <h2 className="font-hand text-2xl font-bold">{t("checkoutTitle")}</h2>
      <p className="mt-1 font-label text-sm text-muted-foreground">{t("checkoutIntro")}</p>
      <div className="mt-3">
        <CopyField value={open.checkoutUrl} />
      </div>
    </section>
  );
}
