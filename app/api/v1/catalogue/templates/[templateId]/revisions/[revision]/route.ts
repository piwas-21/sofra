import { NextResponse } from "next/server";
import { cataloguePool } from "@/lib/catalogue/db";
import {
  catalogueRequestIsLimited,
  logCatalogueReadFailure,
  rateLimitedResponse,
  revisionSelect,
  unavailableResponse,
} from "@/lib/catalogue/http";
import type { PublishedRevisionRow } from "@/lib/catalogue/row";
import { toRevision } from "@/lib/catalogue/row";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public by design: this returns one immutable, reviewed revision from the global
 * curated catalogue. The reader-only database role exposes only published views;
 * the endpoint contains no tenant data and performs no writes.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ templateId: string; revision: string }> },
) {
  if (catalogueRequestIsLimited(request)) return rateLimitedResponse();
  const { templateId, revision: revisionText } = await context.params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateId) || !/^[1-9]\d*$/.test(revisionText)) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const revision = Number(revisionText);
  if (!Number.isSafeInteger(revision) || revision > 2_147_483_647) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const pool = cataloguePool();
  if (!pool) return unavailableResponse();
  try {
    const result = await pool.query<PublishedRevisionRow>(
      revisionSelect + " WHERE template_id = $1 AND revision = $2",
      [templateId, revision],
    );
    const row = result.rows[0];
    if (row?.quality_status !== "reviewed") {
      return NextResponse.json(
        { error: "not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(toRevision(row), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logCatalogueReadFailure(error);
    return unavailableResponse();
  }
}
