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

// Emails / phone-shaped literals inside a console.* call = likely PII leak.
const PII_CONSOLE =
  /console\.(log|error|warn|info)\([^)]*(@[\w.-]+\.\w{2,}|\+?\d[\d\s().-]{7,}\d)/;

function limitFor(rel) {
  // rel is repo-relative (no leading slash), e.g. "lib/billing.ts",
  // "app/(control)/admin/page.tsx", "components/Foo.tsx".
  if (/(^|\/)app\/.*page\.tsx$/.test(rel)) return [200, "page"];
  if (/(^|\/)(lib|actions)\//.test(rel) && /\.ts$/.test(rel)) return [200, "server-action/lib"];
  if (/(^|\/)types?\//.test(rel) || /\.types\.ts$/.test(rel)) return [150, "type"];
  if (/\.tsx$/.test(rel)) return [250, "component"];
  return [0, ""];
}

function loadBaseline() {
  if (!existsSync(BASELINE)) return new Set();
  return new Set(
    readFileSync(BASELINE, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#")),
  );
}

function checkFile(abs, { blocking } = {}) {
  const rel = relative(ROOT, abs).split(sep).join("/");
  if (!/\.(tsx?|mjs)$/.test(rel)) return false;
  if (/\.(test|spec)\.|\.d\.ts$|node_modules\/|\.next\/|generated\//.test(rel)) return false;
  let src;
  try {
    src = readFileSync(abs, "utf8");
  } catch {
    return false;
  }
  const loc = src.split("\n").length;
  const [lim, kind] = limitFor(rel);
  let violated = false;

  if (lim && loc > lim && !loadBaseline().has(rel)) {
    process.stderr.write(`${rel}: file-length: ${kind} ~${loc} LOC (limit ${lim}) — extract per CLAUDE.md §4\n`);
    if (blocking) violated = true;
  }
  if (PII_CONSOLE.test(src)) {
    // Always a warning, never fails CI (heuristic — may be a false positive).
    process.stderr.write(`${rel}: pii-in-log: console.* appears to log an email/phone — log ids, not PII (CLAUDE.md §5)\n`);
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
