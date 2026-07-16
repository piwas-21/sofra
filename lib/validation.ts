import { z } from "zod";

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
  restaurantName: z.string().trim().min(1).max(200),
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
