"use client";

import { Fragment, useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Layout, Image as ImageIcon, Trash2, Copy, Wand2, RefreshCw, Loader2, X, Lock, Unlock,
    Plus, ArrowUp, ArrowDown, Zap, Upload, Film
} from "lucide-react";
import BillingActionButton from "@/components/billing/BillingActionButton";
import { useBillingGuard } from "@/hooks/useBillingGuard";
import {
    useProjectStore,
    type Character,
    type ImageAsset,
    type Project as StoreProject,
    type Prop,
    type Scene,
    type StoryboardFrame as StoreStoryboardFrame,
    type VideoTask as StoreVideoTask,
} from "@/store/projectStore";
import { api, crudApi, type StoryboardRenderPayload, type TaskJob } from "@/lib/api";
import { useTaskStore } from "@/store/taskStore";
import { getAssetUrlWithTimestamp, extractErrorDetail } from "@/lib/utils";
import { getEffectiveProjectCharacters, getProjectCharacterSourceHint, isSeriesProject } from "@/lib/projectAssets";
import { PANEL_HEADER_CLASS, PANEL_TITLE_CLASS } from "@/components/modules/panelHeaderStyles";

import StoryboardFrameEditor from "./StoryboardFrameEditor";

const ACTIVE_STORYBOARD_JOB_STATUSES = ["queued", "claimed", "running", "retry_waiting", "cancel_requested"] as const;

interface StoryboardFrameModel extends StoreStoryboardFrame {
    action_description: string;
    dialogue?: string;
    image_prompt?: string;
    camera_angle?: string;
    camera_movement?: string;
    character_ids?: string[];
    prop_ids?: string[];
    selected_video_id?: string | null;
    updated_at?: string | number;
}

type StoryboardProject = Omit<StoreProject, "frames" | "video_tasks" | "characters" | "scenes" | "props"> & {
    frames: StoryboardFrameModel[];
    video_tasks?: StoreVideoTask[];
    characters: Character[];
    scenes: Scene[];
    props: Prop[];
};

interface RenderCompositionData {
    character_ids?: string[];
    prop_ids?: string[];
    scene_id?: string;
    reference_image_urls: string[];
}

interface CreateFramePayload {
    action_description: string;
    dialogue: string;
    scene_id: string;
    camera_angle: string;
    insert_at?: number;
}

function getFrameDisplayNumber(frame: StoryboardFrameModel, fallbackIndex: number): number {
    return typeof frame.frame_order === "number" ? frame.frame_order + 1 : fallbackIndex + 1;
}

// 中文注释：分镜渲染需要尽量复用素材选中规则，避免单张生成和批量生成拼出来的引用图不一致。
function getSelectedVariantUrl(asset?: ImageAsset | null): string | null {
    if (!asset || !asset.variants || asset.variants.length === 0) return null;

    if (asset.selected_id) {
        const selectedVariant = asset.variants.find((variant) => variant.id === asset.selected_id);
        if (selectedVariant?.url) {
            return selectedVariant.url;
        }
    }

    return asset.variants[0]?.url || null;
}

// 中文注释：把分镜渲染请求的 prompt 和参考图拼装抽成统一方法，保证顶部批量入口和单帧入口行为一致。
function buildStoryboardRenderPayload(project: StoryboardProject, frame: StoryboardFrameModel) {
    const compositionData: RenderCompositionData = {
        character_ids: frame.character_ids,
        prop_ids: frame.prop_ids,
        scene_id: frame.scene_id,
        reference_image_urls: []
    };

    if (frame.scene_id) {
        const scene = project.scenes?.find((item) => item.id === frame.scene_id);
        if (scene) {
            const sceneUrl = getSelectedVariantUrl(scene.image_asset) || scene.image_url;
            if (sceneUrl) {
                compositionData.reference_image_urls.push(sceneUrl);
            }
        }
    }

    if (frame.character_ids && frame.character_ids.length > 0) {
        frame.character_ids.forEach((characterId: string) => {
            const character = project.characters?.find((item) => item.id === characterId);
            if (!character) return;

            const characterUrl = getSelectedVariantUrl(character.three_view_asset)
                || getSelectedVariantUrl(character.full_body_asset)
                || getSelectedVariantUrl(character.headshot_asset)
                || character.three_view_image_url
                || character.full_body_image_url
                || character.headshot_image_url
                || character.avatar_url
                || character.image_url;

            if (characterUrl) {
                compositionData.reference_image_urls.push(characterUrl);
            }
        });
    }

    if (frame.prop_ids && frame.prop_ids.length > 0) {
        frame.prop_ids.forEach((propId: string) => {
            const prop = project.props?.find((item) => item.id === propId);
            if (!prop) return;

            const propUrl = getSelectedVariantUrl(prop.image_asset) || prop.image_url;
            if (propUrl) {
                compositionData.reference_image_urls.push(propUrl);
            }
        });
    }

    const artDirection = project?.art_direction;
    const globalStylePrompt = artDirection?.style_config?.positive_prompt || "";

    let finalPrompt = "";
    if (frame.image_prompt && frame.image_prompt.trim()) {
        finalPrompt = globalStylePrompt
            ? `${globalStylePrompt} . ${frame.image_prompt}`
            : frame.image_prompt;
    } else {
        finalPrompt = [globalStylePrompt, frame.action_description].filter(Boolean).join(" . ");
    }

    return { compositionData, finalPrompt };
}

