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
  const box = input.box ?? "staging";
  const entry = {
    [slug]: {
      name: input.name,
      status: "provisioning",
      managed: "scripts",
      box,
      domain: `${slug}.sofrapiwas.com`,
      domain_mode: "subdomain",
      db: `tenant_${slug}`,
      db_role: `tenant_${slug}`,
      compose_project: `tenant-${slug}`,
      // Always `:latest` — released code, published only from `main`. NOT derived from
      // `box` (as it was until 2026-07-31): every self-serve tenant lands on
      // `box: staging`, because that is where the control plane runs, so deriving from
      // the box silently gave every paying customer the develop build — and, because the
      // staging box's deploy re-pulls `:staging` tenants on every backend develop merge,
      // applied develop's EF migrations to their database each time.
      //
      // A develop-tracking SHOWCASE (`demo`) still wants `:staging`, but that is a
      // founder judgement about one tenant, not something the generator can infer — so it
      // is a hand-edit to this field in the proposed PR, which is exactly the review
      // checkpoint ADR-012 puts at the merge. The PR body says so.
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

// Close the quote, emit an escaped apostrophe, reopen: the only way to get a
// literal ' inside a POSIX single-quoted argument.
const SHELL_QUOTED_APOSTROPHE = String.raw`'\''`;

/** Quote a value for a POSIX shell single-quoted argument. The tenant name is
 *  free text and the founder copy-pastes these commands into a terminal, so an
 *  apostrophe must not end the quoting. */
const shq = (value: string): string =>
  "'" + value.replaceAll("'", SHELL_QUOTED_APOSTROPHE) + "'";

/** Collapse anything that would break the markdown fence or the shell command this
 *  body embeds. `provisionSchema` already refuses control characters in `name`, so in
 *  practice this changes nothing — it is here so the function is safe on its own,
 *  because a body builder that depends on a caller's validation is one refactor away
 *  from emitting an unbalanced code fence built from public-form input. */
const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();

/**
 * The PR body for a provisioning proposal.
 *
 * **For a staging-box tenant, merging this PR provisions it** (SOFRA-ONBOARDING-PLAN §2
 * option B, ADR-012 amendment 2026-07-30): the deploy repo's
 * `provision-on-registry-merge.yml` chains the image build and `provision-tenant.sh` off
 * the registry sync. So the body leads with what to CHECK before merging — the merge is
 * the last reversible moment.
 *
 * That chain is **staging-only** (it follows `sync-registry-to-staging.yml` and inherits
 * its narrowness), so a `box: prod` entry gets the opposite header: merging does nothing
 * and the commands are required, not a fallback. Telling a prod entry "merging provisions
 * this" would leave the founder waiting on a chain that never runs.
 *
 * The image-build command stays in the body either way, because that step is the one that
 * is easy to skip and fatal to skip: `NEXT_PUBLIC_*` are baked per domain, so provisioning
 * without it dies at `docker compose pull` on an image that was never published.
 */
export function buildProvisioningPrBody(input: TenantProvisionInput): string {
  const { slug } = input;
  const domain = `${slug}.sofrapiwas.com`;
  const box = input.box ?? "staging";
  const chained = box === "staging";

  // One line, naming the one field in the diff the founder may need to change. It used to
  // branch on the box and warn that a staging-box tenant rides develop; the generator no
  // longer produces that entry, so warning about it would be an unfalsifiable checkbox.
  const tagCheck =
    "- [ ] **`backend_tag: latest`** — released code, published only from `main`. If this is a develop-tracking **showcase** rather than a customer, change it to `staging` in Files changed before merging; a customer should stay on `latest`, so their database is never migrated by unreleased code";

  const header = chained
    ? [
        "### ⚠️ Merging this PR provisions the tenant",
        "",
        "`provision-on-registry-merge.yml` builds the per-tenant frontend image and then runs",
        "`provision-tenant.sh` on the box — roughly 15 minutes, hands-off. **This is the human",
        "checkpoint, and it is the last reversible moment.** Before you merge:",
      ]
    : [
        `### Merging this PR does **not** provision — \`box: ${box}\``,
        "",
        "The post-merge chain is staging-only. This entry will be reported and skipped, so the",
        "two commands below are **required**, not a fallback. Still check the entry first:",
      ];

  const after = chained
    ? [
        "The chain provisions **first-time only**, and reports back on this PR when it is done —",
        "or opens an issue on the deploy repo if any stage fails, including the registry sync it",
        "waits on. A tenant it has already finished is skipped, so re-merging or",
        "reverting-and-remerging this PR will not provision twice. One it left part-way through is",
        "*completed* rather than skipped, so a retry is always safe.",
      ]
    : [
        "Merging still fires `sync-registry-to-staging.yml`, which copies the registry to the",
        "**staging** box only. A prod-box tenant needs the prod box's own access (ADR-012",
        "per-box boundary), so run the commands from a machine that has it.",
      ];

  return [
    `Adds the \`${slug}\` tenant to \`tenants/registry.yml\`, proposed by the control plane (sofra ADR-012).`,
    "",
    `- **domain** \`${domain}\` · **template** \`${input.template}\` · **currency** \`${input.currency}\``,
    `- **languages** \`${input.languages.join(", ")}\` · **modules** \`${input.modules.join(", ")}\``,
    `- **box** \`${box}\` · status starts at \`provisioning\``,
    "",
    ...header,
    "",
    `- [ ] the **slug** \`${slug}\` is what the customer should live on forever — it is the subdomain, database, role and compose project, and changing it later is a full re-provision`,
    `- [ ] **modules** \`${input.modules.join(", ")}\` match what they actually paid for — they are enforced at runtime now, so a missing id is a feature they bought and will not get`,
    tagCheck,
    `- [ ] **template** \`${input.template}\` and **currency** \`${input.currency}\` are right — the template is baked into the image at build time, so changing it later is a rebuild`,
    "",
    ...after,
    "",
    `Afterwards: \`./verify-env.sh https://${domain}\`, hand over the generated admin password from the tenant \`.env\` (and have them change it), then flip this entry's \`status\` to \`active\` in a follow-up commit.`,
    "",
    chained ? "### If the chain fails" : "### Run these after merging",
    "",
    "Both are idempotent and safe to re-run:",
    "",
    "```bash",
    "gh workflow run build-tenant-image.yml --repo piwas-21/restaurant-app-frontend \\",
    `  -f tenant_domain=${domain} \\`,
    `  -f image_tag=tenant-${slug} \\`,
    `  -f restaurant_name=${shq(oneLine(input.name))} \\`,
    `  -f template=${input.template} \\`,
    `  -f currency=${input.currency}`,
    "",
    `gh workflow run provision-tenant.yml --repo piwas-21/restaurant-app-deploy -f slug=${slug}`,
    "```",
    "",
    "Full runbook: deploy repo `DEPLOYMENT.md` §Tenant provisioning.",
  ].join("\n");
}
