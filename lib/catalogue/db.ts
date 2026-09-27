import { Pool } from "pg";
import { cataloguePoolConfig, type CataloguePoolConfig } from "@/lib/catalogue/config";

const globalForCataloguePool = globalThis as typeof globalThis & {
  cataloguePool?: Pool;
};

export function cataloguePool(): Pool | null {
  const connectionString = process.env.CATALOGUE_DATABASE_URL?.trim();
  if (!connectionString) return null;

  if (!globalForCataloguePool.cataloguePool) {
    let poolConfig: CataloguePoolConfig;
    try {
      poolConfig = cataloguePoolConfig();
    } catch {
      console.error("[catalogue-read] database pool configuration is invalid");
      return null;
    }
    const pool = new Pool({
      connectionString,
      ...poolConfig,
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
