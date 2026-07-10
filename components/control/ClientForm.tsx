"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  createClientAction,
  updateClientAction,
  type PartnerActionState,
} from "@/lib/actions/partner-actions";
import ActionError from "./ActionError";

type ClientValues = {
  id?: string;
  restaurantName?: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
};

export default function ClientForm({ client }: { client?: ClientValues }) {
  const t = useTranslations("control.clientForm");
  const isEdit = Boolean(client?.id);
  const [state, action, pending] = useActionState<PartnerActionState, FormData>(
    isEdit ? updateClientAction : createClientAction,
    {},
  );

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      {isEdit && <input type="hidden" name="id" value={client!.id} />}
      <input
        name="restaurantName"
        required
        defaultValue={client?.restaurantName ?? ""}
        placeholder={t("restaurantName")}
        aria-label={t("restaurantNameAria")}
        className="input-primary sm:col-span-2"
      />
      <input
        name="contactName"
        defaultValue={client?.contactName ?? ""}
        placeholder={t("contactName")}
        aria-label={t("contactName")}
        className="input-primary"
      />
      <input
        name="email"
        type="email"
        defaultValue={client?.email ?? ""}
        placeholder={t("email")}
        aria-label={t("email")}
        className="input-primary"
      />
      <input
        name="phone"
        defaultValue={client?.phone ?? ""}
        placeholder={t("phone")}
        aria-label={t("phone")}
        className="input-primary"
      />
      <input
        name="city"
        defaultValue={client?.city ?? ""}
        placeholder={t("city")}
        aria-label={t("city")}
        className="input-primary"
      />
      <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="btn-primary disabled:opacity-60">
          {pending ? t("saving") : isEdit ? t("save") : t("add")}
        </button>
        {state.ok && isEdit && (
          <span className="font-label text-craft-success-text dark:text-craft-success">
            {t("saved")}
          </span>
        )}
        <ActionError code={state.error} />
      </div>
    </form>
  );
}
