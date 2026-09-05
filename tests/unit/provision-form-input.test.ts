import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { readProvisionForm } from "@/lib/provision-form-input";
import { buildTenantRegistryEntry } from "@/lib/provisioning-registry";
import { provisionSchema } from "@/lib/validation-provision";

// The FormData → registry-entry path for /admin/provision.
//
// THIS FILE IS A REGRESSION TEST BEFORE IT IS ANYTHING ELSE. `openProvisioningPrAction`
// built its parse object field by field and never read `stripeAccount`: the input was on
// the form, the key was in the schema, and `splitDeferredModules` consumed it downstream
// — so it looked wired from every direction except the one that mattered, and
// `input.stripeAccount` was permanently `undefined`. The founder path therefore DEFERRED
// `online-payments` to a second registry PR even when the founder had already created the
// connected account and typed it in, which is the exact promise SOFRA-PAYMENTS-PLAN §9 P1
// and runbook §2b were built to make.
//
// Every unit test for `buildTenantRegistryEntry` was green throughout, because they hand
// the builder an input object directly. Only a test that starts from a FormData and ends
// at the emitted YAML can see this class of bug — which is why these assert the whole
// round trip rather than the mapping alone.

const form = (fields: Record<string, string | string[]>): FormData => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const one of Array.isArray(v) ? v : [v]) fd.append(k, one);
  }
  return fd;
};

const base = {
  slug: "bistro-nova",
  name: "Bistro Nova",
  adminEmail: "Owner@Nova.example",
  template: "craft",
  currency: "EUR",
  languages: ["en", "nl"],
  modules: ["core"],
};

/** The FormData → entry round trip, parsed back out of the YAML it emits. */
const entryFrom = (fields: Record<string, string | string[]>) => {
  const read = readProvisionForm(form(fields));
  if (!read.ok) throw new Error(`expected a usable input, got ${read.error}`);
  const built = buildTenantRegistryEntry(read.input);
  const tenant = (
    parse(`version: 1\ntenants:\n${built.entry}`) as { tenants: Record<string, Record<string, unknown>> }
  ).tenants[read.input.slug];
  return { tenant, deferred: built.deferred, input: read.input };
};

describe("the Stripe account is SERVER-DERIVED, and the form cannot supply one", () => {
  // The provenance flip (ADR-011 amendment, E3). The account is minted by
  // `openProvisioningPr` and attached to the input it builds the entry from; the
  // browser has no say. The original regression this file was written for — a posted
  // field silently never read — is therefore now the REQUIRED behaviour for this one
  // field, and it is asserted as such rather than deleted.
  it("ignores a posted acct_ instead of forwarding it to the entry", () => {
    const { tenant, deferred, input } = entryFrom({
      ...base,
      modules: ["core", "online-payments"],
      stripeAccount: "acct_1AbCdEfGhIjKlMnO",
    });
    expect(input.stripeAccount).toBeUndefined();
    expect("stripe_account" in tenant).toBe(false);
    // And the pairing rule still holds the module back rather than emitting an entry
    // `provision-tenant.sh` would refuse before the database.
    expect(deferred).toEqual(["online-payments"]);
  });

  it("carries BOTH halves in one entry once the mint has attached an account", () => {
    // What the action actually does: map the form, then hand the builder the input plus
    // the minted id. This is the shape that makes `provision-tenant.sh:117` never fire.
    const read = readProvisionForm(form({ ...base, modules: ["core", "online-payments"] }));
    if (!read.ok) throw new Error(read.error);
    const built = buildTenantRegistryEntry({ ...read.input, stripeAccount: "acct_1UCOkhCSPiP2JWOQ" });
    const tenant = (
      parse(`version: 1\ntenants:\n${built.entry}`) as { tenants: Record<string, Record<string, unknown>> }
    ).tenants[read.input.slug];
    expect(tenant.stripe_account).toBe("acct_1UCOkhCSPiP2JWOQ");
    expect(tenant.modules).toEqual(["core", "online-payments"]);
    expect(built.deferred).toEqual([]);
  });

  it("still defers when no account could be minted — the last-resort path", () => {
    const { tenant, deferred } = entryFrom({ ...base, modules: ["core", "online-payments"] });
    expect(deferred).toEqual(["online-payments"]);
    expect(tenant.modules).toEqual(["core"]);
    expect("stripe_account" in tenant).toBe(false);
  });
});

