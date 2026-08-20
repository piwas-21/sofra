"use server";

// Admin-only: propose a NEW tenant by opening a registry PR on the deploy repo
// (ADR-012, git-native trigger). Returns the PR URL; a founder reviews + merges,
// the change syncs to the box, then the provision-tenant Action runs the script.

import { requireAdmin } from "@/lib/rbac";
import { normalizeBaseDomain } from "@/lib/base-domain";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { slugProvisionVerdict } from "@/lib/provisioning-facts";
import { splitCsvLower } from "@/lib/validation";
import { provisionSchema } from "@/lib/validation-provision";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { checkSlug } from "@/lib/slug-availability";
import {
  openProvisioningPr,
  provisioningConfigured,
  ProvisioningNotConfiguredError,
  ProvisioningApiError,
} from "@/lib/provisioning";

/** `error` is a message key in `control.errors` (rendered by <ActionError />);
 *  GitHub API errors pass through raw. `prUrl` on success. */
export type ProvisionActionState = { error?: string; ok?: boolean; prUrl?: string };

/** Collapse a repeated (checkbox-group) form field into the comma list the
 *  schema validates, dropping any non-string entry. */
const csvField = (formData: FormData, name: string): string =>
  formData
    .getAll(name)
    .filter((v): v is string => typeof v === "string")
    .join(",");

export async function openProvisioningPrAction(
  _prev: ProvisionActionState,
  formData: FormData,
): Promise<ProvisionActionState> {
  const admin = await requireAdmin();
  if (!provisioningConfigured()) return { error: "provisioningNotConfigured" };

  const parsed = provisionSchema.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name"),
    adminEmail: formData.get("adminEmail"),
    template: formData.get("template"),
    currency: formData.get("currency"),
    // Checkbox groups: several values under one name, so getAll + join — a
    // plain get() would silently take the FIRST box and provision a tenant
    // missing everything else that was ticked. getAll can also yield File
    // entries on a crafted multipart POST, which would stringify to
    // "[object Object]" and sail into the registry; keep strings only.
    languages: csvField(formData, "languages"),
    modules: csvField(formData, "modules"),
    city: formData.get("city"),
    baseDomain: formData.get("baseDomain"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "invalidInput" };
  const input = parsed.data;

  const languages = splitCsvLower(input.languages);
  const modules = splitCsvLower(input.modules);
  if (languages.length === 0 || modules.length === 0) return { error: "invalidInput" };

  // Empty stays undefined all the way down, which is what makes an absent
  // `base_domain:` the unchanged default rather than a value anyone had to choose.
  const baseDomain = input.baseDomain ? normalizeBaseDomain(input.baseDomain) : undefined;

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
    const { prUrl, deferred } = await openProvisioningPr({
      slug: input.slug,
      name: input.name,
      adminEmail: input.adminEmail.toLowerCase(),
      template: input.template,
      currency: input.currency,
      languages,
      modules,
      stripeAccount: input.stripeAccount || undefined,
      // Re-normalized rather than passed through: the schema only ASKED whether the
      // value is a usable base domain, and the answer it validated is a different
      // string from the one it was handed (a pasted scheme, a trailing dot). The
      // registry must carry the canonical form, because a slug is concatenated onto it.
      baseDomain: baseDomain?.ok ? baseDomain.domain : undefined,
      city: input.city || undefined,
    });
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
