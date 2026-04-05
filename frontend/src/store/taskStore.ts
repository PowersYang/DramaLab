import { create } from "zustand";

import { api, TaskJob, TaskReceipt } from "@/lib/api";


const ACTIVE_TASK_STATUSES = new Set(["queued", "claimed", "running", "retry_waiting", "cancel_requested"]);
const TERMINAL_TASK_STATUSES = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
const DEFAULT_WAIT_TIMEOUT_SECONDS = 1800;
const MIN_WAIT_TIMEOUT_SECONDS = 1800;
const WAIT_TIMEOUT_BUFFER_SECONDS = 120;
const inFlightProjectJobRequests = new Map<string, Promise<TaskJob[]>>();

interface TaskStore {
    jobsById: Record<string, TaskJob>;
    jobIdsByProject: Record<string, string[]>;
    enqueueReceipts: (projectId: string, receipts: TaskReceipt[]) => void;
    upsertJobs: (jobs: TaskJob[]) => void;
    fetchJob: (jobId: string) => Promise<TaskJob>;
    waitForJob: (jobId: string, options?: { intervalMs?: number; maxAttempts?: number }) => Promise<TaskJob>;
    fetchProjectJobs: (projectId?: string, statuses?: string[], options?: { seriesId?: string; limit?: number }) => Promise<TaskJob[]>;
    cancelJob: (jobId: string) => Promise<TaskJob>;
    retryJob: (jobId: string) => Promise<TaskJob>;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
    jobsById: {},
    jobIdsByProject: {},

    enqueueReceipts: (projectId, receipts) => set((state) => {
        const nextJobs = { ...state.jobsById };
        const existingIds = new Set(state.jobIdsByProject[projectId] || []);
        for (const receipt of receipts) {
            nextJobs[receipt.job_id] = {
                id: receipt.job_id,
                task_type: receipt.task_type,
                status: receipt.status,
                queue_name: receipt.queue_name,
                priority: 100,
                project_id: receipt.project_id,
                series_id: receipt.series_id,
                resource_type: receipt.resource_type,
                resource_id: receipt.resource_id,
                attempt_count: 0,
                max_attempts: 2,
                created_at: receipt.created_at,
                payload_json: receipt.source_video_task_id ? { video_task_id: receipt.source_video_task_id } : {},
            };
            existingIds.add(receipt.job_id);
        }
        return {
            jobsById: nextJobs,
            jobIdsByProject: {
                ...state.jobIdsByProject,
                [projectId]: Array.from(existingIds),
            },
        };
    }),

    upsertJobs: (jobs) => set((state) => {
        const nextJobs = { ...state.jobsById };
        const nextIds = { ...state.jobIdsByProject };
        for (const job of jobs) {
            nextJobs[job.id] = job;
            const scopeId = job.project_id || job.series_id;
            if (scopeId) {
                // 中文注释：taskStore 既承接项目任务，也承接系列任务；系列页恢复活跃任务时用 series_id 作为桶键。
                const ids = new Set(nextIds[scopeId] || []);
                ids.add(job.id);
                nextIds[scopeId] = Array.from(ids);
            }
        }
        return { jobsById: nextJobs, jobIdsByProject: nextIds };
    }),

    fetchJob: async (jobId) => {
        const job = await api.getTask(jobId);
        get().upsertJobs([job]);
        return job;
    },

    waitForJob: async (jobId, options) => {
        const intervalMs = options?.intervalMs ?? 1000;
        let job = await get().fetchJob(jobId);

        // 中文注释：默认等待预算按任务 timeout_seconds 推导，并保底 30 分钟，避免长任务在 6 分钟边界被前端误判“卡住”。
        const timeoutSeconds = typeof job.timeout_seconds === "number" && job.timeout_seconds > 0
            ? job.timeout_seconds
            : DEFAULT_WAIT_TIMEOUT_SECONDS;
        const waitBudgetSeconds = Math.max(MIN_WAIT_TIMEOUT_SECONDS, timeoutSeconds + WAIT_TIMEOUT_BUFFER_SECONDS);
        const derivedMaxAttempts = Math.max(1, Math.ceil((waitBudgetSeconds * 1000) / intervalMs));
        const maxAttempts = options?.maxAttempts ?? derivedMaxAttempts;

        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            if (TERMINAL_TASK_STATUSES.has(job.status)) {
                return job;
            }
            await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
            job = await get().fetchJob(jobId);
        }

        if (TERMINAL_TASK_STATUSES.has(job.status) || !ACTIVE_TASK_STATUSES.has(job.status)) {
            return job;
        }

        throw new Error(
            `任务等待超时（job_id=${jobId}, status=${job.status}）。任务仍在后台执行，请到任务面板继续跟踪进度。`,
        );
    },

    fetchProjectJobs: async (projectId, statuses, options) => {
        // 中文注释：同一项目+筛选条件下，多组件可能在同一时刻并发拉取任务列表；这里做 in-flight 合并，避免请求风暴。
        const requestKey = [
            projectId || "",
            options?.seriesId || "",
            statuses?.join(",") || "",
            String(options?.limit ?? ""),
        ].join("|");
        const existingRequest = inFlightProjectJobRequests.get(requestKey);
        if (existingRequest) {
            return existingRequest;
        }

        const requestPromise = (async () => {
            const jobs = await api.listTasks(projectId, statuses, options);
            get().upsertJobs(jobs);

            // 中文注释：仅查询活跃任务时，接口在任务结束后会“消失”该任务。
            // 若本地仍保留旧的 running/queued 状态，会导致页面一直显示“进行中”。
            const requestedActiveOnly = !!statuses?.length && statuses.every((status) => ACTIVE_TASK_STATUSES.has(status));
            if (!requestedActiveOnly) {
                return jobs;
            }

            const scopeId = projectId || options?.seriesId;
            if (!scopeId) {
                return jobs;
            }

            const state = get();
            const fetchedIds = new Set(jobs.map((job) => job.id));
            const staleActiveIds = (state.jobIdsByProject[scopeId] || []).filter((jobId) => {
                const existing = state.jobsById[jobId];
                return !!existing && ACTIVE_TASK_STATUSES.has(existing.status) && !fetchedIds.has(jobId);
            });

            if (staleActiveIds.length === 0) {
                return jobs;
            }

            const refreshed = await Promise.all(
                staleActiveIds.map(async (jobId) => {
                    try {
                        return await api.getTask(jobId);
                    } catch {
                        return null;
                    }
                }),
            );
            const recoveredJobs = refreshed.filter((job): job is TaskJob => !!job);
            if (recoveredJobs.length > 0) {
                get().upsertJobs(recoveredJobs);
            }
            return jobs;
        })();

        inFlightProjectJobRequests.set(requestKey, requestPromise);
        try {
            return await requestPromise;
        } finally {
            inFlightProjectJobRequests.delete(requestKey);
        }
    },

    cancelJob: async (jobId) => {
        const job = await api.cancelTask(jobId);
        get().upsertJobs([job]);
        return job;
    },

    retryJob: async (jobId) => {
        const job = await api.retryTask(jobId);
        get().upsertJobs([job]);
        return job;
    },
}));
