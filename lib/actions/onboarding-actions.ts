"use server";

// Admin-only onboarding of a referred partner as the reseller payer for a
// tenant (SOFRA-PARTNER-PLAN, reseller flow). Creates/reuses the PARTNER user +
// the tenant Client + a PENDING billing plan (no Mollie yet), then mints a
// set-password invite and ALWAYS returns the link so the founder can share it
// manually. The partner completes the payment from their own dashboard.

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
): Promise<string> {
  const needsPassword = user.status === "INVITED";
  const link = needsPassword
    ? `${siteUrl()}/invite/${await createToken(user.id, "invite")}`
    : `${siteUrl()}/login`;
  await sendEmail({
    to: email,
    subject: needsPassword
      ? "Welcome to Sofra — set your password"
      : `Sofra — ${restaurantName} is ready for your subscription`,
    html: craftEmail({
      kicker: "Partner program",
      title: needsPassword ? "Welcome aboard 🎉" : "A new plan is waiting",
      bodyHtml: `<p style="margin:0 0 12px;">Hi ${escapeHtml(user.name)},</p>
<p style="margin:0;">${escapeHtml(restaurantName)} is set up on Sofra. ${
        needsPassword ? "Set your password to open your dashboard" : "Sign in to your dashboard"
      } and start the monthly subscription — afiyet olsun.</p>`,
      cta: { label: needsPassword ? "Set your password" : "Open your dashboard", url: link },
      footerNote: needsPassword ? "The link works once and expires in 24 hours." : undefined,
    }),
  });
  return link;
}

/** Close the originating signup lead (ADR-004) once its onboard succeeds.
 *  Idempotent by input: no id, an unknown id, or an already-CONVERTED lead is a
 *  no-op (returns false). A genuine DB error still propagates. Founder-reversible,
 *  like the pipeline's own transitions. Returns whether the lead was flipped, so
 *  the caller can revalidate /admin/signups. */
async function markSignupConverted(signupId: unknown, actorId: string): Promise<boolean> {
  if (typeof signupId !== "string" || signupId === "") return false;
  const signup = await db.signupRequest.findUnique({ where: { id: signupId } });
  if (!signup || signup.status === "CONVERTED") return false;
  await db.signupRequest.update({
    where: { id: signupId },
    data: { status: "CONVERTED", decidedAt: new Date() },
  });
  await audit(actorId, "signup.converted", "SignupRequest", signupId);
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

  // One billing anchor per tenant (unique tenantSlug). Refuse a re-onboard.
  if (await db.tenantBilling.findUnique({ where: { tenantSlug } })) {
    return { error: "tenantAlreadyOnboarded" };
  }

  // Pre-check tenant ownership BEFORE creating anything: a slug already held by
  // a DIFFERENT partner must reject here, not after resolvePartnerUser has
  // created a fresh user (which would then be left orphaned).
  const slugOwner = await db.client.findUnique({ where: { tenantSlug }, include: { partner: true } });
  // Case-insensitive: emails are, and `email` is already lowercased. (All
  // current paths store lowercased, but don't depend on that here.)
  if (slugOwner && slugOwner.partner.email.toLowerCase() !== email) {
    return { error: "tenantAlreadyOnboarded" };
  }

  const user = await resolvePartnerUser(email, input.name);
  if (!user) return { error: "userExists" };

  const client = await resolveTenantClient(user.id, tenantSlug, input.restaurantName);
  if (!client) return { error: "tenantAlreadyOnboarded" };

  await defineTenantPlan({
    tenantSlug,
    name: input.name,
    email,
    description: input.restaurantName,
    amountCents: Math.round(input.amount * 100),
    interval: input.interval as BillingInterval,
    liveSince,
    clientId: client.id,
    actorId: admin.id,
  });

  const inviteLink = await emailOnboardInvite(user, email, input.restaurantName);
  await audit(admin.id, "partner.onboarded", "User", user.id, { tenantSlug, clientId: client.id });

  // Onboarding IS the conversion event: when this flow was opened from a signup
  // lead (hidden signupId), close that lead so it leaves the pipeline.
  if (await markSignupConverted(formData.get("signupId"), admin.id)) {
    revalidatePath("/admin/signups");
  }
  revalidatePath("/admin/onboard");
  return { ok: true, inviteLink };
}
