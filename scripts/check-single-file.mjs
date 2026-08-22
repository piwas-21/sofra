#!/usr/bin/env node
// Single-file checker for sofra (DEV-PHASES-PLAN W1, D10 + D7). Two modes:
//
//   (default)  PostToolUse hook — checks ONE file (path from argv[2] or the
//              hook JSON on stdin). NON-BLOCKING: always exit 0, warnings to
//              stderr. Fast in-loop feedback right after an edit.
//   --all      CI mode — walks the tracked source tree, applies the same
//              rules, and EXITS 1 if any hard violation (over-limit file not
//              in the baseline) is found. PII warnings never fail the build.
//
// Rules: file-length (CLAUDE.md §4: page 200 · component 250 · server-action/
// lib 200 · type 150) + a PII-in-console heuristic (§5: no partner/client
// emails/phones in logs). sofra is Tailwind — no CSS-module rule (unlike the
// frontend checker this is ported from).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));
const BASELINE = join(ROOT, "scripts", "file-length-baseline.txt");

// A console.* call + an email/phone-shaped literal on the same line = likely
// PII leak. Checked per-line (below) rather than with one greedy regex so an
// inner `)` in the console args doesn't defeat the match.
const CONSOLE_CALL = /console\.(log|error|warn|info)\(/;
const PII_SHAPE = /@[\w.-]+\.\w{2,}|\+?\d[\d\s().-]{7,}\d/;
// The shape rule alone cannot see the common case, and missed the real one: a
// warn line that interpolated `opts.to` printed every customer's address for
// months (EMAIL-SPEC-CONTROL-PLANE G15), because an INTERPOLATED value has no
// shape until runtime. So also flag a console line that interpolates something
// NAMED like a person: `email`, `mail`, `phone`, `recipient`, or a bare `to`.
// Names, not types — which is why this stays a warning: such a value may well be
// a slug or a boolean. A false warning costs a glance; the miss it replaces cost
// a live PII leak that every gate reported as clean.
// Two small patterns rather than one clever one: an interpolation, and a name
// inside it. Sonar flagged the combined version for complexity, and splitting it
// is the better code anyway — each half is readable on its own line.
const INTERPOLATION = /\$\{[^}]*\}/g;
const PII_NAME = /\b(e?mail|phone|recipient|to)\b/i;
// …except where the value is ALREADY passed through the redaction helpers. They
// are stripped rather than allow-listed per line, so a line that tags one value
// and prints another raw is still caught — the mixed case is the likely one.
const PII_REDACTED_CALL = /\b(recipientTag|redactAddresses)\s*\([^)]*\)/g;

function limitFor(rel) {
  // rel is repo-relative (no leading slash), e.g. "lib/billing.ts",
  // "app/(control)/admin/page.tsx", "components/Foo.tsx".
  if (/(^|\/)app\/.*page\.tsx$/.test(rel)) return [200, "page"];
  if (/(^|\/)(lib|actions)\//.test(rel) && /\.ts$/.test(rel)) return [200, "server-action/lib"];
  if (/(^|\/)types?\//.test(rel) || /\.types\.ts$/.test(rel)) return [150, "type"];
  if (/\.tsx$/.test(rel)) return [250, "component"];
  return [0, ""];
}

// Read the baseline once at module load (not per file checked).
const baseline = existsSync(BASELINE)
  ? new Set(
      readFileSync(BASELINE, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#")),
    )
  : new Set();

function checkFile(abs, { blocking } = {}) {
  const rel = relative(ROOT, abs).split(sep).join("/");
  if (!/\.(tsx?|mjs)$/.test(rel)) return false;
  if (/\.(test|spec)\.|\.d\.ts$|node_modules\/|\.next\/|generated\//.test(rel)) return false;
  let src;
  try {
    src = readFileSync(abs, "utf8");
  } catch (e) {
    // Surface the skip (don't silently miss a file's violations in --all CI mode).
    process.stderr.write(`${rel}: skipped — unreadable (${e.code ?? e.message})\n`);
    return false;
  }
  const loc = src.split("\n").length;
  const [lim, kind] = limitFor(rel);
  let violated = false;

  if (lim && loc > lim && !baseline.has(rel)) {
    process.stderr.write(`${rel}: file-length: ${kind} ~${loc} LOC (limit ${lim}) — extract per CLAUDE.md §4\n`);
    if (blocking) violated = true;
  }
  if (
    src
      .split("\n")
      .map((line) => line.replace(PII_REDACTED_CALL, "TAGGED"))
      .some((line) => {
        if (!CONSOLE_CALL.test(line)) return false;
        if (PII_SHAPE.test(line)) return true;
        // EVERY interpolation on the line, not the first: `${slug}` followed by
        // `${user.email}` is the shape a careful-looking line actually has.
        return [...line.matchAll(INTERPOLATION)].some((m) => PII_NAME.test(m[0]));
      })
  ) {
    // Always a warning, never fails CI (heuristic — may be a false positive).
    process.stderr.write(
      `${rel}: pii-in-log: console.* appears to log an email/phone/recipient — log an id or a tag (lib/log-recipient.ts), not PII (CLAUDE.md §5)\n`,
    );
  }
  return violated;
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (/^(node_modules|\.next|\.git)$/.test(e.name) || e.name === "generated") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

if (process.argv.includes("--all")) {
  const roots = ["app", "lib", "components", "scripts", "i18n"].map((d) => join(ROOT, d)).filter(existsSync);
  let bad = 0;
  for (const r of roots) for (const f of walk(r)) if (checkFile(f, { blocking: true })) bad++;
  if (bad) {
    process.stderr.write(`\ncheck-single-file: ${bad} file(s) over their CLAUDE.md §4 limit and not baselined.\n`);
    process.exit(1);
  }
  process.exit(0);
} else {
  let file = process.argv[2];
  if (!file && !process.stdin.isTTY) {
    try {
      file = JSON.parse(readFileSync(0, "utf8"))?.tool_input?.file_path ?? "";
    } catch {
      file = "";
    }
  }
  if (file) {
    const abs = resolve(file);
    if (abs.startsWith(ROOT + sep)) checkFile(abs, { blocking: false });
  }
  process.exit(0);
}
