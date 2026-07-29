"use client";

import { useState } from "react";
import { BUNDLES, MODULES, extraLanguageCount, quoteModules, type ModuleId } from "@/lib/module-catalog";
import { TENANT_LANGUAGES } from "@/lib/tenant-options";
import { eur } from "@/lib/format";

/**
 * Module + language pickers for the provisioning form (ADR-010 catalog).
 *
 * These were free-text comma lists, which asked the founder to remember eight
 * exact ids and ten locale codes and rejected them after the fact. Checkboxes
 * carry the same values — the server action reads `getAll` and joins, so the
 * registry entry and the validation are unchanged.
 *
 * The running price is the reason this is a client component: the selection
 * feeds `/admin/onboard`'s amount field, and computing it here means the two
 * numbers come from one source instead of a mental sum.
 */
export default function ProvisionPicker({
  labels,
  initialModules,
  initialLanguages,
}: Readonly<{
  labels: {
    modules: string;
    modulesCore: string;
    languages: string;
    languagesHint: string;
    price: string;
    priceBundle: string;
    priceALaCarte: string;
  };
  /** Module ids from a signup lead (SOFRA-ONBOARDING-PLAN O1). Empty/absent = a
   *  blank form. Filtered below rather than by the caller, because which ids this
   *  component actually manages is its own business. */
  initialModules?: readonly ModuleId[];
  /** Tenant locales from a signup lead. Empty/absent keeps the en+nl default. */
  initialLanguages?: readonly string[];
}>) {
  // `core` and `extra-languages` are excluded because this state models the
  // CHECKBOXES only: core rides a hidden input and extra-languages is DERIVED
  // from the language count below. Seeding either here would put a value in
  // state that no rendered input corresponds to — harmless today (`quoteModules`
  // dedupes, and neither id has a checkbox to desynchronise) but a latent trap
  // the moment someone adds one. Keep the state and the inputs in step.
  const [modules, setModules] = useState<ModuleId[]>(() =>
    (initialModules ?? []).filter((m) => m !== "core" && m !== "extra-languages"),
  );
  // English always ships, so it is forced back in even if a stored list somehow
  // lost it (the picker renders it disabled-and-checked and it must agree).
  const [languages, setLanguages] = useState<string[]>(() =>
    initialLanguages && initialLanguages.length > 0
      ? ["en", ...initialLanguages.filter((l) => l !== "en")]
      : ["en", "nl"],
  );

  const toggle = <T extends string>(list: T[], value: T, on: boolean): T[] =>
    on ? [...list, value] : list.filter((v) => v !== value);

  const extras = extraLanguageCount(languages);
  // The add-on is per-tenant, not per-language: selecting it once covers them
  // all, so the quote takes the flag from the language count.
  const selection: ModuleId[] = extras > 0 ? [...modules, "extra-languages"] : modules;
  const quote = quoteModules(selection);
  const bundle = BUNDLES.find((b) => b.id === quote.bundle);

  return (
    <>
      <fieldset className="sm:col-span-2 border-2 border-border rounded-craft p-3">
        <legend className="font-label px-1 text-sm text-muted-foreground">{labels.modules}</legend>
        {/* Core is mandatory — every instance runs it — so it is stated, not offered,
            and carried by a hidden input because a disabled checkbox submits nothing. */}
        <input type="hidden" name="modules" value="core" />
        <p className="font-label text-sm mb-2">
          {labels.modulesCore} · {eur(MODULES.find((m) => m.id === "core")!.priceCents)}
        </p>
        <div className="grid gap-1 sm:grid-cols-2">
          {MODULES.filter((m) => m.id !== "core" && m.id !== "extra-languages").map((m) => (
            <label key={m.id} className="flex items-start gap-2 font-label text-sm">
              <input
                type="checkbox"
                name="modules"
                value={m.id}
                checked={modules.includes(m.id)}
                onChange={(e) => setModules((prev) => toggle(prev, m.id, e.target.checked))}
                className="mt-1 accent-primary"
              />
              <span>
                <span className="font-bold">{m.id}</span> · {eur(m.priceCents)}
                <br />
                <span className="text-muted-foreground">{m.surface}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="sm:col-span-2 border-2 border-border rounded-craft p-3">
        <legend className="font-label px-1 text-sm text-muted-foreground">{labels.languages}</legend>
        {/* English is the tenant app's fallback locale, so it ships regardless —
            disabled inputs don't submit, hence the hidden one. First in source
            order so the registry list reads en, …. */}
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
              <span>
                {l.label} <span className="text-muted-foreground">({l.code})</span>
              </span>
            </label>
          ))}
        </div>
        {/* Priced AND recorded: the quote adds extra-languages past English + one,
            so the registry entry has to carry it too or the tenant is billed for a
            module their instance was never marked as having. */}
        {extras > 0 && <input type="hidden" name="modules" value="extra-languages" />}
        <p className="font-label text-xs text-muted-foreground mt-2">{labels.languagesHint}</p>
      </fieldset>

      <output className="sm:col-span-2 font-label text-sm">
        <span className="font-bold text-lg text-primary">
          {labels.price}: {eur(quote.monthlyCents)}
        </span>
        {bundle && (
          <span className="text-muted-foreground">
            {" "}
            — {labels.priceBundle} «{bundle.id}»
            {quote.aLaCarteCents > quote.monthlyCents && (
              <> ({labels.priceALaCarte} {eur(quote.aLaCarteCents)})</>
            )}
          </span>
        )}
      </output>
    </>
  );
}
