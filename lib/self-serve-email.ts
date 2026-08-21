// The two emails a self-serve signup sends (SOFRA-ONBOARDING-PLAN O2), and the
// invite template the founder's own onboarding path shares with it.
//
// Split out of the intake route so the route reads as the flow it is (guard →
// validate → decide → mint → notify) rather than interleaving two templates with
// it, and so the route stays inside the file-length limit as O2 grows.
//
// Both are best-effort at the call site: the account and the plan are already
// committed by the time these run, so a Resend outage must not turn a paid-up
// customer into a 500. The founder notification is the backstop — it names the
// restaurant and the plan, so a missed welcome email is recoverable by hand.
//
// LANGUAGE (G9). The customer-facing half is localized and the founder-facing
// half is not, and that asymmetry is the whole rule: the founder is one person who
// reads English, while the invite is the FIRST thing a restaurant owner in Geneva
// ever receives from us and the only route into an account with no password.

import { sendEmail, escapeHtml, siteUrl } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
import { emailTranslator } from "@/lib/email-locale";
import { eur } from "@/lib/format";

/**
 * "Your restaurant has an account — here is how to get in and start paying."
 *
 * The one template behind BOTH onboarding paths: the founder's `/admin/onboard`
 * and the self-serve signup. It was two near-identical copies for one commit and
 * they had already drifted a sentence apart, which is exactly how the next reader
 * ends up unsure which one customers actually receive.
 *
 * `inviteToken` is null when the account already has a password — that recipient
 * gets a login link, because handing an existing account a set-password link
 * invites them to reset a password they already know.
 *
 * `rows` lets the self-serve caller state the address and the monthly total. That
 * total is the number the dashboard will charge, re-quoted from the catalog;
 * saying it here means the first figure they see after setting a password is one
 * they have already read.
 *
 * Returns Resend's verdict, and callers must use it: a swallowed `{sent:false}`
 * is a customer told to check an inbox nothing was sent to.
 */
export async function sendInviteEmail(opts: {
  to: string;
  /** The person, for the greeting. */
  name: string;
  restaurantName: string;
  inviteToken: string | null;
  /** The language this person is written to in — `User.locale`, or the intake's
   *  own locale for an account that does not exist yet. */
  locale: string;
  /** Extra `detailRows` beneath the copy; omit for the founder path. */
  rows?: [string, string][];
}): Promise<{ sent: boolean }> {
  const t = await emailTranslator(opts.locale, "emails.invite");
  const needsPassword = opts.inviteToken !== null;
  // ONE variant key, used for the subject, the title, the lead and the button, so
  // the four cannot drift into describing different situations to one reader.
  const variant = needsPassword ? "setPassword" : "ready";
  const link = needsPassword ? `${siteUrl()}/invite/${opts.inviteToken}` : `${siteUrl()}/login`;
  // Escaped BEFORE interpolation (lib/email-templates.ts's contract): the message
  // catalogue is ours and trusted, a restaurant name typed into a form is not.
  const restaurant = escapeHtml(opts.restaurantName);
  return sendEmail({
    to: opts.to,
    subject: t(`subject.${variant}`, { restaurant: opts.restaurantName }),
    html: craftEmail({
      kicker: t("kicker"),
      title: t(`title.${variant}`),
      bodyHtml: `<p style="margin:0 0 12px;">${t("greeting", { name: escapeHtml(opts.name) })}</p>
<p style="margin:0 0 12px;">${t(`lead.${variant}`, { restaurant })}</p>
${opts.rows ? detailRows(opts.rows) : ""}`,
      cta: { label: t(`cta.${variant}`), url: link },
      footerNote: needsPassword ? t("footerNote") : undefined,
    }),
  });
}

/** The self-serve caller's shape: same template, plus the address and the total. */
export async function sendOwnerWelcome(opts: {
  to: string;
  contactName: string;
  restaurantName: string;
  slug: string;
  amountCents: number;
  inviteToken: string | null;
  locale: string;
}): Promise<{ sent: boolean }> {
  const t = await emailTranslator(opts.locale, "emails.invite");
  return sendInviteEmail({
    to: opts.to,
    name: opts.contactName,
    restaurantName: opts.restaurantName,
    inviteToken: opts.inviteToken,
    locale: opts.locale,
    rows: [
      [t("rowAddress"), `${opts.slug}.sofrapiwas.com`],
      // The amount stays as `eur()` formats it — the price is the same number in
      // every language, and `Intl` already localizes the separator inside it.
      [t("rowPlan"), `${eur(opts.amountCents)}/month`],
    ],
  });
}

/**
 * Tell the founder what the intake did — including, explicitly, whether an
 * account was created. Self-serve means nobody is watching the queue for a lead
 * that quietly failed to become one, so the outcome is stated rather than
 * inferred from the presence of a row.
 *
 * English, deliberately: it goes to the founder's own inbox (M5/M8 are the same),
 * and translating an operational notice would only make it harder to grep.
 */
export async function sendFounderSignupNotice(opts: {
  to: string;
  replyTo: string;
  restaurantName: string;
  rows: [string, string][];
  /** One line saying what happened to the account: minted, or why not. */
  outcome: string;
  messageHtml: string;
}): Promise<void> {
  await sendEmail({
    to: opts.to,
    replyTo: opts.replyTo,
    subject: `SofraPiwas — New signup: ${opts.restaurantName}`,
    html: craftEmail({
      kicker: "Signups",
      title: "New restaurant signup",
      bodyHtml: `<p style="margin:0 0 12px;"><strong>${escapeHtml(opts.outcome)}</strong></p>
${detailRows(opts.rows)}${opts.messageHtml}`,
      cta: { label: "Review in admin", url: `${siteUrl()}/admin` },
    }),
  });
}
