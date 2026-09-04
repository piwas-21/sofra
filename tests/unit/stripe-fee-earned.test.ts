import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { feeEarnedRow, feeEarnedUpsert } from "@/lib/stripe-fee-earned";
import type { StripeApplicationFee } from "@/lib/stripe-fee-refund";

// Shaped from a REAL `application_fee.created` payload read off the Stripe API
// in test mode 2026-09-04 (fee_1UC4vr…, the fee from the fee-refund runbook's
// own verified run), not from the documentation.
const fee = (over: Partial<StripeApplicationFee> = {}): StripeApplicationFee => ({
  id: "fee_1UC4vrFfnKu8VnLMj2MIShQy",
  account: "acct_1UC065FfnKu8VnLM",
  amount: 60,
  refunded: false,
  amount_refunded: 0,
  currency: "chf",
  charge: "ch_3UC4voFfnKu8VnLM1XoHvmdB",
  created: 1788558359,
  ...over,
});

describe("feeEarnedRow", () => {
  it("takes the connected account from the FEE, not from the charge or the event", () => {
    // The load-bearing field: it is the ONLY join key back to a tenant, and the
    // event that carries this fee has `account: null` (measured), so there is no
    // second source to fall back on. Asserted against the charge id explicitly
    // because "some acct_-shaped string" would pass a laxer check.
    const row = feeEarnedRow(fee());
    expect(row.connectedAccountId).toBe("acct_1UC065FfnKu8VnLM");
    expect(row.connectedAccountId).not.toBe(row.chargeId);
    expect(row.chargeId).toBe("ch_3UC4voFfnKu8VnLM1XoHvmdB");
  });

  it("reads Stripe's `created` as epoch SECONDS", () => {
    // The off-by-1000. Milliseconds would place this fee in January 1970, which
    // a month-scoped readout renders as an empty period — not as an error.
    expect(feeEarnedRow(fee()).feeCreatedAt.toISOString()).toBe("2026-09-04T21:45:59.000Z");
  });

  it("lower-cases the currency so one tenant's CHF cannot become two totals", () => {
    expect(feeEarnedRow(fee({ currency: "CHF" })).currency).toBe("chf");
  });

  it("records the fee as created and never its refunded amount", () => {
    // `amount` is immutable in Stripe; `amount_refunded` moves. Storing the
    // second would be a snapshot that silently goes stale.
    const row = feeEarnedRow(fee({ amount: 60, amount_refunded: 60, refunded: true }));
    expect(row.amount).toBe(60);
    expect(Object.keys(row)).not.toContain("amountRefunded");
  });
});

describe("feeEarnedUpsert — the idempotency anchor", () => {
  const write = () => feeEarnedUpsert(fee());

  it("keys the write on applicationFeeId and on nothing else", () => {
    // A redelivery must collide. If this key ever becomes the charge id, two
    // fees on one charge would overwrite each other; if it becomes anything
    // non-unique, a redelivery doubles recorded revenue. There is no arithmetic
    // on this path to neutralise either.
    const write = feeEarnedUpsert(fee());
    expect(write.where).toEqual({ applicationFeeId: "fee_1UC4vrFfnKu8VnLMj2MIShQy" });
  });

  it("says nothing on the redelivery branch, so a second delivery cannot restate the row", () => {
    expect(write().update).toEqual({});
    expect(Object.keys(write().update)).toHaveLength(0);
  });

  it("creates the same row feeEarnedRow computes", () => {
    expect(write().create).toEqual(feeEarnedRow(fee()));
  });
});

// The constraint itself lives in SQL and in schema.prisma, not in TypeScript, so
// no test over the pure functions above can see it — and the upsert is only
// idempotent BECAUSE the column is unique. These two read the declarations off
// disk (no DB, no network, in keeping with §7) so that deleting the anchor is a
// red test rather than a silent behaviour change. What they prove is that the
// declaration is present; that Postgres enforces it is proven on staging by
// replaying the event and asserting one row, exactly as #217 proved its own.
const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

describe("the StripeApplicationFee idempotency anchor is declared", () => {
  it("schema.prisma marks applicationFeeId @unique", () => {
    const model = /model StripeApplicationFee \{[\s\S]*?\n\}/.exec(read("prisma/schema.prisma"))?.[0];
    expect(model).toBeDefined();
    expect(model).toMatch(/applicationFeeId\s+String\s+@unique/);
  });

  it("the migration creates the unique index Prisma expects", () => {
    const sql = read("prisma/migrations/20260905000000_stripe_application_fee/migration.sql");
    // The index NAME matters: Prisma derives `<Table>_<col>_key`, and CI's drift
    // check compares the two. A differently-named index would enforce the same
    // rule and still fail the build.
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "StripeApplicationFee_applicationFeeId_key"\s*\n?\s*ON "StripeApplicationFee"\("applicationFeeId"\)/,
    );
  });
});
