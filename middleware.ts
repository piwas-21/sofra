import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Skip api routes, Next internals, files with an extension, and the en-only
  // control plane (login/invite/reset/forgot/dashboard/admin) — those live
  // outside [locale] and must not be locale-redirected.
  matcher: [
    "/((?!api|_next|_vercel|login|invite|reset|forgot|dashboard|admin|.*\\..*).*)",
  ],
};
