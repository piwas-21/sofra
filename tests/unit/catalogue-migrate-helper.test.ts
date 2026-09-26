import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const helperPath = resolve(process.cwd(), "scripts/catalogue/migrate-deploy.sh");

describe("catalogue migration helper", () => {
  it("requires the owner URL and invokes Prisma with the catalogue config", () => {
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
          CATALOGUE_DATABASE_URL: "postgresql://owner:fixture@localhost/sofra_catalogue",
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
