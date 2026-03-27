"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, RefreshCw, Copy, Download, Trash2, AlertCircle } from "lucide-react";

import { TaskJob, VideoTask } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";
import { useTaskStore } from "@/store/taskStore";

interface VideoQueueProps {
    tasks: VideoTask[];
    jobs: TaskJob[];
    onRemix: (task: VideoTask) => void;
}

export default function VideoQueue({ tasks, jobs, onRemix }: VideoQueueProps) {
    const [filter, setFilter] = useState<"all" | "processing" | "completed" | "failed">("all");
    const cancelJob = useTaskStore((state) => state.cancelJob);
    const retryJob = useTaskStore((state) => state.retryJob);

    const filteredTasks = tasks.filter(t => {
        if (filter === "all") return true;
        if (filter === "processing") return t.status === "pending" || t.status === "processing";
        return t.status === filter;
    }).reverse(); // Newest first

    const filteredJobs = jobs.filter((job) => {
        if (filter === "all") return true;
        if (filter === "processing") return ["queued", "claimed", "running", "retry_waiting", "cancel_requested"].includes(job.status);
        if (filter === "failed") return ["failed", "timed_out"].includes(job.status);
        return false;
    }).reverse();

    const processingCount = jobs.filter(job => ["queued", "claimed", "running", "retry_waiting", "cancel_requested"].includes(job.status)).length;

    return (
        <div className="h-full flex flex-col bg-black/40 backdrop-blur-sm border-l border-white/5">
            {/* Header & Tabs */}
            <div className="p-4 border-b border-white/5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-display font-bold text-white">任务队列</h3>
                    <div className="text-xs font-mono text-gray-500 flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${processingCount > 0 ? "bg-green-500 animate-pulse" : "bg-gray-600"}`} />
                        GPU: {processingCount > 0 ? "Running" : "Idle"}
                    </div>
                </div>

                <div className="flex bg-white/5 rounded-lg p-1 gap-1">
                    {[
                        { id: "all", label: "全部" },
                        { id: "processing", label: "进行中" },
                        { id: "completed", label: "已完成" },
                        { id: "failed", label: "失败" },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setFilter(tab.id as any)}
                            className={`flex-1 py-1.5 text-xs rounded-md transition-colors ${filter === tab.id
                                ? "bg-white/10 text-white font-medium shadow-sm"
                                : "text-gray-500 hover:text-gray-300"
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
                        <JobCard key={job.id} job={job} onCancel={cancelJob} onRetry={retryJob} />
                    ))}
                    {filteredTasks.map((task) => (
                        <TaskCard key={task.id} task={task} onRemix={onRemix} />
                    ))}

                    {filteredTasks.length === 0 && filteredJobs.length === 0 && (
                        <div className="text-center py-10 text-gray-600 text-sm">
                            暂无任务
                        </div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

function JobCard({ job, onCancel, onRetry }: { job: TaskJob; onCancel: (jobId: string) => Promise<TaskJob>; onRetry: (jobId: string) => Promise<TaskJob> }) {
    const isActive = ["queued", "claimed", "running", "retry_waiting", "cancel_requested"].includes(job.status);
    const isFailed = ["failed", "timed_out"].includes(job.status);
    const sourceVideoTaskId = job.payload_json?.video_task_id;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className={`rounded-xl border p-3 ${isFailed ? "border-red-500/20 bg-red-500/5" : "border-white/10 bg-white/5"}`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        {isActive ? <Loader2 size={14} className="animate-spin text-primary" /> : <AlertCircle size={14} className="text-red-400" />}
                        <span className="text-xs font-mono text-gray-400">#{job.id.slice(0, 8)}</span>
                    </div>
                    <p className="text-sm text-white">{job.status}</p>
                    <p className="text-xs text-gray-500 mt-1">
                        {sourceVideoTaskId ? `video_task=${sourceVideoTaskId.slice(0, 8)}` : job.task_type}
                    </p>
                    {job.error_message && <p className="text-xs text-red-300 mt-2 line-clamp-2">{job.error_message}</p>}
                </div>
                <div className="flex gap-2">
                    {isActive && (
                        <button
                            onClick={() => void onCancel(job.id)}
                            className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-gray-300"
                        >
                            取消
                        </button>
                    )}
                    {isFailed && (
                        <button
                            onClick={() => void onRetry(job.id)}
                            className="px-2 py-1 text-xs rounded bg-white/5 hover:bg-white/10 text-gray-300"
                        >
                            重试
                        </button>
                    )}
                </div>
            </div>
        </motion.div>
    );
}

function TaskCard({ task, onRemix }: { task: VideoTask; onRemix: (t: VideoTask) => void }) {
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
            className={`rounded-xl overflow-hidden border transition-all ${isProcessing ? "bg-white/5 border-white/10" :
                isFailed ? "bg-red-500/5 border-red-500/20" :
                    "bg-black/40 border-white/10 hover:border-white/20"
                }`}
        >
            {/* Processing State (Compact) */}
            {isProcessing && (
                <div className="p-3 flex gap-3 items-center">
                    <div className="w-12 h-12 rounded bg-black/50 relative overflow-hidden flex-shrink-0">
                        {task.image_url ? (
                            <img
                                src={getDisplayUrl(task.image_url)}
                                alt="Input"
                                className="w-full h-full object-cover opacity-60"
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center bg-purple-900/30 text-purple-400 text-[10px] font-bold">
                                R2V
                            </div>
                        )}
                        <div className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="animate-spin text-primary" size={16} />
                        </div>
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-mono text-gray-400">#{task.id.slice(0, 6)}</span>
                            <span className="text-xs text-primary animate-pulse">
                                {task.status === "pending" ? "排队中" : "生成中..."}
                            </span>
                        </div>
                        <p className="text-xs text-gray-300 truncate">{task.prompt}</p>
                    </div>
                </div>
            )}

            {/* Completed State (Detailed) */}
            {isCompleted && (
                <div>
                    {/* Header */}
                    <div className="px-3 py-2 border-b border-white/5 flex justify-between items-center bg-white/5">
                        <span className="text-xs font-mono text-gray-500">#{task.id.slice(0, 6)}</span>
                        <div className="flex gap-2">
                            <button
                                onClick={() => onRemix(task)}
                                className="text-xs flex items-center gap-1 text-gray-400 hover:text-white transition-colors"
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
                                <div className="w-full h-full grid grid-cols-2 gap-0.5 bg-purple-900/20">
                                    {task.reference_video_urls.slice(0, 4).map((url, idx) => (
                                        <div key={idx} className="relative bg-black/50 overflow-hidden">
                                            <video
                                                src={getAssetUrl(url)}
                                                className="w-full h-full object-cover"
                                                muted
                                                preload="metadata"
                                            />
                                            <div className="absolute bottom-0.5 left-0.5 bg-purple-600/80 px-1 rounded text-[8px] text-white font-bold">
                                                @{String.fromCharCode(65 + idx)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="w-full h-full flex items-center justify-center bg-purple-900/10 text-purple-400/50 text-xs font-bold">
                                    R2V Input
                                </div>
                            )}
                            <div className="absolute top-2 left-2 bg-black/60 px-1.5 py-0.5 rounded text-[10px] text-gray-300">Input</div>
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
                            <div className="absolute top-2 right-2 bg-primary/80 px-1.5 py-0.5 rounded text-[10px] text-white">Result</div>
                        </div>
                    </div>

                    {/* Prompt & Actions */}
                    <div className="p-3">
                        <p className="text-xs text-gray-400 line-clamp-2 mb-3 hover:line-clamp-none transition-all cursor-help">
                            {task.prompt}
                        </p>

                        <div className="flex justify-between items-center">
                            <div className="flex gap-2">
                                <button className="p-1.5 hover:bg-white/10 rounded text-gray-400 hover:text-white">
                                    <Copy size={14} />
                                </button>
                                <button className="p-1.5 hover:bg-white/10 rounded text-gray-400 hover:text-white">
                                    <Download size={14} />
                                </button>
                            </div>
                            <button className="p-1.5 hover:bg-red-500/20 rounded text-gray-500 hover:text-red-400">
                                <Trash2 size={14} />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Failed State */}
            {isFailed && (
                <div className="p-3">
                    <div className="flex items-center gap-2 text-red-400 mb-2">
                        <AlertCircle size={16} />
                        <span className="text-sm font-medium">生成失败</span>
                    </div>
                    <p className="text-xs text-gray-500 mb-3">未知错误，请重试</p>
                    <button
                        onClick={() => onRemix(task)}
                        className="w-full py-1.5 bg-white/5 hover:bg-white/10 rounded text-xs text-gray-300 transition-colors"
                    >
                        重试任务
                    </button>
                </div>
            )}
        </motion.div>
    );
}
