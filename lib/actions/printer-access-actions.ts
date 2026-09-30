"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { loadTenantRegistry } from "@/lib/tenant-registry";
import { printerAgentFresh, printerTenantEligible } from "@/lib/printer-access-policy";
import { decryptPrinterKey, encryptPrinterKey, fingerprint, newPrinterKey,
  printerCredentialsConfigured } from "@/lib/printer-credential-crypto";
import { rateLimit } from "@/lib/rate-limit";

export type PrinterActionState = { error?: string; ok?: boolean; key?: string };
async function eligible(slug: string) {
  const registry = await loadTenantRegistry();
  return registry.ok ? registry.tenants.find((t) => t.slug === slug && printerTenantEligible(t)) : undefined;
}
export async function revealPrinterKey(slug: string): Promise<PrinterActionState> {
  const admin = await requireAdmin();
  if (!printerCredentialsConfigured() || !await eligible(slug)) return { error: "unavailable" };
  if (!rateLimit(`printer-reveal:${admin.id}`, 30, 60_000)) return { error: "limited" };
  const credential = await db.printerCredential.findUnique({ where: { tenantSlug: slug } });
  if (credential?.box !== (await eligible(slug))?.box || !credential?.keyCipher || !credential.verified || credential.pendingCipher || !printerAgentFresh(credential.lastSyncedAt)) {
    return { error: "notReady" };
  }
  try {
    const key = decryptPrinterKey(credential.keyCipher, `${slug}:current`);
    // Revealing secrets requires a durable audit; a failed audit refuses the reveal.
    await db.auditLog.create({ data: { actorId: admin.id, action: "printer.key.revealed",
      entityType: "PrinterCredential", entityId: slug } });
    return { key };
  } catch { return { error: "unavailable" }; }
}
export async function renewPrinterKey(_previous: PrinterActionState, form: FormData): Promise<PrinterActionState> {
  const admin = await requireAdmin();
  const slug = form.get("tenantSlug");
  if (typeof slug !== "string" || form.get("confirmSlug") !== slug) return { error: "confirmation" };
  if (!printerCredentialsConfigured() || !await eligible(slug)) return { error: "unavailable" };
  const credential = await db.printerCredential.findUnique({ where: { tenantSlug: slug } });
  if (credential?.box !== (await eligible(slug))?.box || !credential?.renewable || !printerAgentFresh(credential.lastSyncedAt)) return { error: "notReady" };
  if (!rateLimit(`printer-renew:${admin.id}:${slug}`, 3, 60_000)) return { error: "limited" };
  const key = newPrinterKey();
  try {
    await db.$transaction(async (tx) => {
      const updated = await tx.printerCredential.updateMany({
        where: { tenantSlug: slug, pendingCipher: null },
        data: { pendingCipher: encryptPrinterKey(key, `${slug}:pending`), pendingFingerprint: fingerprint(key), requestedAt: new Date() },
      });
      if (updated.count !== 1) throw new Error("Renewal already pending");
      await tx.auditLog.create({ data: { actorId: admin.id, action: "printer.key.requested",
        entityType: "PrinterCredential", entityId: slug } });
    });
  } catch { return { error: "pending" }; }
  revalidatePath("/admin/printers");
  return { ok: true };
}
