#!/usr/bin/env node
// Start the STANDALONE production server — the exact server shape the Docker
// image runs on the box (next.config.ts sets `output: "standalone"`).
//
// Why this exists: the E2E suite used to run `next start`, which Next warns
// about on every run ("next start does not work with output: standalone") and
// which serves the app through a DIFFERENT server than production. The whole
// suite therefore passed against a server shape that never ships — assets are
// resolved differently, and the standalone bundle is a file-traced subset of
// node_modules, so a dependency the app needs at RUNTIME can be missing from
// the image while `next start` is perfectly happy.
//
// Standalone does NOT copy two things into .next/standalone (documented Next
// behaviour, and exactly what the Dockerfile's runner stage copies by hand):
//   .next/static  ->  .next/standalone/.next/static   (JS/CSS chunks)
//   public        ->  .next/standalone/public         (static files)
// Without them the pages render but every chunk 404s, so the tests fail in a
// way that looks like an app bug rather than a missing copy step.
import { cpSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const standalone = path.join(root, ".next", "standalone");
const server = path.join(standalone, "server.js");

if (!existsSync(server)) {
  console.error(
    `no standalone server at ${server} — run \`npm run build\` first ` +
      `(and keep output: "standalone" in next.config.ts)`,
  );
  process.exit(1);
}

for (const [from, to] of [
  [path.join(root, ".next", "static"), path.join(standalone, ".next", "static")],
  [path.join(root, "public"), path.join(standalone, "public")],
]) {
  if (existsSync(from)) cpSync(from, to, { recursive: true, force: true });
}

// server.js reads PORT/HOSTNAME from the environment and defaults to
// 0.0.0.0:3000. `next start` bound loopback by default; keep that, so a local
// run (which holds a Mollie test key and a seeded admin) is not offered to the
// LAN. An explicit HOSTNAME still wins.
const child = spawn(process.execPath, [server], {
  stdio: "inherit",
  env: { ...process.env, HOSTNAME: process.env.HOSTNAME || "127.0.0.1" },
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => child.kill(sig));
}
child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
