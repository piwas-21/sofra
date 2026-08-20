"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

export interface ProvisionBaseDomainOption {
  domain: string;
  /** Whose zone it is — shown so the founder cannot place a tenant under the wrong
   *  partner's domain by picking a plausible-looking name out of a flat list. */
  partner: string;
}

/**
 * Which zone the new tenant lives under, and what its hostname will therefore be
 * (SOFRA-PARTNER-FLEXIBILITY-PLAN D1).
 *
 * A PICKER rather than a text field: the options are the platform default and the base
 * domains some partner has actually PROVEN control of (`allVerifiedBaseDomains`). A
 * free-text box would let a typo — or an unproven zone — reach a registry PR, and the
 * failure mode is not a validation error but a tenant that stands up without a
 * certificate, because certificates are issued per hostname over HTTP-01 and the name
 * has to answer first.
 *
 * The empty value is the default and is what makes this field free: submitted empty,
 * the generator emits exactly the entry it emitted before this field existed —
 * `<slug>.sofrapiwas.com`, with no `base_domain:` key at all.
 *
 * The preview is the point of the component. `<slug>.<base>` is derived from two fields
 * that sit apart in the form, and the founder is about to open a PR proposing an
 * IMMUTABLE identifier; seeing the resulting hostname before submitting is the cheapest
 * possible place to catch it.
 */
export default function ProvisionDomainField({
  slug,
  options,
}: Readonly<{ slug: string; options: ProvisionBaseDomainOption[] }>) {
  const t = useTranslations("control.admin");
  const [baseDomain, setBaseDomain] = useState("");
  // The placeholder is only ever shown, never submitted — an empty slug fails the
  // form's own `required` + pattern long before the action sees it.
  const hostname = `${slug.trim() || t("provision.baseDomainSlugPlaceholder")}.${
    baseDomain || "sofrapiwas.com"
  }`;

  return (
    <label className="sm:col-span-2 grid gap-1 font-label text-sm text-muted-foreground">
      {t("provision.baseDomain")}
      <select
        name="baseDomain"
        value={baseDomain}
        onChange={(e) => setBaseDomain(e.target.value)}
        aria-label={t("provision.baseDomain")}
        className="input-primary font-mono"
      >
        <option value="">{t("provision.baseDomainOurs")}</option>
        {options.map((o) => (
          <option key={o.domain} value={o.domain}>
            {o.domain} — {o.partner}
          </option>
        ))}
      </select>
      <span>
        {t("provision.baseDomainPreview")} <span className="font-mono">{hostname}</span>
      </span>
      <span>{baseDomain ? t("provision.baseDomainDnsFirst") : t("provision.baseDomainHint")}</span>
    </label>
  );
}
