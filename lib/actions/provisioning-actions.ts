"use server";

// Admin-only: propose a NEW tenant by opening a registry PR on the deploy repo
// (ADR-012, git-native trigger). Returns the PR URL; a founder reviews + merges,
// the change syncs to the box, then the provision-tenant Action runs the script.
//
// Also holds `updatePaymentsModeAction` (SOFRA-PAYMENTS-PRICING-MODE-PLAN S2a) —
// the AMENDMENT counterpart to `openProvisioningPrAction` below: same registry-PR
// mechanism, applied to a tenant that must already exist rather than a new one.

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { slugProvisionVerdict } from "@/lib/provisioning-facts";
import { readProvisionForm } from "@/lib/provision-form-input";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { checkSlug } from "@/lib/slug-availability";
import { paymentsModeChangeSchema } from "@/lib/validation";
import {
  openProvisioningPr,
  provisioningConfigured,
  ProvisioningNotConfiguredError,
  ProvisioningApiError,
} from "@/lib/provisioning";
import { applyPaymentsModeChange, type PaymentsModeActionState } from "./payments-mode-change";

/** `error` is a message key in `control.errors` (rendered by <ActionError />);
 *  GitHub API errors pass through raw. `prUrl` on success. */
export type ProvisionActionState = { error?: string; ok?: boolean; prUrl?: string };

export async function openProvisioningPrAction(
  _prev: ProvisionActionState,
  formData: FormData,
): Promise<ProvisionActionState> {
  const admin = await requireAdmin();
  if (!provisioningConfigured()) return { error: "provisioningNotConfigured" };

  // The whole browser-fields → registry-entry mapping, in one testable place
  // (lib/provision-form-input.ts). It lives there rather than inline because inline is
  // where a posted field can go unread without any test noticing.
  const read = readProvisionForm(formData);
  if (!read.ok) return { error: read.error };
  const input = read.input;

  // Last gate before an IMMUTABLE identifier is proposed: the slug becomes the
  // subdomain, database, DB role and compose project, so a wrong one costs a full
  // re-provision (SOFRA-ONBOARDING-PLAN trap 3).
  //
  // `openProvisioningPr` also refuses a slug already merged into the registry,
  // and that check stays — it is the authority, and it catches a still-open
  // proposal this one cannot see. Checking here first is about WHICH answer the
  // founder gets: a reserved word was previously accepted all the way into a
  // merged registry entry, and a taken one only failed after a GitHub round-trip.
  //
  // An unreadable registry fails OPEN on `taken` (empty list) and closed on
  // `reserved`, which is the right split: the reserved list is local knowledge
  // that is always available, while "taken" has an authority one layer down that
  // will still refuse it. Blocking all provisioning because the bind-mount is
  // missing would be worse than deferring one check.
  const registry = await loadTenantRegistry();
  const taken = registry.ok ? registry.tenants.map((t) => t.slug) : [];
  const verdict = checkSlug(input.slug, taken);
  if (verdict === "reserved") return { error: "slugReserved" };
  if (verdict === "taken") return { error: "slugTaken" };
  // "invalid" is unreachable — provisionSchema already enforced the grammar — so
  // it is deliberately not mapped to a message nobody would ever see.

  // The abuse gate (O2): a SELF-SERVE tenant gets no proposal until its first
  // payment has settled. Anyone can now create an account and a plan without a
  // human involved, and under O3 a merge will stand up real infrastructure — so
  // the payment and the proposal stay coupled here. Founder-proposed tenants (no
  // plan) and reseller plans are unaffected; see lib/provisioning-payment-gate.
  if ((await slugProvisionVerdict(input.slug)) === "awaitingPayment") {
    return { error: "awaitingFirstPayment" };
  }

  try {
    const { prUrl, deferred } = await openProvisioningPr(input);
    // Record it on the billing row when there is one. The auto path reads this as its
    // idempotency marker, so a founder proposing by hand must populate it too — otherwise
    // a later payment webhook sees no record, tries again, and has to infer the truth from
    // GitHub refusing a duplicate branch.
    await db.tenantBilling
      .update({ where: { tenantSlug: input.slug }, data: { provisioningPrUrl: prUrl } })
      .catch(() => undefined); // no plan for this slug: founder-proposed, nothing to record
    // `deferred` only when non-empty: an always-present `[]` reads as a field nobody set
    // rather than as the absence of a withheld module.
    await audit(admin.id, "tenant.provision.proposed", "Tenant", input.slug, {
      prUrl,
      ...(deferred.length ? { deferred } : {}),
    });
    return { ok: true, prUrl };
  } catch (e) {
    if (e instanceof ProvisioningNotConfiguredError) return { error: "provisioningNotConfigured" };
    if (e instanceof ProvisioningApiError) return { error: e.message };
    console.error("openProvisioningPrAction failed", e);
    return { error: "provisionFailed" };
  }
}

/**
 * Amend an EXISTING tenant's payments mode + commission rate as the OWNER
 * (SOFRA-PAYMENTS-PRICING-MODE-PLAN S2a/S2b).
 *
 * The founder may name any tenant, so the slug is read straight from the form and
 * `requireAdmin()` is the whole authorization story. The partner counterpart
 * (S4, `lib/actions/partner-payments-actions.ts`) may not, and takes the slug off
 * a row it loaded scoped by `partnerId` instead — everything AFTER that point is
 * the shared `applyPaymentsModeChange`.
 */
export async function updatePaymentsModeAction(
  _prev: PaymentsModeActionState,
  formData: FormData,
): Promise<PaymentsModeActionState> {
  const admin = await requireAdmin();
  if (!provisioningConfigured()) return { error: "provisioningNotConfigured" };

  const parsed = paymentsModeChangeSchema.safeParse({
    tenantSlug: formData.get("tenantSlug"),
    mode: formData.get("mode"),
    commissionBps: formData.get("commissionBps"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "invalidInput" };
  const { tenantSlug, mode, commissionBps } = parsed.data;

  const { state, billingId } = await applyPaymentsModeChange({
    actorId: admin.id,
    initiator: "owner",
    tenantSlug,
    mode,
    commissionBps,
  });

  revalidatePath("/admin/billing");
  if (billingId) revalidatePath(`/admin/billing/${billingId}`);
  return state;
}
