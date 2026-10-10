// Propose an existing tenant's partner-brand amendment in the deploy repo.
// Each partner/site pair gets its own branch so concurrent site proposals cannot
// return one another's review links.

import type { RenderableBrand } from "@/lib/partner-brand";
import {
  gh,
  OWNER,
  REPO,
  BASE,
  REGISTRY_PATH,
  ProvisioningApiError,
  ProvisioningNotConfiguredError,
} from "./provisioning";
import { setRegistryPartnerBrand } from "./partner-brand-registry-edit";
import { partnerBrandRegistryPrBody } from "./partner-brand-registry-pr-body";
import {
  assertSafeOrphanBranch,
  branchFor,
  findClosedProposal,
  findOpenProposal,
  registryFile,
} from "./partner-brand-registry-pr-branch";
export { PartnerBrandProposalConflictError } from "./partner-brand-registry-pr-errors";
import { PartnerBrandProposalConflictError } from "./partner-brand-registry-pr-errors";
export type PartnerBrandProposal =
  | { kind: "opened" | "pending"; prUrl: string; optedOut: boolean }
  | { kind: "unchanged"; optedOut: boolean };

/**
 * Apply a safe public projection to a registered tenant's branch and open (or
 * recover) its review PR. A matching open PR is returned as pending; a branch
 * with different proposed content, a closed PR, or an unprovable base is refused.
 */
export async function openPartnerBrandRegistryPr(
  partnerId: string,
  slug: string,
  brand: RenderableBrand | null,
): Promise<PartnerBrandProposal> {
  const token = process.env.PROVISION_GITHUB_TOKEN;
  if (!token) throw new ProvisioningNotConfiguredError();

  const baseFile = await registryFile(token, BASE);
  const baseEdit = setRegistryPartnerBrand(baseFile.content, slug, brand);
  if (!baseEdit.changed) return { kind: "unchanged", optedOut: baseEdit.optedOut };

  const branch = branchFor(partnerId, slug);
  const baseRef = await gh<{ object: { sha: string } }>(
    token,
    `/repos/${OWNER}/${REPO}/git/ref/heads/${BASE}`,
  );
  let branchAlreadyExists = false;
  try {
    await gh(token, `/repos/${OWNER}/${REPO}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }),
    });
  } catch (error) {
    if (!(error instanceof ProvisioningApiError) || !/Reference already exists/i.test(error.message)) throw error;
    branchAlreadyExists = true;
  }

  if (branchAlreadyExists) {
    const pending = await findOpenProposal(token, branch);
    if (pending) {
      const pendingFile = await registryFile(token, branch);
      const pendingEdit = setRegistryPartnerBrand(pendingFile.content, slug, brand);
      if (pendingEdit.changed) {
        throw new PartnerBrandProposalConflictError(
          "A partner-brand proposal for this site is already open with different saved details.",
          pending.html_url,
        );
      }
      return { kind: "pending", prUrl: pending.html_url, optedOut: pendingEdit.optedOut };
    }

    const closed = await findClosedProposal(token, branch);
    if (closed) {
      throw new PartnerBrandProposalConflictError(
        "A previous partner-brand proposal for this site was closed; refusing to reuse its branch.",
        closed.html_url,
      );
    }
  }

  const orphan = branchAlreadyExists
    ? await assertSafeOrphanBranch(token, branch, baseRef.object.sha, slug)
    : null;
  const source = orphan?.file ?? (await registryFile(token, branch));
  const edit = setRegistryPartnerBrand(source.content, slug, brand);
  if (orphan && !orphan.atBase && edit.changed) {
    throw new PartnerBrandProposalConflictError(
      "A prior partner-brand proposal for this site contains different saved details; refusing to amend an orphaned branch.",
    );
  }
  if (edit.changed) {
    await gh(token, `/repos/${OWNER}/${REPO}/contents/${REGISTRY_PATH}`, {
      method: "PUT",
      body: JSON.stringify({
        message: `chore(registry): update partner brand for '${slug}'`,
        content: Buffer.from(edit.yaml, "utf8").toString("base64"),
        sha: source.sha,
        branch,
      }),
    });
  }

  try {
    const pr = await gh<{ html_url: string }>(token, `/repos/${OWNER}/${REPO}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title: `Update partner brand: ${slug}`,
        head: branch,
        base: BASE,
        body: partnerBrandRegistryPrBody(slug, brand, edit.optedOut),
      }),
    });
    return { kind: "opened", prUrl: pr.html_url, optedOut: edit.optedOut };
  } catch (error) {
    if (!(error instanceof ProvisioningApiError)) throw error;
    const pending = await findOpenProposal(token, branch);
    if (pending) {
      const pendingFile = await registryFile(token, branch);
      const pendingEdit = setRegistryPartnerBrand(pendingFile.content, slug, brand);
      if (pendingEdit.changed) {
        throw new PartnerBrandProposalConflictError(
          "A partner-brand proposal for this site is open with different saved details.",
          pending.html_url,
        );
      }
      return { kind: "pending", prUrl: pending.html_url, optedOut: pendingEdit.optedOut };
    }
    throw error;
  }
}
