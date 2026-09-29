/** Dated primary-source inventory for the Switzerland/Geneva discovery pages. */
export const DISCOVERY_CONTENT_LAST_CHECKED = "2026-09-30";

export const ALTERNATIVE_PROVIDER_KEYS = ["sofra", "foodAmigos", "lightspeed"] as const;
export const ALTERNATIVE_PROVIDER_SOURCE_KEYS = {
  sofra: ["sofra"],
  foodAmigos: ["gloriafood", "foodAmigos", "foodAmigosPricing"],
  lightspeed: ["lightspeedSwiss", "lightspeedPrices"],
} as const;
export const ALTERNATIVE_FAQ_KEYS = ["endDate", "foodAmigos", "swissPayments"] as const;
export const SWITZERLAND_STEP_KEYS = ["languages", "currency", "qrFlow", "menuData", "rehearsal"] as const;
export const GENEVA_STEP_KEYS = ["language", "menu", "tables", "service", "maintain"] as const;

export const ALTERNATIVES_SOURCES = [
  { key: "gloriafood", url: "https://www.gloriafood.com/" },
  { key: "foodAmigos", url: "https://gloriafood.foodamigos.io/restaurant.html" },
  { key: "foodAmigosPricing", url: "https://gloriafood.foodamigos.io/pricing.html" },
  { key: "sofra", url: "https://sofrapiwas.com/en/signup" },
  { key: "lightspeedSwiss", url: "https://www.lightspeedhq.com/ch/caisse/restaurant/" },
  { key: "lightspeedPrices", url: "https://www.lightspeedhq.com/ch-de/kassensystem/restaurant/preise/" },
] as const;

export const SWITZERLAND_SOURCES = [
  { key: "languages", url: "https://www.aboutswitzerland.eda.admin.ch/en/language" },
  { key: "dialects", url: "https://www.aboutswitzerland.eda.admin.ch/en/languages-and-dialects" },
] as const;

export const GENEVA_SOURCES = [
  { key: "officialLanguage", url: "https://ge.ch/grandconseil/data/texte/QUE01420.pdf" },
  { key: "languages", url: "https://www.aboutswitzerland.eda.admin.ch/en/language" },
] as const;
