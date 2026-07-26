// Who the onboarding write path acts on: the payer's user account and, in the
// reseller flow, the tenant's CRM Client. Extracted from onboarding-actions.ts
// so the action reads as the flow it is (validate -> resolve actors -> define
// plan -> invite) instead of interleaving three resolution policies.
//
// All three return null rather than throwing on a conflict: the action turns
// that into a message key, and "this email belongs to another role" is an
// expected founder mistake, not an exception.

import { db } from "@/lib/db";

/** Create the PARTNER user if new; reuse an existing partner (by email, so one
 *  partner can be given several tenants). Returns null on a non-partner email
 *  (e.g. an ADMIN) — never repurpose it. */
export async function resolvePartnerUser(email: string, name: string) {
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
export async function resolveOwnerUser(email: string, name: string) {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing.role === "OWNER" ? existing : null;
  return db.user.create({ data: { email, name, role: "OWNER", status: "INVITED" } });
}

/** Create the tenant's CRM Client if new; reuse the partner's own. Returns null
 *  if the (unique) slug is already tied to a different partner. */
export async function resolveTenantClient(userId: string, tenantSlug: string, restaurantName: string) {
  const existing = await db.client.findUnique({ where: { tenantSlug } });
  if (existing) {
    if (existing.partnerId !== userId) return null;
    // Onboarding IS the transition to live, so a reused Client must not keep a
    // stale pipeline status: a LEAD with a billing plan reads as an open
    // opportunity forever. A re-onboarded CHURNED client is live again too —
    // that is what just happened.
    return existing.status === "LIVE"
      ? existing
      : db.client.update({ where: { id: existing.id }, data: { status: "LIVE" } });
  }
  return db.client.create({
    data: { partnerId: userId, restaurantName, tenantSlug, status: "LIVE" },
  });
}

/** The lead behind an onboarding, if any — only what the action actually uses. */
export type OnboardSignup = { id: string; status: string };

/** Either a message key to return, or the resolved flow. Discriminated on `ok`
 *  so the caller narrows with one check. */
export type OnboardFlow =
  | { ok: false; error: string }
  | { ok: true; signup: OnboardSignup | null; ownerFlow: boolean };

/**
 * Decide which onboarding flow this submission is, and refuse the three ways a
 * tenant slug can already be taken — all BEFORE anything is created, so a
 * rejection never leaves a freshly minted user orphaned.
 *
 * A `signupId` that is present but does not resolve is refused rather than
 * treated as "no signup": falling through would quietly onboard the restaurant
 * as a PARTNER with a CRM Client, a different product shape than the founder
 * asked for, discovered later by whoever wonders why the owner has a partner
 * dashboard.
 */
export async function resolveOnboardFlow(input: {
  signupId: string | null;
  tenantSlug: string;
  /** Already lowercased by the caller. */
  email: string;
}): Promise<OnboardFlow> {
  const signup = input.signupId
    ? await db.signupRequest.findUnique({ where: { id: input.signupId } })
    : null;
  if (input.signupId && !signup) return { ok: false, error: "signupNotFound" };

  // One billing anchor per tenant (unique tenantSlug). Refuse a re-onboard.
  if (await db.tenantBilling.findUnique({ where: { tenantSlug: input.tenantSlug } })) {
    return { ok: false, error: "tenantAlreadyOnboarded" };
  }

  // A slug already held by a DIFFERENT partner must reject here. The owner flow
  // creates no Client, but this still guards a slug an existing reseller holds.
  // Case-insensitive: emails are, and `email` arrives lowercased.
  const slugOwner = await db.client.findUnique({
    where: { tenantSlug: input.tenantSlug },
    include: { partner: true },
  });
  if (slugOwner && slugOwner.partner.email.toLowerCase() !== input.email) {
    return { ok: false, error: "tenantAlreadyOnboarded" };
  }

  return { ok: true, signup, ownerFlow: signup !== null };
}
