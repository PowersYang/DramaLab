"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Loader2, Tag } from "lucide-react";

import { TaskJob } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";
import { useTaskStore } from "@/store/taskStore";
import { PANEL_HEADER_CLASS, PANEL_TITLE_CLASS } from "@/components/modules/panelHeaderStyles";

type QueueFilter = "all" | "processing" | "completed" | "failed";
type QueueStep = "assets" | "storyboard" | "audio";

const ACTIVE_STATUSES = ["queued", "claimed", "running", "retry_waiting", "cancel_requested"] as const;
const FAILED_STATUSES = ["failed", "timed_out"] as const;
const COMPLETED_STATUSES = ["succeeded", "cancelled"] as const;

const STEP_TASK_TYPES: Record<QueueStep, string[]> = {
    // 资产页只展示资产图像/参考动作视频相关任务，避免把其它生产阶段任务混进当前面板。
    assets: ["asset.generate", "asset.generate_batch", "asset.motion_ref.generate"],
    // 分镜页同时承载“分析、润色、渲染”三类任务，统一聚合到一个队列里。
    storyboard: ["storyboard.analyze", "storyboard.generate_all", "storyboard.render", "storyboard.refine_prompt"],
    // 配音页只聚焦 TTS 相关任务，避免把 SFX/BGM/导出任务混进来干扰对白制作。
    audio: ["audio.generate.project", "audio.generate.line"],
};

const TASK_TYPE_LABELS: Record<string, string> = {
    "asset.generate": "资产生成",
    "asset.generate_batch": "批量资产生成",
    "asset.motion_ref.generate": "资产动作参考生成",
    "storyboard.analyze": "分镜分析",
    "storyboard.generate_all": "分镜批量生成",
    "storyboard.render": "分镜渲染",
    "storyboard.refine_prompt": "分镜提示词润色",
    "audio.generate.project": "整片对白生成",
    "audio.generate.line": "单句对白生成",
};


interface ProjectTaskQueuePanelProps {
    step: QueueStep;
}

interface QueueJobDisplayInfo {
    title: string;
    subtitle: string;
    badges: string[];
    detail: string | null;
    accentClassName: string;
}

export function getStepTaskActiveCount(step: QueueStep, jobs: TaskJob[]): number {
    const taskTypes = new Set(STEP_TASK_TYPES[step]);
    return jobs.filter((job) => taskTypes.has(job.task_type) && ACTIVE_STATUSES.includes(job.status as typeof ACTIVE_STATUSES[number])).length;
}

