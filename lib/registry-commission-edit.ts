// Surgical single-tenant edits to `tenants/registry.yml`'s
// `payments_commission_bps` field (SOFRA-PAYMENTS-PRICING-MODE-PLAN S2a) — the
// AMENDMENT counterpart to `lib/provisioning-registry.ts`, which only builds a
// brand-new entry. Consumed by `lib/registry-commission-pr.ts`, which does the
// GitHub side; this file stays pure so the dangerous part (rewriting a file a
// human reviews for content they hand-wrote) is unit-testable in isolation.
//
// A YAML parse-and-restringify is FORBIDDEN here on purpose: the registry
// carries extensive hand-written documentation as comments (see the deploy
// repo's tenants/registry.yml header), and round-tripping it through a YAML
// library would silently delete every one of them. So this is LINE editing
// against the exact shape `provisioning-registry.ts` emits and the deploy
// repo's real file confirms: a tenant header at 2 spaces (`  slug:`), its
// fields at 4 (`    name: ...`), and comments appearing BOTH between blocks at
// 2 spaces and inside a block at 4 — which is also what makes "blank, or
// indented >= 4 spaces" the right definition of "still inside this block": a
// 2-space comment between two tenants correctly ends the first block rather
// than being read as its tail.
//
// Pure: no GitHub API, no fs, no env — registryYaml in, registryYaml out.

import { isCommissionBps } from "./payments-pricing";

/** No `slug` entry exists in the registry at all. */
export class UnknownRegistryTenantError extends Error {
  constructor(slug: string) {
    super(`registry has no '${slug}' entry`);
    this.name = "UnknownRegistryTenantError";
  }
}

/** `bps` failed `isCommissionBps` — negative, fractional, or above the ceiling. */
export class InvalidCommissionBpsError extends Error {
  constructor(bps: number) {
    super(`${bps} is not a valid commission rate`);
    this.name = "InvalidCommissionBpsError";
  }
}

/**
 * A non-zero rate was requested for a tenant whose block has no
 * `stripe_account:` line. `provision-tenant.sh` refuses a non-zero
 * `payments_commission_bps` unless the SAME entry also carries
 * `online-payments` in `modules` AND a `stripe_account` — and refuses it
 * BEFORE the database, the compose project or the image. So writing the rate
 * here without the account would not give this tenant a restaurant without
 * commission on the next re-provision; it would give them no tenant at all.
 *
 * Unlike a brand-new entry (`splitDeferredModules` in
 * `provisioning-module-pairing.ts`), there is no "defer it to a second PR"
 * available here: this call amends a tenant that already exists, so the only
 * honest answer is to refuse outright rather than propose a change that would
 * brick the next re-provision.
 */
export class MissingStripeAccountError extends Error {
  constructor(slug: string) {
    super(
      `'${slug}' has no stripe_account: — provision-tenant.sh refuses a non-zero ` +
        "payments_commission_bps without online-payments + stripe_account, and refuses it " +
        "BEFORE the database, so proposing this rate would yield no tenant at all rather " +
        "than a tenant without commission",
    );
    this.name = "MissingStripeAccountError";
  }
}

const escapeForRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The `[headerIdx, endIdx)` line range `slug`'s block occupies in `lines` —
 * `headerIdx` is the header line itself (`  slug:`), `endIdx` is exclusive, so
 * callers scan the body as `[headerIdx + 1, endIdx)`.
 *
 * The header must match `^  <slug>:\s*$` exactly, anchored at both ends, so a
 * slug can never match a longer sibling (`demo` must not match `demo2:`).
 */
function findBlock(lines: string[], slug: string): { headerIdx: number; endIdx: number } | null {
  const headerRe = new RegExp(`^ {2}${escapeForRegex(slug)}:\\s*$`);
  const headerIdx = lines.findIndex((line) => headerRe.test(line));
  if (headerIdx === -1) return null;

  let endIdx = lines.length;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (lines[i].trim() === "" || /^ {4,}/.test(lines[i])) continue;
    endIdx = i;
    break;
  }
  return { headerIdx, endIdx };
}

