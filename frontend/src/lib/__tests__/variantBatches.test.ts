import { describe, expect, it } from "vitest";

import { getLatestVariantBatch } from "../variantBatches";

describe("getLatestVariantBatch", () => {
  it("returns only variants from the newest generated batch when batch ids exist", () => {
    const variants = [
      { id: "new-2", url: "oss://new-2", created_at: "2026-04-05T09:00:02Z", batch_id: "batch-new" },
      { id: "new-1", url: "oss://new-1", created_at: "2026-04-05T09:00:01Z", batch_id: "batch-new" },
      { id: "old-4", url: "oss://old-4", created_at: "2026-04-05T08:30:04Z", batch_id: "batch-old" },
      { id: "old-3", url: "oss://old-3", created_at: "2026-04-05T08:30:03Z", batch_id: "batch-old" },
    ];

    expect(getLatestVariantBatch(variants).map((variant) => variant.id)).toEqual(["new-2", "new-1"]);
  });

  it("falls back to the newest four variants when historical data has no batch id", () => {
    const variants = [
      { id: "v5", url: "oss://v5", created_at: "2026-04-05T09:00:05Z" },
      { id: "v4", url: "oss://v4", created_at: "2026-04-05T09:00:04Z" },
      { id: "v3", url: "oss://v3", created_at: "2026-04-05T09:00:03Z" },
      { id: "v2", url: "oss://v2", created_at: "2026-04-05T09:00:02Z" },
      { id: "v1", url: "oss://v1", created_at: "2026-04-05T09:00:01Z" },
    ];

    expect(getLatestVariantBatch(variants).map((variant) => variant.id)).toEqual(["v5", "v4", "v3", "v2"]);
  });
});
