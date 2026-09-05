import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  connectAccountUpsert,
  connectExpressIdempotencyKey,
  type ConnectAccountRow,
} from "@/lib/connect-account-store";

// The two decisions this slice is FOR: what the idempotency key is, and what the
// write is keyed on. Both are pure, so both are decidable here — which is the
// point of splitting them out of the module that calls Stripe.

describe("connectExpressIdempotencyKey", () => {
  it("is exactly `<slug>-connect-express-v1`", () => {
    // Pinned as a literal, not composed from the same constant the code uses: a
    // test that rebuilds the key the way the source does cannot notice the key
    // changing. MEASURED consequence of it changing (2026-09-05, test platform):
    // one altered character minted a SECOND live Stripe account.
    expect(connectExpressIdempotencyKey("rumi")).toBe("rumi-connect-express-v1");
  });

  it("depends on the slug and on nothing else, so a retry after a crash recomputes it", () => {
    // No clock, no random, no payload. This is the whole recovery mechanism: a
    // later process, in a later container, must arrive at the same string.
    expect(connectExpressIdempotencyKey("obresse")).toBe(connectExpressIdempotencyKey("obresse"));
    expect(connectExpressIdempotencyKey("obresse")).not.toBe(connectExpressIdempotencyKey("obress"));
  });

  it("refuses a slug that is not registry-shaped", () => {
    // A blank slug yields `-connect-express-v1`, a perfectly valid key that every
    // blank-slug caller would share — i.e. one Stripe account handed to whichever
    // tenant asked second. Each of these is a different way to arrive there.
    for (const bad of ["", " ", "a", "RUMI", "rumi restaurant", "-rumi", "../rumi", "rumi/../x"]) {
      expect(() => connectExpressIdempotencyKey(bad)).toThrow(/non-registry slug/);
    }
  });

  it("accepts what the registry actually contains", () => {
    // The positive control for the refusal above: a rule that refuses everything
    // would pass every assertion in the previous test.
    for (const ok of ["rumi", "obresse", "cafe-du-nord", "a1", "x".repeat(31)]) {
      expect(connectExpressIdempotencyKey(ok)).toBe(`${ok}-connect-express-v1`);
    }
    expect(() => connectExpressIdempotencyKey("x".repeat(32))).toThrow();
  });
});

describe("connectAccountUpsert — the anchor", () => {
  const row = (over: Partial<ConnectAccountRow> = {}): ConnectAccountRow => ({
    tenantSlug: "rumi",
    stripeAccountId: "acct_1UCOkhCSPiP2JWOQ",
    idempotencyKey: "rumi-connect-express-v1",
    country: "CH",
    ...over,
  });

  it("keys the write on stripeAccountId and on nothing else", () => {
    // A replay of the mint returns the SAME account, so the write must collide
    // on the account id. Keyed on the slug instead, a second account minted by
    // mistake would silently REPOINT the tenant and abandon the first one — the
    // worst outcome available here, because the abandoned account is live.
    expect(connectAccountUpsert(row()).where).toEqual({ stripeAccountId: "acct_1UCOkhCSPiP2JWOQ" });
  });

  it("says nothing on the replay branch", () => {
    expect(connectAccountUpsert(row()).update).toEqual({});
    expect(Object.keys(connectAccountUpsert(row()).update)).toHaveLength(0);
  });

  it("creates the row it was handed, unaltered", () => {
    expect(connectAccountUpsert(row()).create).toEqual(row());
  });
});

// The constraints live in SQL and in schema.prisma, not in TypeScript, so no test
// over the pure functions above can see them — and the upsert is only idempotent
// BECAUSE the columns are unique. These read the declarations off disk (no DB, no
// network, in keeping with CLAUDE.md §7) so that deleting an anchor is a red test
// rather than a silent behaviour change, exactly as the StripeApplicationFee
// tests do for theirs.
const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

describe("the StripeConnectAccount guards are declared", () => {
  const model = () =>
    /model StripeConnectAccount \{[\s\S]*?\n\}/.exec(read("prisma/schema.prisma"))?.[0];

  it("schema.prisma makes tenantSlug unique — the guard that outlives the idempotency key", () => {
    // Stripe expires an idempotency key after ~24h. After that, this constraint
    // is the only thing standing between a replay and a second live account.
    expect(model()).toBeDefined();
    expect(model()).toMatch(/tenantSlug\s+String\s+@unique/);
  });

  it("schema.prisma makes stripeAccountId and idempotencyKey unique too", () => {
    expect(model()).toMatch(/stripeAccountId\s+String\s+@unique/);
    expect(model()).toMatch(/idempotencyKey\s+String\s+@unique/);
  });

  it("the migration creates the three unique indexes Prisma expects", () => {
    // The index NAMES matter: Prisma derives `<Table>_<col>_key` and CI's drift
    // check compares the two, so a differently-named index enforces the same rule
    // and still fails the build.
    const sql = read("prisma/migrations/20260905190000_stripe_connect_account/migration.sql");
    for (const col of ["tenantSlug", "stripeAccountId", "idempotencyKey"]) {
      expect(sql).toMatch(
        new RegExp(
          `CREATE UNIQUE INDEX "StripeConnectAccount_${col}_key"\\s*\\n?\\s*ON "StripeConnectAccount"\\("${col}"\\)`,
        ),
      );
    }
  });
});
