// The two emails a self-serve signup sends (SOFRA-ONBOARDING-PLAN O2).
//
// Split out of the intake route so the route reads as the flow it is (guard →
// validate → decide → mint → notify) rather than interleaving two templates with
// it, and so the route stays inside the file-length limit as O2 grows.
//
// Both are best-effort at the call site: the account and the plan are already
// committed by the time these run, so a Resend outage must not turn a paid-up
// customer into a 500. The founder notification is the backstop — it names the
// restaurant and the plan, so a missed welcome email is recoverable by hand.

import { sendEmail, escapeHtml, siteUrl } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";
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
  kicker: string;
  /** Extra `detailRows` beneath the copy; omit for the founder path. */
  rows?: [string, string][];
}): Promise<{ sent: boolean }> {
  const needsPassword = opts.inviteToken !== null;
  const link = needsPassword ? `${siteUrl()}/invite/${opts.inviteToken}` : `${siteUrl()}/login`;
  return sendEmail({
    to: opts.to,
    subject: needsPassword
      ? "Welcome to SofraPiwas — set your password"
      : `SofraPiwas — ${opts.restaurantName} is ready for your subscription`,
    html: craftEmail({
      kicker: opts.kicker,
      title: needsPassword ? "Welcome aboard 🎉" : "A new plan is waiting",
      bodyHtml: `<p style="margin:0 0 12px;">Hi ${escapeHtml(opts.name)},</p>
<p style="margin:0 0 12px;">${escapeHtml(opts.restaurantName)} is set up on SofraPiwas. ${
        needsPassword ? "Set your password to open your dashboard" : "Sign in to your dashboard"
      } and start the monthly subscription — afiyet olsun.</p>
${opts.rows ? detailRows(opts.rows) : ""}`,
      cta: { label: needsPassword ? "Set your password" : "Open your dashboard", url: link },
      footerNote: needsPassword ? "The link works once and expires in 24 hours." : undefined,
    }),
  });
}

/** The self-serve caller's shape: same template, plus the address and the total. */
export function sendOwnerWelcome(opts: {
  to: string;
  contactName: string;
  restaurantName: string;
  slug: string;
  amountCents: number;
  inviteToken: string | null;
}): Promise<{ sent: boolean }> {
  return sendInviteEmail({
    to: opts.to,
    name: opts.contactName,
    restaurantName: opts.restaurantName,
    inviteToken: opts.inviteToken,
    kicker: "Welcome to SofraPiwas",
    rows: [
      ["Your web address", `${opts.slug}.sofrapiwas.com`],
      ["Your plan", `${eur(opts.amountCents)}/month`],
    ],
  });
}

/**
 * Tell the founder what the intake did — including, explicitly, whether an
 * account was created. Self-serve means nobody is watching the queue for a lead
 * that quietly failed to become one, so the outcome is stated rather than
 * inferred from the presence of a row.
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
