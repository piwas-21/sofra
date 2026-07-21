"use server";

// Admin-only tenant onboarding. Two flows, chosen by whether it was opened from
// a signup lead (hidden signupId):
//   • RESELLER (no signup) — a referred PARTNER pays for the tenant: create/reuse
//     the PARTNER user + a CRM Client + a PENDING plan linked to that Client.
//   • DIRECT OWNER (from a signup, ADR-004) — the restaurant's own contact pays:
//     create/reuse an OWNER user + a PENDING plan with payerUserId set, NO Client,
//     and mark the originating signup CONVERTED.
// Both mint a set-password invite and ALWAYS return the link so the founder can
// share it manually; the payer completes the first payment from their dashboard.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sendEmail, escapeHtml, siteUrl } from "@/lib/email";
import { craftEmail } from "@/lib/email-templates";
import { createToken } from "@/lib/tokens";
import { onboardSchema } from "@/lib/validation";
import { defineTenantPlan } from "@/lib/billing-onboarding";
import { type BillingInterval } from "@/lib/billing";

/** `error` is a message key in `control.errors` (translated by <ActionError />);
 *  Zod issue messages pass through raw. */
export type OnboardActionState = { error?: string; ok?: boolean; inviteLink?: string };

/** Create the PARTNER user if new; reuse an existing partner (by email, so one
 *  partner can be given several tenants). Returns null on a non-partner email
 *  (e.g. an ADMIN) — never repurpose it. */
async function resolvePartnerUser(email: string, name: string) {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing.role === "PARTNER" ? existing : null;
  return db.user.create({
    data: { email, name, role: "PARTNER", status: "INVITED", profile: { create: {} } },
  });
}

/** Create the OWNER user (direct self-serve, ADR-004) if new; reuse an existing
 *  OWNER (one owner may hold several tenants). Returns null if the email already
 *  belongs to a PARTNER/ADMIN — never repurpose another role. No PartnerProfile:
 *  that's reseller metadata and an owner isn't a partner. */
async function resolveOwnerUser(email: string, name: string) {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing.role === "OWNER" ? existing : null;
  return db.user.create({ data: { email, name, role: "OWNER", status: "INVITED" } });
}

/** Create the tenant's CRM Client if new; reuse the partner's own. Returns null
 *  if the (unique) slug is already tied to a different partner. */
async function resolveTenantClient(userId: string, tenantSlug: string, restaurantName: string) {
  const existing = await db.client.findUnique({ where: { tenantSlug } });
  if (existing) return existing.partnerId === userId ? existing : null;
  return db.client.create({
    data: { partnerId: userId, restaurantName, tenantSlug, status: "LIVE" },
  });
}

/** Email the onboarding link — a set-password invite for a fresh INVITED
 *  account, or a plain login link for an already-ACTIVE one — and return it. */
async function emailOnboardInvite(
  user: { id: string; name: string; status: string },
  email: string,
  restaurantName: string,
  ownerFlow: boolean,
): Promise<string> {
  const needsPassword = user.status === "INVITED";
  const link = needsPassword
    ? `${siteUrl()}/invite/${await createToken(user.id, "invite")}`
    : `${siteUrl()}/login`;
  await sendEmail({
    to: email,
    subject: needsPassword
      ? "Welcome to SofraPiwas — set your password"
      : `SofraPiwas — ${restaurantName} is ready for your subscription`,
    html: craftEmail({
      kicker: ownerFlow ? "Welcome to SofraPiwas" : "Partner program",
      title: needsPassword ? "Welcome aboard 🎉" : "A new plan is waiting",
      bodyHtml: `<p style="margin:0 0 12px;">Hi ${escapeHtml(user.name)},</p>
<p style="margin:0;">${escapeHtml(restaurantName)} is set up on SofraPiwas. ${
        needsPassword ? "Set your password to open your dashboard" : "Sign in to your dashboard"
      } and start the monthly subscription — afiyet olsun.</p>`,
      cta: { label: needsPassword ? "Set your password" : "Open your dashboard", url: link },
      footerNote: needsPassword ? "The link works once and expires in 24 hours." : undefined,
    }),
  });
  return link;
}

