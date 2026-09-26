import { NextResponse } from "next/server";
import { cataloguePool } from "@/lib/catalogue/db";
import {
  badQueryResponse,
  catalogueRequestIsLimited,
  logCatalogueReadFailure,
  rateLimitedResponse,
  unavailableResponse,
} from "@/lib/catalogue/http";
import { queryPublishedPage } from "@/lib/catalogue/list-query";
import {
  decodeCatalogueCursor,
  encodeCatalogueCursor,
  parseCatalogueFilters,
} from "@/lib/catalogue/query";
import { toSummary } from "@/lib/catalogue/row";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (catalogueRequestIsLimited(request)) return rateLimitedResponse();

  const url = new URL(request.url);
  const parsed = parseCatalogueFilters(url.searchParams);
  if (!parsed.success) return badQueryResponse();

  const cursor = decodeCatalogueCursor(url.searchParams.get("cursor"), parsed.filters);
  if (!cursor.valid) return badQueryResponse();

  const pool = cataloguePool();
  if (!pool) return unavailableResponse();

  try {
    const rows = await queryPublishedPage(pool, parsed.filters, cursor.templateId);
    const hasMore = rows.length > parsed.filters.limit;
    const pageRows = rows.slice(0, parsed.filters.limit);
    const lastRow = pageRows.at(-1);
    return NextResponse.json(
      {
        items: pageRows.map((row) => toSummary(row, parsed.filters.locale)),
        nextCursor: hasMore && lastRow
          ? encodeCatalogueCursor(lastRow.template_id, parsed.filters)
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logCatalogueReadFailure(error);
    return unavailableResponse();
  }
}
