import { z } from "zod";

/** Split a comma-separated form field into trimmed, lowercased, non-empty values.
 *  Shared so the schema validates exactly the list the action goes on to send. */
export const splitCsvLower = (raw: string): string[] =>
  raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** No line breaks or control characters.
 *
 *  A tenant's display name reaches three formats where a newline changes meaning: the
 *  registry YAML (safe on its own — `yaml.stringify` quotes it), the provisioning PR body
 *  (a newline breaks the fence around the fallback shell command), and — through the
 *  registry — `build-tenant-image.yml`'s `build-args:`, which is a NEWLINE-DELIMITED list,
 *  so a second line there injects a build arg into the tenant's own bundle.
 *
 *  It lived only on `provisionSchema` while the founder form was the only way in. O3's
 *  payment-triggered proposal reaches `openProvisioningPr` from the PUBLIC intake without
 *  passing through that form, so the guard has to be at the intake edge too or the
 *  unattended path is the one place nothing checks. `trim()` is not enough — it strips
 *  only the ends. */
export const noControlChars = <T extends z.ZodType<string>>(schema: T) =>
  schema.refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "no line breaks or control characters");

export const applySchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(200).email(),
  company: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().max(200).optional().or(z.literal("")),
  message: z.string().trim().min(1).max(2000),
  locale: z.string().max(5).default("en"),
});

// Direct restaurant signup intake (ADR-004 self-serve v1). Public form; the
// founder converts leads via /admin/onboard. desiredSlug is optional but, when
// given, must match the registry grammar (same as billing/onboard) so we don't
// capture garbage the founder then has to clean up.
export const signupSchema = z.object({
  // Guarded because this becomes the registry `name:` for a self-serve tenant (O3).
  restaurantName: noControlChars(z.string().trim().min(1).max(200)),
  contactName: z.string().trim().min(1).max(200),
  email: z.string().trim().max(200).email(),
  phone: z.string().trim().max(50).optional().or(z.literal("")),
  city: z.string().trim().max(200).optional().or(z.literal("")),
  desiredSlug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,30}$/, "lowercase slug, 2-31 chars")
    .optional()
    .or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
  locale: z.string().max(5).default("en"),

  // --- Configurator answers (SOFRA-ONBOARDING-PLAN O1) ---
  // Comma-separated, matching the registry grammar. Bounded so a crafted POST
  // cannot stuff the column; the *contents* are validated against the catalog in
  // the route, which is where an unknown id can be dropped rather than 400ing a
  // real lead over a stale client bundle.
  // All optional: a lead can submit the plain form (or an older cached bundle)
  // with none of these, and still be a valid signup.
  modules: z.string().trim().max(300).optional().or(z.literal("")),
  languages: z.string().trim().max(100).optional().or(z.literal("")),
  template: z.string().trim().max(30).optional().or(z.literal("")),
  currency: z.string().trim().max(3).optional().or(z.literal("")),
  // Coerced because it rides the form as a string. Never trusted — the route
  // re-quotes from the catalog and stores its own number.
  quotedCents: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

export const clientSchema = z.object({
  restaurantName: z.string().trim().min(1).max(200),
  contactName: z.string().trim().max(200).optional().or(z.literal("")),
  email: z.string().trim().max(200).email().optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional().or(z.literal("")),
  city: z.string().trim().max(200).optional().or(z.literal("")),
});

// Statuses a PARTNER may set directly. ONBOARDING is reached via the
// "request onboarding" action; LIVE/CHURNED are ADMIN-only.
export const PARTNER_STATUSES = ["LEAD", "CONTACTED", "DEMO_SCHEDULED", "AGREED"] as const;
export const partnerStatusSchema = z.enum(PARTNER_STATUSES);

// Target statuses an ADMIN may move a signup lead to (NEW is the initial state,
// set on intake, and is never a valid transition target).
export const SIGNUP_STATUSES = ["CONTACTED", "CONVERTED", "DECLINED"] as const;
export const signupStatusSchema = z.enum(SIGNUP_STATUSES);

export const noteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export const commissionSchema = z.object({
  partnerId: z.string().min(1),
  clientId: z.string().optional().or(z.literal("")),
  // Accept "120.50" style input in EUR; stored as cents.
  amount: z.coerce.number().finite().gt(-100_000).lt(100_000),
  note: z.string().trim().min(1).max(500),
});

// Mollie tenant billing (S9). Slug mirrors the registry grammar enforced by
// provision-tenant.sh; amount is EUR ("129.00" style), stored as cents.
export const billingSchema = z.object({
  tenantSlug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,30}$/, "lowercase slug, 2-31 chars"),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(200).email(),
  description: z.string().trim().min(1).max(200),
  amount: z.coerce.number().finite().gt(0).lt(100_000),
  interval: z.enum(["month", "quarter", "year"]),
});

// Onboard a referred partner as the reseller payer for a tenant. Admin sets the
// price/interval/go-live; the partner completes the payment (SOFRA-PARTNER-PLAN,
// reseller flow). amount is EUR, stored as cents; liveSince is a plain date.
export const onboardSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(200).email(),
  tenantSlug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,30}$/, "lowercase slug, 2-31 chars"),
  restaurantName: z.string().trim().min(1).max(200),
  amount: z.coerce.number().finite().gt(0).lt(100_000),
  interval: z.enum(["month", "quarter", "year"]),
  liveSince: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date as YYYY-MM-DD")
    // Reject an impossible calendar date. A plain `new Date("2026-02-31…")` does
    // NOT return Invalid Date — JS silently ROLLS OVER (Feb 31 -> Mar 3), so an
    // isNaN check wouldn't catch it and we'd store the wrong day. Round-trip
    // instead: reconstruct the date and require it to equal what was typed.
    .refine((v) => {
      const [y, m, d] = v.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      // NaN guard first: this refine still runs when the format regex failed
      // (e.g. ""), and toISOString() throws on an Invalid Date.
      return !Number.isNaN(dt.getTime()) && dt.toISOString().slice(0, 10) === v;
    }, "not a real calendar date")
    .optional()
    .or(z.literal("")),
});
