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
import {
  UnknownRegistryTenantError,
  InvalidCommissionBpsError,
  MissingStripeAccountError,
} from "./registry-commission-errors";

// Re-exported so every existing importer keeps its single import site.
export { UnknownRegistryTenantError, InvalidCommissionBpsError, MissingStripeAccountError };

/** No `slug` entry exists in the registry at all. */
const escapeForRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * The `[headerIdx, endIdx)` line range `slug`'s block occupies in `lines` —
 * `headerIdx` is the header line itself (`  slug:`), `endIdx` is exclusive, so
 * callers scan the body as `[headerIdx + 1, endIdx)`.
 *
 * The header must match `^  <slug>:\s*$` exactly, anchored at both ends, so a
 * slug can never match a longer sibling (`demo` must not match `demo2:`).
 */
function findBlock(lines: string[], slug: string): { headerIdx: number; endIdx: number } | null {
  const headerRe = new RegExp(String.raw`^ {2}${escapeForRegex(slug)}:\s*$`);
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
    const match = BPS_LINE.exec(lines[i]);
    if (match) return Number(match[2]);
  }
  return undefined;
}

/**
 * The block already carries the key: rewrite that one line, or drop it at 0.
 *
 * Dropping rather than writing `: 0` is the registry's own convention — absent means
 * zero and the schema comment says so — so the line would be noise in a file humans
 * review. The original indentation is reused rather than assumed; nothing here should
 * be what decides a file's formatting.
 */
function rewriteExisting(lines: string[], bpsIdx: number, bps: number): string[] {
  if (bps === 0) return [...lines.slice(0, bpsIdx), ...lines.slice(bpsIdx + 1)];
  const indent = BPS_LINE.exec(lines[bpsIdx])![1];
  const next = [...lines];
  next[bpsIdx] = `${indent}payments_commission_bps: ${bps}`;
  return next;
}

/**
 * The block has no key yet. At 0 there is nothing to write — absent already means
 * zero — so the input comes back untouched and the caller reports `changed: false`
 * rather than opening an empty PR.
 *
 * Otherwise the line goes immediately after `stripe_account:`. That anchor exists
 * exactly when a non-zero rate is legal at all, and using it avoids having to decide
 * where a block "ends" among trailing comments.
 */
function insertAfterStripeAccount(
  lines: string[],
  stripeIdx: number,
  bps: number,
  slug: string,
): string[] {
  if (bps === 0) return lines;
  if (stripeIdx === -1) throw new MissingStripeAccountError(slug);
  const indent = STRIPE_LINE.exec(lines[stripeIdx])![1];
  return [
    ...lines.slice(0, stripeIdx + 1),
    `${indent}payments_commission_bps: ${bps}`,
    ...lines.slice(stripeIdx + 1),
  ];
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

  const next =
    bpsIdx !== -1
      ? rewriteExisting(lines, bpsIdx, bps)
      : insertAfterStripeAccount(lines, stripeIdx, bps, slug);

  const yaml = next.join("\n");
  return { yaml, changed: yaml !== registryYaml };
}
