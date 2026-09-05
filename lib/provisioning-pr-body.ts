// The PR body for an ADR-012 provisioning proposal — the founder-facing half of
// lib/provisioning-registry.ts, split out when the pair outgrew one file's LOC limit
// (CLAUDE.md §4). Pure: no GitHub API, no secrets, no env.
//
// It describes the entry that generator emits, so it derives every value it quotes
// from the SAME input through the SAME helpers. Two independent literals would drift,
// and a body that misdescribes the diff is worse than no body — the founder ticks the
// checklist against it.

import { splitDeferredModules, tenantDomain, type TenantProvisionInput } from "./provisioning-registry";
// The conditional sections live next door (LOC limit, CLAUDE.md §4). Each returns an
// empty array when it does not apply, so this file spreads them unconditionally.
import {
  baseDomainSection,
  commissionSection,
  deferredSection,
  partnerSection,
} from "./provisioning-pr-blocks";

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
  // Derived through the SAME helper the entry uses, never re-literalled: this body is
  // the checklist the founder ticks, and a body naming a different host than the diff
  // is worse than no body at all.
  const domain = tenantDomain(input);
  const box = input.box ?? "staging";
  const chained = box === "staging";
  // Same helper the entry generator uses, so the body cannot describe a split the diff
  // does not have.
  const { granted, deferred } = splitDeferredModules(input.modules, input.stripeAccount);
  // Same condition `buildTenantRegistryEntry` uses to decide whether a requested
  // commission rate may be written at all — computed once here so the summary
  // bullet and commissionSection cannot disagree about which case applies.
  const grantsOnlinePayments = granted.includes("online-payments");

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

  // Built as statements rather than inline: nesting a conditional inside a template
  // literal that is itself inside a conditional is the shape Sonar rejects (S3358),
  // and it is genuinely hard to read — the "(not written)" caveat below belongs to the
  // commission, not to the deferred module list it would otherwise sit beside.
  const deferredSuffix = deferred.length
    ? ` · **deferred** \`${deferred.join(", ")}\` (see below)`
    : "";

  // A rate is only WRITTEN into the entry when online-payments actually survives the
  // grant/defer split — provision-tenant.sh refuses a non-zero rate without the module
  // and a stripe_account, and refuses it before the database. So when the module is
  // deferred the number is still worth showing (it is what the second PR will carry)
  // but must be labelled as not yet written, or a reviewer reads it as live.
  let commissionSuffix = "";
  if (input.paymentsCommissionBps) {
    const caveat = grantsOnlinePayments ? "" : " (not written — see below)";
    commissionSuffix = ` · **commission** \`${input.paymentsCommissionBps} bps\`${caveat}`;
  }

  return [
    `Adds the \`${slug}\` tenant to \`tenants/registry.yml\`, proposed by the control plane (sofra ADR-012).`,
    "",
    `- **domain** \`${domain}\` · **template** \`${input.template}\` · **currency** \`${input.currency}\``,
    `- **languages** \`${input.languages.join(", ")}\` · **modules** \`${granted.join(", ")}\`${deferredSuffix}${commissionSuffix}`,
    `- **box** \`${box}\` · status starts at \`provisioning\`${
      input.baseDomain ? ` · **base_domain** \`${input.baseDomain}\` (a partner's own zone)` : ""
    }${
      // In the summary as well as its own section below: this is the line a founder
      // skims, and a name becoming public is the one thing in the diff that is about
      // a third party rather than about the tenant.
      input.partnerBrand ? ` · **partner credit** \`${input.partnerBrand.displayName}\` (public)` : ""
    }`,
    "",
    ...header,
    "",
    `- [ ] the **slug** \`${slug}\` is what the customer should live on forever — it is the subdomain, database, role and compose project, and changing it later is a full re-provision`,
    // With a deferral the "must match what they paid for" wording would be false by
    // construction, and a checkbox the founder must tick while knowing it is wrong is
    // how the whole checklist stops being read. So the ask changes with the diff.
    deferred.length
      ? `- [ ] **modules** \`${granted.join(", ")}\` are everything they paid for EXCEPT \`${deferred.join(", ")}\`, which is held back on purpose — see the section below. They are enforced at runtime, so any *other* missing id is a feature they bought and will not get`
      : `- [ ] **modules** \`${granted.join(", ")}\` match what they actually paid for — they are enforced at runtime now, so a missing id is a feature they bought and will not get`,
    tagCheck,
    `- [ ] **template** \`${input.template}\` and **currency** \`${input.currency}\` are right — the template is baked into the image at build time, so changing it later is a rebuild`,
    ...deferredSection(slug, granted, deferred),
    ...commissionSection(slug, input.paymentsCommissionBps, grantsOnlinePayments),
    ...baseDomainSection(input.baseDomain, domain),
    // Only when a publishable partner brand reached the entry — `renderableBrand`
    // decided that, not this file.
    ...(input.partnerBrand ? partnerSection(slug, input.partnerBrand) : []),
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
