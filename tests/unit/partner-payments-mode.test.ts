import { describe, expect, it, vi, beforeEach } from "vitest";

// The partner's payments-mode action, at its ONE risky seam: the authorization
// boundary (SOFRA-PAYMENTS-PRICING-MODE-PLAN S4).
//
// The DB, the GitHub call and the audit sink are mocked; the code under test is the
// real action, the real `ownClient` query it goes through, and the real shared core
// underneath it. The question these tests answer is not "does it save" — it is
// "what does it do with a client that is not this partner's", and the only honest
// answer is one measured on the SIDE EFFECTS: no registry PR proposed, no Prisma
// write, no audit row.
//
// `db.client.findFirst` is a fake that HONOURS its `where` clause rather than
// returning a canned row, which is what makes the ownership scope testable at all:
// drop `partnerId` from the query and the fake starts returning another partner's
// client, exactly as Postgres would.

const PARTNER = { id: "partner-1", email: "p@example.com", name: "P", role: "PARTNER" as const };

const CLIENTS = [
  { id: "c-mine", partnerId: "partner-1", tenantSlug: "zeta", restaurantName: "Mine" },
  { id: "c-theirs", partnerId: "partner-2", tenantSlug: "rival", restaurantName: "Theirs" },
  { id: "c-pipeline", partnerId: "partner-1", tenantSlug: null, restaurantName: "No tenant yet" },
];

const BILLING: Record<string, { id: string; tenantSlug: string; paymentsMode: string; paymentsCommissionBps: number }> = {
  zeta: { id: "bill-zeta", tenantSlug: "zeta", paymentsMode: "flat", paymentsCommissionBps: 0 },
  rival: { id: "bill-rival", tenantSlug: "rival", paymentsMode: "flat", paymentsCommissionBps: 0 },
};

const clientFindFirst = vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
  // Prisma semantics, reproduced: every PRESENT key narrows, an absent one does not.
  const hit = CLIENTS.find((c) =>
    Object.entries(where).every(([k, v]) => v === undefined || c[k as keyof typeof c] === v),
  );
  return hit ?? null;
});
const billingFindUnique = vi.fn(
  async ({ where }: { where: { tenantSlug: string } }) => BILLING[where.tenantSlug] ?? null,
);
const billingUpdate = vi.fn(async (args: { where: unknown; data: unknown }) => args);
const requirePartner = vi.fn(async () => PARTNER);
// The fake PR URL encodes what the editor was ASKED for, so an assertion on the
// audit row's `prUrl` also pins which tenant the proposal was actually about.
const prUrlFor = (slug: string, bps: number) =>
  `https://github.com/piwas-21/restaurant-app-deploy/pull/${slug}-${bps}`;
const openCommissionChangePr = vi.fn(async (slug: string, bps: number) => ({
  alreadySet: false,
  prUrl: prUrlFor(slug, bps),
}));

