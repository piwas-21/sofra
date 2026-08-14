// "Your restaurant is live" -- the mail the self-serve funnel never sent.
//
// Kept separate from the sweep (lib/go-live-notify.ts) the way `self-serve-email.ts`
// is kept separate from the intake route: the flow should read as a flow, not as a
// template interleaved with one.

import { sendEmail, escapeHtml, siteUrl } from "@/lib/email";
import { craftEmail, detailRows } from "@/lib/email-templates";

/**
 * The owner's first message about their own app. Three things it must carry, in the
 * order someone actually needs them:
 *
 *  1. the address their restaurant now answers on,
 *  2. how to get IN -- which is NOT a password we mail. O3 built /forgot-password on
 *     the tenant itself precisely so no credential ever leaves the box, and this mail
 *     is the sentence that mechanism was always missing,
 *  3. where the rest of the setup lives.
 *
 * Returns Resend's verdict; the caller records it rather than assuming delivery.
 */
export async function sendTenantLiveEmail(opts: {
  to: string;
  /** The person, for the greeting. */
  contactName: string;
  restaurantName: string;
  /** `https://<domain>`, already validated by `tenantOrigin`. */
  origin: string;
}): Promise<{ sent: boolean }> {
  const setPassword = `${opts.origin}/forgot-password`;
  return sendEmail({
    to: opts.to,
    subject: `${opts.restaurantName} is live on SofraPiwas 🎉`,
    html: craftEmail({
      kicker: "Your restaurant is live",
      title: "It's ready",
      bodyHtml: `<p style="margin:0 0 12px;">Hi ${escapeHtml(opts.contactName)},</p>
<p style="margin:0 0 12px;">${escapeHtml(
        opts.restaurantName,
      )} is now live. Your guests can reach it, and you can start setting it up.</p>
${detailRows([
  ["Your restaurant", opts.origin.replace(/^https:\/\//, "")],
  ["Sign in as", opts.to],
])}
<p style="margin:12px 0 0;">To get in the first time, set your admin password from your
own site — we never send passwords by email:</p>
<p style="margin:8px 0 0;"><a href="${setPassword}" style="color:#A84B2F;">${setPassword}</a></p>`,
      cta: { label: "Open your restaurant", url: opts.origin },
      footerNote: `Your setup checklist is in your dashboard (${siteUrl()}/dashboard). Reply to this email if anything looks wrong — a person reads it.`,
    }),
  });
}
