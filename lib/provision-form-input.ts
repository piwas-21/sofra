// The FormData → `TenantProvisionInput` mapping for /admin/provision.
//
// It exists because the bug it was extracted for was INVISIBLE to every test in the
// repo. `openProvisioningPrAction` built its `safeParse` object field by field and
// simply never read `stripeAccount` — the field was on the form, in the schema, and
// consumed downstream by `splitDeferredModules`, so it looked wired from every angle
// except the one that mattered. `buildTenantRegistryEntry`'s unit tests were green
// throughout, because they hand the builder an input object directly and the mapping
// that produces that object had no tests at all.
//
// So this is the seam, and it is deliberately the WHOLE path from a browser's fields to
// the exact object handed to `openProvisioningPr` — schema, list splitting, base-domain
// normalization, all of it. A test can now construct a FormData and assert what the
// generator would emit, which is the only shape of test that would have caught the
// original omission.
//
// Pure: no DB, no network, no env, no guards. Everything that decides whether the
// proposal may HAPPEN (requireAdmin, the slug verdict, the O2 payment gate, the GitHub
// call) stays in the action, because none of it is a mapping question.

import { normalizeBaseDomain } from "./base-domain";
import type { TenantProvisionInput } from "./provisioning-registry";
import { splitCsvLower } from "./validation";
import { provisionSchema } from "./validation-provision";

/** `error` is either a `control.errors` key or a raw Zod issue message; both render. */
export type ProvisionFormResult =
  | { ok: true; input: TenantProvisionInput }
  | { ok: false; error: string };

/** Collapse a repeated (checkbox-group) form field into the comma list the
 *  schema validates, dropping any non-string entry. */
const csvField = (formData: FormData, name: string): string =>
  formData
    .getAll(name)
    .filter((v): v is string => typeof v === "string")
    .join(",");

/**
 * An OPTIONAL text field, read as "" when the form did not send it.
 *
 * `formData.get()` returns `null` for a field that is absent, and `z.string().optional()`
 * accepts `undefined`, not `null` — so an absent optional field fails the WHOLE parse
 * with "Invalid input", naming nothing. That is not theoretical: every time a field is
 * added here, a browser still holding the previous bundle posts without it, and a
 * no-JS submit posts exactly the fields that were in the HTML it rendered. `baseDomain`
 * would have made every such POST fail entirely rather than fall back to the default it
 * is documented to have.
 *
 * A `File` becomes "" for the same reason `csvField` drops one: `String(file)` is
 * "[object Object]", which would sail into the registry as a value somebody typed.
 */
const optionalField = (formData: FormData, name: string): string => {
  const raw = formData.get(name);
  return typeof raw === "string" ? raw : "";
};

export function readProvisionForm(formData: FormData): ProvisionFormResult {
  const parsed = provisionSchema.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name"),
    adminEmail: formData.get("adminEmail"),
    template: formData.get("template"),
    currency: formData.get("currency"),
    // Checkbox groups: several values under one name, so getAll + join — a
    // plain get() would silently take the FIRST box and provision a tenant
    // missing everything else that was ticked. getAll can also yield File
    // entries on a crafted multipart POST, which would stringify to
    // "[object Object]" and sail into the registry; keep strings only.
    languages: csvField(formData, "languages"),
    modules: csvField(formData, "modules"),
    city: optionalField(formData, "city"),
    // NOT optional to remember. Every field the form posts is read here, and this file
    // is the one place where "the form has it and the action does not" can be seen at a
    // glance — which is precisely what went wrong with `stripeAccount`, back when that
    // was a field at all.
    baseDomain: optionalField(formData, "baseDomain"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "invalidInput" };
  const data = parsed.data;

  const languages = splitCsvLower(data.languages);
  const modules = splitCsvLower(data.modules);
  if (languages.length === 0 || modules.length === 0) return { ok: false, error: "invalidInput" };

  // Empty stays undefined all the way down, which is what makes an absent
  // `base_domain:` the unchanged default rather than a value anyone had to choose.
  const baseDomain = data.baseDomain ? normalizeBaseDomain(data.baseDomain) : undefined;

  return {
    ok: true,
    input: {
      slug: data.slug,
      name: data.name,
      adminEmail: data.adminEmail.toLowerCase(),
      template: data.template,
      currency: data.currency,
      languages,
      modules,
      // No `stripeAccount`: it is not a form field any more. Under the ADR-011
      // amendment the control plane MINTS the tenant's connected account
      // (lib/provisioning-mint.ts) and the ACTION attaches the result, so the
      // mapping from a browser's fields cannot carry it and cannot drop it.
      // Re-normalized rather than passed through: the schema only ASKED whether the
      // value is a usable base domain, and the answer it validated is a different
      // string from the one it was handed (a pasted scheme, a trailing dot). The
      // registry must carry the canonical form, because a slug is concatenated onto it.
      baseDomain: baseDomain?.ok ? baseDomain.domain : undefined,
      city: data.city || undefined,
    },
  };
}
