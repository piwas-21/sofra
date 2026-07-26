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
import {
  resolveOnboardFlow,
  resolveOwnerUser,
  resolvePartnerUser,
  resolveTenantClient,
} from "@/lib/onboarding-actors";
import { type BillingInterval } from "@/lib/billing";

/** `error` is a message key in `control.errors` (translated by <ActionError />);
 *  Zod issue messages pass through raw. */
export type OnboardActionState = { error?: string; ok?: boolean; inviteLink?: string };

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

  const rawSignupId = formData.get("signupId");
  const flow = await resolveOnboardFlow({
    signupId: typeof rawSignupId === "string" && rawSignupId ? rawSignupId : null,
    tenantSlug,
    email,
  });
  if (!flow.ok) return { error: flow.error };
  const { signup, ownerFlow } = flow;

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
