import { describe, expect, it } from "vitest";

import { formatTaskModelSummary, getTaskModelInfo } from "./taskModelInfo";

describe("taskModelInfo", () => {
  it("formats requested and resolved models when fallback happens", () => {
    const job = {
      id: "job_1",
      task_type: "series.asset.generate",
      status: "succeeded",
      queue_name: "image",
      priority: 50,
      attempt_count: 1,
      max_attempts: 2,
      created_at: Date.now(),
      payload_json: { model_name: "wan2.6-t2i" },
      result_json: {
        requested_model: "wan2.6-t2i",
        resolved_model: "wan2.5-t2i-preview",
        fallback_reason: "模型 wan2.6-t2i 当前不可用，系统已回退到可运行模型 wan2.5-t2i-preview",
      },
    } as any;

    expect(getTaskModelInfo(job)).toEqual({
      requestedModel: "wan2.6-t2i",
      resolvedModel: "wan2.5-t2i-preview",
      fallbackReason: "模型 wan2.6-t2i 当前不可用，系统已回退到可运行模型 wan2.5-t2i-preview",
    });
    expect(formatTaskModelSummary(job)).toBe("请求模型：wan2.6-t2i，实际执行：wan2.5-t2i-preview");
  });

  it("falls back to a single execution model summary when no fallback happened", () => {
    const job = {
      id: "job_2",
      task_type: "video.generate.asset",
      status: "succeeded",
      queue_name: "video",
      priority: 50,
      attempt_count: 1,
      max_attempts: 2,
      created_at: Date.now(),
      payload_json: { requested_model: "wan2.6-i2v" },
      result_json: {
        resolved_model: "wan2.6-i2v",
      },
    } as any;

    expect(formatTaskModelSummary(job)).toBe("执行模型：wan2.6-i2v");
  });
});
