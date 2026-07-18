// ADR-012 git-native provisioning trigger (control-plane half). The control plane
// proposes a NEW tenant by opening a PR that appends its entry to the deploy repo's
// tenants/registry.yml — a REVIEWABLE checkpoint (invariant 3), never a direct box
// write. A founder merges it, the change syncs to the box, and the provision-tenant
// GitHub Action (deploy repo) runs the idempotent script. The app holds only a
// repo-scoped GitHub token (PROVISION_GITHUB_TOKEN) — never the box SSH key
// (invariant 2).

import { buildTenantRegistryEntry, type TenantProvisionInput } from "@/lib/provisioning-registry";

const OWNER = "piwas-21";
const REPO = "restaurant-app-deploy";
const BASE = "develop"; // deploy repo default/integration branch (GitFlow)
const REGISTRY_PATH = "tenants/registry.yml";
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

async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
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
export async function openProvisioningPr(input: TenantProvisionInput): Promise<{ prUrl: string }> {
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

  const entry = buildTenantRegistryEntry(input);
  const updated = `${current.replace(/\n*$/, "\n")}${entry}\n`;

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
      body:
        `Adds the \`${input.slug}\` tenant to \`${REGISTRY_PATH}\` (proposed by the control plane, ADR-012).\n\n` +
        `- template: **${input.template}** · currency: ${input.currency} · box: ${input.box ?? "staging"}\n` +
        `- After merge: sync to the box, then run the \`provision-tenant\` Action with slug \`${input.slug}\`.\n\n` +
        `Review the entry before merging — this is the human checkpoint before any box provisioning.`,
    }),
  });
  return { prUrl: pr.html_url };
}
