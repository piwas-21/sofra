import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const helperPath = resolve(process.cwd(), "scripts/catalogue/migrate-deploy.sh");
const testOwnerConnectionSentinel = process.env.CATALOGUE_MIGRATION_TEST_DATABASE_URL;

if (!testOwnerConnectionSentinel) {
  throw new Error("Vitest must provide the migration-helper owner setting sentinel.");
}

describe("catalogue migration helper", () => {
  it("requires a nonempty owner setting and invokes Prisma with the catalogue config", () => {
    expect(testOwnerConnectionSentinel).toBe("test-owner-config-stub");
    const directory = mkdtempSync(join(tmpdir(), "catalogue-migrate-helper-"));
    try {
      const nodeShim = join(directory, "node");
      const argsPath = join(directory, "args.txt");
      writeFileSync(nodeShim, "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$MIGRATE_ARGS_FILE\"\n");
      chmodSync(nodeShim, 0o755);
      const path = `${directory}:${process.env.PATH ?? ""}`;
      const result = spawnSync("sh", [helperPath], {
        encoding: "utf8",
        env: {
          ...process.env,
          CATALOGUE_DATABASE_URL: testOwnerConnectionSentinel,
          MIGRATE_ARGS_FILE: argsPath,
          PATH: path,
        },
      });

      expect(result.status).toBe(0);
      expect(readFileSync(argsPath, "utf8").trim().split("\n")).toEqual([
        "node_modules/prisma/build/index.js",
        "migrate",
        "deploy",
        "--config",
        "prisma.catalogue.config.ts",
      ]);

      const missingArgsPath = join(directory, "missing-args.txt");
      const missingUrl = spawnSync("sh", [helperPath], {
        encoding: "utf8",
        env: {
          ...process.env,
          CATALOGUE_DATABASE_URL: "",
          MIGRATE_ARGS_FILE: missingArgsPath,
          PATH: path,
        },
      });
      expect(missingUrl.status).toBe(2);
      expect(missingUrl.stderr).toContain("CATALOGUE_DATABASE_URL is required");
      expect(existsSync(missingArgsPath)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
