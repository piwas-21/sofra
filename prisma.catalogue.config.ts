import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

loadEnv({ path: ".env.local" });

export default defineConfig({
  schema: "prisma/catalogue/schema.prisma",
  migrations: { path: "prisma/catalogue/migrations" },
  datasource: { url: process.env.CATALOGUE_DATABASE_URL! },
});
