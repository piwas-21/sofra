"use server";

// Admin-only: propose a NEW tenant by opening a registry PR on the deploy repo
// (ADR-012, git-native trigger). Returns the PR URL; a founder reviews + merges,
// the change syncs to the box, then the provision-tenant Action runs the script.

import { requireAdmin } from "@/lib/rbac";
import { audit } from "@/lib/audit";
import { provisionSchema } from "@/lib/validation";
import {
  openProvisioningPr,
  provisioningConfigured,
  ProvisioningNotConfiguredError,
  ProvisioningApiError,
} from "@/lib/provisioning";

/** `error` is a message key in `control.errors` (rendered by <ActionError />);
 *  GitHub API errors pass through raw. `prUrl` on success. */
export type ProvisionActionState = { error?: string; ok?: boolean; prUrl?: string };

const splitList = (raw: string): string[] =>
  raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

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
    languages: formData.get("languages"),
    modules: formData.get("modules"),
    city: formData.get("city"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "invalidInput" };
  const input = parsed.data;

  const languages = splitList(input.languages);
  const modules = splitList(input.modules);
  if (languages.length === 0 || modules.length === 0) return { error: "invalidInput" };

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
