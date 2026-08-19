// The two mails the free period was missing (EMAIL-SPEC-CONTROL-PLANE G2/G3).
//
// Kept apart from the sweep for the reason `go-live-email.ts` is: the flow should
// read as a flow, not as a template interleaved with one.
//
// WHAT THE PARTNER'S MAIL MAY NOT SAY. The owner's answer to O-T2 is that nothing
// happens when a trial ends — no mandate was taken, no card is on file, nothing is
// charged and nothing is suspended; the pay button simply returns. So this mail may
// not threaten suspension and may not imply an automatic charge. Both would be
// FALSE, and a false warning about money is the cheapest way to lose a partner who
// is still deciding whether to sell us to their client.
//
// It is also the FIRST localized mail in this codebase. Every other template is
// hardcoded English while both intakes have stored the visitor's language all along
// (EMAIL-SPEC §1). A bill is the wrong place to keep that gap.

import { sendEmail, escapeHtml, siteUrl } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
import { emailTranslator } from "@/lib/email-locale";
import { intervalKeyOf } from "@/lib/billing-display";
import { eur } from "@/lib/format";
import { PARTNER_WARNING_DAYS, type TrialPhase } from "@/lib/trial-warning-policy";

/**
 * The date, spelled out in the reader's own language — not the en-GB `shortDate` of
 * the UI, which is abbreviated for a table and reads oddly in a sentence.
 *
 * `en` is formatted as en-GB. Plain "en" is US-shaped ("August 22, 2026") and every
 * other surface in this company writes "22 August 2026": a NL-registered company
 * selling in CH has no US audience, and one mail in a different date order is exactly
 * the kind of small wrongness that makes a bill look like a phishing attempt.
 */
function longDate(locale: string, d: Date): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

/**
 * "Your free period ends on …" — to the person who would pay.
 *
 * Three things, in the order someone deciding actually needs them: WHEN the free
 * period ends, WHAT the plan costs after it, and the one link where they can start
 * the subscription themselves. Everything else is reassurance that nothing happens
 * on its own, which is the true and the useful thing to say.
 */
export async function sendTrialEndingEmail(opts: {
  to: string;
  /** The locale the control plane holds for them (`emailLocale`). */
  locale: string;
  contactName: string;
  restaurantName: string;
  /** What is true at the moment of sending — never what the milestone was. */
  phase: TrialPhase;
  endsAt: Date;
  daysLeft: number;
  amountCents: number;
  /** Mollie interval grammar, e.g. "1 month". */
  interval: string;
}): Promise<{ sent: boolean }> {
  const t = await emailTranslator(opts.locale, "emails.trialEnding");
  const plan = await emailTranslator(opts.locale, "control.plan");
  const date = longDate(opts.locale, opts.endsAt);
  // Escaped BEFORE interpolation, per lib/email-templates.ts's contract: the message
  // catalogue is ours and trusted, a restaurant name is not.
  const restaurant = escapeHtml(opts.restaurantName);
  const billingUrl = `${siteUrl()}/dashboard/billing`;
  const amountLine = plan("amountLine", {
    amount: eur(opts.amountCents),
    interval: plan(`interval.${intervalKeyOf(opts.interval)}`),
  });

  return sendEmail({
    to: opts.to,
    subject: t(`subject.${opts.phase}`, { date }),
    html: craftEmail({
      kicker: t("kicker"),
      title: t(`title.${opts.phase}`, { date }),
      bodyHtml: `<p style="margin:0 0 12px;">${t("greeting", { name: escapeHtml(opts.contactName) })}</p>
<p style="margin:0 0 12px;">${t(`lead.${opts.phase}`, { restaurant, date, days: opts.daysLeft })}</p>
<p style="margin:0 0 12px;">${t("noAutoCharge", { restaurant })}</p>
${detailRows([
  [t("rowRestaurant"), opts.restaurantName],
  [t("rowFreeUntil"), date],
  [t("rowPlan"), amountLine],
])}
<p style="margin:12px 0 0;">${t("howToStart")}</p>`,
      cta: { label: t("cta"), url: billingUrl },
      footerNote: t("footerNote"),
    }),
  });
}

/**
 * "A free period is ending" — to the founder's inbox, days before the payer hears it.
 *
 * English like every other founder notice (M5/M8), and deliberately the FIRST mail
 * out: the owner framed the partner's warning as conditional — *"if me as owner has
 * not extended their free usage"* — so this exists to make the extension possible
 * before, not after. It links straight at the panel that grants one.
 */
export async function sendTrialEndingFounderEmail(opts: {
  to: string;
  billingId: string;
  tenantSlug: string;
  restaurantName: string;
  payerName: string;
  payerEmail: string;
  endsAt: Date;
  daysLeft: number;
  amountCents: number;
  interval: string;
}): Promise<{ sent: boolean }> {
  return sendEmail({
    to: opts.to,
    subject: `SofraPiwas — Free period ending: ${opts.restaurantName}`,
    html: craftEmail({
      kicker: "Trials",
      title: "A free period is ending",
      bodyHtml: `${detailRows([
        ["Restaurant", opts.restaurantName],
        ["Tenant", opts.tenantSlug],
        ["Payer", `${opts.payerName} (${opts.payerEmail})`],
        // `longDate`, not `shortDate`: the latter formats in the SERVER's timezone,
        // and a trial ending at 23:59:59.999Z reads as the NEXT day from anywhere
        // east of Greenwich. The box runs UTC today, so this is a trap rather than a
        // live bug — one TZ env away from the founder and the partner being told two
        // different dates for the same free period.
        ["Free until", longDate("en", opts.endsAt)],
        ["Days left", String(opts.daysLeft)],
        ["Plan", `${eur(opts.amountCents)} / ${opts.interval}`],
      ])}
<p style="margin:12px 0 0;">They will be told ${PARTNER_WARNING_DAYS} days before it ends, and
again on the last day. Nothing is charged and nothing is suspended when it lapses — the pay button simply
comes back.</p>
<p style="margin:8px 0 0;">If this one should stay free for longer, extend it now: an
extension moves the date, and the payer is then told the new one instead.</p>`,
      cta: { label: "Extend the free period", url: `${siteUrl()}/admin/billing/${opts.billingId}` },
      footerNote: "You are seeing this before they do — that is the point of the fortnight.",
    }),
  });
}
