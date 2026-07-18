// Pure registry-entry generation for the ADR-012 git-native provisioning trigger.
// The control plane computes a NEW tenants/registry.yml entry from tenant data and
// opens a PR to the deploy repo (lib/provisioning.ts). The registry stays the
// source of truth (ADR-003/007) — the entry is proposed as a reviewable PR, never
// written to the box directly. This module holds only the pure YAML-block builder
// so it stays unit-testable + free of the GitHub API / secrets.

import { stringify } from "yaml";

export interface TenantProvisionInput {
  /** Registry key + derivation seed. Must already match the slug grammar. */
  slug: string;
  name: string;
  adminEmail: string;
  template: "classic" | "craft";
  currency: string;
  languages: string[];
  modules: string[];
  city?: string;
  /** Which box the tenant belongs on; provision-tenant.sh refuses a mismatch. */
  box?: string;
}

/**
 * Build the `tenants/registry.yml` entry for a NEW tenant as a YAML block already
 * indented two spaces so it nests under `tenants:`. Slug-derived fields
 * (`db`/`db_role`/`compose_project`/`domain`/`frontend_tag`) follow the registry
 * conventions; `status` starts at `provisioning` and `managed` is `scripts` (never
 * `legacy` — that guard protects tenant 1, ADR-006). String values are emitted via
 * `yaml.stringify`, so any special characters in name/city are safely escaped (no
 * YAML injection from free-text input).
 */
export function buildTenantRegistryEntry(input: TenantProvisionInput): string {
  const { slug } = input;
  const entry = {
    [slug]: {
      name: input.name,
      status: "provisioning",
      managed: "scripts",
      box: input.box ?? "staging",
      domain: `${slug}.sofrapiwas.com`,
      domain_mode: "subdomain",
      db: `tenant_${slug}`,
      db_role: `tenant_${slug}`,
      compose_project: `tenant-${slug}`,
      backend_tag: "latest",
      frontend_tag: `tenant-${slug}`,
      currency: input.currency,
      languages: input.languages,
      modules: input.modules,
      template: input.template,
      admin_email: input.adminEmail,
      // Only emit city when set — the registry field is optional.
      ...(input.city ? { city: input.city } : {}),
    },
  };
  return stringify(entry)
    .trimEnd()
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");
}