/** Close the originating signup lead (ADR-004) once its onboard succeeds. No-op
 *  (returns false) when there was no lead or it's already CONVERTED. A genuine DB
 *  error still propagates. Founder-reversible, like the pipeline's own transitions.
 *  Returns whether it flipped, so the caller can revalidate /admin/signups. */
async function markSignupConverted(
  signup: { id: string; status: string } | null,
  actorId: string,
): Promise<boolean> {
  if (!signup || signup.status === "CONVERTED") return false;
  await db.signupRequest.update({
    where: { id: signup.id },
    data: { status: "CONVERTED", decidedAt: new Date() },
  });
  await audit(actorId, "signup.converted", "SignupRequest", signup.id);
  return true;
}

export async function onboardPartnerAction(
  _prev: OnboardActionState,
  formData: FormData,
): Promise<OnboardActionState> {
  const admin = await requireAdmin();

  const parsed = onboardSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    tenantSlug: formData.get("tenantSlug"),
    restaurantName: formData.get("restaurantName"),
    amount: formData.get("amount"),
    interval: formData.get("interval"),
    liveSince: formData.get("liveSince"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "invalidInput" };
  const input = parsed.data;
  const email = input.email.toLowerCase();
  const tenantSlug = input.tenantSlug;

  // onboardSchema already rejected an impossible calendar date, so this parses
  // to a valid Date (or null when omitted).
  const liveSince = input.liveSince ? new Date(`${input.liveSince}T00:00:00Z`) : null;

  // A real signup lead behind this onboarding = the DIRECT-OWNER flow (the
  // restaurant's own contact pays). Absent/unknown id = the RESELLER flow.
  const rawSignupId = formData.get("signupId");
  const signup =
    typeof rawSignupId === "string" && rawSignupId
      ? await db.signupRequest.findUnique({ where: { id: rawSignupId } })
      : null;
  const ownerFlow = signup !== null;

  // One billing anchor per tenant (unique tenantSlug). Refuse a re-onboard.
  if (await db.tenantBilling.findUnique({ where: { tenantSlug } })) {
    return { error: "tenantAlreadyOnboarded" };
  }

  // Pre-check tenant ownership BEFORE creating anything: a slug already held by
  // a DIFFERENT partner must reject here, not after a fresh user is created (it
  // would be left orphaned). The owner flow creates no Client, but this still
  // guards against onboarding a slug an existing reseller Client already holds.
  const slugOwner = await db.client.findUnique({ where: { tenantSlug }, include: { partner: true } });
  // Case-insensitive: emails are, and `email` is already lowercased. (All
  // current paths store lowercased, but don't depend on that here.)
  if (slugOwner && slugOwner.partner.email.toLowerCase() !== email) {
    return { error: "tenantAlreadyOnboarded" };
  }

  const user = ownerFlow
    ? await resolveOwnerUser(email, input.name)
    : await resolvePartnerUser(email, input.name);
  if (!user) return { error: "userExists" };

  // Reseller flow links a CRM Client; owner flow pays via payerUserId, no Client.
  let clientId: string | null = null;
  if (!ownerFlow) {
    const client = await resolveTenantClient(user.id, tenantSlug, input.restaurantName);
    if (!client) return { error: "tenantAlreadyOnboarded" };
    clientId = client.id;
  }

  await defineTenantPlan({
    tenantSlug,
    name: input.name,
    email,
    description: input.restaurantName,
    amountCents: Math.round(input.amount * 100),
    interval: input.interval as BillingInterval,
    liveSince,
    clientId,
    payerUserId: ownerFlow ? user.id : null,
    actorId: admin.id,
  });

  const inviteLink = await emailOnboardInvite(user, email, input.restaurantName, ownerFlow);
  await audit(admin.id, ownerFlow ? "owner.onboarded" : "partner.onboarded", "User", user.id, {
    tenantSlug,
    clientId,
  });

  // Onboarding IS the conversion event: close the originating signup lead.
  if (await markSignupConverted(signup, admin.id)) {
    revalidatePath("/admin/signups");
  }
  revalidatePath("/admin/onboard");
  return { ok: true, inviteLink };
}
