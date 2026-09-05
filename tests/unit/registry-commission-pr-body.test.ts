import { describe, expect, it } from "vitest";
import { commissionChangePrBody } from "@/lib/registry-commission-pr-body";
import {
  COMMISSION_FLOOR_CENTS,
  COMMISSION_MODE_SAVING_CENTS,
  DEFAULT_COMMISSION_BPS,
  ONLINE_PAYMENTS_PRICE_CENTS,
} from "@/lib/payments-pricing";

// The founder reads this body immediately before merging a live per-transaction
// rate into the deploy registry. It is prose, so nothing else can check it: the
// module that used to hold it needs a GitHub token and the network, which is why
// its crossover sentence stated the OPPOSITE of the truth from the day it was
// written until 2026-09-05.
describe("commissionChangePrBody", () => {
  const body = commissionChangePrBody("rumi", 0, DEFAULT_COMMISSION_BPS);

  it("names the tenant and both ends of the rate change", () => {
    expect(body).toContain("`rumi`");
    expect(body).toContain("`0` bps → `150` bps");
  });

  // THE DIRECTION. Below the crossover the turnover is small, so `commission`
  // (the €9 floor plus a small cut) costs LESS than the €19 flat module — the
  // reading that was inverted here, and that the same sentence in messages/*.json
  // has always stated correctly. Asserted as a sentence rather than a keyword
  // because the failure mode is a true-looking sentence pointing the wrong way.
  it("says commission is the CHEAPER mode below the crossover, not the dearer one", () => {
    expect(body).toContain("below that figure `commission` costs this tenant LESS than `flat`");
    expect(body).not.toContain("below that figure `flat` would have cost this tenant less");
  });

  // The number itself, and the basis it is computed from. 150 bps against the €10
  // the module drops by = €666.67/mo of turnover. Against the full €19 it would
  // read 1266.67 — a confident wrong number, 1.9x too high.
  it("quotes the crossover computed from the saving, never the full list price", () => {
    expect(body).toContain("~`666.67` of monthly online turnover");
    expect(body).not.toContain("1266.67");
  });

  // Every price in the prose is derived, so a floor or catalog change moves the
  // body with it instead of leaving it quoting a number nobody charges.
  it("derives every price it prints from the constants", () => {
    expect(body).toContain(`€${(COMMISSION_MODE_SAVING_CENTS / 100).toFixed(2)} the module drops by`);
    expect(body).toContain(`€${(ONLINE_PAYMENTS_PRICE_CENTS / 100).toFixed(2)} → the €${(COMMISSION_FLOOR_CENTS / 100).toFixed(2)} floor`);
  });

  // 0 bps is not "a very high crossover" — there is no turnover at which the two
  // modes meet, and a number here would be a fabricated one.
  it("prints no crossover figure at all at 0 bps", () => {
    const zero = commissionChangePrBody("rumi", 150, 0);
    expect(zero).toContain("none at 0 bps");
    expect(zero).not.toMatch(/of monthly online turnover/);
  });

  // The fact easiest to miss, and the reason the body exists at all.
  it("states that merging changes enforcement only, and that a restart is not enough", () => {
    expect(body).toContain("### Merging this changes ENFORCEMENT only");
    expect(body).toContain("`docker compose restart` re-reads nothing");
    expect(body).toContain("gh workflow run provision-tenant.yml");
  });
});