export default function ProjectTaskQueuePanel({ step }: ProjectTaskQueuePanelProps) {
    const currentProject = useProjectStore((state) => state.currentProject);
    const fetchProjectJobs = useTaskStore((state) => state.fetchProjectJobs);
    const jobsById = useTaskStore((state) => state.jobsById);
    const jobIdsByProject = useTaskStore((state) => state.jobIdsByProject);
    const [filter, setFilter] = useState<QueueFilter>("all");
    const previousActiveJobIdsRef = useRef<string[]>([]);

    const filteredStepJobs = useMemo(() => {
        if (!currentProject) {
            return [];
        }

        const taskTypes = new Set(STEP_TASK_TYPES[step]);
        return (jobIdsByProject[currentProject.id] || [])
            .map((jobId) => jobsById[jobId])
            .filter((job): job is TaskJob => !!job && taskTypes.has(job.task_type))
            .sort((a, b) => {
                const timeA = new Date(String(a.created_at)).getTime();
                const timeB = new Date(String(b.created_at)).getTime();
                return timeB - timeA;
            });
    }, [currentProject, jobIdsByProject, jobsById, step]);

    const activeJobIds = useMemo(
        () => filteredStepJobs
            .filter((job) => ACTIVE_STATUSES.includes(job.status as typeof ACTIVE_STATUSES[number]))
            .map((job) => job.id),
        [filteredStepJobs]
    );

    useEffect(() => {
        if (!currentProject) {
            previousActiveJobIdsRef.current = [];
            return;
        }

        let cancelled = false;
        // 进入 Tab 时先拉全量任务，让用户能看到最近的成功/失败记录。
        void fetchProjectJobs(currentProject.id).catch((error) => {
            if (!cancelled) {
                console.error("Failed to fetch step task queue:", error);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [currentProject?.id, fetchProjectJobs, step]);

    useEffect(() => {
        if (!currentProject || activeJobIds.length === 0) {
            previousActiveJobIdsRef.current = activeJobIds;
            return;
        }

        let cancelled = false;
        let timeoutId: number | null = null;

        const pollActiveJobs = async () => {
            try {
                await fetchProjectJobs(currentProject.id, [...ACTIVE_STATUSES]);
            } catch (error) {
                console.error("Failed to poll step task queue:", error);
            } finally {
                if (!cancelled) {
                    timeoutId = window.setTimeout(pollActiveJobs, 3000);
                }
            }
        };

        timeoutId = window.setTimeout(pollActiveJobs, 3000);
        return () => {
            cancelled = true;
            if (timeoutId) {
                window.clearTimeout(timeoutId);
            }
        };
    }, [activeJobIds, currentProject?.id, fetchProjectJobs, step]);

    useEffect(() => {
        if (!currentProject) {
            previousActiveJobIdsRef.current = [];
            return;
        }

        const previousIds = previousActiveJobIdsRef.current;
        const activeIdSet = new Set(activeJobIds);
        const finishedJobIds = previousIds.filter((jobId) => !activeIdSet.has(jobId));
        previousActiveJobIdsRef.current = activeJobIds;

        if (finishedJobIds.length === 0) {
            return;
        }

        let cancelled = false;
        // 有任务刚结束时补拉一次全量，确保 completed / failed 状态立即出现在列表里。
        void fetchProjectJobs(currentProject.id).catch((error) => {
            if (!cancelled) {
                console.error("Failed to refresh completed step jobs:", error);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [activeJobIds, currentProject?.id, fetchProjectJobs, step]);

    const visibleJobs = filteredStepJobs.filter((job) => {
        if (filter === "all") {
            return true;
        }
        if (filter === "processing") {
            return ACTIVE_STATUSES.includes(job.status as typeof ACTIVE_STATUSES[number]);
        }
        if (filter === "completed") {
            return COMPLETED_STATUSES.includes(job.status as typeof COMPLETED_STATUSES[number]);
        }
        return FAILED_STATUSES.includes(job.status as typeof FAILED_STATUSES[number]);
    });

    const processingCount = activeJobIds.length;

    return (
        <div className="h-full flex flex-col bg-black/10">
            <div className="border-b border-white/10">
                <div className={PANEL_HEADER_CLASS}>
                    <h3 className={PANEL_TITLE_CLASS}>任务队列</h3>
                    <div className="text-xs font-mono text-gray-500 flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${processingCount > 0 ? "bg-green-500 animate-pulse" : "bg-gray-600"}`} />
                        {processingCount > 0 ? `${processingCount} 个进行中` : "空闲"}
                    </div>
                </div>

                <div className="p-4 pt-3">
                    <div className="flex bg-white/5 rounded-lg p-1 gap-1">
                        {[
                            { id: "all", label: "全部" },
                            { id: "processing", label: "进行中" },
                            { id: "completed", label: "已完成" },
                            { id: "failed", label: "失败" },
                        ].map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => setFilter(tab.id as QueueFilter)}
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
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <AnimatePresence mode="popLayout">
                    {visibleJobs.map((job) => (
                        <QueueJobCard key={job.id} job={job} step={step} project={currentProject} />
                    ))}
                </AnimatePresence>

                {visibleJobs.length === 0 && (
                    <div className="text-center py-10 text-gray-600 text-sm">
                        暂无任务
                    </div>
                )}
            </div>
        </div>
    );
}

function QueueJobCard({ job, step, project }: { job: TaskJob; step: QueueStep; project: any }) {
    const cancelJob = useTaskStore((state) => state.cancelJob);
    const retryJob = useTaskStore((state) => state.retryJob);
    const isActive = ACTIVE_STATUSES.includes(job.status as typeof ACTIVE_STATUSES[number]);
    const isFailed = FAILED_STATUSES.includes(job.status as typeof FAILED_STATUSES[number]);
    const isCompleted = COMPLETED_STATUSES.includes(job.status as typeof COMPLETED_STATUSES[number]);
    const statusLabel = getStatusLabel(job.status);
    const displayInfo = buildJobDisplayInfo(step, job, project);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className={`rounded-2xl border p-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.18)] ${isFailed ? "border-red-500/25 bg-red-500/8" : "border-white/10 bg-white/6 backdrop-blur-sm"}`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        {isActive && <Loader2 size={14} className="animate-spin text-primary" />}
                        {isFailed && <AlertCircle size={14} className="text-red-400" />}
                        {isCompleted && <CheckCircle2 size={14} className="text-emerald-400" />}
                        <span className="text-xs font-mono text-gray-400">#{job.id.slice(0, 8)}</span>
                        <span className={`h-2 w-2 rounded-full ${displayInfo.accentClassName}`} />
                    </div>
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-white leading-5">{displayInfo.title}</p>
                            {displayInfo.subtitle && (
                                <p className="text-xs text-gray-400 mt-1">{displayInfo.subtitle}</p>
                            )}
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${getStatusClassName(job.status)}`}>
                            {statusLabel}
                        </span>
                    </div>

                    {displayInfo.badges.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                            {displayInfo.badges.map((badge) => (
                                <span
                                    key={`${job.id}-${badge}`}
                                    className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-gray-300"
                                >
                                    <Tag size={10} className="text-gray-500" />
                                    {badge}
                                </span>
                            ))}
                        </div>
                    )}

                    {displayInfo.detail && (
                        <p className="text-xs text-gray-500 mt-3 leading-5">
                            {displayInfo.detail}
                        </p>
                    )}

                    <p className="text-[11px] text-gray-600 mt-3">
                        创建于 {formatTimestamp(job.created_at)}
                    </p>
                    {job.error_message && (
                        <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/8 px-3 py-2">
                            <p className="text-[11px] font-medium text-red-300 mb-1">失败原因</p>
                            <p className="text-xs text-red-200/90 line-clamp-3">
                            {job.error_message}
                            </p>
                        </div>
                    )}
                </div>
                <div className="flex gap-2 shrink-0">
                    {isActive && (
                        <button
                            onClick={() => void cancelJob(job.id)}
                            className="px-2.5 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-gray-300"
                        >
                            取消
                        </button>
                    )}
                    {isFailed && (
                        <button
                            onClick={() => void retryJob(job.id)}
                            className="px-2.5 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-gray-300"
                        >
                            重试
                        </button>
                    )}
                </div>
            </div>
        </motion.div>
    );
}

function getStatusLabel(status: TaskJob["status"]): string {
    if (status === "queued") return "排队中";
    if (status === "claimed") return "已领取，等待执行";
    if (status === "running") return "执行中";
    if (status === "retry_waiting") return "等待重试";
    if (status === "cancel_requested") return "取消中";
    if (status === "succeeded") return "已完成";
    if (status === "failed") return "执行失败";
    if (status === "cancelled") return "已取消";
    if (status === "timed_out") return "执行超时";
    return status;
}

function getStatusClassName(status: TaskJob["status"]): string {
    if (ACTIVE_STATUSES.includes(status as typeof ACTIVE_STATUSES[number])) {
        return "bg-primary/15 text-primary";
    }
    if (FAILED_STATUSES.includes(status as typeof FAILED_STATUSES[number])) {
        return "bg-red-500/15 text-red-300";
    }
    if (status === "succeeded") {
        return "bg-emerald-500/15 text-emerald-300";
    }
    return "bg-white/10 text-gray-300";
}

function formatTimestamp(value: string | number): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function buildJobDisplayInfo(step: QueueStep, job: TaskJob, project: any): QueueJobDisplayInfo {
    if (step === "assets") {
        return buildAssetJobDisplayInfo(job, project);
    }
    if (step === "audio") {
        return buildAudioJobDisplayInfo(job, project);
    }
    return buildStoryboardJobDisplayInfo(job, project);
}

function buildAssetJobDisplayInfo(job: TaskJob, project: any): QueueJobDisplayInfo {
    const assetTypeKey = normalizeAssetType(String(job.resource_type || job.payload_json?.asset_type || ""));
    const assetId = job.resource_id || job.payload_json?.asset_id;
    const asset = findAsset(project, assetTypeKey, assetId);
    const assetTypeLabel = getAssetTypeLabel(assetTypeKey);
    const assetName = asset?.name || `未命名${assetTypeLabel}`;
    const generationLabel = getAssetGenerationLabel(job);
    const taskLabel = TASK_TYPE_LABELS[job.task_type] || "资产任务";
    const badges = [assetTypeLabel, generationLabel].filter(Boolean);
    const detailParts = [
        asset?.description || null,
        job.attempt_count > 0 ? `已尝试 ${job.attempt_count}/${job.max_attempts} 次` : null,
    ].filter(Boolean);

    return {
        title: `${assetName} · ${generationLabel}`,
        subtitle: `${taskLabel} · ${assetTypeLabel}`,
        badges,
        detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
        accentClassName: "bg-sky-400",
    };
}

function buildStoryboardJobDisplayInfo(job: TaskJob, project: any): QueueJobDisplayInfo {
    if (job.task_type === "storyboard.analyze" || job.task_type === "storyboard.generate_all") {
        return {
            title: TASK_TYPE_LABELS[job.task_type] || "分镜任务",
            subtitle: "作用于当前项目的整段剧本",
            badges: ["项目级任务"],
            detail: job.result_json?.frame_count ? `本次生成 ${job.result_json.frame_count} 个分镜帧` : null,
            accentClassName: "bg-violet-400",
        };
    }

    const frameId = job.resource_id || job.payload_json?.frame_id;
    const frame = findFrame(project, frameId);
    const frameOrder = typeof frame?.frame_order === "number" ? frame.frame_order + 1 : null;
    const frameLabel = frameOrder ? `第 ${frameOrder} 帧` : "分镜帧";
    const scene = frame?.scene_id ? project?.scenes?.find((item: any) => item.id === frame.scene_id) : null;
    const characterNames = Array.isArray(frame?.character_ids)
        ? (project?.characters || [])
            .filter((item: any) => frame.character_ids.includes(item.id))
            .map((item: any) => item.name)
            .slice(0, 2)
        : [];
    const subtitleParts = [TASK_TYPE_LABELS[job.task_type] || "分镜任务", frameLabel];
    const badges = [frameLabel];
    if (scene?.name) {
        badges.push(`场景：${scene.name}`);
    }
    if (characterNames.length > 0) {
        badges.push(`角色：${characterNames.join("、")}`);
    }
    const detail = frame?.action_description || frame?.image_prompt || frame?.dialogue || null;

    return {
        title: `${frameLabel} · ${getStoryboardTaskLabel(job.task_type)}`,
        subtitle: subtitleParts.join(" · "),
        badges,
        detail,
        accentClassName: "bg-fuchsia-400",
    };
}

function buildAudioJobDisplayInfo(job: TaskJob, project: any): QueueJobDisplayInfo {
    if (job.task_type === "audio.generate.project") {
        return {
            title: TASK_TYPE_LABELS[job.task_type] || "配音任务",
            subtitle: "",
            badges: [],
            detail: typeof job.result_json?.audio_frame_count === "number"
                ? `已生成 ${job.result_json.audio_frame_count} 条对白音频`
                : "按角色默认音色与语音参数批量生成所有对白",
            accentClassName: "bg-amber-400",
        };
    }

    const frameId = job.resource_id || job.payload_json?.frame_id;
    const frame = findFrame(project, frameId);
    const frameOrder = typeof frame?.frame_order === "number" ? frame.frame_order + 1 : null;
    const frameLabel = frameOrder ? `第 ${frameOrder} 镜` : "对白镜头";
    const speaker = Array.isArray(frame?.character_ids)
        ? (project?.characters || []).find((item: any) => item.id === frame.character_ids[0])
        : null;
    const tuningParts = [
        typeof job.payload_json?.speed === "number" ? `语速 ${job.payload_json.speed}x` : null,
        typeof job.payload_json?.pitch === "number" ? `音调 ${job.payload_json.pitch}` : null,
        typeof job.payload_json?.volume === "number" ? `音量 ${job.payload_json.volume}` : null,
    ].filter(Boolean);

    return {
        title: `${frameLabel} · ${speaker?.name || "未绑定角色"}对白生成`,
        subtitle: "",
        badges: [],
        detail: frame?.dialogue || (tuningParts.length > 0 ? tuningParts.join(" · ") : null),
        accentClassName: "bg-amber-400",
    };
}

function normalizeAssetType(value: string): "character" | "scene" | "prop" | null {
    if (value === "character" || value === "scene" || value === "prop") {
        return value;
    }
    if (value === "full_body" || value === "head_shot") {
        return "character";
    }
    return null;
}

function findAsset(project: any, assetType: "character" | "scene" | "prop" | null, assetId?: string) {
    if (!project || !assetType || !assetId) {
        return null;
    }

    if (assetType === "character") {
        return project.characters?.find((item: any) => item.id === assetId) || null;
    }
    if (assetType === "scene") {
        return project.scenes?.find((item: any) => item.id === assetId) || null;
    }
    return project.props?.find((item: any) => item.id === assetId) || null;
}

function findFrame(project: any, frameId?: string) {
    if (!project || !frameId) {
        return null;
    }
    return project.frames?.find((item: any) => item.id === frameId) || null;
}

function getAssetTypeLabel(assetType: "character" | "scene" | "prop" | null): string {
    if (assetType === "character") return "角色";
    if (assetType === "scene") return "场景";
    if (assetType === "prop") return "道具";
    return "资产";
}

function getAssetGenerationLabel(job: TaskJob): string {
    if (job.task_type === "asset.motion_ref.generate") {
        return getMotionAssetLabel(String(job.payload_json?.asset_type || job.resource_type || ""));
    }

    const generationType = String(job.payload_json?.generation_type || "");
    if (generationType === "all") return "整套图像";
    if (generationType === "full_body") return "全身图";
    if (generationType === "three_view") return "三视图";
    if (generationType === "headshot") return "头像";
    return "图像生成";
}

function getMotionAssetLabel(assetType: string): string {
    if (assetType === "full_body") return "全身动作参考";
    if (assetType === "head_shot") return "头像动作参考";
    if (assetType === "scene") return "场景动作参考";
    if (assetType === "prop") return "道具动作参考";
    return "动作参考";
}

function getStoryboardTaskLabel(taskType: string): string {
    if (taskType === "storyboard.render") return "画面渲染";
    if (taskType === "storyboard.refine_prompt") return "提示词润色";
    if (taskType === "storyboard.analyze") return "分镜分析";
    if (taskType === "storyboard.generate_all") return "批量生成";
    return TASK_TYPE_LABELS[taskType] || taskType;
}
