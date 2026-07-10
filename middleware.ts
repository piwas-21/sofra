import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Skip api routes, Next internals, files with an extension, and the control
  // plane (login/invite/reset/forgot/dashboard/admin/billing) — it lives
  // outside [locale], follows the NEXT_LOCALE cookie instead (sofra #9), and
  // must not be locale-redirected. /billing/thanks
  // is the Mollie checkout redirect target (S9) — a locale redirect there
  // would break the URL Mollie was given.
  matcher: [
    "/((?!api|_next|_vercel|login|invite|reset|forgot|dashboard|admin|billing|.*\\..*).*)",
  ],
};
