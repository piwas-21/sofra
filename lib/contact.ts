/**
 * The address a customer can always reach a human at.
 *
 * Deliberately a `mailto:` target and not the site's contact form: that form
 * POSTs to `/api/waitlist`, which answers 502 when `sendEmail` reports
 * `{sent:false}` — so in the exact failure this address exists for (no key, no
 * sender, Resend down) the form cannot succeed either. A mailto link is resolved
 * by the visitor's own mail client and cannot be taken down by our outbound
 * transport.
 *
 * A constant rather than env because it is rendered in a CLIENT component: an
 * env read there would need NEXT_PUBLIC_, which is the same literal with extra
 * steps and one more way to ship a blank link.
 */
export const CONTACT_EMAIL = "mahmutkaya.nl@gmail.com"; // founder inbox (owner-approved); move to a sofra-domain alias later
