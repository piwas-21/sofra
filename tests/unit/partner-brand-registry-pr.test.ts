import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setRegistryPartnerBrand } from "@/lib/partner-brand-registry-edit";

const mocks = vi.hoisted(() => {
  class ApiError extends Error {}
  class NotConfigured extends Error {}
  return {
    gh: vi.fn<(token: string, path: string, init?: RequestInit) => Promise<unknown>>(),
    ApiError,
    NotConfigured,
  };
});

vi.mock("@/lib/provisioning", () => ({
  gh: mocks.gh,
  OWNER: "piwas-21",
  REPO: "restaurant-app-deploy",
  BASE: "develop",
  REGISTRY_PATH: "tenants/registry.yml",
  ProvisioningApiError: mocks.ApiError,
  ProvisioningNotConfiguredError: mocks.NotConfigured,
}));

const { openPartnerBrandRegistryPr, PartnerBrandProposalConflictError } = await import(
  "@/lib/partner-brand-registry-pr"
);

const registry = [
  "version: 1",
  "tenants:",
  "  cafe-demo:",
  "    status: active",
  "    managed: scripts",
  "    partner_attribution: true",
  "  bakery-demo:",
  "    status: active",
  "    managed: scripts",
  "    partner_attribution: true",
  "  optout-demo:",
  "    status: active",
  "    managed: scripts",
  '    partner_attribution: "false"',
  "    partner_name: Old Partner",
  "    partner_url: https://old.example",
  "" ]
  .join("\n");
const brand = { displayName: "Public Partner", websiteUrl: "https://partner.example" };
const baseSha = "a".repeat(40);

const branchFor = (partnerId: string, slug: string) =>
  `partner-brand-${createHash("sha256").update(`${partnerId}\0${slug}`).digest("hex").slice(0, 16)}`;
const encoded = (content: string) => Buffer.from(content, "utf8").toString("base64");
const file = (content: string, sha: string) => ({ content: encoded(content), sha });

type PullRequest = {
  html_url: string;
  head: { ref: string; repo: { full_name: string } };
  base: { ref: string };
};

type ApiOptions = {
  existingBranch?: boolean;
  branchSha?: string;
  branchYaml?: string;
  branchCommit?: { parents: Array<{ sha: string }>; commit: { message: string }; files: Array<{ filename: string }> };
  openPrs?: PullRequest[];
  closedPrs?: PullRequest[];
  failAfterCreatePr?: boolean;
};

