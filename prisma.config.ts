// Prisma 7 config (replaces the old schema-embedded config; the CLI no longer
// auto-loads .env — load Next's env files ourselves so `prisma migrate dev`
// works against the local dev DB).
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // Connection for the CLI (migrate/studio). The app itself passes its own
  // adapter to PrismaClient in lib/db.ts.
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
