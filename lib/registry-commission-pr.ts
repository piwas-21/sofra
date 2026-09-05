// Amend an EXISTING tenant's payments commission rate by proposing a registry
// PR (SOFRA-PAYMENTS-PRICING-MODE-PLAN S2a) — the AMENDMENT counterpart to
// `lib/provisioning.ts`'s `openProvisioningPr`, which only APPENDS a brand-new
// entry and refuses a slug that already exists. Split into its own file rather
// than folded into `provisioning.ts`, which already sits close to CLAUDE.md
// §4's line limit — the same split that file's own history records having had
// for provisioning-pr-body.ts / provisioning-pr-blocks.ts /
// provisioning-module-pairing.ts. Shares `provisioning.ts`'s GitHub client
// (`gh`) and repo constants rather than a second copy of either.

import {
  gh,
  OWNER,
  REPO,
  BASE,
  REGISTRY_PATH,
  ProvisioningNotConfiguredError,
  ProvisioningApiError,
} from "./provisioning";
import { currentRegistryCommissionBps, setRegistryCommissionBps } from "./registry-commission-edit";
import {
  COMMISSION_FLOOR_CENTS,
  COMMISSION_MODE_SAVING_CENTS,
  ONLINE_PAYMENTS_PRICE_CENTS,
  crossoverCentsPerMonth,
} from "./payments-pricing";

// Integer cents as a plain major-units string for a MARKDOWN body — not
// `format.ts`'s `eur()`, whose nl-NL output ("€ 9,00") carries a currency symbol
// this text supplies itself and a figure the surrounding sentence explicitly
// says is in the TENANT's currency, not Sofra's EUR.
const majorUnits = (cents: number): string => (cents / 100).toFixed(2);

export type CommissionChangeResult = { alreadySet: true } | { alreadySet: false; prUrl: string };

/**
 * The PR body: tenant, old → new rate, the crossover (so a reviewer sees the
 * commercial consequence, plan §2), and — the fact easiest to miss — that
 * merging changes ENFORCEMENT only. The billing intent already moved the
 * moment the caller wrote `TenantBilling`; this PR is what makes the box agree
 * with it, and only a re-provision (never a `restart`, which re-reads nothing)
 * makes that happen.
 */
function commissionChangePrBody(slug: string, oldBps: number, newBps: number): string {
  // No second argument: the crossover is driven by what `commission` SAVES on
  // the module, not by its full list price — see COMMISSION_MODE_SAVING_CENTS,
  // which this deliberately defaults to.
  const crossover = crossoverCentsPerMonth(newBps);
  // Read from the constants, never typed as prose: this file deleted its own
  // duplicated catalog lookup for exactly this reason, and a PR body that
  // hardcodes "€9" is the same drift one layer further out — it would keep
  // saying it after the floor moved, while every UI surface had already changed.
  const floor = majorUnits(COMMISSION_FLOOR_CENTS);
  const full = majorUnits(ONLINE_PAYMENTS_PRICE_CENTS);
  const saving = majorUnits(COMMISSION_MODE_SAVING_CENTS);
  return [
    `Updates \`${slug}\`'s per-transaction commission rate in \`tenants/registry.yml\`, proposed by the control plane's \`/admin\` (SOFRA-PAYMENTS-PRICING-MODE-PLAN S2a).`,
    "",
    `- **tenant** \`${slug}\``,
    `- **rate** \`${oldBps}\` bps → \`${newBps}\` bps`,
    crossover !== null
      ? `- **crossover** ~\`${majorUnits(crossover)}\` of monthly online turnover (this tenant's own billing currency, major units) — below that figure \`commission\` costs this tenant LESS than \`flat\`; above it, more. Computed from the €${saving} the module drops by under \`commission\` (€${full} → the €${floor} floor), not from the full €${full}`
      : "- **crossover** none at 0 bps — commission costs nothing no matter the turnover",
    "",
    "### Merging this changes ENFORCEMENT only",
    "",
    "This edits what is sent to Stripe as `application_fee_amount` once the tenant is",
    "next provisioned — merging alone does **not** flip anything live, and a",
    "`docker compose restart` re-reads nothing (the tenant's env is baked at",
    "provisioning). The billing intent (`TenantBilling`) already reflects the new rate;",
    "until the re-provision below runs, the tenant is billed the new rate while still",
    "being enforced at the old one.",
    "",
    "```bash",
    `gh workflow run provision-tenant.yml --repo piwas-21/restaurant-app-deploy -f slug=${slug}`,
    "```",
    "",
    "Idempotent and safe to re-run.",
  ].join("\n");
}

/**
 * Open a PR amending `slug`'s `payments_commission_bps` to `bps`. Mirrors
 * `openProvisioningPr`'s steps — read the registry (content+sha) on BASE,
 * apply the edit, branch off BASE, commit, open the PR — but on a slug that
 * must ALREADY be in the registry; `setRegistryCommissionBps` throws when it
 * is not (there is no "append" fallback here, unlike a new tenant's entry).
 *
 * Returns `{ alreadySet: true }` without opening anything when the registry
 * already carries this exact rate — `setRegistryCommissionBps` reports that
 * as `changed: false`, and a PR with an empty diff is worse than no PR: it is
 * a checklist item a founder ticks for nothing.
 */
export async function openCommissionChangePr(slug: string, bps: number): Promise<CommissionChangeResult> {
  const token = process.env.PROVISION_GITHUB_TOKEN;
  if (!token) throw new ProvisioningNotConfiguredError();

  const file = await gh<{ content: string; sha: string }>(
    token,
    `/repos/${OWNER}/${REPO}/contents/${REGISTRY_PATH}?ref=${BASE}`,
  );
  const current = Buffer.from(file.content, "base64").toString("utf8");
  // Read BEFORE the edit — the only place the "old" figure in the PR body can
  // come from without a second, independent parse that could disagree with
  // the one setRegistryCommissionBps actually acted on.
  const oldBps = currentRegistryCommissionBps(current, slug) ?? 0;

  const { yaml: updated, changed } = setRegistryCommissionBps(current, slug, bps);
  if (!changed) return { alreadySet: true };

  const baseRef = await gh<{ object: { sha: string } }>(
    token,
    `/repos/${OWNER}/${REPO}/git/ref/heads/${BASE}`,
  );
  // Distinct prefix from provisioning's `provision/<slug>`: this amends a
  // tenant that already exists, and the two flows must never collide on a
  // branch name for the same slug.
  const branch = `payments/${slug}`;
  try {
    await gh(token, `/repos/${OWNER}/${REPO}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }),
    });
  } catch (e) {
    // An open proposal for this same tenant already holds the branch.
    if (e instanceof ProvisioningApiError && /Reference already exists/i.test(e.message)) {
      throw new ProvisioningApiError(
        `a commission-rate change for '${slug}' is already open (branch ${branch} exists)`,
      );
    }
    throw e;
  }

  await gh(token, `/repos/${OWNER}/${REPO}/contents/${REGISTRY_PATH}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `chore(registry): update '${slug}' payments_commission_bps to ${bps}`,
      content: Buffer.from(updated, "utf8").toString("base64"),
      sha: file.sha,
      branch,
    }),
  });

  const pr = await gh<{ html_url: string }>(token, `/repos/${OWNER}/${REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `Update payments commission: ${slug} (${oldBps} → ${bps} bps)`,
      head: branch,
      base: BASE,
      body: commissionChangePrBody(slug, oldBps, bps),
    }),
  });
  return { alreadySet: false, prUrl: pr.html_url };
}
