import { z } from "zod";
import { isHttpsUrl } from "@/lib/partner-brand";

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  url: z.string().trim().refine(isHttpsUrl),
  email: z.email(),
});

/** Runtime platform defaults are configured on the box, never copied from a legal record. */
export function platformTenantBranding() {
  return schema.parse({
    name: process.env.SOFRA_BRAND_NAME ?? "",
    url: process.env.SOFRA_BRAND_URL ?? "",
    email: process.env.SOFRA_BRAND_EMAIL ?? "",
  });
}
