"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, Users, MapPin, Box, X, Check, Plus, RefreshCw } from "lucide-react";
import { useBillingGuard } from "@/hooks/useBillingGuard";
import { useProjectStore } from "@/store/projectStore";
import { api, crudApi, TaskJob } from "@/lib/api";
import { useTaskStore } from "@/store/taskStore";
import { formatRequestFailureMessage } from "@/lib/taskFeedback";
import { getEffectiveProjectCharacters } from "@/lib/projectAssets";
import AssetTypeTabs from "@/components/common/AssetTypeTabs";
import StudioAssetCard from "@/components/common/StudioAssetCard";
import ProjectCharacterSourceHintBanner from "@/components/common/ProjectCharacterSourceHintBanner";
import CharacterWorkbench from "./CharacterWorkbench";
import ScenePropWorkbenchModal from "./ScenePropWorkbenchModal";
import { PANEL_HEADER_CLASS, PANEL_META_TEXT_CLASS, PANEL_TITLE_CLASS } from "@/components/modules/panelHeaderStyles";

function getAssetTypeLabel(type: "character" | "scene" | "prop" | string) {
    if (type === "character") return "角色";
    if (type === "scene") return "场景";
    if (type === "prop") return "道具";
    return "素材";
}

const ACTIVE_TASK_STATUSES = ["queued", "claimed", "running", "retry_waiting", "cancel_requested"];
const TERMINAL_TASK_STATUSES = new Set(["succeeded", "failed", "cancelled", "timed_out"]);
const EMPTY_TASK_IDS: string[] = [];

function mapJobToGeneratingTask(job: TaskJob) {
    const assetId = job.resource_id || job.payload_json?.asset_id;
    if (!assetId) {
        return null;
    }

    if (job.task_type === "asset.generate" || job.task_type === "asset.generate_batch") {
        return {
            assetId,
            generationType: typeof job.payload_json?.generation_type === "string" ? job.payload_json.generation_type : "all",
            batchSize: typeof job.payload_json?.batch_size === "number" ? job.payload_json.batch_size : 1,
        };
    }

    if (job.task_type === "asset.motion_ref.generate") {
        const motionAssetType = job.payload_json?.asset_type;
        const generationType =
            motionAssetType === "head_shot"
                ? "video_head_shot"
                : motionAssetType === "scene"
                    ? "video_scene"
                    : motionAssetType === "prop"
                        ? "video_prop"
                        : "video_full_body";
        return {
            assetId,
            generationType,
            batchSize: 1,
        };
    }

    return null;
}

export function collectTerminalGeneratingTaskKeys(
    jobsById: Record<string, TaskJob>,
    jobIds: string[],
    assetIdSet: Set<string>,
) {
    // 中文注释：仅终态任务参与 pending 清理，运行态仍由活跃任务列表驱动卡片“生成中”展示。
    const keys = new Set<string>();
    jobIds.forEach((jobId) => {
        const job = jobsById[jobId];
        if (!job || !TERMINAL_TASK_STATUSES.has(job.status)) {
            return;
        }
        const mapped = mapJobToGeneratingTask(job);
        if (!mapped || !assetIdSet.has(mapped.assetId)) {
            return;
        }
        keys.add(`${mapped.assetId}:${mapped.generationType}`);
    });
    return Array.from(keys);
}

const LOCAL_PENDING_TASK_TTL_MS = 15000;

