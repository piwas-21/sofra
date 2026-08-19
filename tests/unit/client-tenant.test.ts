import { describe, expect, it } from "vitest";
import {
  clientRowSummary,
  clientTenantView,
  languageLabels,
  moduleLines,
  planLine,
} from "@/lib/client-tenant";
import type { RegistryResult, RegistryTenant } from "@/lib/tenant-registry";

const tenant = (over: Partial<RegistryTenant> = {}): RegistryTenant => ({
  slug: "obresse",
  name: "O'Bresse",
  status: "active",
  managed: "sofra",
  box: "prod",
  domain: "obresse.sofrapiwas.com",
  domain_mode: "subdomain",
  db: "obresse",
  languages: ["en", "fr"],
  modules: ["core", "reservations"],
  ...over,
});

const okRegistry = (tenants: RegistryTenant[] = [tenant()]): RegistryResult => ({
  ok: true,
  tenants,
});
const failedRegistry: RegistryResult = { ok: false, error: "TENANT_REGISTRY_PATH is not set." };

describe("clientTenantView", () => {
  it("shows nothing for a client still in the pipeline", () => {
    expect(clientTenantView({ status: "LEAD", tenantSlug: null, registry: okRegistry() })).toEqual({
      kind: "none",
    });
  });

  it("says a client is being set up once onboarding is requested and no slug exists", () => {
    expect(
      clientTenantView({ status: "ONBOARDING", tenantSlug: null, registry: okRegistry() }),
    ).toEqual({ kind: "awaiting" });
  });

  it("resolves a provisioned client to its registry entry", () => {
    const view = clientTenantView({
      status: "LIVE",
      tenantSlug: "obresse",
      registry: okRegistry(),
    });
    expect(view.kind).toBe("live");
    if (view.kind === "live") expect(view.tenant.domain).toBe("obresse.sofrapiwas.com");
  });

  it("distinguishes an unreadable registry from a slug with no entry", () => {
    // The two look identical from a caller that only passes a list, and they are
    // different news: one is our ops failure, the other is a tenant not created yet.
    expect(
      clientTenantView({ status: "LIVE", tenantSlug: "obresse", registry: failedRegistry }),
    ).toEqual({ kind: "unreadable", slug: "obresse" });
    expect(
      clientTenantView({ status: "LIVE", tenantSlug: "ghost", registry: okRegistry() }),
    ).toEqual({ kind: "unlisted", slug: "ghost" });
  });

  it("never leaks the registry error text to a partner", () => {
    const view = clientTenantView({
      status: "LIVE",
      tenantSlug: "obresse",
      registry: failedRegistry,
    });
    expect(JSON.stringify(view)).not.toContain("TENANT_REGISTRY_PATH");
  });
});

describe("moduleLines", () => {
  it("returns catalog order, not registry order, with what each unlocks", () => {
    const lines = moduleLines(["reservations", "core", "cashier"]);
    expect(lines.map((l) => l.id)).toEqual(["core", "cashier", "reservations"]);
    expect(lines.every((l) => l.known)).toBe(true);
    expect(lines[0].surface).toMatch(/QR menu/);
  });

  it("deduplicates and ignores blank ids", () => {
    expect(moduleLines(["core", "core", " ", ""]).map((l) => l.id)).toEqual(["core"]);
  });

  it("keeps an id the catalog does not know, flagged rather than hidden", () => {
    // The registry is the source of truth and hand-editable: dropping an id would
    // under-report what a partner's client actually has.
    const lines = moduleLines(["core", "time-machine"]);
    expect(lines.map((l) => l.id)).toEqual(["core", "time-machine"]);
    expect(lines[1]).toEqual({ id: "time-machine", known: false, surface: null });
  });

  it("is empty for an empty grant list", () => {
    expect(moduleLines([])).toEqual([]);
  });
});

describe("languageLabels", () => {
  it("labels known tenant languages in registry order", () => {
    expect(languageLabels(["fr", "en"])).toEqual(["Français", "English"]);
  });
  it("passes an unrecognised code through rather than dropping it", () => {
    expect(languageLabels(["en", "xx"])).toEqual(["English", "xx"]);
  });
});

describe("planLine", () => {
  const sub = (status: string) => ({ amountCents: 4500, interval: "1 month", status });

  it("returns null when no plan has been defined at all", () => {
    expect(planLine(null)).toBeNull();
    expect(planLine(undefined)).toBeNull();
  });

  it("reports a PENDING plan with no paid first payment as payable", () => {
    expect(planLine({ subscriptions: [sub("PENDING")], payments: [] })).toEqual({
      state: "pay",
      amountCents: 4500,
      interval: "1 month",
    });
  });

  it("reports the mandate window as 'processing' — never as payable", () => {
    // A pay button here is a second charge on a card that has already paid.
    const line = planLine({
      subscriptions: [sub("PENDING")],
      payments: [{ sequenceType: "first", status: "paid" }],
    });
    expect(line?.state).toBe("processing");
  });

  it("reports an active plan with its amount", () => {
    expect(planLine({ subscriptions: [sub("ACTIVE")], payments: [] })?.state).toBe("active");
  });

  it("survives a plan row with no subscription", () => {
    expect(planLine({ subscriptions: [], payments: [] })).toEqual({
      state: "none",
      amountCents: null,
      interval: null,
    });
  });
});

describe("clientRowSummary", () => {
  it("carries the domain and tenant status only for a resolved entry", () => {
    expect(
      clientRowSummary({
        status: "LIVE",
        tenantSlug: "obresse",
        registry: okRegistry(),
        billing: { subscriptions: [{ amountCents: 4500, interval: "1 month", status: "ACTIVE" }], payments: [] },
      }),
    ).toEqual({
      domain: "obresse.sofrapiwas.com",
      tenantStatus: "active",
      view: "live",
      slug: "obresse",
      plan: { state: "active", amountCents: 4500, interval: "1 month" },
    });
  });

  it("never guesses a domain from the slug when the registry cannot be read", () => {
    const summary = clientRowSummary({
      status: "LIVE",
      tenantSlug: "obresse",
      registry: failedRegistry,
      billing: null,
    });
    expect(summary.domain).toBeNull();
    expect(summary.tenantStatus).toBeNull();
    expect(summary.view).toBe("unreadable");
    expect(summary.plan).toBeNull();
  });

  it("agrees with the panel about a pipeline client", () => {
    const summary = clientRowSummary({
      status: "AGREED",
      tenantSlug: null,
      registry: okRegistry(),
      billing: null,
    });
    expect(summary.view).toBe("none");
    expect(clientTenantView({ status: "AGREED", tenantSlug: null, registry: okRegistry() }).kind)
      .toBe("none");
  });
});
