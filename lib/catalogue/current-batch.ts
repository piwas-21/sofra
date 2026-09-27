import type { Pool } from "pg";
import { z } from "zod";
import { CATALOGUE_REVISION_MAX, CATALOGUE_TEMPLATE_ID_MAX_LENGTH } from "./query";
import type { PublishedRevisionRow } from "./row";
import { toRevision } from "./row";
import type { TemplateRevisionResponse } from "./types";

export const CURRENT_BATCH_LIMIT = 128;
export const CURRENT_BATCH_BODY_MAX_BYTES = 65_536;

const batchItemSchema = z.strictObject({
  templateId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(CATALOGUE_TEMPLATE_ID_MAX_LENGTH),
  adoptedRevision: z.number().int().min(1).max(CATALOGUE_REVISION_MAX),
});
const batchSchema = z.strictObject({ items: z.array(batchItemSchema).min(1).max(CURRENT_BATCH_LIMIT) });

export type CurrentBatchRequestItem = z.infer<typeof batchItemSchema>;
export type CurrentBatchResultItem = {
  templateId: string;
  status: "available" | "withdrawn" | "notFound";
  revision: TemplateRevisionResponse | null;
  adoptedRevisionWithdrawn: boolean | null;
};

type CurrentBatchRow = {
  template_id: string;
  known_template_id: string | null;
  current_revision: number | null;
  current_content_hash: string | null;
  withdrawn: boolean | null;
  adopted_revision_withdrawn: boolean | null;
  published_revision: PublishedRevisionRow | null;
};

export function parseCurrentBatch(value: unknown): CurrentBatchRequestItem[] | null {
  const parsed = batchSchema.safeParse(value);
  if (!parsed.success) return null;
  const ids = new Set(parsed.data.items.map((item) => item.templateId));
  return ids.size === parsed.data.items.length ? parsed.data.items : null;
}

export async function readBoundedBatchBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing catalogue batch body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > CURRENT_BATCH_BODY_MAX_BYTES) {
        await reader.cancel();
        throw new RangeError("Catalogue batch body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** One reader-role query over published views; draft and tenant tables are never queried. */
export async function queryCurrentBatch(
  pool: Pick<Pool, "query">,
  items: readonly CurrentBatchRequestItem[],
): Promise<CurrentBatchResultItem[]> {
  const result = await pool.query<CurrentBatchRow>([
    "WITH requested AS (",
    " SELECT template_id, adopted_revision, ordinal",
    " FROM unnest($1::text[], $2::integer[]) WITH ORDINALITY AS input(template_id, adopted_revision, ordinal)",
    ")",
    "SELECT requested.template_id, status.template_id AS known_template_id,",
    " status.revision AS current_revision, status.content_hash AS current_content_hash,",
    " status.withdrawn, adopted.withdrawn AS adopted_revision_withdrawn,",
    " row_to_json(published) AS published_revision",
    "FROM requested",
    "LEFT JOIN catalogue.public_current_status AS status ON status.template_id = requested.template_id",
    "LEFT JOIN catalogue.public_revision_status AS adopted",
    " ON adopted.template_id = requested.template_id AND adopted.revision = requested.adopted_revision",
    "LEFT JOIN catalogue.public_current AS published",
    " ON published.template_id = requested.template_id AND published.revision = status.revision",
    "ORDER BY requested.ordinal",
  ].join(" "), [items.map((item) => item.templateId), items.map((item) => item.adoptedRevision)]);
  if (result.rows.length !== items.length) throw new Error("Catalogue batch returned an incomplete result");

  return result.rows.map((row, index) => {
    if (row.template_id !== items[index]?.templateId) throw new Error("Catalogue batch returned an unexpected result");
    if (!row.known_template_id) {
      return { templateId: row.template_id, status: "notFound", revision: null, adoptedRevisionWithdrawn: null };
    }
    if (row.withdrawn) {
      return {
        templateId: row.template_id,
        status: "withdrawn",
        revision: null,
        adoptedRevisionWithdrawn: row.adopted_revision_withdrawn,
      };
    }
    const published = row.published_revision;
    if (published?.quality_status !== "reviewed" ||
      published.revision !== row.current_revision ||
      published.content_hash !== row.current_content_hash?.trim()) {
      throw new Error("Catalogue batch current revision is inconsistent");
    }
    return {
      templateId: row.template_id,
      status: "available",
      revision: toRevision(published),
      adoptedRevisionWithdrawn: row.adopted_revision_withdrawn,
    };
  });
}