describe("readProvisionForm — the rest of the mapping", () => {
  it("splits the checkbox groups rather than taking the first box", () => {
    const { input } = entryFrom(base);
    expect(input.languages).toEqual(["en", "nl"]);
    expect(input.modules).toEqual(["core"]);
  });

  it("lower-cases the admin email the founder will actually see submitted", () => {
    expect(entryFrom(base).input.adminEmail).toBe("owner@nova.example");
  });

  it("emits no base_domain when the picker is left on the default", () => {
    const { tenant } = entryFrom({ ...base, baseDomain: "" });
    expect(tenant.domain).toBe("bistro-nova.sofrapiwas.com");
    expect("base_domain" in tenant).toBe(false);
  });

  it("normalizes a base domain before it can be concatenated with a slug", () => {
    // The schema only ASKS whether the value is usable; the string it validated is not
    // the string it was handed, and the registry has to carry the canonical form.
    const { tenant } = entryFrom({ ...base, baseDomain: " HTTPS://SolutionEva.com/ " });
    expect(tenant.base_domain).toBe("solutioneva.com");
    expect(tenant.domain).toBe("bistro-nova.solutioneva.com");
  });

  it("refuses a module list that is only separators", () => {
    // Passes the schema's `.min(1)` and collapses to nothing afterwards — the one case
    // the length check in this module exists for.
    const read = readProvisionForm(form({ ...base, modules: ",,," }));
    expect(read).toEqual({ ok: false, error: "invalidInput" });
  });

  it("tolerates an optional field the form did not send at all", () => {
    // A browser holding the PREVIOUS bundle posts without the newest field, and a no-JS
    // submit posts exactly what its HTML carried. `formData.get()` answers `null` there,
    // and `z.string().optional()` accepts `undefined`, not `null` — so without the
    // coercion in `optionalField` adding `baseDomain` would have made every such POST
    // fail the WHOLE form with "Invalid input", naming nothing.
    const fd = form(base); // no city, no baseDomain
    const read = readProvisionForm(fd);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.input.baseDomain).toBeUndefined();
      expect(read.input.city).toBeUndefined();
    }
  });

  it("READS EVERY FIELD THE SCHEMA VALIDATES — by name, not field by field", () => {
    // The invariant that was missing, and the reason `stripeAccount` could be dropped
    // with a green suite: nothing crossed the form→schema seam. Asserted over
    // `provisionSchema.shape` so that ADDING a field to the schema and forgetting to
    // read it here fails BY NAME, rather than waiting for someone to notice a feature
    // quietly not working.
    const fd = form(base);
    const seen = new Set<string>();
    const realGet = fd.get.bind(fd);
    const realGetAll = fd.getAll.bind(fd);
    Object.defineProperty(fd, "get", {
      value: (n: string) => {
        seen.add(n);
        return realGet(n);
      },
    });
    Object.defineProperty(fd, "getAll", {
      value: (n: string) => {
        seen.add(n);
        return realGetAll(n);
      },
    });
    readProvisionForm(fd);

    const keys = Object.keys(provisionSchema.shape);
    // Vacuity guard: an empty (or shape-less) key list would make the loop below pass by
    // iterating nothing, which is the same false green this test exists to end.
    expect(keys.length).toBeGreaterThan(5);
    expect(keys).toContain("baseDomain");
    for (const key of keys) {
      expect(seen, `provisionSchema validates "${key}" but the form is never asked for it`).toContain(
        key,
      );
    }
  });

  it("passes the schema's own message through when a field is malformed", () => {
    const read = readProvisionForm(form({ ...base, slug: "Not A Slug" }));
    expect(read.ok).toBe(false);
  });

  it("drops a non-string checkbox entry from a crafted multipart POST", () => {
    // `getAll` can yield a File; stringifying one gives "[object Object]", which would
    // sail into the registry as a module id nobody granted.
    const fd = form(base);
    fd.append("modules", new File(["x"], "x.txt"));
    const read = readProvisionForm(fd);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.input.modules).toEqual(["core"]);
  });
});
