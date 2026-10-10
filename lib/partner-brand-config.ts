import defaults from "@/config/partner-brand-limits.json";

export const PARTNER_BRAND_CONFIG_ENV = {
  applyMaxAttempts: "PARTNER_BRAND_APPLY_MAX_ATTEMPTS",
  applyWindowMs: "PARTNER_BRAND_APPLY_WINDOW_MS",
  sitePageSize: "PARTNER_BRAND_SITE_PAGE_SIZE",
} as const;

type NumericSetting = { default: number; minimum: number; maximum: number };

export class InvalidPartnerBrandConfigError extends Error {
  constructor(readonly variable: string) {
    super(`${variable} must be a positive safe integer within its configured bounds.`);
  }
}

function isValidSetting(setting: NumericSetting): boolean {
  return Number.isSafeInteger(setting.minimum) &&
    Number.isSafeInteger(setting.maximum) &&
    Number.isSafeInteger(setting.default) &&
    setting.minimum > 0 &&
    setting.maximum >= setting.minimum &&
    setting.default >= setting.minimum &&
    setting.default <= setting.maximum;
}

function configuredInteger(
  variable: string,
  raw: string | undefined,
  setting: NumericSetting,
): number {
  if (!isValidSetting(setting)) throw new InvalidPartnerBrandConfigError(variable);
  if (raw === undefined) return setting.default;
  const normalized = raw.trim();
  if (!/^[0-9]+$/.test(normalized)) throw new InvalidPartnerBrandConfigError(variable);
  const value = Number(normalized);
  if (
    !Number.isSafeInteger(value) ||
    value < setting.minimum ||
    value > setting.maximum
  ) {
    throw new InvalidPartnerBrandConfigError(variable);
  }
  return value;
}

export type PartnerBrandRuntimeConfig = {
  applyMaxAttempts: number;
  applyWindowMs: number;
  sitePageSize: number;
};

export function partnerBrandRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PartnerBrandRuntimeConfig {
  return {
    applyMaxAttempts: configuredInteger(
      PARTNER_BRAND_CONFIG_ENV.applyMaxAttempts,
      environment[PARTNER_BRAND_CONFIG_ENV.applyMaxAttempts],
      defaults.applyMaxAttempts,
    ),
    applyWindowMs: configuredInteger(
      PARTNER_BRAND_CONFIG_ENV.applyWindowMs,
      environment[PARTNER_BRAND_CONFIG_ENV.applyWindowMs],
      defaults.applyWindowMs,
    ),
    sitePageSize: configuredInteger(
      PARTNER_BRAND_CONFIG_ENV.sitePageSize,
      environment[PARTNER_BRAND_CONFIG_ENV.sitePageSize],
      defaults.sitePageSize,
    ),
  };
}
