"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MODULES, BUNDLES, extraLanguageCount, quoteModules, type ModuleId } from "@/lib/module-catalog";
import { TEMPLATES, TENANT_CURRENCIES, TENANT_LANGUAGES } from "@/lib/tenant-options";
import { eur } from "@/lib/format";
import { paymentsModeQuote, type PaymentsMode } from "@/lib/payments-pricing";
import PaymentsModeChoice from "./PaymentsModeChoice";

/**
 * Public product configurator on /signup (SOFRA-ONBOARDING-PLAN O1).
 *
 * The customer picks what they want and sees the price; previously every one of
 * these decisions was typed by the founder at /admin/provision after the fact.
 *
 * Deliberately NOT shared with control/ProvisionPicker: that one is a founder
 * tool showing raw module ids in English, this one is customer-facing in six
 * locales with plain-language names. The two share what actually matters — the
 * catalog and the pricing — via lib/module-catalog, so a price can never diverge
 * between what a lead is quoted and what the founder provisions.
 */
export default function SignupConfigurator() {
  const t = useTranslations("signup.configurator");
  const [modules, setModules] = useState<ModuleId[]>([]);
  const [languages, setLanguages] = useState<string[]>(["en"]);
  const [paymentsMode, setPaymentsMode] = useState<PaymentsMode>("flat");

  const toggle = <T extends string>(list: T[], value: T, on: boolean): T[] =>
    on ? [...list, value] : list.filter((v) => v !== value);

  const extras = extraLanguageCount(languages);
  // The add-on is per-tenant, not per-language: ticking a third language turns it
  // on once and covers them all. Mirrors ProvisionPicker so the two quotes agree.
  const selection: ModuleId[] = extras > 0 ? [...modules, "extra-languages"] : modules;
  const quote = quoteModules(selection);
  const bundle = BUNDLES.find((b) => b.id === quote.bundle);
  const saving = quote.aLaCarteCents - quote.monthlyCents;
  // Meaningless without the module — PaymentsModeChoice reads this to decide
  // whether to render at all, same reading sanitizeSignupConfiguration gives it.
  const hasOnlinePayments = modules.includes("online-payments");
  const total = paymentsModeQuote(quote.monthlyCents, paymentsMode, hasOnlinePayments);

  const optionalModules = MODULES.filter(
    (m) => m.id !== "core" && m.id !== "extra-languages" && m.sellable !== false,
  );

  return (
    <div className="sm:col-span-2 grid gap-4">
      <fieldset className="hand-drawn-border bg-card p-4">
        <legend className="font-label px-1 text-sm text-muted-foreground">{t("modules")}</legend>
        {/* Core ships with every instance, so it is stated rather than offered. A
            disabled checkbox submits nothing, hence the hidden input. */}
        <input type="hidden" name="modules" value="core" />
        <p className="font-label text-sm mb-3">
          <span className="font-bold">{t("module.core")}</span> · {t("included")}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {optionalModules.map((m) => {
            // Hoisted so the label text is written once and the aria-label needs
            // no nested template literal (Sonar S4624).
            const name = t(`module.${m.id}`);
            const price = eur(m.priceCents);
            return (
              <label key={m.id} className="flex items-start gap-2 font-label text-sm">
                <input
                  type="checkbox"
                  name="modules"
                  value={m.id}
                  checked={modules.includes(m.id)}
                  onChange={(e) => setModules((prev) => toggle(prev, m.id, e.target.checked))}
                  // Name and description split explicitly: the visible label is
                  // "name · price / hint", which a screen reader would otherwise
                  // announce as one run-on string.
                  aria-label={`${name} · ${price}`}
                  aria-describedby={`module-hint-${m.id}`}
                  className="mt-1 accent-primary"
                />
                <span>
                  <span className="font-bold">{name}</span> · {price}
                  <br />
                  <span id={`module-hint-${m.id}`} className="text-muted-foreground">
                    {t(`moduleHint.${m.id}`)}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <PaymentsModeChoice
        hasOnlinePayments={hasOnlinePayments}
        mode={paymentsMode}
        onChange={setPaymentsMode}
      />

      <fieldset className="hand-drawn-border bg-card p-4">
        <legend className="font-label px-1 text-sm text-muted-foreground">{t("theme")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {TEMPLATES.map((tpl, i) => (
            <label key={tpl.id} className="flex items-start gap-2 font-label text-sm">
              <input
                type="radio"
                name="template"
                value={tpl.id}
                defaultChecked={i === 0}
                // The label's visible children are a decorative preview image and
                // the swatch (both aria-hidden), so name the control explicitly
                // rather than leaving its accessible name to be inferred around
                // hidden elements.
                aria-label={t(`template.${tpl.id}`)}
                aria-describedby={`template-hint-${tpl.id}`}
                className="mt-1 accent-primary"
              />
              <span>
                {/* A real screenshot beats a colour dot: the choice is baked into
                    the tenant's image at build time, so it is expensive to regret.
                    Decorative — the adjacent name and hint already say which theme
                    this is, and a screenshot has no text worth duplicating to a
                    screen reader. Intrinsic size given so it reserves its space and
                    does not shift the form as it loads. */}
                {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size static asset already optimised to ~15KB; next/image adds a request path for nothing */}
                <img
                  src={tpl.preview}
                  alt=""
                  aria-hidden="true"
                  width={640}
                  height={380}
                  loading="lazy"
                  decoding="async"
                  className="mb-2 w-full h-auto rounded-craft border-2 border-border"
                />
                <span
                  aria-hidden="true"
                  className="inline-block w-3 h-3 rounded-full align-middle mr-1"
                  style={{ backgroundColor: tpl.swatch }}
                />
                <span className="font-bold">{t(`template.${tpl.id}`)}</span>
                <br />
                <span id={`template-hint-${tpl.id}`} className="text-muted-foreground">
                  {t(`templateHint.${tpl.id}`)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="hand-drawn-border bg-card p-4">
        <legend className="font-label px-1 text-sm text-muted-foreground">{t("languages")}</legend>
        {/* English is the tenant app's fallback locale, so it always ships. */}
        <input type="hidden" name="languages" value="en" />
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {TENANT_LANGUAGES.map((l) => (
            <label key={l.code} className="flex items-center gap-2 font-label text-sm">
              <input
                type="checkbox"
                name="languages"
                value={l.code}
                checked={languages.includes(l.code)}
                disabled={l.code === "en"}
                onChange={(e) => setLanguages((prev) => toggle(prev, l.code, e.target.checked))}
                className="accent-primary"
              />
              <span>{l.label}</span>
            </label>
          ))}
        </div>
        {/* Recorded as well as priced: if the quote charges extra-languages, the
            registry entry has to carry it too, or the tenant is billed for a
            module their instance was never marked as having. */}
        {extras > 0 && <input type="hidden" name="modules" value="extra-languages" />}
        <p className="font-label text-xs text-muted-foreground mt-2">{t("languagesHint")}</p>
      </fieldset>

      <fieldset className="hand-drawn-border bg-card p-4">
        <legend className="font-label px-1 text-sm text-muted-foreground">{t("currency")}</legend>
        <div className="flex flex-wrap gap-4">
          {TENANT_CURRENCIES.map((c, i) => (
            <label key={c} className="flex items-center gap-2 font-label text-sm">
              <input
                type="radio"
                name="currency"
                value={c}
                defaultChecked={i === 0}
                className="accent-primary"
              />
              <span>{c}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* Carried so the founder sees what the lead was actually shown; the server
          re-computes it from the catalog AND the payments mode, and never
          trusts this value. */}
      <input type="hidden" name="quotedCents" value={total} />

      <output className="hand-drawn-border bg-card p-4 font-label">
        <span className="font-display font-bold text-3xl text-primary">{eur(total)}</span>
        <span className="text-muted-foreground"> {t("perMonth")}</span>
        {bundle && saving > 0 && (
          <p className="text-sm text-craft-olive-text dark:text-craft-olive-dark mt-1">
            {t("bundleSaving", { bundle: t(`bundle.${bundle.id}`), saving: eur(saving) })}
          </p>
        )}
        <p className="text-xs text-muted-foreground mt-2">{t("priceHint")}</p>
      </output>
    </div>
  );
}
