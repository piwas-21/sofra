"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { saveBillingIdentityAction, type IdentityActionState } from "@/lib/actions/billing-identity-actions";
import ActionError from "./ActionError";
import VatStatusBadge, { type VatStatusValue } from "./VatStatusBadge";

export type IdentityDefaults = {
  id: string;
  legalName: string;
  tradeName: string | null;
  legalForm: string | null;
  registrationNo: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  countryCode: string;
  billingEmail: string;
  vatNumber: string | null;
  vatStatus: VatStatusValue;
  vatCheckedAt: Date | null;
  vatCheckRef: string | null;
  vatCheckDetail: string | null;
  vatCheckName: string | null;
};

/**
 * The legal entity a tenant's invoices are addressed to (B1).
 *
 * Submitting re-checks the VAT number against VIES when it CHANGED, or when its
 * stored status is not yet settled; see `saveBillingIdentityAction` for why an
 * unchanged, already-answered number is not re-asked, and for the rule that keeps
 * a proven VALID from being erased by an outage.
 *
 * The "re-check" control deliberately lives OUTSIDE this component, in the page:
 * it needs its own <form>, and a nested form is invalid HTML that submits the
 * wrong action.
 */
export default function BillingIdentityForm({
  billingId,
  defaults,
  // The payer's own form (B5) submits the SAME fields to a different guard, so
  // the action is a parameter rather than the component being copied. Copying it
  // would eventually let the two surfaces disagree about the fields an invoice
  // needs — and the one that drifted would be the customer-facing one.
  saveAction = saveBillingIdentityAction,
}: Readonly<{
  billingId: string;
  defaults?: IdentityDefaults;
  saveAction?: (prev: IdentityActionState, formData: FormData) => Promise<IdentityActionState>;
}>) {
  const t = useTranslations("control.admin.identity");
  const [state, action, pending] = useActionState<IdentityActionState, FormData>(saveAction, {});

  const field = (
    name: keyof IdentityDefaults,
    opts: { required?: boolean; type?: string; maxLength?: number; pattern?: string } = {},
  ) => (
    <input
      name={name}
      type={opts.type ?? "text"}
      required={opts.required}
      maxLength={opts.maxLength ?? 200}
      pattern={opts.pattern}
      defaultValue={(defaults?.[name] as string | null) ?? ""}
      placeholder={t(`fields.${name}`)}
      aria-label={t(`fields.${name}`)}
      className="input-primary"
    />
  );

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="billingId" value={billingId} />

      {field("legalName", { required: true })}
      {field("tradeName")}
      {field("legalForm", { maxLength: 100 })}
      {field("registrationNo", { maxLength: 60 })}
      {field("addressLine1", { required: true })}
      {field("addressLine2")}
      {field("postalCode", { required: true, maxLength: 20 })}
      {field("city", { required: true, maxLength: 120 })}
      {/* The single most load-bearing field on this form: it decides the tax
          treatment of every invoice to this party. Uppercased by the schema. */}
      {field("countryCode", { required: true, maxLength: 2, pattern: "[A-Za-z]{2}" })}
      {field("billingEmail", { required: true, type: "email" })}
      {field("vatNumber", { maxLength: 30 })}

      <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </button>
        {/* Rendered ENTIRELY from `defaults`, never from the action's returned
            status. The two disagree for the moment between the action resolving
            and revalidation landing — and a mixed render is the worst of both: a
            fresh label beside the previous check's date and detail, i.e. a badge
            that says INVALID while showing when the number was proven VALID. */}
        {defaults && (
          <VatStatusBadge
            status={defaults.vatStatus}
            checkedAt={defaults.vatCheckedAt}
            evidenced={Boolean(defaults.vatCheckRef)}
            detail={defaults.vatCheckDetail}
            registeredName={defaults.vatCheckName}
          />
        )}
      </div>

      {state.ok && <p className="sm:col-span-2 font-label text-craft-success-text">{t("saved")}</p>}
      <div className="sm:col-span-2">
        <ActionError code={state.error} />
      </div>
    </form>
  );
}
