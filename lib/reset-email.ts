// "Reset your password" — the mail (M4).
//
// Its own module for the reason `trial-warning-email.ts` and `self-serve-email.ts`
// are: the action should read as the flow it is (rate limit → resolve → mint token
// → send → audit), not as a template interleaved with one.
//
// Two things about it are load-bearing and were both wrong until G9/G10.
//
// It is written in the RECIPIENT's language, from `User.locale` — a person locked
// out of their account is the last person who should have to read instructions in a
// language they did not choose.
//
// And it no longer calls everyone a PARTNER. The old copy said "your SofraPiwas
// partner password", written when partners were the only accounts there were; a
// restaurant owner locked out of their own dashboard was reading about a
// relationship they have never had, which is exactly what a phishing mail looks
// like. The kicker and the sentence follow `User.role`.

import { sendEmail, escapeHtml } from "@/lib/email";
import { craftEmail } from "@/lib/email-templates";
import { emailTranslator } from "@/lib/email-locale";

/** The persona the copy addresses. Not the role enum: ADMIN and OWNER read the
 *  same neutral sentence, and only a reseller is told about a partner account. */
type Persona = "partner" | "account";

export async function sendPasswordResetEmail(opts: {
  to: string;
  name: string;
  role: string;
  locale: string;
  /** The single-use link. Built by the caller, which owns the token. */
  url: string;
}): Promise<{ sent: boolean }> {
  const t = await emailTranslator(opts.locale, "emails.reset");
  const persona: Persona = opts.role === "PARTNER" ? "partner" : "account";
  // Resolved before the template, so the HTML below carries no nested template
  // literal (Sonar S4624) and each line reads as one sentence.
  const greeting = t("greeting", { name: escapeHtml(opts.name) });
  const lead = t(`lead.${persona}`);
  return sendEmail({
    to: opts.to,
    subject: t("subject"),
    html: craftEmail({
      kicker: t(`kicker.${persona}`),
      title: t("title"),
      // Escaped BEFORE interpolation (lib/email-templates.ts's contract): the
      // catalogue is ours, the name on the account is not.
      bodyHtml: `<p style="margin:0 0 12px;">${greeting}</p>
<p style="margin:0;">${lead}</p>`,
      cta: { label: t("cta"), url: opts.url },
      footerNote: t("footerNote"),
    }),
  });
}
