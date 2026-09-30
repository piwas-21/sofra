import { db } from "@/lib/db";
import { boxAuthorized } from "@/lib/backup-agent-auth";
import { decryptPrinterKey, encryptPrinterKey, fingerprint } from "@/lib/printer-credential-crypto";
import type { z } from "zod";
import { printerReportSchema, printerTenantEligible } from "@/lib/printer-access-policy";
import type { RegistryTenant } from "@/lib/tenant-registry";

type Report = z.infer<typeof printerReportSchema>;
export async function syncPrinterCredentials(report: Report, tenants: RegistryTenant[]) {
  const allowed = tenants.filter((t) => boxAuthorized(report.box, t.box) && printerTenantEligible(t));
  const slugs = new Set(allowed.map((t) => t.slug));
  if (report.credentials.some((c) => !slugs.has(c.tenantSlug))) return null;
  await db.$transaction(async (tx) => {
    const existing = await tx.printerCredential.findMany({ where: {
      tenantSlug: { in: report.credentials.map((c) => c.tenantSlug) },
    } });
    const bySlug = new Map(existing.map((c) => [c.tenantSlug, c]));
    await Promise.all(report.credentials.map(async (item) => {
      const previous = bySlug.get(item.tenantSlug);
      const verified = item.verified && item.key.length > 0;
      const hash = verified ? fingerprint(item.key) : null;
      const applied = verified && previous?.pendingFingerprint === hash;
      await tx.printerCredential.upsert({
        where: { tenantSlug: item.tenantSlug },
        create: {
          tenantSlug: item.tenantSlug, box: report.box,
          keyCipher: verified ? encryptPrinterKey(item.key, `${item.tenantSlug}:current`) : null,
          keyFingerprint: hash, lastSyncedAt: new Date(), verified, renewable: item.renewable,
        },
        update: {
          box: report.box, lastSyncedAt: new Date(), verified, renewable: item.renewable,
          ...(item.renewalFailed !== undefined ? { renewalFailed: item.renewalFailed } : {}),
          ...(verified ? { keyCipher: encryptPrinterKey(item.key, `${item.tenantSlug}:current`), keyFingerprint: hash } : {}),
          ...(applied ? { pendingCipher: null, pendingFingerprint: null, requestedAt: null,
            updatedAt: new Date(), renewalFailed: false } : {}),
        },
      });
      if (applied) await tx.auditLog.create({ data: {
        actorId: null, action: "printer.key.applied", entityType: "PrinterCredential", entityId: item.tenantSlug,
        meta: { box: report.box },
      } });
    }));
  }, { isolationLevel: "Serializable" });
  const pending = await db.printerCredential.findMany({
    where: { tenantSlug: { in: report.credentials.map((c) => c.tenantSlug) }, pendingCipher: { not: null } },
  });
  return pending.map((c) => ({ tenantSlug: c.tenantSlug,
    key: decryptPrinterKey(c.pendingCipher!, `${c.tenantSlug}:pending`) }));
}
