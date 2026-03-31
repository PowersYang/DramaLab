import { describe, expect, it } from "vitest";

import { filterVideoQueueJobs, getVideoTaskTypeLabel, isVideoQueueTaskType } from "@/lib/videoTaskQueue";
import type { TaskJob } from "@/lib/api";

function makeJob(taskType: string): TaskJob {
    return {
        id: `${taskType}-job`,
        task_type: taskType,
        status: "queued",
        queue_name: "default",
        priority: 100,
        attempt_count: 0,
        max_attempts: 2,
        created_at: "2026-03-31T00:00:00Z",
    };
}

describe("videoTaskQueue", () => {
    it("只把视频页相关任务识别为队列任务", () => {
        expect(isVideoQueueTaskType("video.generate.frame")).toBe(true);
        expect(isVideoQueueTaskType("video.generate.asset")).toBe(true);
        expect(isVideoQueueTaskType("video.polish_prompt")).toBe(true);
        expect(isVideoQueueTaskType("storyboard.analyze")).toBe(false);
        expect(isVideoQueueTaskType("asset.generate")).toBe(false);
    });

    it("会过滤掉非视频链路任务", () => {
        const jobs = [
            makeJob("storyboard.analyze"),
            makeJob("video.generate.frame"),
            makeJob("video.polish_prompt"),
            makeJob("asset.generate"),
        ];

        expect(filterVideoQueueJobs(jobs).map((job) => job.task_type)).toEqual([
            "video.generate.frame",
            "video.polish_prompt",
        ]);
    });

    it("为视频任务返回稳定中文标签", () => {
        expect(getVideoTaskTypeLabel("video.generate.project")).toBe("项目视频生成");
        expect(getVideoTaskTypeLabel("video.generate.asset")).toBe("资产视频生成");
        expect(getVideoTaskTypeLabel("video.polish_r2v_prompt")).toBe("R2V 提示词润色");
        expect(getVideoTaskTypeLabel("unknown.task")).toBe("unknown.task");
    });
});
