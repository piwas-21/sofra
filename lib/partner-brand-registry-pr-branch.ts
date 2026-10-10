// Helpers for isolating, finding, and safely recovering an existing-site proposal branch.

import { createHash } from "node:crypto";
import type { RenderableBrand } from "@/lib/partner-brand";
import {
  gh,
  OWNER,
  REPO,
  BASE,
  REGISTRY_PATH,
  ProvisioningApiError,
} from "./provisioning";
import { setRegistryPartnerBrand } from "./partner-brand-registry-edit";
import { PartnerBrandProposalConflictError } from "./partner-brand-registry-pr-errors";

export type RegistryFile = { content: string; sha: string };
export type PullRequest = {
  html_url: string;
  head: { ref: string; repo?: { full_name?: string } };
  base?: { ref: string };
};
type BranchCommit = {
  parents: Array<{ sha: string }>;
  commit: { message: string };
  files: Array<{ filename: string }>;
};

export type PendingPartnerBrandProposal = {
  kind: "pending";
  prUrl: string;
  optedOut: boolean;
};

export const branchFor = (partnerId: string, slug: string): string => {
  const identity = `${partnerId}\0${slug}`;
  const digest = createHash("sha256")
    .update(identity)
    .digest("hex")
    .slice(0, 16);
  return `partner-brand-${digest}`;
};

export async function registryFile(token: string, ref: string): Promise<RegistryFile> {
  const file = await gh<RegistryFile>(
    token,
    `/repos/${OWNER}/${REPO}/contents/${REGISTRY_PATH}?ref=${encodeURIComponent(ref)}`,
  );
  return { ...file, content: Buffer.from(file.content, "base64").toString("utf8") };
}

export async function findOpenProposal(token: string, branch: string): Promise<PullRequest | undefined> {
  const head = encodeURIComponent(`${OWNER}:${branch}`);
  const proposals = await gh<PullRequest[]>(
    token,
    `/repos/${OWNER}/${REPO}/pulls?state=open&head=${head}`,
  );
  return proposals.find(
    (pr) =>
      pr.head.ref === branch &&
      (!pr.head.repo?.full_name || pr.head.repo.full_name === `${OWNER}/${REPO}`) &&
      (!pr.base?.ref || pr.base.ref === BASE),
  );
}

export async function findClosedProposal(token: string, branch: string): Promise<PullRequest | undefined> {
  const head = encodeURIComponent(`${OWNER}:${branch}`);
  const proposals = await gh<PullRequest[]>(
    token,
    `/repos/${OWNER}/${REPO}/pulls?state=closed&head=${head}`,
  );
  return proposals.find(
    (pr) =>
      pr.head.ref === branch &&
      (!pr.head.repo?.full_name || pr.head.repo.full_name === `${OWNER}/${REPO}`) &&
      (!pr.base?.ref || pr.base.ref === BASE),
  );
}

export async function createBranchIfMissing(
  token: string,
  branch: string,
  baseSha: string,
): Promise<boolean> {
  try {
    await gh(token, `/repos/${OWNER}/${REPO}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
    return false;
  } catch (error) {
    if (
      error instanceof ProvisioningApiError &&
      /Reference already exists/i.test(error.message)
    )
      return true;
    throw error;
  }
}

export async function findMatchingOpenProposal(
  token: string,
  branch: string,
  slug: string,
  brand: RenderableBrand | null,
  mismatchMessage: string,
): Promise<PendingPartnerBrandProposal | null> {
  const pending = await findOpenProposal(token, branch);
  if (!pending) return null;

  const pendingFile = await registryFile(token, branch);
  const pendingEdit = setRegistryPartnerBrand(pendingFile.content, slug, brand);
  if (pendingEdit.changed)
    throw new PartnerBrandProposalConflictError(
      mismatchMessage,
      pending.html_url,
    );

  return {
    kind: "pending",
    prUrl: pending.html_url,
    optedOut: pendingEdit.optedOut,
  };
}

export async function assertSafeOrphanBranch(
  token: string,
  branch: string,
  baseSha: string,
  slug: string,
): Promise<{ file: RegistryFile; atBase: boolean }> {
  const ref = await gh<{ object: { sha: string } }>(
    token,
    `/repos/${OWNER}/${REPO}/git/ref/heads/${branch}`,
  );
  if (ref.object.sha === baseSha) return { file: await registryFile(token, branch), atBase: true };

  // A prior interrupted attempt may have committed the one expected registry
  // edit but failed before opening its PR. Recover only that exact one-commit
  // branch, based on today's develop tip and touching no other file.
  const commit = await gh<BranchCommit>(token, `/repos/${OWNER}/${REPO}/commits/${ref.object.sha}`);
  const expectedMessage = `chore(registry): update partner brand for '${slug}'`;
  if (
    commit.parents.length !== 1 ||
    commit.parents[0]?.sha !== baseSha ||
    commit.commit.message !== expectedMessage ||
    commit.files.length !== 1 ||
    commit.files[0]?.filename !== REGISTRY_PATH
  ) {
    throw new PartnerBrandProposalConflictError(
      "A prior partner-brand branch is based on a different registry revision; refusing to reuse it.",
    );
  }
  return { file: await registryFile(token, branch), atBase: false };
}
