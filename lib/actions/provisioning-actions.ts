"use server";

// Admin-only: propose a NEW tenant by opening a registry PR on the deploy repo
// (ADR-012, git-native trigger). Returns the PR URL; a founder reviews + merges,
// the change syncs to the box, then the provision-tenant Action runs the script.

import { requireAdmin } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { provisionSchema, splitCsvLower } from "@/lib/validation";
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
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "invalidInput" };
  const input = parsed.data;

  const languages = splitCsvLower(input.languages);
  const modules = splitCsvLower(input.modules);
  if (languages.length === 0 || modules.length === 0) return { error: "invalidInput" };

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

  try {
    const { prUrl } = await openProvisioningPr({
      slug: input.slug,
      name: input.name,
      adminEmail: input.adminEmail.toLowerCase(),
      template: input.template,
      currency: input.currency,
      languages,
      modules,
      city: input.city || undefined,
    });
    await audit(admin.id, "tenant.provision.proposed", "Tenant", input.slug, { prUrl });
    return { ok: true, prUrl };
  } catch (e) {
    if (e instanceof ProvisioningNotConfiguredError) return { error: "provisioningNotConfigured" };
    if (e instanceof ProvisioningApiError) return { error: e.message };
    console.error("openProvisioningPrAction failed", e);
    return { error: "provisionFailed" };
  }
}
