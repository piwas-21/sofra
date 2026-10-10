#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
const VALID_SEVERITIES = new Set(["info", "low", "moderate", "high", "critical"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validateFinding(info, vulnerabilities) {
  if (!VALID_SEVERITIES.has(info.severity) || !Array.isArray(info.via)) throw new Error("Malformed audit finding");
  for (const via of info.via) {
    if (typeof via === "string") {
      if (!vulnerabilities[via]) throw new Error("Incomplete transitive audit report");
      continue;
    }
    if (!via || !VALID_SEVERITIES.has(via.severity) || typeof via.name !== "string" || !via.url) {
      throw new Error("Malformed root advisory");
    }
  }
}

function validateReport(audit) {
  if (audit.error || audit.auditReportVersion !== 2 || !audit.metadata?.vulnerabilities || !audit.vulnerabilities) {
    throw new Error("Audit did not return a complete successful report");
  }
  for (const info of Object.values(audit.vulnerabilities)) validateFinding(info, audit.vulnerabilities);
}

function developmentScopeMatches(entry, lock) {
  if (!entry.developmentOnlyPackage || !entry.version || !lock.packages) return false;
  const suffix = `node_modules/${entry.developmentOnlyPackage}`;
  const matches = Object.entries(lock.packages).filter(([path]) => path === suffix || path.endsWith(`/${suffix}`));
  return matches.length > 0 && matches.every(([, info]) => info.dev === true && info.version === entry.version);
}

function acceptedFinding(entry, lock, today) {
  return Boolean(
    entry?.reason?.trim() &&
    DATE_PATTERN.test(entry.expires) &&
    !Number.isNaN(Date.parse(entry.expires)) &&
    entry.expires >= today &&
    developmentScopeMatches(entry, lock),
  );
}

/** Every unmatched, expired or production-reachable high/critical advisory fails. */
export function auditFailures(audit, allowlist, lock, today = new Date().toISOString().slice(0, 10)) {
  validateReport(audit);
  if (!Array.isArray(allowlist)) throw new Error("Invalid audit exception list");
  const allowed = new Map(allowlist.map((entry) => [entry.id, entry]));
  if (allowed.size !== allowlist.length) throw new Error("Duplicate audit exception");
  const roots = Object.values(audit.vulnerabilities).flatMap((info) =>
    info.via.filter((via) => typeof via === "object" && via !== null && BLOCKING_SEVERITIES.has(via.severity)),
  );
  if (roots.length === 0 && Object.values(audit.vulnerabilities).some((info) => BLOCKING_SEVERITIES.has(info.severity))) {
    throw new Error("Blocking findings have no root advisory");
  }
  const failures = new Set();
  for (const via of roots) {
    const id = via.url?.split("/").pop();
    const entry = allowed.get(id);
    if (!acceptedFinding(entry, lock, today) || via.name !== entry.developmentOnlyPackage) {
      failures.add(id ?? "unidentified advisory");
    }
  }
  return [...failures];
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.length !== 2) throw new Error("Audit JSON must be supplied on standard input; file arguments are not accepted");
    const audit = JSON.parse(readFileSync(0, "utf8"));
    const allowlist = JSON.parse(readFileSync(new URL("../.npm-audit-allowlist.json", import.meta.url), "utf8"));
    const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
    const failures = auditFailures(audit, allowlist, lock);
    if (failures.length > 0) throw new Error(`Unaccepted high/critical advisories: ${failures.join(", ")}`);
    console.log("npm audit passed: no unaccepted high/critical advisories; dated exceptions require development-only lockfile scope");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Audit validation failed");
    process.exitCode = 1;
  }
}
