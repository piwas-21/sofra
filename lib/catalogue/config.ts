export interface CatalogueRateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface CataloguePoolConfig {
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
}

const CATALOGUE_POOL_LIMITS = {
  maxConnections: { minimum: 1, maximum: 10 },
  connectionTimeoutMillis: { minimum: 100, maximum: 60_000 },
  idleTimeoutMillis: { minimum: 1_000, maximum: 600_000 },
} as const;

function positiveInteger(
  name: string,
  rawValue: string | undefined,
): number {
  if (rawValue === undefined || rawValue.trim() === "") {
    throw new TypeError(`${name} must be configured as a positive safe integer.`);
  }
  const normalized = rawValue.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new TypeError(`${name} must be configured as a positive safe integer.`);
  }

  const value = Number(normalized);
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be configured as a positive safe integer.`);
  }
  return value;
}

function boundedInteger(
  name: string,
  rawValue: string | undefined,
  minimum: number,
  maximum: number,
): number {
  const value = positiveInteger(name, rawValue);
  if (value < minimum || value > maximum) {
    throw new TypeError(`${name} must be between ${minimum} and ${maximum}.`);
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

export function cataloguePoolConfig(
  environment: Record<string, string | undefined> = process.env,
): CataloguePoolConfig {
  return {
    max: boundedInteger(
      "CATALOGUE_POOL_MAX",
      environment.CATALOGUE_POOL_MAX,
      CATALOGUE_POOL_LIMITS.maxConnections.minimum,
      CATALOGUE_POOL_LIMITS.maxConnections.maximum,
    ),
    connectionTimeoutMillis: boundedInteger(
      "CATALOGUE_POOL_CONNECTION_TIMEOUT_MS",
      environment.CATALOGUE_POOL_CONNECTION_TIMEOUT_MS,
      CATALOGUE_POOL_LIMITS.connectionTimeoutMillis.minimum,
      CATALOGUE_POOL_LIMITS.connectionTimeoutMillis.maximum,
    ),
    idleTimeoutMillis: boundedInteger(
      "CATALOGUE_POOL_IDLE_TIMEOUT_MS",
      environment.CATALOGUE_POOL_IDLE_TIMEOUT_MS,
      CATALOGUE_POOL_LIMITS.idleTimeoutMillis.minimum,
      CATALOGUE_POOL_LIMITS.idleTimeoutMillis.maximum,
    ),
  };
}
