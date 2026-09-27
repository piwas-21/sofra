import { NextResponse } from "next/server";
import { cataloguePool } from "@/lib/catalogue/db";
import {
  parseCurrentBatch,
  queryCurrentBatch,
  readBoundedBatchBody,
} from "@/lib/catalogue/current-batch";
import {
  catalogueRequestLimitResponse,
  logCatalogueReadFailure,
  unavailableResponse,
} from "@/lib/catalogue/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public by design: only published, reviewed revisions from reader-role views; no tenant data or writes. */
export async function POST(request: Request) {
  const limitResponse = catalogueRequestLimitResponse(request);
  if (limitResponse) return limitResponse;

  let items;
  try {
    items = parseCurrentBatch(await readBoundedBatchBody(request));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RangeError ? "body_too_large" : "invalid_body" },
      { status: error instanceof RangeError ? 413 : 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!items) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  const pool = cataloguePool();
  if (!pool) return unavailableResponse();
  try {
    return NextResponse.json(
      { items: await queryCurrentBatch(pool, items) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logCatalogueReadFailure(error);
    return unavailableResponse();
  }
}
