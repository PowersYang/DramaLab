"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, RefreshCw, Copy, Download, Trash2, AlertCircle } from "lucide-react";

import { TaskJob, VideoTask } from "@/lib/api";
import { formatTaskModelSummary, getTaskModelInfo } from "@/lib/taskModelInfo";
import { getAssetUrl } from "@/lib/utils";
import { useTaskStore } from "@/store/taskStore";
import { useBillingGuard } from "@/hooks/useBillingGuard";
import { filterVideoQueueJobs, getVideoTaskTypeLabel } from "@/lib/videoTaskQueue";

interface VideoQueueProps {
    tasks: VideoTask[];
    jobs: TaskJob[];
    onRemix: (task: VideoTask) => void;
}

export default function VideoQueue({ tasks, jobs, onRemix }: VideoQueueProps) {
    const [filter, setFilter] = useState<"all" | "processing" | "completed" | "failed">("all");
    const cancelJob = useTaskStore((state) => state.cancelJob);
    const retryJob = useTaskStore((state) => state.retryJob);
    const { getTaskPrice } = useBillingGuard();
    const videoJobs = filterVideoQueueJobs(jobs);

    const filteredTasks = tasks.filter(t => {
        if (filter === "all") return true;
        if (filter === "processing") return t.status === "pending" || t.status === "processing";
        return t.status === filter;
    }).reverse(); // Newest first

    const filteredJobs = videoJobs.filter((job) => {
        if (filter === "all") return true;
        if (filter === "processing") return ["queued", "claimed", "running", "retry_waiting", "cancel_requested"].includes(job.status);
        if (filter === "failed") return ["failed", "timed_out"].includes(job.status);
        return false;
    }).reverse();

    const processingCount = videoJobs.filter(job => ["queued", "claimed", "running", "retry_waiting", "cancel_requested"].includes(job.status)).length;

    return (
        <div className="video-queue-shell flex h-full flex-col border-l video-workspace-divider">
            {/* Header & Tabs */}
            <div className="video-workspace-divider border-b p-4">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-display font-bold text-slate-900 dark:text-white">任务队列</h3>
                    <div className="video-muted-note flex items-center gap-2 text-xs font-medium">
                        <div className={`h-2 w-2 rounded-full ${processingCount > 0 ? "bg-emerald-500 animate-pulse" : "bg-slate-300 dark:bg-slate-600"}`} />
                        {processingCount > 0 ? "生成中" : "空闲"}
                    </div>
                </div>

                <div className="video-segmented flex gap-1 rounded-xl p-1">
                    {[
                        { id: "all", label: "全部" },
                        { id: "processing", label: "进行中" },
                        { id: "completed", label: "已完成" },
                        { id: "failed", label: "失败" },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setFilter(tab.id as any)}
                            className={`video-segmented-button flex-1 rounded-md py-1.5 text-xs transition-colors ${filter === tab.id
                                ? "video-segmented-button-active font-medium"
                                : ""
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Task List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <AnimatePresence mode="popLayout">
                    {filteredJobs.map((job) => (
                        <JobCard key={job.id} job={job} priceCredits={getTaskPrice(job.task_type)} onCancel={cancelJob} onRetry={retryJob} />
                    ))}
                    {filteredTasks.map((task) => (
                        <TaskCard key={task.id} task={task} priceCredits={getTaskPrice(inferVideoTaskType(task))} onRemix={onRemix} />
                    ))}

                    {filteredTasks.length === 0 && filteredJobs.length === 0 && (
                        <div className="video-muted-note py-10 text-center text-sm">
                            暂无任务
                        </div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

function JobCard({ job, priceCredits, onCancel, onRetry }: { job: TaskJob; priceCredits: number | null; onCancel: (jobId: string) => Promise<TaskJob>; onRetry: (jobId: string) => Promise<TaskJob> }) {
    const isActive = ["queued", "claimed", "running", "retry_waiting", "cancel_requested"].includes(job.status);
    const isFailed = ["failed", "timed_out"].includes(job.status);
    const sourceVideoTaskId = job.payload_json?.video_task_id;
    const modelSummary = formatTaskModelSummary(job);
    const fallbackReason = getTaskModelInfo(job).fallbackReason;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className={`video-card rounded-2xl p-3.5 ${isFailed
                ? "border-rose-200 bg-rose-50/90 dark:border-rose-500/25 dark:bg-rose-500/10"
                : ""
                }`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        {isActive ? <Loader2 size={14} className="animate-spin text-primary" /> : <AlertCircle size={14} className="text-rose-500 dark:text-rose-300" />}
                        <span className="video-helper-text font-mono">#{job.id.slice(0, 8)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-slate-900 dark:text-white">{formatJobLabel(job.task_type, job.status)}</p>
                        {priceCredits != null && (
                            <span className="video-status-badge video-status-badge-warning inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold">
                                消耗 {priceCredits} 算力豆
                            </span>
                        )}
                    </div>
                    <p className="video-helper-text mt-1">
                        {sourceVideoTaskId ? `video_task=${sourceVideoTaskId.slice(0, 8)}` : formatJobType(job.task_type)}
                    </p>
                    {modelSummary ? <p className="video-helper-text mt-1">{modelSummary}</p> : null}
                    {fallbackReason ? <p className="mt-1 text-[11px] leading-5 text-amber-500">{fallbackReason}</p> : null}
                </div>
                <div className="flex gap-2">
                    {isActive && (
                        <button
                            onClick={() => void onCancel(job.id)}
                            className="video-chip-button rounded-lg px-2 py-1 text-xs transition-colors"
                        >
                            取消
                        </button>
                    )}
                    {isFailed && (
                        <button
                            onClick={() => void onRetry(job.id)}
                            className="video-chip-button rounded-lg px-2 py-1 text-xs transition-colors"
                        >
                            重试
                        </button>
                    )}
                </div>
            </div>
        </motion.div>
    );
}

function TaskCard({ task, priceCredits, onRemix }: { task: VideoTask; priceCredits: number | null; onRemix: (t: VideoTask) => void }) {
    const isCompleted = task.status === "completed";
    const isProcessing = task.status === "processing" || task.status === "pending";
    const isFailed = task.status === "failed";

    const getDisplayUrl = (url: string) => {
        return getAssetUrl(url);
    };

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className={`video-card overflow-hidden rounded-2xl transition-all ${isProcessing ? "" :
                isFailed ? "border-rose-200 bg-rose-50/90 dark:border-rose-500/25 dark:bg-rose-500/10" :
                    "hover:border-slate-300 dark:hover:border-white/20"
                }`}
        >
            {/* Processing State (Compact) */}
            {isProcessing && (
                <div className="p-3 flex gap-3 items-center">
                    <div className="video-card-soft relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-xl">
                        {task.image_url ? (
                            <img
                                src={getDisplayUrl(task.image_url)}
                                alt="Input"
                                className="w-full h-full object-cover opacity-60"
                            />
                        ) : (
                            <div className="flex h-full w-full items-center justify-center bg-violet-100 text-[10px] font-bold text-violet-600 dark:bg-violet-900/30 dark:text-violet-300">
                                R2V
                            </div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="animate-spin text-primary" size={16} />
                        </div>
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-1">
                            <span className="video-helper-text font-mono">#{task.id.slice(0, 6)}</span>
                            <span className="text-xs text-primary animate-pulse">
                                {task.status === "pending" ? "排队中" : "生成中..."}
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {priceCredits != null && (
                                <span className="video-status-badge video-status-badge-warning inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold">
                                    消耗 {priceCredits} 算力豆
                                </span>
                            )}
                        </div>
                        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 truncate">{task.prompt}</p>
                    </div>
                </div>
            )}

            {/* Completed State (Detailed) */}
            {isCompleted && (
                <div>
                    {/* Header */}
                    <div className="video-card-soft flex items-center justify-between border-b video-workspace-divider px-3 py-2">
                        <div className="flex items-center gap-2">
                            <span className="video-helper-text font-mono">#{task.id.slice(0, 6)}</span>
                            {priceCredits != null && (
                                <span className="video-status-badge video-status-badge-warning inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold">
                                    消耗 {priceCredits} 算力豆
                                </span>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => onRemix(task)}
                                className="video-inline-button flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors"
                                title="使用此参数重做"
                            >
                                <RefreshCw size={12} /> Remix
                            </button>
                        </div>
                    </div>

                    {/* Visual Comparison */}
                    <div className="flex h-32 relative group">
                        {/* Input Image/Videos (Left) */}
                        <div className="w-1/2 relative border-r border-white/10">
                            {task.image_url ? (
                                <img src={getDisplayUrl(task.image_url)} alt="Input" className="w-full h-full object-cover" />
                            ) : task.reference_video_urls && task.reference_video_urls.length > 0 ? (
                                /* R2V: Show reference video thumbnails */
                                <div className="grid h-full w-full grid-cols-2 gap-0.5 bg-violet-100 dark:bg-violet-900/20">
                                    {task.reference_video_urls.slice(0, 4).map((url, idx) => (
                                        <div key={idx} className="relative bg-black/50 overflow-hidden">
                                            <video
                                                src={getAssetUrl(url)}
                                                className="w-full h-full object-cover"
                                                muted
                                                preload="metadata"
                                            />
                                            <div className="absolute bottom-0.5 left-0.5 rounded bg-violet-600/80 px-1 text-[8px] font-bold text-white">
                                                @{String.fromCharCode(65 + idx)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex h-full w-full items-center justify-center bg-violet-100 text-xs font-bold text-violet-500/80 dark:bg-violet-900/10 dark:text-violet-300/60">
                                    R2V Input
                                </div>
                            )}
                            <div className="video-status-badge absolute top-2 left-2 rounded px-1.5 py-0.5 text-[10px] text-slate-100">Input</div>
                        </div>

                        {/* Output Video (Right) */}
                        <div className="w-1/2 relative bg-black">
                            {task.video_url ? (
                                <video
                                    src={getAssetUrl(task.video_url)}
                                    controls
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-red-500 text-xs">
                                    Error
                                </div>
                            )}
                            <div className="video-status-badge video-status-badge-accent absolute top-2 right-2 rounded px-1.5 py-0.5 text-[10px] text-white">Result</div>
                        </div>
                    </div>

                    {/* Prompt & Actions */}
                    <div className="p-3">
                        <p className="mb-3 cursor-help text-xs text-slate-500 transition-all hover:line-clamp-none dark:text-slate-400 line-clamp-2">
                            {task.prompt}
                        </p>

                        <div className="flex justify-between items-center">
                            <div className="flex gap-2">
                                <button className="video-inline-button rounded p-1.5">
                                    <Copy size={14} />
                                </button>
                                <button className="video-inline-button rounded p-1.5">
                                    <Download size={14} />
                                </button>
                            </div>
                            <button className="rounded p-1.5 text-slate-500 hover:bg-rose-500/10 hover:text-rose-500 dark:text-slate-500 dark:hover:bg-rose-500/20 dark:hover:text-rose-300">
                                <Trash2 size={14} />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Failed State */}
            {isFailed && (
                <div className="p-3">
                    <div className="mb-2 flex items-center gap-2 text-rose-500 dark:text-rose-300">
                        <AlertCircle size={16} />
                        <span className="text-sm font-medium">生成失败</span>
                    </div>
                    {priceCredits != null && (
                        <div className="mb-3">
                            <span className="video-status-badge video-status-badge-warning inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold">
                                消耗 {priceCredits} 算力豆
                            </span>
                        </div>
                    )}
                    <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">未知错误，请重试</p>
                    <button
                        onClick={() => onRemix(task)}
                        className="video-chip-button w-full rounded-lg py-1.5 text-xs transition-colors"
                    >
                        重试任务
                    </button>
                </div>
            )}
        </motion.div>
    );
}

// 视频任务完成后只保留产物对象，这里按是否绑定 frame 来推断对应的计费任务类型。
function inferVideoTaskType(task: VideoTask): string {
    return task.frame_id ? "video.generate.frame" : "video.generate.asset";
}

function formatJobType(taskType: string): string {
    return getVideoTaskTypeLabel(taskType);
}

function formatJobLabel(taskType: string, status: TaskJob["status"]): string {
    const label = formatJobType(taskType);
    if (["queued", "claimed", "running", "retry_waiting", "cancel_requested"].includes(status)) {
        return `${label}进行中`;
    }
    if (["failed", "timed_out"].includes(status)) {
        return `${label}失败`;
    }
    return label;
}
