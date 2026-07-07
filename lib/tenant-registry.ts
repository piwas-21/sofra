// Read-only view over the deploy repo's tenants/registry.yml (ADR-007: the
// committed YAML is the source of truth until >3 tenants; it graduates to a
// Postgres table after that — this module is the seam where that swap lands).
// The box bind-mounts the synced tenants/ dir into this container read-only
// and points TENANT_REGISTRY_PATH at it; lifecycle changes still happen in
// git + provision scripts (ADR-003), never through the control plane.

import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { z } from "zod";

const tenantSchema = z.object({
  name: z.string(),
  status: z.string(),
  managed: z.string(),
  box: z.string(),
  domain: z.string(),
  domain_mode: z.string(),
  db: z.string(),
  backend_tag: z.string().optional(),
  frontend_tag: z.string().optional(),
  currency: z.string().optional(),
  languages: z.array(z.string()).default([]),
  modules: z.array(z.string()).default([]),
  admin_email: z.string().optional(),
  city: z.string().optional(),
});

const registrySchema = z.object({
  version: z.number(),
  tenants: z.record(z.string(), tenantSchema),
});

export type RegistryTenant = z.infer<typeof tenantSchema> & { slug: string };

export type RegistryResult =
  | { ok: true; tenants: RegistryTenant[] }
  | { ok: false; error: string };

/**
 * Load and validate the registry. Returns a result (not a throw): a missing
 * mount or a malformed file is an ops condition the admin page reports
 * inline, same as the MOLLIE_API_KEY-not-set banner.
 */
export async function loadTenantRegistry(): Promise<RegistryResult> {
  const path = process.env.TENANT_REGISTRY_PATH;
  if (!path) {
    return { ok: false, error: "TENANT_REGISTRY_PATH is not set on this environment." };
  }
  try {
    const raw = await readFile(path, "utf8");
    const parsed = registrySchema.parse(parse(raw));
    const tenants = Object.entries(parsed.tenants)
      .map(([slug, t]) => ({ slug, ...t }))
      .sort((a, b) => a.slug.localeCompare(b.slug));
    return { ok: true, tenants };
  } catch (e) {
    // Surfacing the message is safe: path + zod/yaml diagnostics, no secrets.
    console.error("tenant registry: load failed", e);
    return { ok: false, error: e instanceof Error ? e.message : "Unknown registry read error." };
  }
}