const BPS_LINE = /^( +)payments_commission_bps:\s*(\d+)/;
const STRIPE_LINE = /^( +)stripe_account:/;

/**
 * The rate `slug`'s block currently carries, or `undefined` when the key is
 * absent or the slug is unknown — both of which mean 0, the same convention
 * `setRegistryCommissionBps` below uses. Exported only so
 * `lib/registry-commission-pr.ts` can report a "before" figure in the PR body
 * without a second, independent parse of the block that could disagree with
 * the one this file actually acts on.
 */
export function currentRegistryCommissionBps(registryYaml: string, slug: string): number | undefined {
  const lines = registryYaml.split("\n");
  const block = findBlock(lines, slug);
  if (!block) return undefined;
  for (let i = block.headerIdx + 1; i < block.endIdx; i++) {
    const match = lines[i].match(BPS_LINE);
    if (match) return Number(match[2]);
  }
  return undefined;
}

/**
 * Set (or clear) `slug`'s `payments_commission_bps` in `registryYaml`.
 *
 * - `bps` failing {@link isCommissionBps} → {@link InvalidCommissionBpsError}.
 * - `slug` not present → {@link UnknownRegistryTenantError}.
 * - An existing `payments_commission_bps:` line in the block: `bps > 0`
 *   replaces it in place (preserving its original indentation); `bps === 0`
 *   deletes the line entirely — absent means 0 (the registry schema documents
 *   that), so leaving `: 0` behind would be redundant noise in a file humans
 *   review.
 * - No existing line: `bps === 0` is a no-op (`changed: false`); `bps > 0` is
 *   inserted immediately after the block's `stripe_account:` line, matching
 *   its indentation — or {@link MissingStripeAccountError} when the block has
 *   none. Anchoring to `stripe_account:` rather than appending at the block's
 *   end is deliberate: that anchor is guaranteed to exist exactly when a
 *   non-zero rate is legal, which sidesteps having to decide where a block
 *   "ends" in the presence of trailing comments.
 *
 * Idempotent: applying the same value twice returns `changed: false` the
 * second time, with byte-identical YAML — `changed` is derived from a plain
 * string comparison of the whole file, not tracked case by case, so a
 * "replace with the same value" can never disagree with that comparison.
 */
export function setRegistryCommissionBps(
  registryYaml: string,
  slug: string,
  bps: number,
): { yaml: string; changed: boolean } {
  if (!isCommissionBps(bps)) throw new InvalidCommissionBpsError(bps);

  const lines = registryYaml.split("\n");
  const block = findBlock(lines, slug);
  if (!block) throw new UnknownRegistryTenantError(slug);
  const { headerIdx, endIdx } = block;

  let bpsIdx = -1;
  let stripeIdx = -1;
  for (let i = headerIdx + 1; i < endIdx; i++) {
    if (bpsIdx === -1 && BPS_LINE.test(lines[i])) bpsIdx = i;
    if (stripeIdx === -1 && STRIPE_LINE.test(lines[i])) stripeIdx = i;
  }

  let next: string[];
  if (bpsIdx !== -1) {
    if (bps > 0) {
      const indent = lines[bpsIdx].match(BPS_LINE)![1];
      next = [...lines];
      next[bpsIdx] = `${indent}payments_commission_bps: ${bps}`;
    } else {
      next = [...lines.slice(0, bpsIdx), ...lines.slice(bpsIdx + 1)];
    }
  } else if (bps === 0) {
    next = lines;
  } else {
    if (stripeIdx === -1) throw new MissingStripeAccountError(slug);
    const indent = lines[stripeIdx].match(STRIPE_LINE)![1];
    next = [
      ...lines.slice(0, stripeIdx + 1),
      `${indent}payments_commission_bps: ${bps}`,
      ...lines.slice(stripeIdx + 1),
    ];
  }

  const yaml = next.join("\n");
  return { yaml, changed: yaml !== registryYaml };
}
