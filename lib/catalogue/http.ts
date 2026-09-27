import { NextResponse } from "next/server";
import { clientIpFromXff, rateLimit } from "@/lib/rate-limit";
import { catalogueRateLimitConfig, type CatalogueRateLimitConfig } from "@/lib/catalogue/config";

export function catalogueRequestLimitResponse(
  request: Pick<Request, "headers">,
  environment: Record<string, string | undefined> = process.env,
): NextResponse | null {
  let config: CatalogueRateLimitConfig;
  try {
    config = catalogueRateLimitConfig(environment);
  } catch {
    console.error("[catalogue-read] rate-limit configuration is invalid");
    return unavailableResponse();
  }

  return rateLimit(
    "catalogue-read:" + clientIpFromXff(request.headers.get("x-forwarded-for")),
    config.maxRequests,
    config.windowMs,
  ) ? null : rateLimitedResponse();
}

export function rateLimitedResponse(): NextResponse {
  return NextResponse.json(
    { error: "rate_limited" },
    { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } },
  );
}

export function unavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "catalogue_unavailable" },
    { status: 503, headers: { "Retry-After": "30", "Cache-Control": "no-store" } },
  );
}

export function badQueryResponse(): NextResponse {
  return NextResponse.json({ error: "invalid_query" }, { status: 400, headers: { "Cache-Control": "no-store" } });
}

export const revisionSelect = [
  "SELECT template_id, revision, schema_version, type::text, name, description,",
  "cuisines, source_locale, translations, locale_fallbacks, dependencies,",
  "provenance, quality_status::text, compatible_tenant_contract_versions,",
  "payload, content_hash",
  "FROM catalogue.public_revision",
].join(" ");

export function logCatalogueReadFailure(error: unknown): void {
  const kind = error instanceof Error ? error.name : "UnknownError";
  console.error("[catalogue-read] database query failed", { errorType: kind });
}
