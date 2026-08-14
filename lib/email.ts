// Resend HTTP sender (same provider/pattern as the waitlist route; Netcup
// blocks SMTP). Without a key we log instead of sending — callers that need
// certainty (e.g. invite links) must surface the link in the UI as well.
const RESEND_URL = "https://api.resend.com/emails";

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.WAITLIST_FROM;
  if (!apiKey) {
    console.warn(`email (not sent, no RESEND_API_KEY): to=${opts.to} subject=${opts.subject}`);
    return { sent: false };
  }
  // No sandbox fallback. `onboarding@resend.dev` used to be the default here, and it does
  // not degrade gracefully: Resend accepts it only for the account owner's own address and
  // answers 403 for every other recipient. So the fallback turned a missing env var into a
  // mailer that works perfectly for the one person who would test it and silently reaches
  // no customer. Refusing is louder and strictly more honest.
  //
  // This REFUSES rather than throws, on purpose. Callers here document sendEmail as
  // never-throwing and one of them runs inside the Mollie webhook (lib/billing-notify.ts),
  // where a throw would fail a payment that has already settled. `{sent:false}` is the
  // contract they already handle — signup surfaces the invite link in the UI when it comes
  // back false — so the failure stays visible without taking the money path down with it.
  if (!from) {
    console.error(
      `email (not sent, no WAITLIST_FROM): to=${opts.to} subject=${opts.subject} — ` +
        `set WAITLIST_FROM to a sender on a Resend-VERIFIED domain, e.g. "Sofra <sofra@send.sofrapiwas.com>"`,
    );
    return { sent: false };
  }
  // Default the reply path rather than asking every call site to remember it. An
  // explicit `replyTo` still wins — the founder notifications set it to the
  // CUSTOMER so a reply reaches the person who wrote in, and that must not be
  // overwritten. Defaulting here means a mail added later inherits a monitored
  // mailbox instead of quietly shipping without one, which is the failure mode
  // that produced this gap in the first place (7 of 9 customer mails had none).
  const replyTo = opts.replyTo ?? supportReplyTo();
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [opts.to],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: opts.subject,
      html: opts.html,
    }),
  });
  if (!res.ok) {
    console.error("email: resend failed", res.status, await res.text());
    return { sent: false };
  }
  return { sent: true };
}

export function founderInbox(): string | undefined {
  return process.env.WAITLIST_TO;
}

/**
 * The monitored mailbox a recipient reaches by pressing Reply.
 *
 * Every company mail is sent FROM `send.sofrapiwas.com`, which exists to send and
 * has no inbox — and `sofrapiwas.com` has no MX at all, so a reply to any address
 * there hard-bounces. Without this header a customer answering their invite, their
 * password reset or their INVOICE is replying into a black hole, and never finds
 * out. Reply-To costs nothing and does not have to live on the sending domain.
 *
 * Undefined when unset: no header, which is exactly today's behaviour, so this
 * cannot break a deployment that has not configured it yet.
 */
export function supportReplyTo(): string | undefined {
  return process.env.SUPPORT_REPLY_TO || undefined;
}

export function siteUrl(): string {
  return process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}
