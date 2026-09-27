import { NextResponse } from "next/server";
import { cataloguePool } from "@/lib/catalogue/db";
import { CATALOGUE_REVISION_MAX, CATALOGUE_TEMPLATE_ID_MAX_LENGTH } from "@/lib/catalogue/query";
import {
  badQueryResponse,
  catalogueRequestLimitResponse,
  logCatalogueReadFailure,
  unavailableResponse,
} from "@/lib/catalogue/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CurrentStatusRow = {
  template_id: string;
  revision: number | null;
  content_hash: string | null;
  withdrawn: boolean;
  adopted_revision_withdrawn: boolean | null;
};

/** Status of a previously published template, including explicit withdrawal. */
export async function GET(
  request: Request,
  context: { params: Promise<{ templateId: string }> },
) {
  const limitResponse = catalogueRequestLimitResponse(request);
  if (limitResponse) return limitResponse;

  const { templateId } = await context.params;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(templateId)
    || templateId.length > CATALOGUE_TEMPLATE_ID_MAX_LENGTH) {
    return NextResponse.json(
      { error: "not_found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "adoptedRevision")
    || params.getAll("adoptedRevision").length > 1) return badQueryResponse();
  const revisionText = params.get("adoptedRevision");
  if (revisionText !== null && !/^[1-9]\d*$/.test(revisionText)) return badQueryResponse();
  const adoptedRevision = revisionText !== null ? Number(revisionText) : null;
  if (adoptedRevision !== null
    && (!Number.isSafeInteger(adoptedRevision) || adoptedRevision > CATALOGUE_REVISION_MAX)) {
    return badQueryResponse();
  }

  const pool = cataloguePool();
  if (!pool) return unavailableResponse();
  try {
    const result = await pool.query<CurrentStatusRow>(
      [
        "SELECT current.template_id, current.revision, current.content_hash, current.withdrawn,",
        "(SELECT status.withdrawn FROM catalogue.public_revision_status AS status",
        " WHERE status.template_id = current.template_id AND status.revision = $2::integer)",
        " AS adopted_revision_withdrawn",
        "FROM catalogue.public_current_status AS current WHERE current.template_id = $1",
      ].join(" "),
      [templateId, adoptedRevision],
    );
    const row = result.rows[0];
    if (!row) {
      return NextResponse.json(
        { error: "not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json({
      templateId: row.template_id,
      revision: row.revision,
      contentHash: row.content_hash?.trim() ?? null,
      withdrawn: row.withdrawn,
      adoptedRevisionWithdrawn: row.adopted_revision_withdrawn,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logCatalogueReadFailure(error);
    return unavailableResponse();
  }
}
