import { z } from "zod";
import type { RegistryTenant } from "@/lib/tenant-registry";

export const PRINTER_SYNC_MAX_BODY_BYTES = z.coerce.number().int().min(1024).max(1_048_576)
  .catch(64_000).parse(process.env.PRINTER_SYNC_MAX_BODY_BYTES);
export const PRINTER_AGENT_FRESH_MS = 5 * 60 * 1000;
export function printerTenantEligible(tenant: RegistryTenant): boolean {
  return tenant.status === "active" && (tenant.modules.includes("printing") || tenant.managed === "legacy");
}
export function printerAgentFresh(at: Date | null, now = Date.now()): boolean {
  return at !== null && now - at.getTime() >= 0 && now - at.getTime() < PRINTER_AGENT_FRESH_MS;
}
const slug = z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/);
export const printerReportSchema = z.object({
  box: slug,
  credentials: z.array(z.object({
    tenantSlug: slug,
    key: z.string().max(256).regex(/^[A-Za-z0-9_+/=-]*$/),
    verified: z.boolean(),
    renewable: z.boolean(),
    renewalFailed: z.boolean().optional(),
  }).strict()).max(100),
}).strict().refine((v) => new Set(v.credentials.map((c) => c.tenantSlug)).size === v.credentials.length);
