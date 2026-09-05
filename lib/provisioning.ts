// ADR-012 git-native provisioning trigger (control-plane half). The control plane
// proposes a NEW tenant by opening a PR that appends its entry to the deploy repo's
// tenants/registry.yml — a REVIEWABLE checkpoint (invariant 3), never a direct box
// write. A founder merges it, the change syncs to the box, and the provision-tenant
// GitHub Action (deploy repo) runs the idempotent script. The app holds only a
// repo-scoped GitHub token (PROVISION_GITHUB_TOKEN) — never the box SSH key
// (invariant 2).

import { buildProvisioningPrBody } from "@/lib/provisioning-pr-body";
import { tenantPartnerBrand } from "@/lib/partner-brand-lookup";
import { mintForProposal } from "@/lib/provisioning-mint";
import {
  buildTenantRegistryEntry,
  tenantDomain,
  type TenantProvisionInput,
} from "@/lib/provisioning-registry";

// Exported so lib/registry-commission-pr.ts (the amendment counterpart to
// openProvisioningPr below, split into its own file for CLAUDE.md §4's line
// limit) shares this ONE GitHub client and these ONE repo constants, rather
// than a second copy of either drifting from this one.
export const OWNER = "piwas-21";
export const REPO = "restaurant-app-deploy";
export const BASE = "develop"; // deploy repo default/integration branch (GitFlow)
export const REGISTRY_PATH = "tenants/registry.yml";
const API = "https://api.github.com";

/** Provisioning is not configured (no token) — surfaced like the Mollie banner. */
export class ProvisioningNotConfiguredError extends Error {
  constructor() {
    super("provisioning is not configured (PROVISION_GITHUB_TOKEN unset)");
    this.name = "ProvisioningNotConfiguredError";
  }
}

/** A GitHub API call failed; message is safe to surface (no token). */
export class ProvisioningApiError extends Error {}

export function provisioningConfigured(): boolean {
  return Boolean(process.env.PROVISION_GITHUB_TOKEN);
}

/** Per-call ceiling. Since O3 these calls sit in the Mollie webhook's critical path,
 *  ahead of subscription activation — and a HANG there (not an error, a hang) would stall
 *  activation on a dependency that has nothing to do with billing, until Mollie times the
 *  delivery out and redelivers on top of the one still in flight. `fetch` has no default
 *  timeout, so it needs an explicit one. */
const GH_TIMEOUT_MS = 15_000;

