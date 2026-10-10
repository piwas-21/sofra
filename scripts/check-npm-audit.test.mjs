import assert from "node:assert/strict";
import test from "node:test";
import { auditFailures } from "./check-npm-audit.mjs";

const id = "GHSA-vfj7-8cjw-p6xm";
const via = { name: "braces", severity: "high", url: `https://github.com/advisories/${id}` };
const report = {
  auditReportVersion: 2,
  metadata: { vulnerabilities: { high: 1 } },
  vulnerabilities: { braces: { severity: "high", via: [via] } },
};
const allowed = [{ id, developmentOnlyPackage: "braces", version: "3.0.3", reason: "Reviewed development-only fixture", expires: "2026-10-17" }];
const lock = { packages: { "node_modules/braces": { dev: true, version: "3.0.3" } } };
const today = "2026-10-10";

test("accepts only the reviewed development-only leaf", () => {
  assert.deepEqual(auditFailures(report, allowed, lock, today), []);
});
test("rejects expired exceptions", () => {
  assert.deepEqual(auditFailures(report, allowed, lock, "2026-10-18"), [id]);
});
test("rejects a production-reachable copy even beside a development copy", () => {
  const unsafe = { packages: { ...lock.packages, "node_modules/runtime/node_modules/braces": { version: "3.0.3" } } };
  assert.deepEqual(auditFailures(report, allowed, unsafe, today), [id]);
});
test("rejects a missing or different package version", () => {
  assert.deepEqual(auditFailures(report, allowed, { packages: {} }, today), [id]);
  assert.deepEqual(auditFailures(report, allowed, { packages: { "node_modules/braces": { dev: true, version: "3.0.4" } } }, today), [id]);
});
test("rejects an unrelated critical finding while the accepted leaf remains present", () => {
  const unsafe = structuredClone(report);
  unsafe.vulnerabilities.other = { severity: "critical", via: [{ name: "other", severity: "critical", url: "https://github.com/advisories/GHSA-other" }] };
  assert.deepEqual(auditFailures(unsafe, allowed, lock, today), ["GHSA-other"]);
});
test("fails closed on fetch errors, incomplete reports and duplicate exceptions", () => {
  assert.throws(() => auditFailures({ error: { code: "E503" } }, allowed, lock, today));
  assert.throws(() => auditFailures({}, allowed, lock, today));
  assert.throws(() => auditFailures(report, [...allowed, ...allowed], lock, today));
});

test("rejects malformed roots and dangling transitive findings beside a valid accepted root", () => {
  const malformed = structuredClone(report);
  malformed.vulnerabilities.other = { severity: "high", via: [{ name: "other", url: "https://github.com/advisories/GHSA-other" }] };
  assert.throws(() => auditFailures(malformed, allowed, lock, today));
  malformed.vulnerabilities.other = { severity: "high", via: ["missing-leaf"] };
  assert.throws(() => auditFailures(malformed, allowed, lock, today));
});
