// The CONDITIONAL sections of an ADR-012 provisioning PR body — the parts that
// appear only when the entry carries something the founder has to look at before
// merging (a withheld module, a partner's own zone, a partner credit, a
// per-transaction commission rate).
//
// Split out of lib/provisioning-pr-body.ts when the pair outgrew one file's LOC
// limit (CLAUDE.md §4), the same split that file records having had from
// provisioning-registry.ts. Each function returns markdown LINES and an empty
// array when its condition does not hold, so the body composes them by spreading
// — a section that does not apply contributes nothing, not a blank heading.
//
// Pure: no GitHub API, no secrets, no env.

import type { TenantProvisionInput } from "./provisioning-registry";
import { COMMISSION_FLOOR_CENTS } from "./payments-pricing";

/**
 * Bought but deliberately NOT in this entry.
 *
 * Named, not silent. The entry omits a module they PAID for, so the body has to say
 * so where the founder is already reading — otherwise the checklist quietly
 * contradicts the receipt, and the gap is discovered by a customer asking why card
 * payment does not work.
 *
 * WHAT THIS SECTION NOW MEANS (ADR-011 amendment). It used to be the ordinary
 * self-serve outcome, on the premise that only the restaurant could create a Stripe
 * account. The control plane MINTS the account now, so reaching this section means the
 * mint did not happen — and `note` says why. The instruction is therefore no longer
 * "wait for the restaurant"; it is "fix the reason, or supply an account yourself".
 */
export function deferredSection(
  slug: string,
  granted: string[],
  deferred: string[],
  note?: string,
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
    // The reason, when the mint reported one. Without it this section would say only
    // that something is missing, which is the state this whole slice was written to end.
    ...(note
      ? [
          `**Why there is no account:** ${note}.`,
          "",
          "Sofra creates each tenant's Stripe **Express** account itself, before opening this",
          "PR, so this is a failure rather than the normal course of things.",
          "",
        ]
      : []),
    "**Two ways forward, and the first is usually right.** Fix the cause above and re-propose,",
    "so the entry carries both halves in one commit as it is meant to. Or, if you already hold",
    "an `acct_` for them, add both fields in **Files changed** before merging — one shot, not",
    "two. Only these two lines change; the rest of the entry stays as merged:",
    "",
    "```yaml",
    `  ${slug}:`,
    "    stripe_account: acct_XXXXXXXXXXXX",
    `    modules: [${[...granted, ...deferred].join(", ")}]`,
    "```",
    "",
    "Failing both, provision them now on everything else — they trade on cash from day one —",
    "then add both fields together in a follow-up registry PR and re-run provisioning",
    `(\`gh workflow run provision-tenant.yml --repo piwas-21/restaurant-app-deploy -f slug=${slug}\`),`,
    "and restart the tenant so it picks up the Stripe env. Background — what the account is,",
    "what the restaurant still has to finish, TWINT, the box env — workspace",
    "`docs/runbooks/signup-to-live-tenant.md` **§2b**.",
  ];
}

/**
 * The commission rate this entry carries — or, when a rate was requested but
 * `online-payments` itself is deferred, why the entry carries NEITHER
 * (SOFRA-PAYMENTS-PRICING-MODE-PLAN, S1).
 *
 * `provision-tenant.sh` refuses a non-zero `payments_commission_bps` unless the
 * SAME entry also carries `online-payments` in `modules` AND a `stripe_account`
 * — the identical shape as the deferred-module guard above, one field over.
 * `buildTenantRegistryEntry` already drops the rate rather than write half of
 * that condition; this section is the only place a founder is told a number
 * they requested is silently missing from the diff, because nothing else in
 * the body would say so.
 */
export function commissionSection(
  slug: string,
  paymentsCommissionBps: number | undefined,
  grantsOnlinePayments: boolean,
): string[] {
  if (!paymentsCommissionBps) return [];
  const pct = (paymentsCommissionBps / 100).toFixed(2);
  if (grantsOnlinePayments) {
    return [
      "",
      `### 💳 Per-transaction commission: \`${paymentsCommissionBps}\` bps (${pct}%)`,
      "",
      "This tenant is on the `commission` payments mode: `online-payments` is billed at",
      // Read from the constant rather than typed as prose — a body that hardcoded
      // the floor would keep quoting the old number after it moved.
      `the reduced €${(COMMISSION_FLOOR_CENTS / 100).toFixed(2)}/mo floor (NOT €0) and Sofra takes this rate on top,`,
      "sent to Stripe as `application_fee_amount` on each online order. Same as any other field in this",
      "entry, it only takes effect once this PR merges and the tenant is (re-)provisioned —",
      "until then the billing record and the registry can disagree, same as any other",
      "registry-PR window.",
    ];
  }
  return [
    "",
    `### ⚠️ Requested commission rate \`${paymentsCommissionBps}\` bps (${pct}%) is NOT in this entry`,
    "",
    "`provision-tenant.sh` refuses a non-zero `payments_commission_bps` unless the SAME",
    "entry also carries `online-payments` in `modules` AND a `stripe_account` — the exact",
    "pair deferred in the section above. Writing the rate here without them would only move",
    "the same refusal onto this field, so it is held back alongside `online-payments` and",
    `must be added in the SAME follow-up PR: add \`payments_commission_bps: ${paymentsCommissionBps}\``,
    "next to `stripe_account` and `online-payments` in that one commit — not before, and not",
    "in a separate PR of its own, or the guard trips on whichever field lands first.",
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
