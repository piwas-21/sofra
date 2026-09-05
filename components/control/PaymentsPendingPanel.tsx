import { getTranslations } from "next-intl/server";

/**
 * "Card payments are on their way" (SOFRA-PAYMENTS-PLAN §9 P4).
 *
 * The one window nothing else covers. A buyer of `online-payments` is provisioned
 * WITHOUT it — P1 makes the module and the connected account a pair, because
 * `provision-tenant.sh` refuses one without the other and refuses it before the
 * database — so they go live on everything else and trade on cash meanwhile.
 *
 * WHAT THIS WINDOW NOW MEANS (ADR-011 amendment). It used to be the ordinary state
 * of every self-serve buyer, on the premise that only the restaurant could create a
 * Stripe account. The control plane MINTS the account now, so reaching this panel
 * means OUR creation did not happen — which makes "there is nothing for you to do
 * right now" more true than it was, not less: the outstanding work is ours. That is
 * also why the copy still gives no estimate and still names nothing they cannot act
 * on; the failure is on our side of a wall they cannot see. Every other surface is honest about that state
 * and silent about it: RUMI's own checklist cannot see the purchase (only the grant),
 * and the tenant's checkout simply does not offer a card. Only this dashboard holds
 * both halves, so only this dashboard can say the thing out loud.
 *
 * **The copy rule (§9 Q1) is load-bearing and is enforced by a test.** The permitted
 * vocabulary is THEIR Stripe account, THEIR verification, and "we will tell you when
 * it is on". It may never name an environment variable, a box, a deploy, a registry,
 * a pull request or the founder — a customer cannot act on any of those and should
 * not have to learn that they exist. And because this panel genuinely cannot tell
 * "waiting on Stripe" from "waiting on us" (P7b is what will), it says the SMALLER
 * TRUE THING rather than guessing at Stripe. Saying less than you know is the design
 * here, not a shortfall.
 *
 * The billing sentence is Q3's answer (option B, owner, 2026-08-18): billed from
 * activation, that first month credited on request — the same policy the public FAQ
 * states. It names the billing start, the condition and the remedy, and deliberately
 * gives NO estimate of how long verification takes, because that is not ours to
 * promise.
 */
export default async function PaymentsPendingPanel({ locale }: { readonly locale: string }) {
  const t = await getTranslations({ locale, namespace: "control.paymentsPending" });

  return (
    <div className="grid gap-2 border-l-2 border-primary/40 pl-4">
      <p className="font-label text-xs uppercase tracking-[0.15em] text-primary">
        {t("kicker")}
      </p>
      <p className="font-hand text-2xl font-bold">{t("title")}</p>
      <p className="text-muted-foreground">{t("body")}</p>
      <p className="font-label text-sm text-muted-foreground">{t("billingNote")}</p>
      {/* Prose, not a link, and that is the Express change (ADR-011 amendment).
          This used to be an <a> to https://dashboard.stripe.com. Under Express a
          restaurant has no full Stripe dashboard to log into, and in THIS state
          they have no account at all — so that link led somewhere they could not
          get in. The sentence it carried was still useful ("your own Stripe view is
          coming, here is what it will ask"), so it is re-stated rather than
          deleted: what the short form asks for, and why no link can be kept. */}
      <p className="font-label text-sm text-muted-foreground">{t("nextStep")}</p>
    </div>
  );
}
