"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { addCommissionAction, type AdminActionState } from "@/lib/actions/admin-actions";
import ActionError from "./ActionError";

export default function CommissionForm({
  partnerId,
  clients,
}: {
  partnerId: string;
  clients: { id: string; restaurantName: string }[];
}) {
  const t = useTranslations("control.admin.commissionForm");
  const [state, action, pending] = useActionState<AdminActionState, FormData>(
    addCommissionAction,
    {},
  );

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="partnerId" value={partnerId} />
      <input
        name="amount"
        type="number"
        step="0.01"
        required
        placeholder={t("amount")}
        aria-label={t("amountAria")}
        className="input-primary"
      />
      <select name="clientId" aria-label={t("clientAria")} className="input-primary" defaultValue="">
        <option value="">{t("noClient")}</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.restaurantName}
          </option>
        ))}
      </select>
      <input
        name="note"
        required
        maxLength={500}
        placeholder={t("note")}
        aria-label={t("noteAria")}
        className="input-primary sm:col-span-2"
      />
      <div className="sm:col-span-2 flex items-center gap-4">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? t("recording") : t("record")}
        </button>
        {state.ok && (
          <span className="font-label text-craft-success-text dark:text-craft-success">
            {t("recorded")}
          </span>
        )}
        <ActionError code={state.error} />
      </div>
    </form>
  );
}