export async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    // Never serve a cached registry/ref read — a stale sha would 409 the commit.
    cache: "no-store",
    signal: AbortSignal.timeout(GH_TIMEOUT_MS),
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    // GitHub error bodies name the field/reason, not the token.
    const body = await res.text().catch(() => "");
    throw new ProvisioningApiError(`GitHub ${init?.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Open a PR on the deploy repo that appends the tenant's registry entry. Returns
 * the PR URL. Steps: read the current registry (content+sha) on BASE, append the
 * entry, branch off BASE, commit the change on the branch, open the PR. A slug
 * already MERGED into the registry is refused up front; a still-open proposal for
 * the same slug is caught at branch creation with a clear message (the slug isn't
 * on BASE until its PR merges, so the up-front check can't see it).
 */
export async function openProvisioningPr(
  input: TenantProvisionInput,
): Promise<{ prUrl: string; deferred: string[]; stripeAccount?: string; mintNote?: string }> {
  const token = process.env.PROVISION_GITHUB_TOKEN;
  if (!token) throw new ProvisioningNotConfiguredError();

  const file = await gh<{ content: string; sha: string }>(
    token,
    `/repos/${OWNER}/${REPO}/contents/${REGISTRY_PATH}?ref=${BASE}`,
  );
  const current = Buffer.from(file.content, "base64").toString("utf8");
  if (new RegExp(`^ {2}${input.slug}:`, "m").test(current)) {
    throw new ProvisioningApiError(`registry already has a '${input.slug}' entry`);
  }

  // The reseller credit for the tenant's footer (SOFRA-PARTNER-PLAN §11e), resolved
  // HERE rather than accepted from a caller. It is DERIVED from the slug — nobody
  // types it, and it is not the founder's to type — so filling it at the one place
  // that writes a registry entry means no caller can forget it, no caller can inject
  // one, and a third path added later inherits it. Whatever the input carried is
  // deliberately overwritten: `renderableBrand` behind this lookup is the only thing
  // allowed to decide that a name may be published (D-B1/D-B1a).
  const partnerBrand = await tenantPartnerBrand(input.slug);

  // The tenant's Stripe connected account, minted HERE and for the same reason the
  // partner credit is resolved here rather than accepted from a caller: this is the one
  // place that writes a registry entry, so no caller can forget it, no caller can inject
  // one, and a third path added later inherits it (ADR-011 amendment, E3).
  //
  // AFTER the "slug already merged" refusal above, deliberately — minting for a slug
  // that cannot be proposed would create a live Stripe account for nothing. And it never
  // throws: a Stripe failure must not cost a paying customer their whole tenant, so it
  // degrades to the pre-existing behaviour (the module is withheld by the pairing rule)
  // and the PR body says why.
  const mint = await mintForProposal({
    slug: input.slug,
    name: input.name,
    adminEmail: input.adminEmail,
    currency: input.currency,
    modules: input.modules,
    url: `https://${tenantDomain(input)}`,
  });
  const withAccount: TenantProvisionInput = {
    ...input,
    partnerBrand,
    ...(mint.stripeAccount ? { stripeAccount: mint.stripeAccount } : {}),
    ...(mint.note ? { stripeAccountNote: mint.note } : {}),
  };

  // `deferred` is returned to the caller rather than only rendered into the PR body: a
  // deferral means a customer is being BILLED for a module their tenant will not have
  // until a second registry PR lands, and a prose section in one PR is not a record
  // anyone can query later. The callers put it in the audit trail.
  const { entry, deferred } = buildTenantRegistryEntry(withAccount);
  // trimEnd() (no regex) drops any trailing whitespace/newlines, then we re-add
  // exactly two — avoids the ReDoS-prone `\n*$`, and the blank line keeps the
  // new tenant from butting against the previous one's trailing comment, which
  // reads as if it belongs to the new entry.
  const updated = `${current.trimEnd()}\n\n${entry}\n`;

  // Branch off BASE's tip.
  const baseRef = await gh<{ object: { sha: string } }>(
    token,
    `/repos/${OWNER}/${REPO}/git/ref/heads/${BASE}`,
  );
  const branch = `provision/${input.slug}`;
  try {
    await gh(token, `/repos/${OWNER}/${REPO}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }),
    });
  } catch (e) {
    // A still-open proposal for this slug already holds the branch (the slug is
    // not on BASE yet, so the registry check above couldn't catch it).
    if (e instanceof ProvisioningApiError && /Reference already exists/i.test(e.message)) {
      throw new ProvisioningApiError(
        `a provisioning proposal for '${input.slug}' is already open (branch ${branch} exists)`,
      );
    }
    throw e;
  }

  // Commit the appended registry on the branch.
  await gh(token, `/repos/${OWNER}/${REPO}/contents/${REGISTRY_PATH}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `chore(registry): provision tenant '${input.slug}' (${input.template})`,
      content: Buffer.from(updated, "utf8").toString("base64"),
      sha: file.sha,
      branch,
    }),
  });

  const pr = await gh<{ html_url: string }>(token, `/repos/${OWNER}/${REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `Provision tenant: ${input.slug}`,
      head: branch,
      base: BASE,
      // The SAME object the entry was built from — resolved credit, minted account and
      // all. A body that describes a partner the diff does not name (or omits one it
      // does), or that calls a module deferred when the entry carries it, is worse than
      // no body: the founder ticks the checklist against it.
      body: buildProvisioningPrBody(withAccount),
    }),
  });
  return {
    prUrl: pr.html_url,
    deferred,
    ...(mint.stripeAccount ? { stripeAccount: mint.stripeAccount } : {}),
    ...(mint.note ? { mintNote: mint.note } : {}),
  };
}
