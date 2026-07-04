import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // en first (default); fr for the Geneva market; tr for the brand's roots.
  locales: ["en", "fr", "tr"],
  defaultLocale: "en",
});