export default function StoryboardComposer() {
    const currentProject = useProjectStore((state) => state.currentProject) as StoryboardProject | null;
    const selectedFrameId = useProjectStore((state) => state.selectedFrameId);
    const setSelectedFrameId = useProjectStore((state) => state.setSelectedFrameId);
    const updateProject = useProjectStore((state) => state.updateProject);
    const enqueueReceipts = useTaskStore((state) => state.enqueueReceipts);
    const waitForJob = useTaskStore((state) => state.waitForJob);
    const fetchProjectJobs = useTaskStore((state) => state.fetchProjectJobs);
    const jobsById = useTaskStore((state) => state.jobsById);
    const jobIdsByProject = useTaskStore((state) => state.jobIdsByProject);

    // Use global rendering state (persists across module switches)
    const renderingFrames = useProjectStore((state) => state.renderingFrames);
    const addRenderingFrame = useProjectStore((state) => state.addRenderingFrame);
    const removeRenderingFrame = useProjectStore((state) => state.removeRenderingFrame);

    const [editingFrameId, setEditingFrameId] = useState<string | null>(null);
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [insertIndex, setInsertIndex] = useState<number | null>(null);
    const [extractingFrameId, setExtractingFrameId] = useState<string | null>(null);
    const [renderAllBatchSize, setRenderAllBatchSize] = useState<1 | 2 | 3 | 4>(1);
    const [isSubmittingAllFrames, setIsSubmittingAllFrames] = useState(false);
    const [isSubmittingAnalysis, setIsSubmittingAnalysis] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const previousActiveStoryboardJobIdsRef = useRef<string[]>([]);
    const [uploadTargetFrameId, setUploadTargetFrameId] = useState<string | null>(null);
    const { account, getTaskPrice, canAffordTask } = useBillingGuard();
    const storyboardAnalyzePrice = getTaskPrice("storyboard.analyze");
    const storyboardAnalyzeAffordable = canAffordTask("storyboard.analyze");
    const storyboardRenderPrice = getTaskPrice("storyboard.render");
    const storyboardRenderAffordable = canAffordTask("storyboard.render");
    const effectiveProject = useMemo(() => {
        if (!currentProject) {
            return null;
        }
        return {
            ...currentProject,
            // 中文注释：系列项目的分镜引用、提示词拼装和参考图收集都要基于系列角色主档，而不是旧的 project.characters。
            characters: getEffectiveProjectCharacters(currentProject),
        } as StoryboardProject;
    }, [currentProject]);

    const sortedFrames = useMemo(() => {
        if (!effectiveProject?.frames) {
            return [];
        }

        // 分镜展示始终以数据库中的 frame_order 为准，避免局部更新后出现视觉乱序。
        return [...effectiveProject.frames].sort((a, b) => {
            const orderA = typeof a?.frame_order === "number" ? a.frame_order : Number.MAX_SAFE_INTEGER;
            const orderB = typeof b?.frame_order === "number" ? b.frame_order : Number.MAX_SAFE_INTEGER;
            if (orderA !== orderB) {
                return orderA - orderB;
            }
            return String(a?.id || "").localeCompare(String(b?.id || ""));
        });
    }, [effectiveProject?.frames]);

    const editableFrame = useMemo(
        () => (editingFrameId ? sortedFrames.find((frame) => frame.id === editingFrameId) ?? null : null),
        [editingFrameId, sortedFrames]
    );

    const activeStoryboardRenderJobs = useMemo(() => {
        if (!effectiveProject) {
            return [];
        }

        return (jobIdsByProject[effectiveProject.id] || [])
            .map((jobId) => jobsById[jobId])
            .filter((job): job is TaskJob => {
                return Boolean(
                    job
                    && job.task_type === "storyboard.render"
                    && ACTIVE_STORYBOARD_JOB_STATUSES.includes(job.status as typeof ACTIVE_STORYBOARD_JOB_STATUSES[number])
                );
            });
    }, [effectiveProject, jobIdsByProject, jobsById]);

    const activeStoryboardRenderJobIds = useMemo(
        () => activeStoryboardRenderJobs.map((job) => job.id),
        [activeStoryboardRenderJobs]
    );

    const activeStoryboardRenderFrameIds = useMemo(() => {
        return new Set(
            activeStoryboardRenderJobs
                .map((job) => job.resource_id)
                .filter((resourceId): resourceId is string => Boolean(resourceId))
        );
    }, [activeStoryboardRenderJobs]);

    const isAnalyzingTasks = useMemo(() => {
        if (!currentProject) {
            return false;
        }
        const activeAnalyzeJobs = (jobIdsByProject[currentProject.id] || [])
            .map((jobId) => jobsById[jobId])
            .filter((job): job is TaskJob => {
                return Boolean(
                    job
                    && job.task_type === "storyboard.analyze"
                    && ACTIVE_STORYBOARD_JOB_STATUSES.includes(job.status as typeof ACTIVE_STORYBOARD_JOB_STATUSES[number])
                );
            });
        return activeAnalyzeJobs.length > 0;
    }, [currentProject, jobIdsByProject, jobsById]);

    const isAnalyzing = isAnalyzingTasks || isSubmittingAnalysis;

    const batchRenderableFrames = useMemo(
        () => sortedFrames.filter((frame) => !frame.locked && !activeStoryboardRenderFrameIds.has(frame.id)),
        [activeStoryboardRenderFrameIds, sortedFrames]
    );

    useEffect(() => {
        if (!currentProject || activeStoryboardRenderJobIds.length === 0) {
            return;
        }

        let cancelled = false;
        let timeoutId: number | null = null;

        // 中文注释：分镜批量入队后依赖 taskStore 轮询活跃 job，让页面在后台生成期间也能持续更新状态。
        const pollActiveStoryboardJobs = async () => {
            try {
                await fetchProjectJobs(currentProject.id, [...ACTIVE_STORYBOARD_JOB_STATUSES]);
            } catch (error) {
                console.error("Failed to poll active storyboard jobs:", error);
            } finally {
                if (!cancelled) {
                    timeoutId = window.setTimeout(pollActiveStoryboardJobs, 3000);
                }
            }
        };

        timeoutId = window.setTimeout(pollActiveStoryboardJobs, 3000);
        return () => {
            cancelled = true;
            if (timeoutId) {
                window.clearTimeout(timeoutId);
            }
        };
    }, [activeStoryboardRenderJobIds, currentProject, fetchProjectJobs]);

    useEffect(() => {
        if (!currentProject) {
            previousActiveStoryboardJobIdsRef.current = [];
            return;
        }

        const previousIds = previousActiveStoryboardJobIdsRef.current;
        const activeIdSet = new Set(activeStoryboardRenderJobIds);
        const finishedJobIds = previousIds.filter((jobId) => !activeIdSet.has(jobId));
        previousActiveStoryboardJobIdsRef.current = activeStoryboardRenderJobIds;

        if (finishedJobIds.length === 0) {
            return;
        }

        let cancelled = false;

        // 中文注释：仅在分镜渲染任务刚结束时补拉项目详情，避免历史完成任务导致页面重复刷新。
        void (async () => {
            try {
                const refreshedProject = await api.getProject(currentProject.id);
                if (!cancelled) {
                    updateProject(currentProject.id, refreshedProject);
                }
            } catch (error) {
                console.error("Failed to refresh project after storyboard render:", error);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [activeStoryboardRenderJobIds, currentProject, updateProject]);

    // 中文注释：单帧和批量都走同一份 payload 构建逻辑，减少后续改 prompt/引用图规则时的遗漏。
    const submitStoryboardRender = async (frame: StoryboardFrameModel, batchSize: number) => {
        if (!currentProject) {
            throw new Error("当前项目不存在");
        }

        const { compositionData, finalPrompt } = buildStoryboardRenderPayload(effectiveProject || currentProject, frame);
        return api.renderFrame(currentProject.id, frame.id, compositionData, finalPrompt, batchSize);
    };

    const buildStoryboardRenderBatchPayload = (frames: StoryboardFrameModel[], batchSize: number): StoryboardRenderPayload[] => {
        if (!currentProject) {
            return [];
        }

        return frames.map((frame) => {
            const { compositionData, finalPrompt } = buildStoryboardRenderPayload(effectiveProject || currentProject, frame);
            return {
                frame_id: frame.id,
                composition_data: compositionData,
                prompt: finalPrompt,
                batch_size: batchSize,
            };
        });
    };


    // NEW: Analyze script text to generate storyboard frames
    const handleAnalyzeToStoryboard = async () => {
        if (!currentProject) return;
        if (!storyboardAnalyzeAffordable) {
            alert("当前组织算力豆余额不足，无法提交分镜分析任务。");
            return;
        }

        const text = currentProject.originalText;
        if (!text || !text.trim()) {
            alert("请先输入剧本文本");
            return;
        }

        if (sortedFrames.length > 0) {
            if (!confirm("这将覆盖当前的所有分镜帧。是否继续？")) return;
        }

        setIsSubmittingAnalysis(true);
        try {
            const receipt = await api.analyzeToStoryboard(currentProject.id, text);
            enqueueReceipts(currentProject.id, [receipt]);
            const job = await waitForJob(receipt.job_id, { intervalMs: 2000 });
            const updatedProject = await api.getProject(currentProject.id);
            const frameCount = updatedProject.frames?.length || 0;
            updateProject(currentProject.id, updatedProject);
            if (job.status === "succeeded") {
                if (frameCount > 0) {
                    alert(`成功生成 ${frameCount} 个分镜帧！`);
                } else {
                    alert("AI 模型未生成有效分镜帧，请重新点击按钮再试一次。");
                }
            } else {
                alert(`分镜生成失败：${job.error_message || "请查看控制台了解详情。"}`);
            }
        } catch (error: unknown) {
            console.error("Analyze to storyboard failed:", error);
            const detail = extractErrorDetail(error, "");
            if (detail.includes("JSON") || detail.includes("格式")) {
                alert(`分镜生成失败：AI 模型输出格式异常。\n\n这是模型偶发的格式问题，通常重试即可解决。请再次点击生成按钮。`);
            } else {
                alert(`分镜生成失败：${detail || "请查看控制台了解详情。"}`);
            }
        } finally {
            setIsSubmittingAnalysis(false);
        }
    };

    const handleRenderAllFrames = async () => {
        if (!currentProject) return;
        if (!storyboardRenderAffordable) {
            alert("当前组织算力豆余额不足，无法提交分镜渲染任务。");
            return;
        }

        const lockedCount = sortedFrames.filter((frame) => frame.locked).length;
        const activeCount = sortedFrames.filter((frame) => activeStoryboardRenderFrameIds.has(frame.id)).length;
        const framesToSubmit = batchRenderableFrames;

        if (framesToSubmit.length === 0) {
            alert("没有可提交的分镜。锁定中的分镜和已在生成中的分镜会被自动跳过。");
            return;
        }

        setIsSubmittingAllFrames(true);

        try {
            const payloadItems = buildStoryboardRenderBatchPayload(framesToSubmit, renderAllBatchSize);
            const receipts = await api.renderFramesBatch(currentProject.id, payloadItems);
            enqueueReceipts(currentProject.id, receipts);

            void fetchProjectJobs(currentProject.id).catch((error) => {
                console.error("Failed to refresh storyboard jobs after batch submit:", error);
            });

            const summary: string[] = [
                `已批量提交 ${receipts.length} 个分镜任务，每个分镜生成 ${renderAllBatchSize} 张图片。`
            ];
            if (lockedCount > 0) {
                summary.push(`跳过 ${lockedCount} 个已锁定分镜。`);
            }
            if (activeCount > 0) {
                summary.push(`跳过 ${activeCount} 个生成中的分镜。`);
            }
            alert(summary.join("\n"));
        } catch (error: unknown) {
            console.error("Failed to submit storyboard render batch:", error);
            alert(extractErrorDetail(error, "批量提交分镜渲染任务失败"));
        } finally {
            setIsSubmittingAllFrames(false);
        }
    };

    const handleImageClick = (frameId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingFrameId(frameId);
    };

    const handleDeleteFrame = async (frameId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!currentProject) return;
        if (!confirm("确认删除这个分镜吗？")) return;

        try {
            await crudApi.deleteFrame(currentProject.id, frameId);
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to delete frame:", error);
            alert("删除分镜失败");
        }
    };

    const handleCopyFrame = async (frameId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!currentProject) return;

        try {
            await crudApi.copyFrame(currentProject.id, frameId);
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to copy frame:", error);
            alert("复制分镜失败");
        }
    };

    const handleCreateFrame = async (data: CreateFramePayload) => {
        if (!currentProject) return;

        try {
            await crudApi.createFrame(currentProject.id, {
                ...data,
                insert_at: insertIndex !== null ? insertIndex : undefined
            });
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
            setIsCreateDialogOpen(false);
            setInsertIndex(null);
        } catch (error) {
            console.error("Failed to create frame:", error);
            alert("创建分镜失败");
        }
    };

    const handleMoveFrame = async (index: number, direction: 'up' | 'down', e: React.MouseEvent) => {
        e.stopPropagation();
        if (!currentProject || sortedFrames.length === 0) return;

        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= sortedFrames.length) return;

        // Create new order
        const newFrames = [...sortedFrames];
        const [movedFrame] = newFrames.splice(index, 1);
        newFrames.splice(newIndex, 0, movedFrame);

        const newOrderIds = newFrames.map((frame) => frame.id);

        try {
            // Optimistic update
            updateProject(currentProject.id, { ...currentProject, frames: newFrames });

            await crudApi.reorderFrames(currentProject.id, newOrderIds);
            // No need to fetch again if optimistic update was correct, but good for safety
        } catch (error) {
            console.error("Failed to reorder frames:", error);
            alert("分镜排序失败");
            // Revert on error would be ideal here by fetching project again
            const project = await api.getProject(currentProject.id);
            updateProject(currentProject.id, project);
        }
    };

    const handleExtractLastFrame = async (frameId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!currentProject || sortedFrames.length === 0) return;

        const frameIndex = sortedFrames.findIndex((frame) => frame.id === frameId);
        if (frameIndex <= 0) return;

        // Find the previous frame's selected video
        const prevFrame = sortedFrames[frameIndex - 1];
        if (!prevFrame.selected_video_id) {
            alert("上一帧还没有选中视频。");
            return;
        }

        const prevVideo = currentProject?.video_tasks?.find(
            (task) => task.id === prevFrame.selected_video_id && task.status === "completed"
        );
        if (!prevVideo) {
            alert("上一帧的视频尚未生成完成。");
            return;
        }

        setExtractingFrameId(frameId);
        try {
            const updatedProject = await api.extractLastFrame(currentProject.id, frameId, prevVideo.id);
            updateProject(currentProject.id, updatedProject);
        } catch (error: unknown) {
            console.error("Failed to extract last frame:", error);
            alert(extractErrorDetail(error, "提取上一帧结尾画面失败"));
        } finally {
            setExtractingFrameId(null);
        }
    };

    const handleUploadFrameImage = async (frameId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setUploadTargetFrameId(frameId);
        fileInputRef.current?.click();
    };

    const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !uploadTargetFrameId || !currentProject) return;

        try {
            const updatedProject = await api.uploadFrameImage(currentProject.id, uploadTargetFrameId, file);
            updateProject(currentProject.id, updatedProject);
        } catch (error: unknown) {
            console.error("Failed to upload frame image:", error);
            alert(extractErrorDetail(error, "上传分镜图片失败"));
        } finally {
            setUploadTargetFrameId(null);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleRenderFrame = async (frame: StoryboardFrameModel, batchSize: number = 1, e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (!currentProject) return;
        if (!storyboardRenderAffordable) {
            alert("当前组织算力豆余额不足，无法提交分镜渲染任务。");
            return;
        }
        if (activeStoryboardRenderFrameIds.has(frame.id)) {
            alert("这个分镜已经有一个生成任务正在处理中。");
            return;
        }

        addRenderingFrame(frame.id);
        try {
            const receipt = await submitStoryboardRender(frame, batchSize);
            enqueueReceipts(currentProject.id, [receipt]);
            const job = await waitForJob(receipt.job_id, { intervalMs: 2000 });
            const updatedProject = await api.getProject(currentProject.id);
            useProjectStore.getState().updateProject(currentProject.id, updatedProject);
            if (["failed", "timed_out"].includes(job.status)) {
                alert(job.error_message || "渲染失败，请查看控制台详情。");
            }

        } catch (error) {
            console.error("Render failed:", error);
            alert("渲染失败，请查看控制台详情。");
        } finally {
            removeRenderingFrame(frame.id);
        }
    };

    return (
        <div className="flex flex-col h-full text-white overflow-hidden">
            <div className="flex-shrink-0 border-b border-white/10 bg-black/20">
                <div className={PANEL_HEADER_CLASS}>
                    <h3 className={PANEL_TITLE_CLASS}>
                        <Layout size={16} className="text-primary" /> 分镜设计
                    </h3>
                </div>
                <div className="px-4 pb-4">
                    {isSeriesProject(currentProject) && (
                        <div className="mb-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-100">
                            {getProjectCharacterSourceHint(currentProject)}
                        </div>
                    )}
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                        className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_28px_60px_-44px_rgba(15,23,42,0.46)] backdrop-blur-xl"
                    >
                        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(56,189,248,0.12),transparent_42%),radial-gradient(circle_at_86%_32%,rgba(34,197,94,0.10),transparent_44%),radial-gradient(circle_at_40%_90%,rgba(251,191,36,0.08),transparent_42%)]" />
                        <div className="relative grid gap-3 p-3 xl:grid-cols-12">
                            <div className="xl:col-span-5 rounded-2xl border border-white/10 bg-black/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary/20 text-primary ring-1 ring-primary/20">
                                                <Zap size={14} />
                                            </span>
                                            <div className="font-semibold tracking-[-0.02em] text-white">步骤 1：生成分镜</div>
                                        </div>
                                        <div className="mt-1 text-xs leading-relaxed text-gray-400">
                                            从剧本解析结果生成镜头列表，可再逐帧编辑与补充。
                                        </div>
                                    </div>

                                    <BillingActionButton
                                        onClick={handleAnalyzeToStoryboard}
                                        disabled={isAnalyzing || !storyboardAnalyzeAffordable}
                                        priceCredits={storyboardAnalyzePrice}
                                        balanceCredits={account?.balance_credits}
                                        className="group inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-primary/25 bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-[0_16px_30px_-18px_rgba(49,95,145,0.72)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-primary/90 hover:shadow-[0_22px_36px_-20px_rgba(49,95,145,0.84)] disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none"
                                        tooltipText={storyboardAnalyzePrice == null ? undefined : `预计消耗${storyboardAnalyzePrice}算力豆${!storyboardAnalyzeAffordable ? "，当前余额不足" : ""}`}
                                    >
                                        {isAnalyzing ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                                        {isAnalyzing ? "分析中..." : "生成分镜"}
                                    </BillingActionButton>
                                </div>
                            </div>

                            <div className="xl:col-span-7 rounded-2xl border border-white/10 bg-black/25 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/15">
                                                <ImageIcon size={14} />
                                            </span>
                                            <div className="font-semibold tracking-[-0.02em] text-white">步骤 2：生成分镜图片</div>
                                        </div>
                                        <div className="mt-1 text-xs leading-relaxed text-gray-400">
                                            为每个分镜生成候选图。候选数越多，方便挑选替换。
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2">
                                        <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-2 py-1.5">
                                            <span className="pl-1 text-[11px] font-medium text-gray-400">每帧候选</span>
                                            <div className="flex items-center gap-1 rounded-lg bg-white/5 p-1">
                                                {[1, 2, 3, 4].map((size) => (
                                                    <button
                                                        key={size}
                                                        type="button"
                                                        onClick={() => setRenderAllBatchSize(size as 1 | 2 | 3 | 4)}
                                                        className={`rounded-md px-2.5 py-1 text-[12px] font-semibold tracking-[-0.02em] transition-all ${
                                                            renderAllBatchSize === size
                                                                ? "bg-white/15 text-white shadow-[0_10px_18px_-14px_rgba(15,23,42,0.9)]"
                                                                : "text-gray-500 hover:bg-white/10 hover:text-white"
                                                        }`}
                                                        title={`每个分镜生成 ${size} 张候选图`}
                                                    >
                                                        x{size}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <BillingActionButton
                                            onClick={handleRenderAllFrames}
                                            disabled={isSubmittingAllFrames || sortedFrames.length === 0 || !storyboardRenderAffordable}
                                            priceCredits={storyboardRenderPrice}
                                            balanceCredits={account?.balance_credits}
                                            className="group inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-[linear-gradient(135deg,rgba(16,185,129,0.92),rgba(8,145,178,0.86))] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_18px_34px_-20px_rgba(16,185,129,0.72)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_24px_42px_-24px_rgba(8,145,178,0.9)] disabled:translate-y-0 disabled:opacity-50 disabled:shadow-none"
                                            tooltipText={storyboardRenderPrice == null ? undefined : `预计消耗${storyboardRenderPrice}算力豆${!storyboardRenderAffordable ? "，当前余额不足" : ""}`}
                                        >
                                            {isSubmittingAllFrames ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}
                                            {isSubmittingAllFrames ? "批量提交中..." : `批量生成 x${renderAllBatchSize}`}
                                        </BillingActionButton>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                </div>
            </div>

            {/* Frame List — full width */}
            <div className="flex-1 overflow-y-auto p-8">
                <div className="max-w-4xl mx-auto space-y-6">
                        {/* Add Frame Button (Top) */}
                        <div className="flex justify-center">
                            <button
                                onClick={() => { setInsertIndex(0); setIsCreateDialogOpen(true); }}
                                className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-lg transition-colors border border-dashed border-white/10 hover:border-white/30"
                            >
                                <Plus size={16} />
                                <span className="text-sm font-medium">在开头插入分镜</span>
                            </button>
                        </div>

                        {sortedFrames.map((frame, index) => {
                            const isFrameRendering = renderingFrames.has(frame.id) || activeStoryboardRenderFrameIds.has(frame.id);
                            const prevFrame = index > 0 ? sortedFrames[index - 1] : null;
                            const prevVideoCompleted = prevFrame?.selected_video_id
                                ? currentProject?.video_tasks?.find(
                                    (task) => task.id === prevFrame.selected_video_id && task.status === "completed"
                                )
                                : null;

                            return (
                            <Fragment key={frame.id}>
                                <motion.div
                                    layoutId={frame.id}
                                    onClick={() => setSelectedFrameId(frame.id)}
                                    className={`storyboard-frame-card group relative flex gap-6 p-4 rounded-xl border transition-all cursor-pointer ${selectedFrameId === frame.id
                                        ? "bg-white/5 border-primary ring-1 ring-primary"
                                        : "asset-surface hover:border-white/20"
                                        }`}
                                >
                                    {/* Frame Number */}
                                    <div className="storyboard-frame-index absolute -left-3 -top-3 w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-xs font-bold text-gray-400 shadow-lg z-10">
                                        {getFrameDisplayNumber(frame, index)}
                                    </div>

                                    {/* Image Preview */}
                                    <div className="w-64 aspect-video bg-black/40 rounded-lg border border-white/5 overflow-hidden flex-shrink-0 relative">
                                        {frame.rendered_image_url || frame.image_url ? (
                                            <ImageWithRetry
                                                key={frame.id + (frame.updated_at || 0)} // Force remount on refresh
                                                src={getAssetUrlWithTimestamp(frame.rendered_image_url || frame.image_url, frame.updated_at)}
                                                alt={`Frame ${index + 1}`}
                                                className="w-full h-full object-cover cursor-zoom-in"
                                                onClick={(e: React.MouseEvent) => handleImageClick(frame.id, e)}
                                            />
                                        ) : (
                                            <div className="w-full h-full flex flex-col items-center justify-center text-gray-600 gap-2">
                                                <ImageIcon size={24} className="opacity-20" />
                                                <span className="text-[10px]">暂无图片</span>
                                            </div>
                                        )

                                        }

                                        {/* Hover Actions - pointer-events-none to allow image click */}
                                        <div className="pointer-events-none absolute inset-0 opacity-0 transition-all duration-200 group-hover:opacity-100">
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                                            <div className="absolute inset-0 flex flex-col justify-between p-2">
                                                <div className="flex items-center justify-end">
                                                    <button
                                                        onClick={async (e) => {
                                                            e.stopPropagation();
                                                            if (!currentProject) return;
                                                            try {
                                                                await api.toggleFrameLock(currentProject.id, frame.id);
                                                                const updated = await api.getProject(currentProject.id);
                                                                updateProject(currentProject.id, updated);
                                                            } catch (error) {
                                                                console.error("Toggle lock failed:", error);
                                                            }
                                                        }}
                                                        className={`pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border text-white shadow-[0_14px_28px_-20px_rgba(0,0,0,0.8)] backdrop-blur-md transition-all ${
                                                            frame.locked
                                                                ? "border-amber-300/25 bg-amber-500/20 hover:bg-amber-500/28"
                                                                : "border-white/15 bg-black/35 hover:bg-black/50"
                                                        }`}
                                                        title={frame.locked ? "解锁" : "锁定"}
                                                        aria-label={frame.locked ? "解锁分镜" : "锁定分镜"}
                                                    >
                                                        {frame.locked ? <Unlock size={16} /> : <Lock size={16} />}
                                                    </button>
                                                </div>

                                                <div className="flex items-center justify-center">
                                                    {frame.locked ? (
                                                        <div className="pointer-events-none inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs font-semibold text-gray-200 backdrop-blur-md">
                                                            <Lock size={14} className="opacity-90" />
                                                            已锁定
                                                        </div>
                                                    ) : isFrameRendering ? (
                                                        <div className="pointer-events-none inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/45 px-3 py-2 text-xs font-semibold text-white backdrop-blur-md">
                                                            <Loader2 size={14} className="animate-spin" />
                                                            生成中...
                                                        </div>
                                                    ) : (
                                                        <BillingActionButton
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleRenderFrame(frame, renderAllBatchSize);
                                                            }}
                                                            disabled={!storyboardRenderAffordable}
                                                            priceCredits={storyboardRenderPrice}
                                                            balanceCredits={account?.balance_credits}
                                                            className="pointer-events-auto inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white shadow-[0_18px_38px_-28px_rgba(0,0,0,0.9)] backdrop-blur-md transition-all hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
                                                            tooltipText={storyboardRenderPrice == null ? undefined : `预计消耗${storyboardRenderPrice}算力豆${!storyboardRenderAffordable ? "，当前余额不足" : ""}`}
                                                            tooltipClassName="bottom-full top-auto mb-2 mt-0"
                                                            costClassName="px-1.5 py-0.5 text-[10px]"
                                                        >
                                                            <Wand2 size={14} />
                                                            生成 x{renderAllBatchSize}
                                                        </BillingActionButton>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 flex flex-col gap-3">
                                        <div className="flex items-start justify-between">
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">动作</span>
                                                    {frame.camera_movement && (
                                                        <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded border border-blue-500/30">
                                                            {frame.camera_movement}
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-gray-200 leading-relaxed line-clamp-3">
                                                    {frame.action_description}
                                                </p>
                                            </div>
                                        </div>

                                        {frame.dialogue && (
                                            <div className="mt-auto pt-3 border-t border-white/5">
                                                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-1">对白</span>
                                                <p className="text-sm text-gray-400 italic">&quot;{frame.dialogue}&quot;</p>
                                            </div>
                                        )}

                                        {/* Frame Actions */}
                                        <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-white/5">
                                            <div className="flex items-center gap-1 mr-auto">
                                                <button
                                                    onClick={(e) => handleMoveFrame(index, 'up', e)}
                                                    disabled={index === 0}
                                                    className="btn-tip p-2 hover:bg-white/10 text-gray-400 hover:text-white rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                    data-tip="上移"
                                                >
                                                    <ArrowUp size={14} />
                                                </button>
                                                <button
                                                    onClick={(e) => handleMoveFrame(index, 'down', e)}
                                                    disabled={index === sortedFrames.length - 1}
                                                    className="btn-tip p-2 hover:bg-white/10 text-gray-400 hover:text-white rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                    data-tip="下移"
                                                >
                                                    <ArrowDown size={14} />
                                                </button>
                                            </div>

                                            <button
                                                onClick={(e) => handleCopyFrame(frame.id, e)}
                                                className="btn-tip p-2 hover:bg-white/10 text-gray-400 hover:text-white rounded-lg transition-colors"
                                                data-tip="复制"
                                            >
                                                <Copy size={14} />
                                            </button>
                                            <button
                                                onClick={(e) => handleUploadFrameImage(frame.id, e)}
                                                className="btn-tip p-2 hover:bg-blue-500/20 text-gray-400 hover:text-blue-400 rounded-lg transition-colors"
                                                data-tip="上传图片"
                                            >
                                                <Upload size={14} />
                                            </button>
                                            {index > 0 && prevVideoCompleted ? (
                                                <button
                                                    onClick={(e) => handleExtractLastFrame(frame.id, e)}
                                                    disabled={extractingFrameId === frame.id}
                                                    className="btn-tip p-2 hover:bg-purple-500/20 text-gray-400 hover:text-purple-400 rounded-lg transition-colors disabled:opacity-50"
                                                    data-tip="使用上一帧结尾画面"
                                                >
                                                    {extractingFrameId === frame.id ? <Loader2 size={14} className="animate-spin" /> : <Film size={14} />}
                                                </button>
                                            ) : null}
                                            <button
                                                onClick={(e) => handleDeleteFrame(frame.id, e)}
                                                className="btn-tip p-2 hover:bg-red-500/20 text-gray-400 hover:text-red-400 rounded-lg transition-colors"
                                                data-tip="删除"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>

                                {/* Add Button Between Frames */}
                                <div className="flex justify-center opacity-0 hover:opacity-100 transition-opacity -my-3 z-10 relative">
                                    <button
                                        onClick={() => { setInsertIndex(index + 1); setIsCreateDialogOpen(true); }}
                                        className="storyboard-insert-button p-1 border border-white/20 rounded-full text-gray-400 hover:text-white hover:border-primary hover:bg-primary/20 transition-all transform hover:scale-110"
                                        title="在这里插入分镜"
                                    >
                                        <Plus size={16} />
                                    </button>
                                </div>
                            </Fragment>
                        )})}
                </div>
            </div>

            {/* Storyboard Frame Editor Modal */}
            <AnimatePresence>
                {editableFrame && (
                    <StoryboardFrameEditor
                        frame={editableFrame}
                        onClose={() => setEditingFrameId(null)}
                    />
                )}
            </AnimatePresence>

            {/* Create Frame Dialog */}
            <AnimatePresence>
                {isCreateDialogOpen && (
                    <CreateFrameDialog
                        onClose={() => { setIsCreateDialogOpen(false); setInsertIndex(null); }}
                        onCreate={handleCreateFrame}
                        scenes={currentProject?.scenes || []}
                    />
                )}
            </AnimatePresence>

            {/* Hidden file input for frame image upload */}
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelected}
            />
        </div>
    );
}

function CreateFrameDialog({ onClose, onCreate, scenes }: { onClose: () => void; onCreate: (data: CreateFramePayload) => void; scenes: Scene[] }) {
    const [action, setAction] = useState("");
    const [dialogue, setDialogue] = useState("");
    const [sceneId, setSceneId] = useState(scenes[0]?.id || "");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        if (!action.trim()) {
            alert("请填写动作描述");
            return;
        }
        if (!sceneId && scenes.length > 0) {
            alert("请选择场景");
            return;
        }

        setIsSubmitting(true);
        try {
            await onCreate({
                action_description: action.trim(),
                dialogue: dialogue.trim(),
                scene_id: sceneId,
                camera_angle: "Medium Shot"
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="storyboard-modal border border-white/10 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
                <div className="p-6 border-b border-white/10 flex justify-between items-center bg-black/20">
                    <div className="flex items-center gap-3">
                        <Plus className="text-primary" size={20} />
                        <h2 className="text-lg font-bold text-white">新增分镜</h2>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                        <X size={20} className="text-gray-400" />
                    </button>
                </div>

                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">场景</label>
                        <select
                            value={sceneId}
                            onChange={(e) => setSceneId(e.target.value)}
                            className="storyboard-field w-full px-4 py-3 border border-white/10 rounded-lg text-white focus:border-primary/50 focus:outline-none appearance-none"
                        >
                            <option value="" disabled>请选择场景</option>
                            {scenes.map((scene) => (
                                <option key={scene.id} value={scene.id}>{scene.name}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">动作描述 *</label>
                        <textarea
                            value={action}
                            onChange={(e) => setAction(e.target.value)}
                            placeholder="描述这一帧中发生的内容"
                            rows={3}
                            className="storyboard-field w-full px-4 py-3 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:border-primary/50 focus:outline-none resize-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">对白（可选）</label>
                        <textarea
                            value={dialogue}
                            onChange={(e) => setDialogue(e.target.value)}
                            placeholder="输入角色对白..."
                            rows={2}
                            className="storyboard-field w-full px-4 py-3 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:border-primary/50 focus:outline-none resize-none"
                        />
                    </div>
                </div>

                <div className="p-6 border-t border-white/10 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || !action.trim()}
                        className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isSubmitting && <RefreshCw size={16} className="animate-spin" />}
                        创建分镜
                    </button>
                </div>
            </motion.div>
        </div>
    );
}

function ImageWithRetry({ src, alt, className, onClick }: { src: string, alt: string, className?: string, onClick?: (e: React.MouseEvent) => void }) {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(false);
    const [retryCount, setRetryCount] = useState(0);
    const imgRef = useRef<HTMLImageElement>(null);

    // Reset state when src changes
    useEffect(() => {
        setIsLoading(true);
        setError(false);
        setRetryCount(0);
    }, [src]);

    useEffect(() => {
        if (imgRef.current && imgRef.current.complete) {
            if (imgRef.current.naturalWidth > 0) {
                setIsLoading(false);
            }
        }
    }, [src]);

    useEffect(() => {
        if (error && retryCount < 10) {
            const timer = setTimeout(() => {
                setRetryCount(prev => prev + 1);
                setError(false);
            }, 1000 * (retryCount + 1)); // Exponential backoff
            return () => clearTimeout(timer);
        }
    }, [error, retryCount]);

    // Construct src with retry param to bypass cache if retrying
    const displaySrc = retryCount > 0 ? `${src}${src.includes('?') ? '&' : '?'}retry=${retryCount}` : src;

    return (
        <div className={`relative ${className}`}>
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/5 backdrop-blur-sm z-10">
                    <RefreshCw className="animate-spin text-gray-400" size={24} />
                </div>
            )}
            {/* 中文注释：这里保留原生 img 是为了配合手动重试和缓存击穿参数，避免 next/image 接管后干扰失败重载时序。 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                ref={imgRef}
                src={displaySrc}
                alt={alt}
                className={`${className} ${isLoading ? 'opacity-50' : 'opacity-100'} transition-opacity duration-300`}
                onLoad={() => setIsLoading(false)}
                onError={() => {
                    setError(true);
                    setIsLoading(true); // Keep showing loader while retrying
                }}
                onClick={onClick}
            />
            {error && retryCount >= 10 && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-500/10 backdrop-blur-sm z-20 p-2 text-center">
                    <span className="text-xs text-red-400 font-bold">Failed to load</span>
                    <span className="text-[10px] text-red-400/70 break-all">{src}</span>
                </div>
            )}
        </div>
    );
}
