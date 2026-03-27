import { create } from "zustand";

import { api, TaskJob, TaskReceipt } from "@/lib/api";


interface TaskStore {
    jobsById: Record<string, TaskJob>;
    jobIdsByProject: Record<string, string[]>;
    enqueueReceipts: (projectId: string, receipts: TaskReceipt[]) => void;
    upsertJobs: (jobs: TaskJob[]) => void;
    fetchJob: (jobId: string) => Promise<TaskJob>;
    waitForJob: (jobId: string, options?: { intervalMs?: number; maxAttempts?: number }) => Promise<TaskJob>;
    fetchProjectJobs: (projectId: string, statuses?: string[]) => Promise<TaskJob[]>;
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
            if (job.project_id) {
                const ids = new Set(nextIds[job.project_id] || []);
                ids.add(job.id);
                nextIds[job.project_id] = Array.from(ids);
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
        const maxAttempts = options?.maxAttempts ?? 180;
        let job = await get().fetchJob(jobId);
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            if (["succeeded", "failed", "cancelled", "timed_out"].includes(job.status)) {
                return job;
            }
            await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
            job = await get().fetchJob(jobId);
        }
        return job;
    },

    fetchProjectJobs: async (projectId, statuses) => {
        const jobs = await api.listTasks(projectId, statuses);
        get().upsertJobs(jobs);
        return jobs;
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
