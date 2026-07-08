#!/usr/bin/env node
// i18n parity gate (DEV-PHASES-PLAN W1, D6). Every non-default locale must
// carry exactly the same leaf-key set as en.json — no missing, no extra.
// next-intl resolves keys per-locale, so a drift silently renders a raw key
// (or a wrong-language string) to a user. Exit 1 on any mismatch.
//
// Marketing locales (messages/*.json) move in lockstep; the (control) plane
// is en-only by design and is not localized here.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MESSAGES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "messages");
const BASE = "en";

function leafKeys(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? leafKeys(v, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

function load(locale) {
  return JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), "utf8"));
}

const locales = readdirSync(MESSAGES_DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

const baseKeys = new Set(leafKeys(load(BASE)));
let failed = false;

for (const locale of locales) {
  if (locale === BASE) continue;
  const keys = new Set(leafKeys(load(locale)));
  const missing = [...baseKeys].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !baseKeys.has(k));
  if (missing.length || extra.length) {
    failed = true;
    console.error(`✗ ${locale}: ${missing.length} missing, ${extra.length} extra vs ${BASE}`);
    for (const k of missing) console.error(`    missing: ${k}`);
    for (const k of extra) console.error(`    extra:   ${k}`);
  } else {
    console.log(`✓ ${locale}: ${keys.size} keys in parity with ${BASE}`);
  }
}

if (failed) {
  console.error("\ni18n parity check FAILED — align the locale files above with en.json.");
  process.exit(1);
}
console.log(`\nAll ${locales.length - 1} locales in parity (${baseKeys.size} keys each).`);
