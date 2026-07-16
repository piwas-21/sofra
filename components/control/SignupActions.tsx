"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { setSignupStatusAction } from "@/lib/actions/signup-actions";
import type { AdminActionState } from "@/lib/actions/admin-actions";
import ActionError from "./ActionError";

// Founder pipeline controls for a signup lead. Conversion stays founder-operated:
// "Convert" marks the lead CONVERTED, and the "Open onboarding" link jumps to the
// existing /admin/onboard provisioning flow (the lead's details are on the card).
export default function SignupActions({ id }: Readonly<{ id: string }>) {
  const t = useTranslations("control.admin.signups");
  const [state, submit, pending] = useActionState<AdminActionState, FormData>(
    setSignupStatusAction,
    {},
  );

  if (state.ok) {
    return <p className="font-label text-muted-foreground">{t("updatedNote")}</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <form action={submit}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="status" value="CONTACTED" />
        <button type="submit" disabled={pending} className="btn-secondary disabled:opacity-60">
          {t("markContacted")}
        </button>
      </form>
      <form action={submit}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="status" value="CONVERTED" />
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {t("convert")}
        </button>
      </form>
      <Link href="/admin/onboard" className="font-label text-sm underline">
        {t("openOnboarding")}
      </Link>
      <form action={submit}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="status" value="DECLINED" />
        <button
          type="submit"
          disabled={pending}
          className="btn-artisanal rounded-craft border-2 border-destructive text-destructive px-4 py-2 font-label disabled:opacity-60"
        >
          {t("decline")}
        </button>
      </form>
      <ActionError code={state.error} />
    </div>
  );
}
