import { describe, expect, it } from "vitest";
import {
  CURRENT_BATCH_BODY_MAX_BYTES,
  CURRENT_BATCH_LIMIT,
  parseCurrentBatch,
  readBoundedBatchBody,
} from "@/lib/catalogue/current-batch";

describe("catalogue current batch request", () => {
  it("accepts a bounded set of distinct template IDs with adopted revisions", () => {
    const items = [{ templateId: "tr-kofte", adoptedRevision: 2 }];
    expect(parseCurrentBatch({ items })).toEqual(items);
    expect(parseCurrentBatch({ items: Array.from({ length: CURRENT_BATCH_LIMIT }, (_, index) => ({
      templateId: `template-${index}`,
      adoptedRevision: 1,
    })) })).toHaveLength(CURRENT_BATCH_LIMIT);
  });

  it("rejects duplicate, malformed, oversized and extra-field requests", () => {
    const item = { templateId: "tr-kofte", adoptedRevision: 1 };
    expect(parseCurrentBatch({ items: [item, item] })).toBeNull();
    expect(parseCurrentBatch({ items: [{ ...item, adoptedRevision: 0 }] })).toBeNull();
    expect(parseCurrentBatch({ items: [{ ...item, templateId: "../private" }] })).toBeNull();
    expect(parseCurrentBatch({ items: [{ ...item, extra: "ignored" }] })).toBeNull();
    expect(parseCurrentBatch({ items: [] })).toBeNull();
    expect(parseCurrentBatch({ items: Array.from({ length: CURRENT_BATCH_LIMIT + 1 }, (_, index) => ({
      templateId: `template-${index}`,
      adoptedRevision: 1,
    })) })).toBeNull();
  });

  it("rejects an oversized streaming body before parsing JSON", async () => {
    const request = new Request(import.meta.url, {
      method: "POST",
      body: " ".repeat(CURRENT_BATCH_BODY_MAX_BYTES + 1),
    });
    await expect(readBoundedBatchBody(request)).rejects.toThrow(RangeError);
  });
});
