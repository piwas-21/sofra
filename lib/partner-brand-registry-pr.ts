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
  createBranchIfMissing,
  findMatchingOpenProposal,
  findClosedProposal,
  registryFile,
  type PendingPartnerBrandProposal,
} from "./partner-brand-registry-pr-branch";
export { PartnerBrandProposalConflictError } from "./partner-brand-registry-pr-errors";
import { PartnerBrandProposalConflictError } from "./partner-brand-registry-pr-errors";
import type { RegistryFile } from "./partner-brand-registry-pr-branch";

export type PartnerBrandProposal =
  | { kind: "opened" | "pending"; prUrl: string; optedOut: boolean }
  | { kind: "unchanged"; optedOut: boolean };

type OrphanBranch = Awaited<ReturnType<typeof assertSafeOrphanBranch>>;
type BranchInspection = {
  pending: PendingPartnerBrandProposal | null;
  orphan: OrphanBranch | null;
};

const OPEN_PROPOSAL_MISMATCH =
  "A partner-brand proposal for this site is already open with different saved details.";
const CREATE_PROPOSAL_MISMATCH =
  "A partner-brand proposal for this site is open with different saved details.";

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
  if (!baseEdit.changed)
    return { kind: "unchanged", optedOut: baseEdit.optedOut };

  const branch = branchFor(partnerId, slug);
  const baseRef = await gh<{ object: { sha: string } }>(
    token,
    `/repos/${OWNER}/${REPO}/git/ref/heads/${BASE}`,
  );
  const inspection = await inspectBranch(
    token,
    branch,
    baseRef.object.sha,
    slug,
    brand,
  );
  if (inspection.pending) return inspection.pending;

  const edit = await saveBranchEdit(
    token,
    branch,
    slug,
    brand,
    inspection.orphan,
  );
  return openOrRecoverProposal(token, branch, slug, brand, edit.optedOut);
}

async function inspectBranch(
  token: string,
  branch: string,
  baseSha: string,
  slug: string,
  brand: RenderableBrand | null,
): Promise<BranchInspection> {
  const alreadyExists = await createBranchIfMissing(token, branch, baseSha);
  if (!alreadyExists) return { pending: null, orphan: null };

  const pending = await findMatchingOpenProposal(
    token,
    branch,
    slug,
    brand,
    OPEN_PROPOSAL_MISMATCH,
  );
  if (pending) return { pending, orphan: null };

  const closed = await findClosedProposal(token, branch);
  if (closed) {
    throw new PartnerBrandProposalConflictError(
      "A previous partner-brand proposal for this site was closed; refusing to reuse its branch.",
      closed.html_url,
    );
  }

  const orphan = await assertSafeOrphanBranch(token, branch, baseSha, slug);
  return { pending: null, orphan };
}

async function saveBranchEdit(
  token: string,
  branch: string,
  slug: string,
  brand: RenderableBrand | null,
  orphan: OrphanBranch | null,
) {
  const source = orphan?.file ?? (await registryFile(token, branch));
  const edit = setRegistryPartnerBrand(source.content, slug, brand);
  if (orphan && !orphan.atBase && edit.changed) {
    throw new PartnerBrandProposalConflictError(
      "A prior partner-brand proposal for this site contains different saved details; refusing to amend an orphaned branch.",
    );
  }
  if (edit.changed)
    await updateRegistryFile(token, branch, slug, source, edit.yaml);
  return edit;
}

async function updateRegistryFile(
  token: string,
  branch: string,
  slug: string,
  source: RegistryFile,
  yaml: string,
): Promise<void> {
  await gh(token, `/repos/${OWNER}/${REPO}/contents/${REGISTRY_PATH}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `chore(registry): update partner brand for '${slug}'`,
      content: Buffer.from(yaml, "utf8").toString("base64"),
      sha: source.sha,
      branch,
    }),
  });
}

async function openOrRecoverProposal(
  token: string,
  branch: string,
  slug: string,
  brand: RenderableBrand | null,
  optedOut: boolean,
): Promise<PartnerBrandProposal> {
  try {
    const pr = await gh<{ html_url: string }>(
      token,
      `/repos/${OWNER}/${REPO}/pulls`,
      {
        method: "POST",
        body: JSON.stringify({
          title: `Update partner brand: ${slug}`,
          head: branch,
          base: BASE,
          body: partnerBrandRegistryPrBody(slug, brand, optedOut),
        }),
      },
    );
    return { kind: "opened", prUrl: pr.html_url, optedOut };
  } catch (error) {
    if (!(error instanceof ProvisioningApiError)) throw error;
    const pending = await findMatchingOpenProposal(
      token,
      branch,
      slug,
      brand,
      CREATE_PROPOSAL_MISMATCH,
    );
    if (pending) return pending;
    throw error;
  }
}
