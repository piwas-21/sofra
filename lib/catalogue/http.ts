import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { catalogueRateLimitConfig } from "@/lib/catalogue/config";

export function catalogueRequestIsLimited(request: Request): boolean {
  const config = catalogueRateLimitConfig();
  return !rateLimit(
    "catalogue-read:" + clientIp(request),
    config.maxRequests,
    config.windowMs,
  );
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
