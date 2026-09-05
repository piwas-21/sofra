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
import { commissionChangePrBody } from "./registry-commission-pr-body";

export type CommissionChangeResult = { alreadySet: true } | { alreadySet: false; prUrl: string };

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
