import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  // en first (default); fr + de for the Swiss market; nl for the home base;
  // tr for the brand's roots; ar for guests and restaurateurs across Europe.
  locales: ["en", "fr", "de", "nl", "tr", "ar"],
  defaultLocale: "en",
});
