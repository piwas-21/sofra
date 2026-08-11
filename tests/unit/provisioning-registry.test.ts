import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildProvisioningPrBody } from "@/lib/provisioning-pr-body";
import { buildTenantRegistryEntry, splitDeferredModules } from "@/lib/provisioning-registry";

// Parse a generated block back through the registry shape it will live in. Takes the
// builder's whole result, not just the block, so every assertion below reads the YAML
// that was actually emitted rather than a hand-copied string.
const asTenant = (built: { entry: string }, slug: string) =>
  (parse(`version: 1\ntenants:\n${built.entry}`) as { tenants: Record<string, unknown> }).tenants[
    slug
  ];

describe("buildTenantRegistryEntry", () => {
  it("derives slug-based fields and defaults status/managed/box", () => {
    const block = buildTenantRegistryEntry({
      slug: "bistro-nova",
      name: "Bistro Nova",
      adminEmail: "owner@nova.example",
      template: "craft",
      currency: "EUR",
      languages: ["en", "nl"],
      modules: ["core"],
      city: "Rotterdam",
    });
    expect(asTenant(block, "bistro-nova")).toEqual({
      name: "Bistro Nova",
      status: "provisioning",
      managed: "scripts",
      box: "staging",
      domain: "bistro-nova.sofrapiwas.com",
      domain_mode: "subdomain",
      db: "tenant_bistro-nova",
      db_role: "tenant_bistro-nova",
      compose_project: "tenant-bistro-nova",
      backend_tag: "latest",
      frontend_tag: "tenant-bistro-nova",
      currency: "EUR",
      languages: ["en", "nl"],
      modules: ["core"],
      template: "craft",
      admin_email: "owner@nova.example",
      city: "Rotterdam",
    });
  });

  it("omits city when not provided and honours an explicit box", () => {
    const t = asTenant(
      buildTenantRegistryEntry({
        slug: "nocity",
        name: "No City",
        adminEmail: "a@b.co",
        template: "classic",
        currency: "CHF",
        languages: ["en"],
        modules: ["core"],
        box: "prod",
      }),
      "nocity",
    ) as Record<string, unknown>;
    expect(t.city).toBeUndefined();
    expect(t.box).toBe("prod");
    expect(t.template).toBe("classic");
    expect(t.backend_tag).toBe("latest");
  });

  it("pins :latest even on the staging box — the box no longer decides the tag", () => {
    // The regression this exists for: `backend_tag` was derived from `box`, and every
    // self-serve tenant lands on `box: staging` because that is where the control plane
    // runs. So a paying customer was handed the develop build — and develop's EF
    // migrations, on every backend develop merge — by a default nobody read. This is the
    // ONLY test that distinguishes the two derivations, since the box is the input the
    // old rule keyed on and `staging` is its default value.
    const t = asTenant(
      buildTenantRegistryEntry({
        slug: "onstaging",
        name: "On Staging",
        adminEmail: "a@b.co",
        template: "craft",
        currency: "EUR",
        languages: ["en"],
        modules: ["core"],
      }),
      "onstaging",
    ) as Record<string, unknown>;
    expect(t.box).toBe("staging"); // the default box is unchanged...
    expect(t.backend_tag).toBe("latest"); // ...but it no longer implies the develop build
  });

  it("escapes YAML-special characters in free-text (no injection)", () => {
    // A name with a colon + a would-be injected key must round-trip as a plain
    // string value, never as new YAML structure.
    const name = "Nova: Café\nmanaged: legacy";
    const t = asTenant(
      buildTenantRegistryEntry({
        slug: "evil",
        name,
        adminEmail: "a@b.co",
        template: "craft",
        currency: "EUR",
        languages: ["en"],
        modules: ["core"],
      }),
      "evil",
    ) as Record<string, unknown>;
    expect(t.name).toBe(name);
    expect(t.managed).toBe("scripts"); // the injected "managed: legacy" did NOT take effect
  });
});

