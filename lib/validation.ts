import { z } from "zod";

export const applySchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(200).email(),
  company: z.string().trim().max(200).optional().or(z.literal("")),
  city: z.string().trim().max(200).optional().or(z.literal("")),
  message: z.string().trim().min(1).max(2000),
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
