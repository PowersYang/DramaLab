import type { TaskJob } from "@/lib/api";

// 中文注释：视频页任务队列只展示视频生成链路自身的任务，避免把 storyboard 等其它阶段任务混进来。
export const VIDEO_QUEUE_TASK_TYPES = [
    "video.generate.asset",
    "video.generate.frame",
    "video.generate.project",
    "video.polish_prompt",
    "video.polish_r2v_prompt",
] as const;

const VIDEO_QUEUE_TASK_TYPE_SET = new Set<string>(VIDEO_QUEUE_TASK_TYPES);

export function isVideoQueueTaskType(taskType?: string | null): boolean {
    if (!taskType) {
        return false;
    }
    return VIDEO_QUEUE_TASK_TYPE_SET.has(taskType);
}

export function filterVideoQueueJobs<T extends Pick<TaskJob, "task_type">>(jobs: T[]): T[] {
    return jobs.filter((job) => isVideoQueueTaskType(job.task_type));
}

export function getVideoTaskTypeLabel(taskType: string): string {
    if (taskType === "video.generate.frame") return "分镜视频生成";
    if (taskType === "video.generate.asset") return "资产视频生成";
    if (taskType === "video.generate.project") return "项目视频生成";
    if (taskType === "video.polish_prompt") return "视频提示词润色";
    if (taskType === "video.polish_r2v_prompt") return "R2V 提示词润色";
    return taskType;
}
