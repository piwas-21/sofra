/**
 * Single source of truth for FAQ entries: FaqSection (visible copy) and
 * JsonLd's FAQPage markup both iterate these keys against the `faq.items.*`
 * messages, so the structured data can never drift from what's on the page.
 */
export const FAQ_KEYS = [
  "what",
  "pricing",
  "payments",
  "languages",
  "printing",
  "who",
  "domain",
] as const;