export default function ConsistencyVault() {
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const reconcileGeneratingTasks = useProjectStore((state) => state.reconcileGeneratingTasks);
    const enqueueReceipts = useTaskStore((state) => state.enqueueReceipts);
    const fetchProjectJobs = useTaskStore((state) => state.fetchProjectJobs);
    const jobsById = useTaskStore((state) => state.jobsById);
    const jobIdsByProject = useTaskStore((state) => state.jobIdsByProject);
    const { account, getTaskPrice, canAffordTask } = useBillingGuard();



    const [activeTab, setActiveTab] = useState<"character" | "scene" | "prop">("character");

    // Use global state for generation status to persist across navigation
    // Refactored to track { assetId, generationType }
    const generatingTasks = useProjectStore((state) => state.generatingTasks || []); // Fallback to empty array if not defined yet
    const addGeneratingTask = useProjectStore((state) => state.addGeneratingTask);
    const removeGeneratingTask = useProjectStore((state) => state.removeGeneratingTask);

    // Store ID and Type instead of full object to ensure reactivity
    const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
    const [selectedAssetType, setSelectedAssetType] = useState<string | null>(null);

    // Create asset dialog state
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const assetGeneratePrice = getTaskPrice("asset.generate");
    const assetGenerateAffordable = canAffordTask("asset.generate");
    const motionRefGeneratePrice = getTaskPrice("asset.motion_ref.generate");
    const motionRefAffordable = canAffordTask("asset.motion_ref.generate");
    const effectiveCharacters = getEffectiveProjectCharacters(currentProject);
    const previousActiveTaskKeysRef = useRef<string[]>([]);
    const previousProjectIdRef = useRef<string | null>(null);
    const [pendingGeneratingTasks, setPendingGeneratingTasks] = useState<
        { assetId: string; generationType: string; batchSize: number; expiresAt: number }[]
    >([]);

    // Derive selected asset from currentProject
    const selectedAsset = currentProject ? (() => {
        if (!selectedAssetId || !selectedAssetType) return null;
        const list = selectedAssetType === "character" ? effectiveCharacters :
            selectedAssetType === "scene" ? currentProject.scenes :
                selectedAssetType === "prop" ? currentProject.props : [];
        return list?.find((a: any) => a.id === selectedAssetId) || null;
    })() : null;

    const effectiveGeneratingTasks = useMemo(() => {
        const now = Date.now();
        const merged = new Map<string, { assetId: string; generationType: string; batchSize: number }>();

        [...(generatingTasks || []), ...pendingGeneratingTasks.filter((task) => task.expiresAt > now)].forEach((task: any) => {
            const key = `${task.assetId}:${task.generationType}`;
            merged.set(key, {
                assetId: task.assetId,
                generationType: task.generationType,
                batchSize: task.batchSize,
            });
        });

        return Array.from(merged.values());
    }, [generatingTasks, pendingGeneratingTasks]);

    const isAssetGenerating = (assetId: string) => {
        return effectiveGeneratingTasks.some((t: any) => t.assetId === assetId);
    };

    const getAssetGeneratingTypes = (assetId: string) => {
        return effectiveGeneratingTasks.filter((t: any) => t.assetId === assetId).map((t: any) => ({
            type: t.generationType,
            batchSize: t.batchSize
        }));
    };

    const handleUpdateDescription = async (assetId: string, type: string, description: string) => {
        if (!currentProject) return;
        try {
            const updatedProject = await api.updateAssetDescription(currentProject.id, assetId, type, description);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to update description:", error);
        }
    };

    const handleGenerate = async (
        assetId: string,
        type: string,
        generationType: string = "all",
        prompt: string = "",
        applyStyle: boolean = true,
        negativePrompt: string = "",
        batchSize: number = 1,
        modelName?: string,
    ) => {
        if (!currentProject) return;

        // Add task with specific generation type and batch size
        if (addGeneratingTask) {
            addGeneratingTask(assetId, generationType, batchSize);
        }
        setPendingGeneratingTasks((current) => {
            const nextTask = {
                assetId,
                generationType,
                batchSize,
                expiresAt: Date.now() + LOCAL_PENDING_TASK_TTL_MS,
            };
            return [
                ...current.filter((task) => !(task.assetId === assetId && task.generationType === generationType)),
                nextTask,
            ];
        });

        try {
            const stylePrompt = currentProject?.art_direction?.style_config?.positive_prompt || "";

            console.log("[handleGenerate] Starting asset generation...");

            // Call API - now returns immediately with task_id
            const response = await api.generateAsset(
                currentProject.id,
                assetId,
                type,
                "ArtDirection",
                stylePrompt,
                generationType,
                prompt,
                applyStyle,
                negativePrompt,
                batchSize,
                modelName || currentProject.model_settings?.t2i_model
            );
            enqueueReceipts(currentProject.id, [response]);
        } catch (error: any) {
            console.error("Failed to generate asset:", error);
            alert(formatRequestFailureMessage(error, "启动生成任务失败"));
            setPendingGeneratingTasks((current) =>
                current.filter((task) => !(task.assetId === assetId && task.generationType === generationType)),
            );
            if (removeGeneratingTask) {
                removeGeneratingTask(assetId, generationType);
            }
        }
    };

    // Delete asset handler
    const handleDeleteAsset = async (assetId: string, type: string) => {
        if (!currentProject) return;
        if (!confirm(`确定要删除这个${getAssetTypeLabel(type)}吗？`)) return;

        try {
            if (type === "character") {
                await crudApi.deleteCharacter(currentProject.id, assetId);
            } else if (type === "scene") {
                await crudApi.deleteScene(currentProject.id, assetId);
            } else if (type === "prop") {
                await crudApi.deleteProp(currentProject.id, assetId);
            }
            // Refresh project data
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to delete asset:", error);
            alert("删除素材失败");
        }
    };

    // Create asset handler
    const handleCreateAsset = async (
        type: "character" | "scene" | "prop",
        data: {
            name: string;
            description?: string;
            age?: string;
            gender?: string;
            clothing?: string;
            time_of_day?: string;
            lighting_mood?: string;
        }
    ) => {
        if (!currentProject) return;

        try {
            if (type === "character") {
                await crudApi.createCharacter(currentProject.id, data);
            } else if (type === "scene") {
                await crudApi.createScene(currentProject.id, data);
            } else if (type === "prop") {
                await crudApi.createProp(currentProject.id, data);
            }
            // Refresh project data
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
            setIsCreateDialogOpen(false);
        } catch (error) {
            console.error("Failed to create asset:", error);
            alert("创建素材失败");
        }
    };

    // Video Handlers
    const handleGenerateVideo = async (assetId: string, type: string, prompt: string, negativePrompt: string, duration: number, assetSubType?: string) => {
        if (!currentProject) return;
        const resolvedAssetSubType = assetSubType || "full_body";

        // Validate and map the assetSubType to ensure correct values are passed
        let finalAssetType: 'full_body' | 'head_shot' | 'scene' | 'prop' = 'full_body';

        // Different mappings based on the type of asset
        if (type === "scene") {
            finalAssetType = "scene";
        } else if (type === "prop") {
            finalAssetType = "prop";
        } else {
            // For character types, ensure assetSubType is valid
            if (resolvedAssetSubType === "head_shot") {
                finalAssetType = "head_shot";
            } else {
                finalAssetType = "full_body";  // default to full_body
            }
        }

        // 中文注释：把场景/道具也映射成独立 generationType，避免和角色动态任务互相污染 UI 生成状态。
        const generationType =
            finalAssetType === "scene"
                ? "video_scene"
                : finalAssetType === "prop"
                    ? "video_prop"
                    : resolvedAssetSubType === "head_shot"
                        ? "video_head_shot"
                        : "video_full_body";

        if (addGeneratingTask) {
            addGeneratingTask(assetId, generationType, 1);
        }
        setPendingGeneratingTasks((current) => {
            const nextTask = {
                assetId,
                generationType,
                batchSize: 1,
                expiresAt: Date.now() + LOCAL_PENDING_TASK_TTL_MS,
            };
            return [
                ...current.filter((task) => !(task.assetId === assetId && task.generationType === generationType)),
                nextTask,
            ];
        });

        try {
            console.log(`[handleGenerateVideo] Starting ${generationType} generation for asset ${type}, type: ${finalAssetType}...`);
            const response = await api.generateMotionRef(
                currentProject.id,
                assetId,
                finalAssetType,
                prompt,
                undefined, // audioUrl
                negativePrompt,
                duration
            );
            enqueueReceipts(currentProject.id, [response]);
        } catch (error: any) {
            console.error("Failed to generate video:", error);
            alert(formatRequestFailureMessage(error, "启动视频生成失败"));
            setPendingGeneratingTasks((current) =>
                current.filter((task) => !(task.assetId === assetId && task.generationType === generationType)),
            );
            if (removeGeneratingTask) {
                removeGeneratingTask(assetId, generationType);
            }
        }
    };

    const handleDeleteVideo = async (assetId: string, type: string, videoId: string) => {
        if (!currentProject) return;
        if (!confirm("确定要删除这个视频吗？此操作不可撤销。")) return;

        try {
            await api.deleteAssetVideo(currentProject.id, type, assetId, videoId);
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
        } catch (error: any) {
            console.error("Failed to delete video:", error);
            alert(`Failed to delete video: ${error.message}`);
        }
    };

    const assets = activeTab === "character" ? effectiveCharacters :
        activeTab === "scene" ? currentProject?.scenes :
            activeTab === "prop" ? currentProject?.props : [];
    const currentProjectAssetIds = useMemo(() => {
        if (!currentProject) {
            return [];
        }

        return [
            ...effectiveCharacters.map((asset: any) => asset.id),
            ...(currentProject.scenes || []).map((asset: any) => asset.id),
            ...(currentProject.props || []).map((asset: any) => asset.id),
        ];
    }, [currentProject, effectiveCharacters]);
    const currentProjectAssetIdSet = useMemo(() => new Set(currentProjectAssetIds), [currentProjectAssetIds]);
    const currentProjectGeneratingTasks = useMemo(() => {
        return effectiveGeneratingTasks.filter((task: any) => currentProjectAssetIdSet.has(task.assetId));
    }, [currentProjectAssetIdSet, effectiveGeneratingTasks]);
    const activeGeneratingTaskKeys = useMemo(() => {
        return currentProjectGeneratingTasks.map((task: any) => `${task.assetId}:${task.generationType}`).sort();
    }, [currentProjectGeneratingTasks]);
    const currentProjectTaskIds = useMemo(() => {
        if (!currentProject) {
            return EMPTY_TASK_IDS;
        }
        return jobIdsByProject[currentProject.id] || EMPTY_TASK_IDS;
    }, [currentProject, jobIdsByProject]);
    const terminalGeneratingTaskKeys = useMemo(() => {
        if (!currentProject) {
            return EMPTY_TASK_IDS;
        }

        // 中文注释：任务队列已经进入终态时，立即回收对应 optimistic 生成态，避免卡片继续显示“生成中”。
        return collectTerminalGeneratingTaskKeys(jobsById, currentProjectTaskIds, currentProjectAssetIdSet);
    }, [currentProject, currentProjectAssetIdSet, currentProjectTaskIds, jobsById]);

    useEffect(() => {
        if (!currentProject) {
            return;
        }

        let isCancelled = false;

        // 生成态会被持久化到 localStorage；页面刷新后必须和 task_jobs 对账，
        // 否则任务其实早已完成，卡片仍会永久显示“生成中”。
        const reconcileWithTaskQueue = async () => {
            try {
                const jobs = await fetchProjectJobs(currentProject.id, ACTIVE_TASK_STATUSES);
                if (isCancelled) {
                    return;
                }
                const activeTasks = jobs
                    .map(mapJobToGeneratingTask)
                    .filter((task): task is { assetId: string; generationType: string; batchSize: number } => Boolean(task))
                    .filter((task) => currentProjectAssetIdSet.has(task.assetId));
                reconcileGeneratingTasks(currentProjectAssetIds, activeTasks);
            } catch (error) {
                if (!isCancelled) {
                    console.error("Failed to reconcile asset generation tasks:", error);
                }
            }
        };

        void reconcileWithTaskQueue();
        return () => {
            isCancelled = true;
        };
    }, [currentProject, currentProjectAssetIdSet, currentProjectAssetIds, fetchProjectJobs, reconcileGeneratingTasks]);

    useEffect(() => {
        const timer = window.setInterval(() => {
            const now = Date.now();
            setPendingGeneratingTasks((current) => current.filter((task) => task.expiresAt > now));
        }, 1000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    useEffect(() => {
        if (generatingTasks.length === 0) {
            return;
        }

        const activeKeys = new Set(generatingTasks.map((task: any) => `${task.assetId}:${task.generationType}`));
        setPendingGeneratingTasks((current) =>
            current.filter((task) => !activeKeys.has(`${task.assetId}:${task.generationType}`)),
        );
    }, [generatingTasks]);

    useEffect(() => {
        if (terminalGeneratingTaskKeys.length === 0) {
            return;
        }
        const terminalKeySet = new Set(terminalGeneratingTaskKeys);
        setPendingGeneratingTasks((current) =>
            current.filter((task) => !terminalKeySet.has(`${task.assetId}:${task.generationType}`)),
        );
    }, [terminalGeneratingTaskKeys]);

    useEffect(() => {
        if (!currentProject) {
            return;
        }

        let cancelled = false;
        let timeoutId: number | null = null;

        // 关闭弹窗后仍然持续轮询活跃任务，保证资产卡片和再次打开的工作台都能吃到最新状态。
        const pollActiveAssetJobs = async () => {
            try {
                const jobs = await fetchProjectJobs(currentProject.id, ACTIVE_TASK_STATUSES);
                if (cancelled) {
                    return;
                }
                const activeTasks = jobs
                    .map(mapJobToGeneratingTask)
                    .filter((task): task is { assetId: string; generationType: string; batchSize: number } => Boolean(task))
                    .filter((task) => currentProjectAssetIdSet.has(task.assetId));
                reconcileGeneratingTasks(currentProjectAssetIds, activeTasks);
            } catch (error) {
                if (!cancelled) {
                    console.error("Failed to poll active asset jobs:", error);
                }
            } finally {
                if (!cancelled) {
                    timeoutId = window.setTimeout(pollActiveAssetJobs, 3000);
                }
            }
        };

        timeoutId = window.setTimeout(pollActiveAssetJobs, 3000);
        return () => {
            cancelled = true;
            if (timeoutId) {
                window.clearTimeout(timeoutId);
            }
        };
    }, [activeGeneratingTaskKeys, currentProject, currentProjectAssetIdSet, currentProjectAssetIds, fetchProjectJobs, reconcileGeneratingTasks]);

    useEffect(() => {
        if (!currentProject) {
            previousActiveTaskKeysRef.current = [];
            previousProjectIdRef.current = null;
            return;
        }

        if (previousProjectIdRef.current !== currentProject.id) {
            previousProjectIdRef.current = currentProject.id;
            previousActiveTaskKeysRef.current = activeGeneratingTaskKeys;
            return;
        }

        const previousKeys = previousActiveTaskKeysRef.current;
        const activeKeySet = new Set(activeGeneratingTaskKeys);
        const finishedTaskKeys = previousKeys.filter((taskKey) => !activeKeySet.has(taskKey));
        previousActiveTaskKeysRef.current = activeGeneratingTaskKeys;

        if (finishedTaskKeys.length === 0) {
            return;
        }

        let cancelled = false;

        // 只有后台任务刚结束时才补拉项目详情，避免历史完成任务导致工作台重复刷新。
        void (async () => {
            try {
                const refreshedProject = await api.getProject(currentProject.id);
                if (!cancelled) {
                    updateProject(currentProject.id, refreshedProject);
                }
            } catch (error) {
                if (!cancelled) {
                    console.error("Failed to refresh project after asset task completion:", error);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [activeGeneratingTaskKeys, currentProject, updateProject]);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className={PANEL_HEADER_CLASS}>
                <h2 className={PANEL_TITLE_CLASS}>
                    <Users className="text-primary" size={16} />
                    资产制作
                    <span className={`${PANEL_META_TEXT_CLASS} font-normal`}>角色 / 场景 / 道具 - 统一制作与沉淀</span>
                </h2>
            </div>

            <div className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                    <AssetTypeTabs
                        layoutIdPrefix="consistency-vault-asset-type"
                        value={activeTab}
                        onChange={setActiveTab}
                        items={[
                            {
                                id: "character",
                                label: "角色",
                                icon: <User size={14} />,
                                count: effectiveCharacters.length,
                            },
                            {
                                id: "scene",
                                label: "场景",
                                icon: <MapPin size={14} />,
                                count: currentProject?.scenes?.length || 0,
                            },
                            {
                                id: "prop",
                                label: "道具",
                                icon: <Box size={14} />,
                                count: currentProject?.props?.length || 0,
                            },
                        ]}
                    />

                    <button
                        type="button"
                        onClick={() => setIsCreateDialogOpen(true)}
                        disabled={!currentProject}
                        className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--studio-shell-accent-soft)] bg-[color:var(--studio-shell-accent-soft)] px-4 py-2 text-xs font-semibold text-[color:var(--studio-shell-accent-strong)] shadow-sm transition-colors hover:bg-[color:var(--studio-shell-accent-subtle)] hover:border-[color:var(--studio-shell-accent)] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Plus size={14} />
                        新增{getAssetTypeLabel(activeTab)}
                    </button>
                </div>
                {activeTab === "character" && currentProject?.series_id && (
                    <ProjectCharacterSourceHintBanner project={currentProject} className="mt-3" />
                )}
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                {!currentProject ? (
                    <div className="flex items-center justify-center h-full">
                        <div className="flex flex-col items-center gap-4 animate-pulse">
                            <div className="h-12 w-12 rounded-full border-2 border-indigo-500/20 border-t-indigo-500 animate-spin" />
                            <p className="text-xs font-bold text-gray-500 tracking-widest uppercase">Loading Assets</p>
                        </div>
                    </div>
                ) : assets?.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full py-20 px-6">
                        <div className="w-24 h-24 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center mb-6 shadow-2xl">
                            {activeTab === "character" ? <User size={48} className="text-gray-500" /> : activeTab === "scene" ? <MapPin size={48} className="text-gray-500" /> : <Box size={48} className="text-gray-500" />}
                        </div>
                        <h3 className="text-lg font-bold text-white mb-2">暂无{getAssetTypeLabel(activeTab)}资产</h3>
                        <p className="text-sm text-gray-500 text-center max-w-xs">
                            使用上方“新增{getAssetTypeLabel(activeTab)}”开始创建，或返回“剧本处理”步骤自动提取。
                        </p>
                    </div>
                ) : (
                    <div className="p-6">
                        <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6">
                            {assets?.map((asset: any) => (
                                <StudioAssetCard
                                    key={asset.id}
                                    asset={asset}
                                    type={activeTab}
                                    isGenerating={isAssetGenerating(asset.id)}
                                    onClick={() => {
                                        setSelectedAssetId(asset.id);
                                        setSelectedAssetType(activeTab);
                                    }}
                                    onDelete={() => handleDeleteAsset(asset.id, activeTab)}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Detail Modal / Workbench */}
            <AnimatePresence>
                {selectedAsset && selectedAssetId && selectedAssetType && (
                    selectedAssetType === "character" ? (
                        <CharacterWorkbench
                            asset={selectedAsset}
                            onClose={() => {
                                setSelectedAssetId(null);
                                setSelectedAssetType(null);
                            }}
                            onUpdateDescription={(desc: string) => handleUpdateDescription(selectedAssetId, selectedAssetType, desc)}
                            onGenerate={(type: string, prompt: string, applyStyle: boolean, negativePrompt: string, batchSize: number, modelName?: string) => handleGenerate(selectedAssetId, selectedAssetType, type, prompt, applyStyle, negativePrompt, batchSize, modelName)}
                            generatingTypes={getAssetGeneratingTypes(selectedAssetId)}
                            stylePrompt={currentProject?.art_direction?.style_config?.positive_prompt || ""}
                            styleNegativePrompt={currentProject?.art_direction?.style_config?.negative_prompt || ""}
                            onGenerateVideo={(prompt: string, negativePrompt: string, duration: number, subType?: string) => handleGenerateVideo(selectedAssetId, selectedAssetType, prompt, negativePrompt, duration, subType)}
                            onDeleteVideo={(videoId: string) => handleDeleteVideo(selectedAssetId, selectedAssetType, videoId)}
                            promptStateProjectId={currentProject?.id}
                        />
                    ) : (selectedAssetType === "scene" || selectedAssetType === "prop") ? (
                            <ScenePropWorkbenchModal
                                asset={selectedAsset as any}
                                assetType={selectedAssetType as "scene" | "prop"}
                            promptStateProjectId={currentProject?.id}
                            onClose={() => {
                                setSelectedAssetId(null);
                                setSelectedAssetType(null);
                            }}
                            onUpdateDescription={(desc: string) => handleUpdateDescription(selectedAssetId, selectedAssetType, desc)}
                            styleNegativePrompt={currentProject?.art_direction?.style_config?.negative_prompt || ""}
                            onSelectVariant={(variantId: string) =>
                                api.selectAssetVariant(currentProject!.id, selectedAssetId, selectedAssetType, variantId).then((updatedProject) => {
                                    updateProject(currentProject!.id, updatedProject);
                                })
                            }
                            onDeleteVariant={(variantId: string) =>
                                api.deleteAssetVariant(currentProject!.id, selectedAssetId, selectedAssetType, variantId).then((updatedProject) => {
                                    updateProject(currentProject!.id, updatedProject);
                                })
                            }
                            onGenerateImage={(prompt: string, negativePrompt: string, batchSize: number) =>
                                handleGenerate(
                                    selectedAssetId,
                                    selectedAssetType,
                                    "all",
                                    prompt,
                                    true,
                                    negativePrompt,
                                    batchSize,
                                    currentProject?.model_settings?.t2i_model,
                                )
                            }
                            onGenerateVideo={(prompt: string, negativePrompt: string) =>
                                handleGenerateVideo(selectedAssetId, selectedAssetType, prompt, negativePrompt, 5, "video")
                            }
                            isGeneratingImage={isAssetGenerating(selectedAssetId)}
                            isGeneratingVideo={getAssetGeneratingTypes(selectedAssetId).some((t: any) => t.type.startsWith("video"))}
                            imagePriceCredits={assetGeneratePrice}
                            imageBalanceCredits={account?.balance_credits ?? 0}
                            imageAffordable={assetGenerateAffordable}
                            videoPriceCredits={motionRefGeneratePrice}
                            videoBalanceCredits={account?.balance_credits ?? 0}
                            videoAffordable={motionRefAffordable}
                        />
                    ) : null
                )}
            </AnimatePresence>



            {/* Create Asset Dialog */}
            <AnimatePresence>
                {isCreateDialogOpen && (
                    <CreateAssetDialog
                        initialType={activeTab}
                        onClose={() => setIsCreateDialogOpen(false)}
                        onCreate={handleCreateAsset}
                    />
                )}
            </AnimatePresence>
        </div >
    );
}

function CreateAssetDialog({
    initialType,
    onClose,
    onCreate,
}: {
    initialType: "character" | "scene" | "prop";
    onClose: () => void;
    onCreate: (
        type: "character" | "scene" | "prop",
        data: {
            name: string;
            description?: string;
            age?: string;
            gender?: string;
            clothing?: string;
            time_of_day?: string;
            lighting_mood?: string;
        }
    ) => void | Promise<void>;
}) {
    const [activeType, setActiveType] = useState<"character" | "scene" | "prop">(initialType);
    const [characterForm, setCharacterForm] = useState({
        name: "",
        description: "",
        age: "",
        gender: "",
        clothing: "",
    });
    const [sceneForm, setSceneForm] = useState({
        name: "",
        description: "",
        time_of_day: "",
        lighting_mood: "",
    });
    const [propForm, setPropForm] = useState({
        name: "",
        description: "",
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        const currentName =
            activeType === "character"
                ? characterForm.name
                : activeType === "scene"
                    ? sceneForm.name
                    : propForm.name;

        if (!currentName.trim()) {
            alert("请先填写名称");
            return;
        }
        setIsSubmitting(true);
        try {
            const prune = (value: string) => {
                const trimmed = value.trim();
                return trimmed ? trimmed : undefined;
            };

            if (activeType === "character") {
                await onCreate("character", {
                    name: characterForm.name.trim(),
                    description: prune(characterForm.description),
                    age: prune(characterForm.age),
                    gender: prune(characterForm.gender),
                    clothing: prune(characterForm.clothing),
                });
            } else if (activeType === "scene") {
                await onCreate("scene", {
                    name: sceneForm.name.trim(),
                    description: prune(sceneForm.description),
                    time_of_day: prune(sceneForm.time_of_day),
                    lighting_mood: prune(sceneForm.lighting_mood),
                });
            } else {
                await onCreate("prop", {
                    name: propForm.name.trim(),
                    description: prune(propForm.description),
                });
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const typeLabel = getAssetTypeLabel(activeType);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="asset-surface-strong border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
            >
                <div className="p-6 border-b border-white/10 bg-black/20">
                    <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                            <div className="flex items-center gap-3">
                                <Plus className="text-primary" size={20} />
                                <h2 className="text-lg font-bold text-white">新增资产</h2>
                            </div>
                            <p className="mt-1 text-[11px] text-gray-500">按类型填写关键属性，后续生成会更稳定。</p>
                        </div>
                        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg transition-colors">
                            <X size={20} className="text-gray-400" />
                        </button>
                    </div>

                    <div className="mt-5 flex items-center gap-1 rounded-2xl border border-white/10 bg-black/30 p-1">
                        <button
                            onClick={() => setActiveType("character")}
                            className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                                activeType === "character" ? "bg-indigo-500/25 text-indigo-200 border border-indigo-400/30" : "text-gray-300 hover:bg-white/5"
                            }`}
                        >
                            <User size={14} />
                            角色
                        </button>
                        <button
                            onClick={() => setActiveType("scene")}
                            className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                                activeType === "scene" ? "bg-emerald-500/20 text-emerald-200 border border-emerald-400/25" : "text-gray-300 hover:bg-white/5"
                            }`}
                        >
                            <MapPin size={14} />
                            场景
                        </button>
                        <button
                            onClick={() => setActiveType("prop")}
                            className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                                activeType === "prop" ? "bg-amber-500/20 text-amber-200 border border-amber-400/25" : "text-gray-300 hover:bg-white/5"
                            }`}
                        >
                            <Box size={14} />
                            道具
                        </button>
                    </div>
                </div>

                <div className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">名称 *</label>
                        <input
                            type="text"
                            value={
                                activeType === "character"
                                    ? characterForm.name
                                    : activeType === "scene"
                                        ? sceneForm.name
                                        : propForm.name
                            }
                            onChange={(e) => {
                                const next = e.target.value;
                                if (activeType === "character") setCharacterForm((prev) => ({ ...prev, name: next }));
                                else if (activeType === "scene") setSceneForm((prev) => ({ ...prev, name: next }));
                                else setPropForm((prev) => ({ ...prev, name: next }));
                            }}
                            placeholder={`请输入${typeLabel}名称`}
                            className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:border-primary/50 focus:outline-none"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">描述</label>
                        <textarea
                            value={
                                activeType === "character"
                                    ? characterForm.description
                                    : activeType === "scene"
                                        ? sceneForm.description
                                        : propForm.description
                            }
                            onChange={(e) => {
                                const next = e.target.value;
                                if (activeType === "character") setCharacterForm((prev) => ({ ...prev, description: next }));
                                else if (activeType === "scene") setSceneForm((prev) => ({ ...prev, description: next }));
                                else setPropForm((prev) => ({ ...prev, description: next }));
                            }}
                            placeholder={`请输入${typeLabel}描述`}
                            rows={4}
                            className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:border-primary/50 focus:outline-none resize-none"
                        />
                    </div>

                    {activeType === "character" ? (
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-gray-500 mb-2">年龄</label>
                                <input
                                    value={characterForm.age}
                                    onChange={(e) => setCharacterForm((prev) => ({ ...prev, age: e.target.value }))}
                                    placeholder="例如：18"
                                    className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:border-primary/50 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-2">性别</label>
                                <input
                                    value={characterForm.gender}
                                    onChange={(e) => setCharacterForm((prev) => ({ ...prev, gender: e.target.value }))}
                                    placeholder="例如：女"
                                    className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:border-primary/50 focus:outline-none"
                                />
                            </div>
                            <div className="col-span-2">
                                <label className="block text-xs text-gray-500 mb-2">服装</label>
                                <input
                                    value={characterForm.clothing}
                                    onChange={(e) => setCharacterForm((prev) => ({ ...prev, clothing: e.target.value }))}
                                    placeholder="例如：黑色风衣、白衬衫"
                                    className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:border-primary/50 focus:outline-none"
                                />
                            </div>
                        </div>
                    ) : activeType === "scene" ? (
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-gray-500 mb-2">时间</label>
                                <input
                                    value={sceneForm.time_of_day}
                                    onChange={(e) => setSceneForm((prev) => ({ ...prev, time_of_day: e.target.value }))}
                                    placeholder="例如：清晨 / 夜晚"
                                    className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:border-primary/50 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-500 mb-2">光照氛围</label>
                                <input
                                    value={sceneForm.lighting_mood}
                                    onChange={(e) => setSceneForm((prev) => ({ ...prev, lighting_mood: e.target.value }))}
                                    placeholder="例如：霓虹、逆光"
                                    className="w-full px-4 py-3 bg-black/30 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:border-primary/50 focus:outline-none"
                                />
                            </div>
                        </div>
                    ) : null}
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
                        disabled={
                            isSubmitting ||
                            !(activeType === "character"
                                ? characterForm.name.trim()
                                : activeType === "scene"
                                    ? sceneForm.name.trim()
                                    : propForm.name.trim())
                        }
                        className="px-6 py-2 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isSubmitting && <RefreshCw size={16} className="animate-spin" />}
                        创建{typeLabel}
                    </button>
                </div>
            </motion.div>
        </div>
    );
}
