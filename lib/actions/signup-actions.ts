"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/rbac";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { signupStatusSchema } from "@/lib/validation";
import type { AdminActionState } from "@/lib/actions/admin-actions";

/**
 * Move a signup lead to CONTACTED / CONVERTED / DECLINED (ADR-004). Conversion
 * stays founder-operated — this only records the lead's pipeline state; the
 * actual provisioning happens via /admin/onboard. `error` is a message key in
 * the `control.errors` namespace, rendered by <ActionError />.
 */
export async function setSignupStatusAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");

  const parsedStatus = signupStatusSchema.safeParse(formData.get("status"));
  if (!parsedStatus.success) {
    return { error: "invalidStatus" };
  }
  const status = parsedStatus.data;

  const signup = await db.signupRequest.findUnique({ where: { id } });
  if (!signup) {
    return { error: "signupNotFound" };
  }

  await db.signupRequest.update({
    where: { id },
    data: {
      status,
      // A lead is "decided" once it leaves the pipeline; CONTACTED is interim.
      decidedAt: status === "CONTACTED" ? null : new Date(),
    },
  });
  await audit(admin.id, `signup.${status.toLowerCase()}`, "SignupRequest", id);

  revalidatePath("/admin/signups");
  return { ok: true };
}
