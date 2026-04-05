import { describe, expect, it } from "vitest";

import type { TaskJob } from "@/lib/api";

import { formatRequestFailureMessage, formatTaskFailureMessage } from "./taskFeedback";

describe("taskFeedback", () => {
  it("includes model fallback details in task failure message", () => {
    const message = formatTaskFailureMessage(
      {
        id: "job_1",
        task_type: "asset.generate",
        status: "failed",
        queue_name: "image",
        priority: 50,
        attempt_count: 1,
        max_attempts: 2,
        created_at: Date.now(),
        error_message: "模型调用失败",
        result_json: {
          requested_model: "wan2.6-t2i",
          resolved_model: "wan2.5-t2i-preview",
          fallback_reason: "模型 wan2.6-t2i 当前不可用，系统已回退到可运行模型 wan2.5-t2i-preview",
        },
      } as TaskJob,
      "生成失败",
    );

    expect(message).toContain("模型调用失败");
    expect(message).toContain("请求模型：wan2.6-t2i");
    expect(message).toContain("实际执行：wan2.5-t2i-preview");
    expect(message).toContain("系统已回退到可运行模型");
  });

  it("falls back to generic request error message", () => {
    const error = new Error("网络异常");
    expect(formatRequestFailureMessage(error, "提交失败")).toBe("网络异常");
  });
});
