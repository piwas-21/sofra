export interface CatalogueRateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

function positiveInteger(
  name: string,
  rawValue: string | undefined,
): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    throw new Error(`${name} must be configured as a positive safe integer.`);
  }
  const normalized = rawValue.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`${name} must be configured as a positive safe integer.`);
  }

  const value = Number(normalized);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be configured as a positive safe integer.`);
  }
  return value;
}

export function catalogueRateLimitConfig(
  environment: Record<string, string | undefined> = process.env,
): CatalogueRateLimitConfig {
  return {
    maxRequests: positiveInteger(
      "CATALOGUE_READ_RATE_LIMIT_MAX_REQUESTS",
      environment.CATALOGUE_READ_RATE_LIMIT_MAX_REQUESTS,
    ),
    windowMs: positiveInteger(
      "CATALOGUE_READ_RATE_LIMIT_WINDOW_MS",
      environment.CATALOGUE_READ_RATE_LIMIT_WINDOW_MS,
    ),
  };
}
