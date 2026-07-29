import { getTranslations } from "next-intl/server";

/**
 * The owner's view of the window between "your payment went through" and "your
 * subscription is charging" (SOFRA-ONBOARDING-PLAN O2).
 *
 * That window is real and asynchronous: Mollie validates the recurring mandate
 * after the first payment settles, observed at ~80 s on staging but with a retry
 * schedule that reaches ~26 h in the worst case. The webhook answers non-2xx
 * while the mandate is still invalid so Mollie redelivers (lib/billing.ts
 * MandateNotReadyError) — which is correct, and completely invisible.
 *
 * Before this, the owner saw one muted word ("processing") for that entire
 * period. Someone who has just been charged and sees a single ambiguous word is
 * being told nothing: they cannot distinguish "working, wait" from "stuck, pay
 * again", and the one recovery action they will reach for — pay again — is the
 * exact thing that must not happen. So the state is stated in full: what has
 * happened, what is happening, what happens next, and that no second payment is
 * needed. It renders no pay button, by construction.
 *
 * `planState` calls this window "processing" because partners share that
 * vocabulary; the owner copy calls it "activating", matching the ACTIVATING
 * subscription status it covers. Same window, two audiences.
 */
export default async function ActivatingPanel({
  locale,
  restaurant,
}: {
  readonly locale: string;
  readonly restaurant: string;
}) {
  const t = await getTranslations({ locale, namespace: "control.plan.activating" });

  return (
    <div className="grid gap-3 border-l-2 border-primary/40 pl-4">
      <p className="font-label text-xs uppercase tracking-[0.15em] text-primary">{t("kicker")}</p>
      <p className="font-hand text-2xl font-bold">{t("title", { restaurant })}</p>
      <ol className="grid gap-1 font-label text-sm text-muted-foreground">
        <li>✓ {t("stepPaid")}</li>
        <li>… {t("stepMandate")}</li>
        <li>· {t("stepProvision")}</li>
      </ol>
      <p className="font-label text-sm text-muted-foreground">{t("noSecondPayment")}</p>
    </div>
  );
}
