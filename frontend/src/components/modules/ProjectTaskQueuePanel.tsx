"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Loader2, Tag } from "lucide-react";

import { TaskJob } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";
import { useTaskStore } from "@/store/taskStore";
import { useBillingGuard } from "@/hooks/useBillingGuard";
import { PANEL_HEADER_CLASS, PANEL_TITLE_CLASS } from "@/components/modules/panelHeaderStyles";

type QueueFilter = "all" | "processing" | "completed" | "failed";
type QueueStep = "script" | "assets" | "storyboard" | "audio";

const ACTIVE_STATUSES = ["queued", "claimed", "running", "retry_waiting", "cancel_requested"] as const;
const FAILED_STATUSES = ["failed", "timed_out"] as const;
const COMPLETED_STATUSES = ["succeeded", "cancelled"] as const;

const STEP_TASK_TYPES: Record<QueueStep, string[]> = {
    // 剧本页当前只展示实体提取任务，让用户能直接追踪“提取实体”按钮触发的后台解析。
    script: ["project.reparse"],
    // 资产页只展示资产图像/参考动作视频相关任务，避免把其它生产阶段任务混进当前面板。
    assets: ["asset.generate", "asset.generate_batch", "asset.motion_ref.generate"],
    // 分镜页同时承载“分析、润色、渲染”三类任务，统一聚合到一个队列里。
    storyboard: ["storyboard.analyze", "storyboard.generate_all", "storyboard.render", "storyboard.refine_prompt"],
    // 配音页只聚焦 TTS 相关任务，避免把 SFX/BGM/导出任务混进来干扰对白制作。
    audio: ["audio.generate.project", "audio.generate.line"],
};

const TASK_TYPE_LABELS: Record<string, string> = {
    "project.reparse": "实体提取",
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
    const { getTaskPrice } = useBillingGuard();
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
        <div className="studio-inspector h-full flex flex-col text-slate-900 dark:text-slate-100">
            <div className="border-b border-slate-200/80 dark:border-white/10">
                <div className={PANEL_HEADER_CLASS}>
                    <h3 className={PANEL_TITLE_CLASS}>任务队列</h3>
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                        <div className={`h-2 w-2 rounded-full ${processingCount > 0 ? "bg-emerald-500 animate-pulse" : "bg-slate-300 dark:bg-slate-600"}`} />
                        {processingCount > 0 ? `${processingCount} 个进行中` : "空闲"}
                    </div>
                </div>

                <div className="p-4 pt-3">
                    <div className="flex gap-1 rounded-xl border border-slate-200/80 bg-white/80 p-1 shadow-sm dark:border-white/10 dark:bg-white/5">
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
                                    ? "bg-slate-900 text-white font-medium shadow-sm dark:bg-white dark:text-slate-950"
                                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
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
                        <QueueJobCard key={job.id} job={job} step={step} project={currentProject} priceCredits={getTaskPrice(job.task_type)} />
                    ))}
                </AnimatePresence>

                {visibleJobs.length === 0 && (
                    <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-500">
                        暂无任务
                    </div>
                )}
            </div>
        </div>
    );
}

