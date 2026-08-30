// The CONDITIONAL sections of an ADR-012 provisioning PR body — the parts that
// appear only when the entry carries something the founder has to look at before
// merging (a withheld module, a partner's own zone, a partner credit).
//
// Split out of lib/provisioning-pr-body.ts when the pair outgrew one file's LOC
// limit (CLAUDE.md §4), the same split that file records having had from
// provisioning-registry.ts. Each function returns markdown LINES and an empty
// array when its condition does not hold, so the body composes them by spreading
// — a section that does not apply contributes nothing, not a blank heading.
//
// Pure: no GitHub API, no secrets, no env.

import type { TenantProvisionInput } from "./provisioning-registry";

/**
 * Bought but deliberately NOT in this entry.
 *
 * Named, not silent. The entry omits a module they PAID for, so the body has to say
 * so where the founder is already reading — otherwise the checklist quietly
 * contradicts the receipt, and the gap is discovered by a customer asking why card
 * payment does not work. Empty for every tenant that bought nothing deferred.
 */
export function deferredSection(
  slug: string,
  granted: string[],
  deferred: string[],
): string[] {
  if (!deferred.length) return [];
  return [
    "",
    `### ⚠️ Bought but deliberately NOT in this entry: \`${deferred.join(", ")}\``,
    "",
    `They paid for \`${deferred.join(", ")}\` and they keep it — the plan, the price and the`,
    "subscription are unchanged. It is out of **this** entry because `provision-tenant.sh`",
    "refuses the pair `online-payments` without `stripe_account:`, and refuses it *before*",
    "the database, the compose project or the image — so proposing both here would not give",
    "them a restaurant lacking card payment, it would give them **no restaurant at all**.",
    "",
    "No account was supplied with this proposal. If you are the founder and you already",
    "hold their `acct_` — runbook §2b has you create it *before* proposing, exactly so",
    "this does not happen — the fix is one shot, not two: add both fields in **Files",
    "changed** before merging and delete this section's premise. Otherwise the account",
    "genuinely cannot exist yet, because only the restaurant can create it, through",
    "Stripe's hosted onboarding, which cannot be pre-filled. In that case provision them",
    "now on everything else, then, once they have finished Stripe and you have their id, open a",
    "**second** registry PR that adds BOTH halves together — one without the other trips",
    "the same guard. Only these two fields change; the rest of the entry stays as merged:",
    "",
    "```yaml",
    `  ${slug}:`,
    "    stripe_account: acct_XXXXXXXXXXXX",
    `    modules: [${[...granted, ...deferred].join(", ")}]`,
    "```",
    "",
    `…then re-run provisioning (\`gh workflow run provision-tenant.yml --repo piwas-21/restaurant-app-deploy -f slug=${slug}\`)`,
    "and restart the tenant so it picks up the Stripe env. Full recipe — account creation,",
    "the KYC sitting, TWINT, the box env — workspace `docs/runbooks/signup-to-live-tenant.md`",
    "**§2b**, which is written to be followed BEFORE this second PR.",
  ];
}

/**
 * A partner's own zone.
 *
 * The one thing that can go wrong with a partner-zone entry and cannot be fixed after
 * the merge: the name has to RESOLVE before provisioning, because the certificate is
 * issued per hostname over HTTP-01 and there is no way to pre-issue one. A tenant
 * provisioned ahead of its A record sits without TLS, which looks exactly like a
 * broken product to the restaurant that was just handed a link.
 */
export function baseDomainSection(baseDomain: string | undefined, domain: string): string[] {
  if (!baseDomain) return [];
  return [
    "",
    `### ⚠️ Partner zone — \`base_domain: ${baseDomain}\`, so the wildcard does NOT cover it`,
    "",
    `\`\`\`bash\ndig +short ${domain}   # must already answer with this box's IP\n\`\`\``,
    "",
    "The partner publishes that A record in their own zone (plan §D1a: per-client A record —",
    "a delegated subzone is impossible, not merely worse). An empty answer means merging will",
    "stand the tenant up and then fail to get a certificate, which are issued per hostname over",
    "HTTP-01 and cannot be pre-issued: **wait for the record rather than merge and retry.** And",
    "note `NEXT_PUBLIC_*` are baked per domain, so changing this domain later is a rebuild plus",
    "a re-provision, not a registry edit.",
  ];
}

/**
 * A partner credit is about to become PUBLIC (SOFRA-PARTNER-PLAN §11e).
 *
 * This section exists because the registry PR is the founder's review checkpoint
 * (ADR-012), and this is the moment someone should notice that a name and a link are
 * about to appear on a restaurant's page — a page belonging to a third party. It is
 * the last cheap place to say "no": after the merge the entry is provisioned, and
 * un-publishing means another registry PR and another re-provision.
 *
 * It also names the field the RESTAURANT can be given (D-B2), because the founder is
 * the only party who can add it on their behalf, and the entry deliberately does not
 * carry it by default: absent means attribution is on.
 */
export function partnerSection(
  slug: string,
  brand: NonNullable<TenantProvisionInput["partnerBrand"]>,
): string[] {
  return [
    "",
    `### 👤 This entry credits a partner in the tenant's footer: \`${brand.displayName}\``,
    "",
    `The footer of every page on this restaurant's site will read *"Site by ${brand.displayName}"*${
      brand.websiteUrl ? `, linked to \`${brand.websiteUrl}\`` : " (no link — the partner recorded no website)"
    }.`,
    "It is here because that partner asked for it on `/dashboard/brand`, and only a name and",
    "a URL cross: no address, no phone, and never the legal name — a sole trader's legal name",
    "is a private individual's, which is why the control plane refuses to publish it at all.",
    "",
    "**Check the restaurant is content to be credited.** If they are not, add one line to this",
    "entry before merging — the default is on, so the key only ever appears to turn it off:",
    "",
    "```yaml",
    `  ${slug}:`,
    "    partner_attribution: false",
    "```",
    "",
    "It is resolved during provisioning, so the tenant's env carries only what to display.",
    "Changing it later is a registry edit plus a re-provision (a `restart` re-reads nothing).",
  ];
}
