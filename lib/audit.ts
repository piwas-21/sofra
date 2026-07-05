import { db } from "@/lib/db";

type Meta = Record<string, unknown>;

/** Fire-and-forget audit entry — auditing must never break the main flow. */
export async function audit(
  actorId: string | null,
  action: string,
  entityType?: string,
  entityId?: string | null,
  meta?: Meta,
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId,
        action,
        entityType,
        entityId: entityId ?? undefined,
        meta: meta as object | undefined,
      },
    });
  } catch (e) {
    console.error("audit: failed to write", action, e);
  }
}