function installApi(options: ApiOptions = {}) {
  let branch = "";
  const branchContents = new Map<string, { yaml: string; sha: string }>();
  const branches = new Map<string, string>();
  const openPrs = [...(options.openPrs ?? [])];
  const closedPrs = options.closedPrs ?? [];
  const createdRefs: string[] = [];
  const updatedBranches: string[] = [];
  const pullBodies: string[] = [];
  let pullNumber = 0;

  if (options.existingBranch && options.branchYaml) {
    branch = "";
    branchContents.set("pending", { yaml: options.branchYaml, sha: "branch-file-sha" });
  }

  mocks.gh.mockImplementation(async (_token, path, init) => {
    if (path.includes("/contents/tenants/registry.yml?ref=")) {
      const ref = new URLSearchParams(path.split("?")[1]).get("ref") ?? "";
      if (ref === "develop") return file(registry, "base-file-sha");
      const source = branchContents.get(ref) ?? branchContents.get("pending") ?? { yaml: registry, sha: `file-${ref}` };
      return file(source.yaml, source.sha);
    }
    if (path === "/repos/piwas-21/restaurant-app-deploy/git/ref/heads/develop") {
      return { object: { sha: baseSha } };
    }
    if (path.startsWith("/repos/piwas-21/restaurant-app-deploy/git/ref/heads/")) {
      return { object: { sha: options.branchSha ?? baseSha } };
    }
    if (path.startsWith("/repos/piwas-21/restaurant-app-deploy/commits/")) {
      return options.branchCommit ?? {
        parents: [{ sha: baseSha }],
        commit: { message: "chore(registry): update partner brand for 'cafe-demo'" },
        files: [{ filename: "tenants/registry.yml" }],
      };
    }
    if (path.endsWith("/git/refs") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { ref: string };
      branch = body.ref.replace(/^refs\/heads\//, "");
      createdRefs.push(branch);
      if (options.existingBranch || branches.has(branch)) {
        throw new mocks.ApiError("Reference already exists");
      }
      branches.set(branch, baseSha);
      branchContents.set(branch, { yaml: registry, sha: `file-${branch}` });
      return {};
    }
    if (path.includes("/pulls?state=open&head=")) return openPrs;
    if (path.includes("/pulls?state=closed&head=")) return closedPrs;
    if (path.endsWith("/contents/tenants/registry.yml") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { content: string; branch: string };
      branchContents.set(body.branch, {
        yaml: Buffer.from(body.content, "base64").toString("utf8"),
        sha: `updated-${body.branch}`,
      });
      updatedBranches.push(body.branch);
      return {};
    }
    if (path.endsWith("/pulls") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as { body: string; head: string };
      pullBodies.push(body.body);
      pullNumber += 1;
      const proposal: PullRequest = {
        html_url: `https://github.com/piwas-21/restaurant-app-deploy/pull/${pullNumber}`,
        head: { ref: body.head, repo: { full_name: "piwas-21/restaurant-app-deploy" } },
        base: { ref: "develop" },
      };
      openPrs.push(proposal);
      if (options.failAfterCreatePr) throw new mocks.ApiError("request timed out after creation");
      return proposal;
    }
    throw new Error(`Unexpected GitHub mock request: ${init?.method ?? "GET"} ${path}`);
  });

  return { createdRefs, updatedBranches, pullBodies, branchContents, branches, openPrs };
}

beforeEach(() => {
  vi.stubEnv("PROVISION_GITHUB_TOKEN", "test-token");
  mocks.gh.mockReset();
});

describe("openPartnerBrandRegistryPr", () => {
  it("returns unchanged without a branch when the saved projection is already absent", async () => {
    const api = installApi();

    await expect(openPartnerBrandRegistryPr("partner-1", "cafe-demo", null)).resolves.toEqual({
      kind: "unchanged",
      optedOut: false,
    });
    expect(api.createdRefs).toHaveLength(0);
    expect(api.updatedBranches).toHaveLength(0);
    expect(api.pullBodies).toHaveLength(0);
  });

  it("uses an isolated branch for each partner/site and opens each site's own proposal", async () => {
    const api = installApi();

    const [first, second] = await Promise.all([
      openPartnerBrandRegistryPr("partner-1", "cafe-demo", brand),
      openPartnerBrandRegistryPr("partner-1", "bakery-demo", brand),
    ]);

    expect(first.kind).toBe("opened");
    expect(second.kind).toBe("opened");
    expect(new Set([first.kind === "unchanged" ? "" : first.prUrl, second.kind === "unchanged" ? "" : second.prUrl]).size).toBe(2);
    expect(new Set(api.createdRefs).size).toBe(2);
    expect(new Set(api.createdRefs)).toEqual(new Set([
      branchFor("partner-1", "cafe-demo"),
      branchFor("partner-1", "bakery-demo"),
    ]));
    expect(api.updatedBranches).toEqual(api.createdRefs);
    expect(api.pullBodies.every((body) => body.includes("re-run the deploy repo's tenant provisioning workflow"))).toBe(true);
  });

  it("returns a matching open proposal as pending without making a duplicate", async () => {
    const branch = branchFor("partner-1", "cafe-demo");
    const current = setRegistryPartnerBrand(registry, "cafe-demo", brand).yaml;
    const api = installApi({
      existingBranch: true,
      branchSha: "branch-with-proposal",
      branchYaml: current,
      openPrs: [{
        html_url: "https://github.com/piwas-21/restaurant-app-deploy/pull/18",
        head: { ref: branch, repo: { full_name: "piwas-21/restaurant-app-deploy" } },
        base: { ref: "develop" },
      }],
    });

    await expect(openPartnerBrandRegistryPr("partner-1", "cafe-demo", brand)).resolves.toEqual({
      kind: "pending",
      prUrl: "https://github.com/piwas-21/restaurant-app-deploy/pull/18",
      optedOut: false,
    });
    expect(api.updatedBranches).toHaveLength(0);
    expect(api.pullBodies).toHaveLength(0);
  });

  it("refuses a same-site open proposal whose projection no longer matches saved details", async () => {
    const branch = branchFor("partner-1", "cafe-demo");
    const api = installApi({
      existingBranch: true,
      branchSha: "branch-with-proposal",
      branchYaml: setRegistryPartnerBrand(registry, "cafe-demo", {
        displayName: "Old Public Partner",
        websiteUrl: "https://old.example",
      }).yaml,
      openPrs: [{
        html_url: "https://github.com/piwas-21/restaurant-app-deploy/pull/19",
        head: { ref: branch, repo: { full_name: "piwas-21/restaurant-app-deploy" } },
        base: { ref: "develop" },
      }],
    });

    await expect(openPartnerBrandRegistryPr("partner-1", "cafe-demo", brand)).rejects.toMatchObject({
      name: "PartnerBrandProposalConflictError",
      prUrl: "https://github.com/piwas-21/restaurant-app-deploy/pull/19",
    });
    expect(api.updatedBranches).toHaveLength(0);
  });

  it("fails closed for a previously closed proposal branch", async () => {
    const branch = branchFor("partner-1", "cafe-demo");
    const api = installApi({
      existingBranch: true,
      closedPrs: [{
        html_url: "https://github.com/piwas-21/restaurant-app-deploy/pull/20",
        head: { ref: branch, repo: { full_name: "piwas-21/restaurant-app-deploy" } },
        base: { ref: "develop" },
      }],
    });

    await expect(openPartnerBrandRegistryPr("partner-1", "cafe-demo", brand)).rejects.toBeInstanceOf(
      PartnerBrandProposalConflictError,
    );
    expect(api.updatedBranches).toHaveLength(0);
    expect(api.pullBodies).toHaveLength(0);
  });

  it("fails closed for an orphan branch that is not a single current-base registry edit", async () => {
    const api = installApi({
      existingBranch: true,
      branchSha: "old-or-foreign-head",
      branchCommit: {
        parents: [{ sha: "b".repeat(40) }],
        commit: { message: "unrelated change" },
        files: [{ filename: "tenants/registry.yml" }, { filename: "other.yml" }],
      },
    });

    await expect(openPartnerBrandRegistryPr("partner-1", "cafe-demo", brand)).rejects.toBeInstanceOf(
      PartnerBrandProposalConflictError,
    );
    expect(api.updatedBranches).toHaveLength(0);
    expect(api.pullBodies).toHaveLength(0);
  });

  it("recovers an interrupted single-commit proposal without creating duplicate content", async () => {
    const branch = branchFor("partner-1", "cafe-demo");
    const desired = setRegistryPartnerBrand(registry, "cafe-demo", brand).yaml;
    const api = installApi({
      existingBranch: true,
      branchSha: "single-owned-commit",
      branchYaml: desired,
      branchCommit: {
        parents: [{ sha: baseSha }],
        commit: { message: "chore(registry): update partner brand for 'cafe-demo'" },
        files: [{ filename: "tenants/registry.yml" }],
      },
    });

    await expect(openPartnerBrandRegistryPr("partner-1", "cafe-demo", brand)).resolves.toMatchObject({
      kind: "opened",
      prUrl: expect.stringContaining("/1"),
    });
    expect(api.updatedBranches).toHaveLength(0);
    expect(api.createdRefs).toEqual([branch]);
  });

  it("returns a created PR as pending when GitHub's create response is lost", async () => {
    installApi({ failAfterCreatePr: true });

    await expect(openPartnerBrandRegistryPr("partner-1", "cafe-demo", brand)).resolves.toMatchObject({
      kind: "pending",
      prUrl: "https://github.com/piwas-21/restaurant-app-deploy/pull/1",
      optedOut: false,
    });
  });

  it("removes an existing public projection when the restaurant opted out", async () => {
    const api = installApi();

    const result = await openPartnerBrandRegistryPr("partner-1", "optout-demo", brand);
    const appliedYaml = api.branchContents.get(branchFor("partner-1", "optout-demo"))?.yaml ?? "";

    expect(result).toMatchObject({ kind: "opened", optedOut: true });
    expect(appliedYaml).not.toContain("partner_name:");
    expect(appliedYaml).not.toContain("partner_url:");
    expect(appliedYaml).toContain('partner_attribution: "false"');
  });
});
