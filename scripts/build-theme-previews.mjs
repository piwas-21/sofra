// Regenerate the signup configurator's theme previews from the frontend repo's
// per-template screenshot BASELINES (S15).
//
// The previews are not artwork — they are a crop of an asset CI already keeps
// honest. When a template's look changes, its baseline changes with it (the
// Screenshots workflow fails until the PNG is regenerated and committed), so
// re-running this is the whole maintenance story. Redrawing them by hand would
// let the picker drift from what a customer actually gets.
//
// Usage (from the sofra repo root):
//   node scripts/build-theme-previews.mjs [path-to-frontend-repo]
// Defaults to ../frontend, the workspace layout.
//
// The crop is deliberate: it stops at the fold, above the reference tenant's
// address and phone number. Widen it only after checking what comes into frame.

import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const TEMPLATES = ["classic", "craft"];

/** Source baseline: light theme, desktop viewport — the most legible pairing. */
const BASELINE = (frontend, template) =>
  path.join(
    frontend,
    "e2e/screenshots/__screenshots__",
    template,
    "screenshots-desktop/home-light.png",
  );

// 1280x760 of a ~1280x1990 baseline = nav + hero. Downscaled to 640 because the
// picker renders two side by side in a form column, never full width.
const CROP = { left: 0, top: 0, width: 1280, height: 760 };
const OUT_WIDTH = 640;
const QUALITY = 78;

const frontend = process.argv[2] ?? path.resolve("../frontend");
const outDir = path.resolve("public/theme-previews");
await mkdir(outDir, { recursive: true });

for (const template of TEMPLATES) {
  const src = BASELINE(frontend, template);
  try {
    await stat(src);
  } catch {
    console.error(`missing baseline: ${src}`);
    console.error("Pass the frontend repo path as the first argument.");
    process.exit(1);
  }

  const out = path.join(outDir, `${template}.webp`);
  await sharp(src).extract(CROP).resize({ width: OUT_WIDTH }).webp({ quality: QUALITY }).toFile(out);

  const { size } = await stat(out);
  console.log(`${template.padEnd(8)} → public/theme-previews/${template}.webp  ${(size / 1024).toFixed(1)} KB`);
}
