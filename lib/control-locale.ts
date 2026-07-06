import { cookies } from "next/headers";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";

/**
 * The control plane lives outside [locale] (no locale prefix in its URLs),
 * but its public pages (login / forgot / reset / invite) should follow the
 * language the visitor picked on the marketing site. next-intl's middleware
 * records that choice in the NEXT_LOCALE cookie — read it, fall back to the
 * default locale. Dashboard/admin remain en-only for now (sofra issue #9).
 */
export async function controlLocale(): Promise<string> {
  const cookie = (await cookies()).get("NEXT_LOCALE")?.value;
  return hasLocale(routing.locales, cookie) ? cookie : routing.defaultLocale;
}
