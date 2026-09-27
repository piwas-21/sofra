import { NextResponse } from "next/server";
import { cataloguePool } from "@/lib/catalogue/db";
import { requireAdmin } from "@/lib/rbac";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  await requireAdmin();
  const pool = cataloguePool();
  if (!pool) {
    return NextResponse.json(
      { status: "unavailable", dependency: "catalogue", reason: "not_configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await pool.query<{ schema_available: boolean }>(
      "SELECT to_regclass('catalogue.public_current') IS NOT NULL AS schema_available",
    );
    if (!result.rows[0]?.schema_available) {
      return NextResponse.json(
        { status: "unavailable", dependency: "catalogue", reason: "schema_not_migrated" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      {
        status: "ok",
        dependency: "catalogue",
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const kind = error instanceof Error ? error.name : "UnknownError";
    console.error("[catalogue-health] database query failed", { errorType: kind });
    return NextResponse.json(
      { status: "unavailable", dependency: "catalogue", reason: "database_unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
