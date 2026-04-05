import { describe, expect, it } from "vitest";

import type { TaskJob } from "@/lib/api";
import { collectTerminalGeneratingTaskKeys } from "@/components/modules/ConsistencyVault";

function buildJob(overrides: Partial<TaskJob>): TaskJob {
  return {
    id: "job-default",
    task_type: "asset.generate",
    status: "queued",
    queue_name: "default",
    priority: 100,
    attempt_count: 0,
    max_attempts: 2,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("collectTerminalGeneratingTaskKeys", () => {
  it("collects terminal scene and prop generation keys for current project assets", () => {
    const jobsById: Record<string, TaskJob> = {
      job_scene_done: buildJob({
        id: "job_scene_done",
        status: "succeeded",
        task_type: "asset.generate",
        resource_id: "scene-1",
        payload_json: { generation_type: "all", batch_size: 2 },
      }),
      job_prop_video_failed: buildJob({
        id: "job_prop_video_failed",
        status: "failed",
        task_type: "asset.motion_ref.generate",
        resource_id: "prop-1",
        payload_json: { asset_type: "prop" },
      }),
    };

    const keys = collectTerminalGeneratingTaskKeys(
      jobsById,
      ["job_scene_done", "job_prop_video_failed"],
      new Set(["scene-1", "prop-1"]),
    );

    expect(keys).toEqual(expect.arrayContaining(["scene-1:all", "prop-1:video_prop"]));
    expect(keys).toHaveLength(2);
  });

  it("ignores active statuses, unknown task types, and out-of-scope assets", () => {
    const jobsById: Record<string, TaskJob> = {
      job_running: buildJob({
        id: "job_running",
        status: "running",
        task_type: "asset.generate",
        resource_id: "scene-1",
        payload_json: { generation_type: "all" },
      }),
      job_unknown_task: buildJob({
        id: "job_unknown_task",
        status: "succeeded",
        task_type: "series.assets.extract",
        resource_id: "scene-1",
      }),
      job_other_asset: buildJob({
        id: "job_other_asset",
        status: "succeeded",
        task_type: "asset.generate",
        resource_id: "scene-999",
        payload_json: { generation_type: "all" },
      }),
    };

    const keys = collectTerminalGeneratingTaskKeys(
      jobsById,
      ["job_running", "job_unknown_task", "job_other_asset"],
      new Set(["scene-1"]),
    );

    expect(keys).toEqual([]);
  });
});