vi.mock("@/lib/db", () => ({
  db: {
    client: { findFirst: clientFindFirst },
    tenantBilling: { findUnique: billingFindUnique, update: billingUpdate },
  },
}));
vi.mock("@/lib/rbac", () => ({ requirePartner }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/registry-commission-pr", () => ({ openCommissionChangePr }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Not mocked: `provisioningConfigured()` only reads this env var, and the real
// `ProvisioningApiError` classes below have to be the ones the core catches.
process.env.PROVISION_GITHUB_TOKEN = "test-token";

const { updateClientPaymentsModeAction } = await import("@/lib/actions/partner-payments-actions");
const { audit } = await import("@/lib/audit");
const { ProvisioningApiError } = await import("@/lib/provisioning");

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
};
const submit = (fields: Record<string, string>) => updateClientPaymentsModeAction({}, form(fields));

/** Every side effect this action can have, in one assertion — the thing a refusal
 *  has to leave untouched. A refusal that still opened a PR would be a refusal on
 *  the screen and a change in the registry. */
const expectNothingHappened = () => {
  expect(openCommissionChangePr).not.toHaveBeenCalled();
  expect(billingUpdate).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
};

beforeEach(() => {
  clientFindFirst.mockClear();
  billingFindUnique.mockClear();
  billingUpdate.mockClear();
  openCommissionChangePr.mockClear();
  openCommissionChangePr.mockImplementation(async (slug: string, bps: number) => ({
    alreadySet: false,
    prUrl: prUrlFor(slug, bps),
  }));
  requirePartner.mockReset();
  requirePartner.mockResolvedValue(PARTNER);
  vi.mocked(audit).mockClear();
});

describe("partner payments-mode action — the authorization boundary", () => {
  it("refuses ANOTHER partner's client, and proposes nothing and writes nothing", async () => {
    const state = await submit({ clientId: "c-theirs", mode: "commission", commissionBps: "150" });

    expect(state).toEqual({ error: "clientNotFound" });
    expectNothingHappened();
    // The row exists and is a real, provisioned tenant — the refusal is about
    // OWNERSHIP, not about the client being unfindable.
    expect(CLIENTS.find((c) => c.id === "c-theirs")?.tenantSlug).toBe("rival");
  });

  it("scopes the lookup by partnerId — the query itself, not just its answer", async () => {
    await submit({ clientId: "c-theirs", mode: "commission", commissionBps: "150" });

    expect(clientFindFirst).toHaveBeenCalledWith({
      where: { id: "c-theirs", partnerId: PARTNER.id },
    });
  });

  it("answers a non-existent client the SAME way as another partner's", async () => {
    // The pair is the point: if the two answers differed, the form would be an
    // oracle for "is this client id one of yours".
    const theirs = await submit({ clientId: "c-theirs", mode: "flat", commissionBps: "0" });
    const nobody = await submit({ clientId: "no-such-client", mode: "flat", commissionBps: "0" });

    expect(nobody).toEqual(theirs);
    expectNothingHappened();
  });

  it("IGNORES a tenant slug the partner posts — the slug comes off the row", async () => {
    // The attack this action is shaped against: naming somebody else's tenant in a
    // field the server might read. The form has no such field; posting one anyway
    // must change nothing.
    const state = await submit({
      clientId: "c-mine",
      tenantSlug: "rival",
      mode: "commission",
      commissionBps: "150",
    });

    expect(state).toEqual({ ok: true });
    expect(openCommissionChangePr).toHaveBeenCalledWith("zeta", 150);
    expect(openCommissionChangePr).not.toHaveBeenCalledWith("rival", expect.anything());
    expect(billingUpdate).toHaveBeenCalledWith({
      where: { tenantSlug: "zeta" },
      data: { paymentsMode: "commission", paymentsCommissionBps: 150 },
    });
  });

  it("refuses a client that has no tenant yet", async () => {
    const state = await submit({ clientId: "c-pipeline", mode: "commission", commissionBps: "150" });

    expect(state).toEqual({ error: "clientNotProvisioned" });
    expectNothingHappened();
  });

  it("refuses a session that is not a partner, before any lookup", async () => {
    // What `redirect()` does inside a server action: it throws. Nothing after the
    // guard may run, so the client query must not even be reached.
    requirePartner.mockRejectedValue(new Error("NEXT_REDIRECT"));

    await expect(submit({ clientId: "c-mine", mode: "flat", commissionBps: "0" })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(clientFindFirst).not.toHaveBeenCalled();
    expectNothingHappened();
  });
});

describe("partner payments-mode action — the happy path", () => {
  it("proposes the PR, records the intent, and audits the PARTNER as the actor", async () => {
    const state = await submit({ clientId: "c-mine", mode: "commission", commissionBps: "150" });

    expect(state).toEqual({ ok: true });
    expect(openCommissionChangePr).toHaveBeenCalledWith("zeta", 150);
    expect(audit).toHaveBeenCalledWith(
      PARTNER.id,
      "tenant.paymentsMode.changed",
      "TenantBilling",
      "bill-zeta",
      expect.objectContaining({
        tenantSlug: "zeta",
        initiator: "partner",
        clientId: "c-mine",
        oldMode: "flat",
        newMode: "commission",
        newBps: 150,
        prUrl: prUrlFor("zeta", 150),
      }),
    );
  });

  it("does not hand the partner the deploy-repo PR URL", async () => {
    // It points into a PRIVATE repo they cannot open, and a 404 is worse news than
    // no link. The URL is not lost — the audit row above carries it.
    const state = await submit({ clientId: "c-mine", mode: "commission", commissionBps: "150" });

    expect(state.prUrl).toBeUndefined();
    expect(JSON.stringify(state)).not.toContain("github.com");
  });

  it("reports the no-PR case rather than inventing one", async () => {
    openCommissionChangePr.mockResolvedValue({ alreadySet: true, prUrl: "" });

    const state = await submit({ clientId: "c-mine", mode: "commission", commissionBps: "150" });

    expect(state).toEqual({ ok: true, alreadySet: true });
    expect(billingUpdate).toHaveBeenCalledTimes(1);
  });

  it("refuses a no-op instead of opening an empty PR", async () => {
    const state = await submit({ clientId: "c-mine", mode: "flat", commissionBps: "0" });

    expect(state).toEqual({ error: "paymentsModeUnchanged" });
    expectNothingHappened();
  });

  it("refuses a rate above the ceiling", async () => {
    const state = await submit({ clientId: "c-mine", mode: "commission", commissionBps: "5000" });

    expect(state.error).toBeTruthy();
    expectNothingHappened();
  });
});

describe("shared core — order of operations", () => {
  it("records NO intent when the proposal fails (PR first, Prisma second)", async () => {
    // The order the S2a comment exists for. Prisma-first would leave a billing row
    // claiming a mode nobody was ever asked to approve.
    openCommissionChangePr.mockRejectedValue(new ProvisioningApiError("GitHub said no"));

    const state = await submit({ clientId: "c-mine", mode: "commission", commissionBps: "150" });

    expect(state).toEqual({ error: "GitHub said no" });
    expect(billingUpdate).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