describe("buildProvisioningPrBody", () => {
  const input = {
    slug: "bistro-nova",
    name: "Bistro Nova",
    adminEmail: "owner@nova.example",
    template: "craft" as const,
    currency: "EUR",
    languages: ["en", "nl"],
    modules: ["core", "reservations"],
    city: "Rotterdam",
  };

  it("tells a STAGING entry that merging provisions it", () => {
    const body = buildProvisioningPrBody(input);
    expect(body).toContain("Merging this PR provisions the tenant");
    // The slug is the one field that cannot be renegotiated afterwards, so the
    // checklist has to name the actual value rather than talk about slugs.
    expect(body).toContain("`bistro-nova` is what the customer should live on forever");
    expect(body).toContain("### If the chain fails");
  });

  it("tells a PROD entry the opposite, because the chain is staging-only", () => {
    // The chain follows sync-registry-to-staging and skips any other box. A prod body
    // promising hands-off provisioning would leave the founder waiting on nothing.
    const body = buildProvisioningPrBody({ ...input, box: "prod" });
    expect(body).toContain("does **not** provision");
    expect(body).not.toContain("Merging this PR provisions the tenant");
    expect(body).not.toContain("hands-off");
    // ...and the commands stop being a fallback.
    expect(body).toContain("### Run these after merging");
  });

  it("names backend_tag as an editable field, not a box-dependent warning", () => {
    // The checkbox has to name the risk THIS entry carries and a field the reader can
    // actually see in Files changed, or it is an unfalsifiable box they learn to tick
    // blind. Since the tag is now a constant, the line is the same on both boxes.
    for (const body of [buildProvisioningPrBody(input), buildProvisioningPrBody({ ...input, box: "prod" })]) {
      expect(body).toContain("**`backend_tag: latest`**");
      expect(body).toContain("change it to `staging` in Files changed");
      // The old, now-impossible warning must not survive anywhere in the body.
      expect(body).not.toContain("rides the *develop* build");
    }
  });

  it("agrees with the entry the same PR proposes", () => {
    // The body and the entry are two independent literals; asserting each separately
    // would let one drift. Read the tag out of the generated YAML and require the body
    // to quote that exact value.
    const tag = (
      asTenant(buildTenantRegistryEntry(input), input.slug) as Record<string, unknown>
    ).backend_tag;
    expect(buildProvisioningPrBody(input)).toContain(`**\`backend_tag: ${tag}\`**`);
  });

  it("keeps a newline in the tenant name from breaking the fence or the command", () => {
    // provisionSchema refuses control characters, but this body is a pure function that
    // embeds `name` inside a ``` fence AND a shell command. An interior newline would
    // close the fence early, render the rest as prose, and hand the founder a command
    // with an unterminated quote.
    const body = buildProvisioningPrBody({ ...input, name: "Bistro\n```\n## PWNED" });
    const lines = body.split("\n");
    // Markdown only closes a fence at the START of a line, so counting every ``` in the
    // document would fail on a harmless mid-line one. The invariant that matters is that
    // the fence delimiters are exactly the two we wrote.
    expect(lines.filter((l) => l.trimStart().startsWith("```"))).toEqual(["```bash", "```"]);
    // ...and the whole command stays on one line, so it is still copy-pasteable.
    expect(lines.filter((l) => l.includes("-f restaurant_name="))).toEqual([
      "  -f restaurant_name='Bistro ``` ## PWNED' \\",
    ]);
  });

  it("shell-quotes the tenant name so an apostrophe cannot break the command", () => {
    const body = buildProvisioningPrBody({ ...input, name: "Chez L'Ami; rm -rf /" });
    expect(body).toContain(`-f restaurant_name='Chez L'\\''Ami; rm -rf /'`);
    // No bare, unquoted occurrence that a shell would split or execute.
    expect(body).not.toContain("-f restaurant_name=Chez");
  });
});