function QueueJobCard({ job, step, project, priceCredits }: { job: TaskJob; step: QueueStep; project: any; priceCredits: number | null }) {
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
            className={`rounded-2xl border p-3.5 shadow-[0_12px_36px_rgba(15,23,42,0.08)] transition-colors dark:shadow-[0_12px_36px_rgba(0,0,0,0.22)] ${isFailed
                ? "border-rose-200 bg-rose-50/90 dark:border-rose-500/25 dark:bg-rose-500/10"
                : "border-slate-200/80 bg-white/90 backdrop-blur-sm dark:border-white/10 dark:bg-white/5"
                }`}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        {isActive && <Loader2 size={14} className="animate-spin text-primary" />}
                        {isFailed && <AlertCircle size={14} className="text-rose-500 dark:text-rose-300" />}
                        {isCompleted && <CheckCircle2 size={14} className="text-emerald-500 dark:text-emerald-300" />}
                        <span className="text-xs font-mono text-slate-400 dark:text-slate-500">#{job.id.slice(0, 8)}</span>
                        <span className={`h-2 w-2 rounded-full ${displayInfo.accentClassName}`} />
                    </div>
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-sm font-semibold leading-5 text-slate-900 dark:text-slate-100">{displayInfo.title}</p>
                            {displayInfo.subtitle && (
                                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{displayInfo.subtitle}</p>
                            )}
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${getStatusClassName(job.status)}`}>
                            {statusLabel}
                        </span>
                    </div>

                    {(displayInfo.badges.length > 0 || priceCredits != null) && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            {priceCredits != null && (
                                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200">
                                    消耗 {priceCredits} 算力豆
                                </span>
                            )}
                            {displayInfo.badges.map((badge) => (
                                <span
                                    key={`${job.id}-${badge}`}
                                    className="inline-flex items-center gap-1 rounded-full border border-slate-200/90 bg-slate-100/80 px-2 py-1 text-[10px] text-slate-600 dark:border-white/10 dark:bg-black/20 dark:text-slate-300"
                                >
                                    <Tag size={10} className="text-slate-400 dark:text-slate-500" />
                                    {badge}
                                </span>
                            ))}
                        </div>
                    )}

                    {displayInfo.detail && (
                        <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
                            {displayInfo.detail}
                        </p>
                    )}

                    <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
                        创建于 {formatTimestamp(job.created_at)}
                    </p>
                    {job.error_message && (
                        <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2 dark:border-rose-500/20 dark:bg-rose-500/8">
                            <p className="mb-1 text-[11px] font-medium text-rose-700 dark:text-rose-300">失败原因</p>
                            <p className="line-clamp-3 text-xs text-rose-600/90 dark:text-rose-100/90">
                            {job.error_message}
                            </p>
                        </div>
                    )}
                </div>
                <div className="flex gap-2 shrink-0">
                    {isActive && (
                        <button
                            onClick={() => void cancelJob(job.id)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
                        >
                            取消
                        </button>
                    )}
                    {isFailed && (
                        <button
                            onClick={() => void retryJob(job.id)}
                            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 transition-colors hover:bg-slate-100 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
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
        return "bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary";
    }
    if (FAILED_STATUSES.includes(status as typeof FAILED_STATUSES[number])) {
        return "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300";
    }
    if (status === "succeeded") {
        return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
    }
    return "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-slate-300";
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
    if (step === "script") {
        return buildScriptJobDisplayInfo(job, project);
    }
    if (step === "assets") {
        return buildAssetJobDisplayInfo(job, project);
    }
    if (step === "audio") {
        return buildAudioJobDisplayInfo(job, project);
    }
    return buildStoryboardJobDisplayInfo(job, project);
}

function buildScriptJobDisplayInfo(job: TaskJob, project: any): QueueJobDisplayInfo {
    const result = job.result_json || {};
    const badges = [
        typeof result.character_count === "number" ? `角色 ${result.character_count}` : null,
        typeof result.scene_count === "number" ? `场景 ${result.scene_count}` : null,
        typeof result.prop_count === "number" ? `道具 ${result.prop_count}` : null,
    ].filter(Boolean) as string[];
    const detailParts = [
        job.attempt_count > 0 ? `已尝试 ${job.attempt_count}/${job.max_attempts} 次` : null,
    ].filter(Boolean);
    const scriptLength = typeof job.payload_json?.text === "string"
        ? job.payload_json.text.trim().length
        : 0;

    return {
        title: TASK_TYPE_LABELS[job.task_type] || "剧本任务",
        subtitle: scriptLength > 0 ? `本次解析剧本约 ${scriptLength} 字` : "从当前剧本中提取角色、场景和道具",
        badges,
        detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
        accentClassName: "bg-cyan-400",
    };
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
