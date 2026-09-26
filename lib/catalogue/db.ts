import { Pool } from "pg";

const globalForCataloguePool = globalThis as typeof globalThis & {
  cataloguePool?: Pool;
};

export function cataloguePool(): Pool | null {
  const connectionString = process.env.CATALOGUE_DATABASE_URL?.trim();
  if (!connectionString) return null;

  if (!globalForCataloguePool.cataloguePool) {
    const pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 30_000,
      application_name: "sofra-catalogue-read",
    });
    pool.on("error", (error) => {
      const errorType = error instanceof Error ? error.name : "UnknownError";
      console.error("[catalogue-read] idle database client failed", { errorType });
    });
    globalForCataloguePool.cataloguePool = pool;
  }
  return globalForCataloguePool.cataloguePool;
}