// P1 — a purchased `online-payments` must never reach the proposed entry.
//
// The failure this prevents is not "the tenant provisions without card payment". The
// guard below runs BEFORE the database, the compose project and the image, and exits 1,
// so the tenant would get no restaurant at all while a paid customer waits.
describe("deferring online-payments out of the generated entry", () => {
  const base = {
    slug: "bistro-nova",
    name: "Bistro Nova",
    adminEmail: "owner@nova.example",
    template: "craft" as const,
    currency: "EUR",
    languages: ["en", "nl"],
    city: "Rotterdam",
  };
  const bought = ["core", "reservations", "online-payments"];

  /**
   * The refusal from `provision-tenant.sh` (deploy repo, the `online-payments` guard),
   * verbatim, evaluated by a real bash. Copied text rather than an import because that
   * script lives in another repo and is not on disk in this one — so the test pins the
   * generator against the guard's OWN condition instead of against a paraphrase of it.
   * If the guard is ever reworded, this string is what has to be re-copied.
   */
  const provisionRefuses = (modulesCsv: string, stripeAccount: string): boolean => {
    const script = `
      REG_MODULES=$1
      REG_STRIPE_ACCOUNT=$2
      if [[ " \${REG_MODULES//,/ } " == *" online-payments "* && -z "$REG_STRIPE_ACCOUNT" ]]; then
        exit 0
      fi
      exit 1
    `;
    const res = spawnSync("bash", ["-c", script, "bash", modulesCsv, stripeAccount]);
    if (res.error) throw res.error;
    // 0 = the guard fired (refused), 1 = it did not. Anything else means the harness
    // itself broke, and a broken harness must not read as "the guard stayed silent".
    if (res.status !== 0 && res.status !== 1) {
      throw new Error(`guard harness failed: status=${res.status} ${res.stderr}`);
    }
    return res.status === 0;
  };

  // Fields exactly as provision-tenant.sh would read them out of the merged registry.
  const asRegistryFields = (t: Record<string, unknown>) => ({
    modulesCsv: (t.modules as string[]).join(","),
    stripeAccount: (t.stripe_account as string | undefined) ?? "",
  });

  it("emits an entry the guard ACCEPTS, where the pre-P1 entry was refused", () => {
    const t = asTenant(
      buildTenantRegistryEntry({ ...base, modules: bought }),
      base.slug,
    ) as Record<string, unknown>;
    const { modulesCsv, stripeAccount } = asRegistryFields(t);

    // The generator has never emitted stripe_account, so the guard's second conjunct is
    // satisfied either way — which is precisely why the module list is the whole story.
    expect(stripeAccount).toBe("");

    // Two inputs, two answers, from the guard's own text.
    expect(provisionRefuses(modulesCsv, stripeAccount)).toBe(false);
    // Pre-P1 the entry carried `modules: input.modules` verbatim. Same guard, same
    // account, same tenant — refused.
    expect(provisionRefuses(bought.join(","), stripeAccount)).toBe(true);
  });

  it("grants the module in ONE shot when the account is already known", () => {
    // The founder path. `signup-to-live-tenant.md` §2b has them create the connected
    // account BEFORE proposing, precisely because of the guard above — so deferring
    // unconditionally would make that documented order pointless and route them into a
    // second PR they do not need.
    const { entry, deferred } = buildTenantRegistryEntry({
      ...base,
      modules: bought,
      stripeAccount: "acct_1AbCdEfGhIjKlMnO",
    });
    const t = asTenant({ entry }, base.slug) as Record<string, unknown>;
    expect(t.modules).toEqual(bought);
    expect(t.stripe_account).toBe("acct_1AbCdEfGhIjKlMnO");
    expect(deferred).toEqual([]);

    // Both halves present, so the same guard that refuses the pre-P1 entry accepts this.
    const { modulesCsv, stripeAccount } = asRegistryFields(t);
    expect(provisionRefuses(modulesCsv, stripeAccount)).toBe(false);

    // ...and the body must not then warn about a deferral that did not happen.
    const body = buildProvisioningPrBody({
      ...base,
      modules: bought,
      stripeAccount: "acct_1AbCdEfGhIjKlMnO",
    });
    expect(body).not.toContain("Bought but deliberately NOT in this entry");
  });

  it("treats a whitespace-only account as no account", () => {
    // `provision-tenant.sh` tests `-z "$REG_STRIPE_ACCOUNT"`, which a single space does
    // NOT satisfy — so emitting " " would sail past this generator and then hand the box
    // an entry whose Stripe env points at nothing. Deferring is the safe reading.
    const { entry, deferred } = buildTenantRegistryEntry({
      ...base,
      modules: bought,
      stripeAccount: "   ",
    });
    const t = asTenant({ entry }, base.slug) as Record<string, unknown>;
    expect(deferred).toEqual(["online-payments"]);
    expect(t.stripe_account).toBeUndefined();
    expect(t.modules).toEqual(["core", "reservations"]);
  });

  it("never emits one half of the guard's condition", () => {
    // The property that actually matters, over both shapes: an entry carries the module
    // if and only if it carries an account. Anything else is the landmine, in one
    // direction or the other.
    for (const stripeAccount of [undefined, "", "  ", "acct_1AbCdEfGhIjKlMnO"]) {
      const t = asTenant(
        buildTenantRegistryEntry({ ...base, modules: bought, stripeAccount }),
        base.slug,
      ) as Record<string, unknown>;
      const { modulesCsv, stripeAccount: emitted } = asRegistryFields(t);
      expect(provisionRefuses(modulesCsv, emitted)).toBe(false);
    }
  });

  it("keeps every other purchased module, in order", () => {
    const { entry, deferred } = buildTenantRegistryEntry({ ...base, modules: bought });
    const t = asTenant({ entry }, base.slug) as Record<string, unknown>;
    expect(t.modules).toEqual(["core", "reservations"]);
    expect(deferred).toEqual(["online-payments"]);
  });

  it("changes nothing for a tenant that did not buy it", () => {
    // The strip must be surgical: a generator that quietly dropped ids would be the same
    // class of bug pointed the other way.
    const { entry, deferred } = buildTenantRegistryEntry({
      ...base,
      modules: ["core", "reservations", "loyalty", "printing"],
    });
    const t = asTenant({ entry }, base.slug) as Record<string, unknown>;
    expect(t.modules).toEqual(["core", "reservations", "loyalty", "printing"]);
    expect(deferred).toEqual([]);
    expect(splitDeferredModules(["core"]).granted).toEqual(["core"]);
  });

  it("makes the PR body name the purchase, the reason and the exact follow-up", () => {
    const body = buildProvisioningPrBody({ ...base, modules: bought });

    // Named as bought, not silently absent.
    expect(body).toContain("Bought but deliberately NOT in this entry: `online-payments`");
    expect(body).toContain("no restaurant at all");
    // The reason the founder cannot just add it now.
    expect(body).toContain("only the restaurant can create it");
    // The follow-up, with BOTH halves — an entry adding one without the other is the
    // same landmine re-armed by hand.
    expect(body).toContain("stripe_account: acct_");
    expect(body).toContain("modules: [core, reservations, online-payments]");
    expect(body).toContain("gh workflow run provision-tenant.yml");

    // And the checklist must not still ask the founder to confirm the list matches the
    // receipt — with a deferral that is false by construction.
    expect(body).not.toContain(
      "`core, reservations` match what they actually paid for",
    );
    expect(body).toContain("EXCEPT `online-payments`, which is held back on purpose");
  });

  it("says none of it when nothing was deferred", () => {
    // A standing warning about a module nobody bought trains the founder to skim past
    // the one that matters.
    const body = buildProvisioningPrBody({ ...base, modules: ["core", "reservations"] });
    expect(body).not.toContain("Bought but deliberately NOT in this entry");
    expect(body).not.toContain("stripe_account");
    expect(body).toContain("`core, reservations` match what they actually paid for");
  });

  it("keeps the markdown fences balanced once the block is present", () => {
    // The deferral block adds a SECOND fenced snippet to a body that already embeds the
    // tenant name in a shell fence. The existing fence test runs on a no-deferral input,
    // so without this one the four-fence layout is never exercised at all.
    const body = buildProvisioningPrBody({
      ...base,
      modules: bought,
      name: "Bistro\n```\n## PWNED",
    });
    expect(
      body.split("\n").filter((l) => l.trimStart().startsWith("```")),
    ).toEqual(["```yaml", "```", "```bash", "```"]);
  });

  it("describes the same module list the entry actually carries", () => {
    // The body and the entry are built by separate functions. Read the modules out of
    // the generated YAML and require the body's summary line to quote that exact list,
    // so the two cannot drift into describing different diffs.
    const input = { ...base, modules: bought };
    const t = asTenant(buildTenantRegistryEntry(input), base.slug) as Record<string, unknown>;
    expect(buildProvisioningPrBody(input)).toContain(
      `**modules** \`${(t.modules as string[]).join(", ")}\``,
    );
  });
});
