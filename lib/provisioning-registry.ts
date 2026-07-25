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

/** Quote a value for a POSIX shell single-quoted argument (`'` -> `'\''`). The
 *  tenant name is free text and the founder copy-pastes these commands into a
 *  terminal, so an apostrophe must not end the quoting. */
const shq = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * The PR body for a provisioning proposal: what is being added, then the exact
 * post-merge commands in order. It is a checklist rather than prose because the
 * step that is easy to forget — building the per-tenant frontend image — is a
 * hard prerequisite: `NEXT_PUBLIC_*` are baked per domain, so provisioning
 * without it dies at `docker compose pull` on an image that was never published.
 */
export function buildProvisioningPrBody(input: TenantProvisionInput): string {
  const { slug } = input;
  const domain = `${slug}.sofrapiwas.com`;
  return [
    `Adds the \`${slug}\` tenant to \`tenants/registry.yml\`, proposed by the control plane (sofra ADR-012).`,
    "",
    `- **domain** \`${domain}\` · **template** \`${input.template}\` · **currency** \`${input.currency}\``,
    `- **languages** \`${input.languages.join(", ")}\` · **modules** \`${input.modules.join(", ")}\``,
    `- **box** \`${input.box ?? "staging"}\` · status starts at \`provisioning\``,
    "",
    "Review the entry before merging — this is the human checkpoint before any box provisioning.",
    "",
    "### After merging, in order",
    "",
    "1. **Registry sync** — automatic: merging to `develop` fires `sync-registry-to-staging.yml`. Check it went green; the box reads the registry, so nothing below works until it has.",
    "2. **Build the tenant frontend image** — required *before* provisioning (`NEXT_PUBLIC_*` are baked per domain):",
    "",
    "   ```bash",
    "   gh workflow run build-tenant-image.yml --repo piwas-21/restaurant-app-frontend \\",
    `     -f tenant_domain=${domain} \\`,
    `     -f image_tag=tenant-${slug} \\`,
    `     -f restaurant_name=${shq(input.name)} \\`,
    `     -f template=${input.template} \\`,
    `     -f currency=${input.currency}`,
    "   ```",
    "",
    "3. **Provision on the box**:",
    "",
    "   ```bash",
    `   gh workflow run provision-tenant.yml --repo piwas-21/restaurant-app-deploy -f slug=${slug}`,
    "   ```",
    "",
    `4. **Verify** — \`./verify-env.sh https://${domain}\`, log in with the generated admin password from the tenant \`.env\` and change it, then flip this entry's \`status\` to \`active\` in a follow-up commit.`,
    "",
    "Full runbook: deploy repo `DEPLOYMENT.md` §Tenant provisioning.",
  ].join("\n");
}
