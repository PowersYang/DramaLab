"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { User, Users, MapPin, Box, RefreshCw, Image as ImageIcon, X, Check, ChevronRight, Trash2, Plus, Video, FileText, Wand2, Palette, Sliders } from "lucide-react";
import { useBillingGuard } from "@/hooks/useBillingGuard";
import { useProjectStore } from "@/store/projectStore";
import { api, crudApi, TaskJob } from "@/lib/api";
import { useTaskStore } from "@/store/taskStore";
import { getCharacterPreviewImage } from "@/lib/characterAssets";
import { getAssetUrl, getAssetUrlWithTimestamp } from "@/lib/utils";
import { getEffectiveProjectCharacters, getProjectCharacterSourceHint } from "@/lib/projectAssets";
import AssetTypeTabs from "@/components/common/AssetTypeTabs";
import CharacterWorkbench from "./CharacterWorkbench";
import { VariantSelector } from "../common/VariantSelector";
import { VideoVariantSelector } from "../common/VideoVariantSelector";
import { PANEL_HEADER_CLASS, PANEL_META_TEXT_CLASS, PANEL_TITLE_CLASS } from "@/components/modules/panelHeaderStyles";

function getAssetTypeLabel(type: "character" | "scene" | "prop" | string) {
    if (type === "character") return "角色";
    if (type === "scene") return "场景";
    if (type === "prop") return "道具";
    return "素材";
}

const ACTIVE_TASK_STATUSES = ["queued", "claimed", "running", "retry_waiting", "cancel_requested"];

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
        return {
            assetId,
            generationType: job.payload_json?.asset_type === "head_shot" ? "video_head_shot" : "video_full_body",
            batchSize: 1,
        };
    }

    return null;
}

export default function ConsistencyVault() {
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const reconcileGeneratingTasks = useProjectStore((state) => state.reconcileGeneratingTasks);
    const enqueueReceipts = useTaskStore((state) => state.enqueueReceipts);
    const waitForJob = useTaskStore((state) => state.waitForJob);
    const fetchProjectJobs = useTaskStore((state) => state.fetchProjectJobs);
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

    // Derive selected asset from currentProject
    const selectedAsset = currentProject ? (() => {
        if (!selectedAssetId || !selectedAssetType) return null;
        const list = selectedAssetType === "character" ? effectiveCharacters :
            selectedAssetType === "scene" ? currentProject.scenes :
                selectedAssetType === "prop" ? currentProject.props : [];
        return list?.find((a: any) => a.id === selectedAssetId) || null;
    })() : null;

    const isAssetGenerating = (assetId: string) => {
        return generatingTasks?.some((t: any) => t.assetId === assetId);
    };

    const getAssetGeneratingTypes = (assetId: string) => {
        return generatingTasks?.filter((t: any) => t.assetId === assetId).map((t: any) => ({
            type: t.generationType,
            batchSize: t.batchSize
        })) || [];
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

    const handleGenerate = async (assetId: string, type: string, generationType: string = "all", prompt: string = "", applyStyle: boolean = true, negativePrompt: string = "", batchSize: number = 1) => {
        if (!currentProject) return;

        // Add task with specific generation type and batch size
        if (addGeneratingTask) {
            addGeneratingTask(assetId, generationType, batchSize);
        }

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
                currentProject.model_settings?.t2i_model
            );
            enqueueReceipts(currentProject.id, [response]);
            const job = await waitForJob(response.job_id, { intervalMs: 2000 });
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
            if (["failed", "timed_out"].includes(job.status)) {
                alert(job.error_message || "生成失败，请稍后重试");
            }
        } catch (error: any) {
            console.error("Failed to generate asset:", error);
            alert(`启动生成任务失败: ${error.response?.data?.detail || error.message}`);
        } finally {
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

        // Use a more specific generation type to avoid state pollution
        const generationType = resolvedAssetSubType === "head_shot" ? "video_head_shot" : "video_full_body";

        if (addGeneratingTask) {
            addGeneratingTask(assetId, generationType, 1);
        }

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
            const job = await waitForJob(response.job_id, { intervalMs: 3000 });
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
            if (["failed", "timed_out"].includes(job.status)) {
                alert(`视频生成失败: ${job.error_message || '生成失败，请稍后重试'}`);
            }
        } catch (error: any) {
            console.error("Failed to generate video:", error);
            alert(`启动视频生成失败: ${error.response?.data?.detail || error.message}`);
        } finally {
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

    useEffect(() => {
        if (!currentProject) {
            return;
        }

        const projectAssetIds = [
            ...effectiveCharacters.map((asset: any) => asset.id),
            ...(currentProject.scenes || []).map((asset: any) => asset.id),
            ...(currentProject.props || []).map((asset: any) => asset.id),
        ];
        const projectAssetIdSet = new Set(projectAssetIds);

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
                    .filter((task) => projectAssetIdSet.has(task.assetId));
                reconcileGeneratingTasks(projectAssetIds, activeTasks);
            } catch (error) {
                if (!isCancelled) {
                    console.error("Failed to reconcile asset generation tasks:", error);
                }
            }
        };

        void reconcileWithTaskQueue();
        const timer = window.setInterval(() => {
            void reconcileWithTaskQueue();
        }, 15000);

        return () => {
            isCancelled = true;
            window.clearInterval(timer);
        };
    }, [currentProject, effectiveCharacters, fetchProjectJobs, reconcileGeneratingTasks]);

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
                    <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] leading-5 text-amber-100">
                        {getProjectCharacterSourceHint(currentProject)}
                    </div>
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
                                <AssetCard
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
                            onGenerate={(type: string, prompt: string, applyStyle: boolean, negativePrompt: string, batchSize: number) => handleGenerate(selectedAssetId, selectedAssetType, type, prompt, applyStyle, negativePrompt, batchSize)}
                            generatingTypes={getAssetGeneratingTypes(selectedAssetId)}
                            stylePrompt={currentProject?.art_direction?.style_config?.positive_prompt || ""}
                            styleNegativePrompt={currentProject?.art_direction?.style_config?.negative_prompt || ""}
                            onGenerateVideo={(prompt: string, negativePrompt: string, duration: number, subType?: string) => handleGenerateVideo(selectedAssetId, selectedAssetType, prompt, negativePrompt, duration, subType)}
                            onDeleteVideo={(videoId: string) => handleDeleteVideo(selectedAssetId, selectedAssetType, videoId)}
                        />
                    ) : (
                        <CharacterDetailModal
                            asset={selectedAsset}
                            type={selectedAssetType}
                            onClose={() => {
                                setSelectedAssetId(null);
                                setSelectedAssetType(null);
                            }}
                            onUpdateDescription={(desc: string) => handleUpdateDescription(selectedAssetId, selectedAssetType, desc)}
                            onGenerate={(applyStyle: boolean, negativePrompt: string, batchSize: number) => handleGenerate(selectedAssetId, selectedAssetType, "all", "", applyStyle, negativePrompt, batchSize)}
                            isGenerating={isAssetGenerating(selectedAssetId)}
                            generatePriceCredits={assetGeneratePrice}
                            balanceCredits={account?.balance_credits}
                            generateAffordable={assetGenerateAffordable}
                            stylePrompt={currentProject?.art_direction?.style_config?.positive_prompt || ""}
                            styleNegativePrompt={currentProject?.art_direction?.style_config?.negative_prompt || ""}
                            onGenerateVideo={(prompt: string, duration: number) => handleGenerateVideo(selectedAssetId, selectedAssetType, prompt, "", duration, "video")}
                            onDeleteVideo={(videoId: string) => handleDeleteVideo(selectedAssetId, selectedAssetType, videoId)}
                            isGeneratingVideo={getAssetGeneratingTypes(selectedAssetId).some((t: any) => t.type.startsWith("video"))}
                            videoGeneratePriceCredits={motionRefGeneratePrice}
                            videoBalanceCredits={account?.balance_credits}
                            videoGenerateAffordable={motionRefAffordable}
                        />
                    )
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

function CharacterDetailModal({
    asset,
    type,
    onClose,
    onUpdateDescription,
    onGenerate,
    isGenerating,
    generatePriceCredits,
    balanceCredits,
    generateAffordable,
    stylePrompt = "",
    styleNegativePrompt = "",
    onGenerateVideo,
    onDeleteVideo,
    isGeneratingVideo,
    videoGeneratePriceCredits,
    videoBalanceCredits,
    videoGenerateAffordable,
}: any) {
    const [description, setDescription] = useState(asset.description);
    const [isEditing, setIsEditing] = useState(false);
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);

    // Style Controls
    const [applyStyle, setApplyStyle] = useState(true);
    const [negativePrompt, setNegativePrompt] = useState(styleNegativePrompt || "low quality, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry");
    const [showAdvanced, setShowAdvanced] = useState(false);

    // Video Controls
    const [activeTab, setActiveTab] = useState<"image" | "video">("image");
    const [videoPrompt, setVideoPrompt] = useState(asset.video_prompt || "");

    // Sync local state if asset changes
    useEffect(() => {
        setDescription(asset.description);
        if (asset.video_prompt) setVideoPrompt(asset.video_prompt);
        else if (!videoPrompt) {
            setVideoPrompt(`Cinematic shot of ${asset.name}, ${asset.description}, looking around, breathing, slight movement, high quality, 4k`);
        }
    }, [asset]);

    // Sync negative prompt if style changes
    useEffect(() => {
        if (styleNegativePrompt && (!negativePrompt || negativePrompt.includes("low quality"))) {
            setNegativePrompt(styleNegativePrompt);
        }
    }, [styleNegativePrompt]);

    const handleSave = () => {
        onUpdateDescription(description);
        setIsEditing(false);
    };

    const handleSelectVariant = async (variantId: string) => {
        if (!currentProject) return;
        try {
            const updatedProject = await api.selectAssetVariant(currentProject.id, asset.id, type, variantId);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to select variant:", error);
        }
    };

    const handleDeleteVariant = async (variantId: string) => {
        if (!currentProject) return;
        try {
            const updatedProject = await api.deleteAssetVariant(currentProject.id, asset.id, type, variantId);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to delete variant:", error);
        }
    };

    const handleGenerateClick = (batchSize: number) => {
        onGenerate(applyStyle, negativePrompt, batchSize);
    };

    const typeLabel = getAssetTypeLabel(type);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 md:p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="asset-workbench-shell asset-surface-strong border border-white/10 rounded-[32px] w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden shadow-2xl"
            >
                {/* ── Header ── */}
                <div className="flex h-20 items-center justify-between border-b border-white/5 bg-white/[0.02] px-8">
                    <div className="flex items-center gap-4">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                            type === "scene" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                        } border`}>
                            {type === "scene" ? <MapPin size={20} /> : <Box size={20} />}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-xl font-bold text-white">{asset.name}</h2>
                                <span className="px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                                    {typeLabel}详情
                                </span>
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5">管理资产参考图与视频变体</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2.5 hover:bg-white/10 rounded-full text-gray-500 hover:text-white transition-all">
                        <X size={24} />
                    </button>
                </div>

                {/* ── Main Content Area ── */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Left: Media Control */}
                    <div className="w-[55%] flex flex-col border-r border-white/5 bg-black/20">
                        {/* Internal Tabs */}
                        <div className="flex p-2 bg-black/40 border-b border-white/5">
                            <button
                                onClick={() => setActiveTab("image")}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${
                                    activeTab === "image" 
                                        ? "bg-white/10 text-white shadow-lg ring-1 ring-white/10" 
                                        : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                                }`}
                            >
                                <ImageIcon size={16} />
                                图片参考
                            </button>
                            <button
                                onClick={() => setActiveTab("video")}
                                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all ${
                                    activeTab === "video" 
                                        ? "bg-white/10 text-white shadow-lg ring-1 ring-white/10" 
                                        : "text-gray-500 hover:text-gray-300 hover:bg-white/5"
                                }`}
                            >
                                <Video size={16} />
                                视频参考
                            </button>
                        </div>

                        <div className="flex-1 overflow-hidden p-6">
                            {activeTab === "image" ? (
                                <VariantSelector
                                    asset={asset.image_asset}
                                    currentImageUrl={asset.image_url}
                                    onSelect={handleSelectVariant}
                                    onDelete={handleDeleteVariant}
                                    onGenerate={handleGenerateClick}
                                    isGenerating={isGenerating}
                                    disableGenerate={!generateAffordable}
                                    generateDisabledReason="当前组织算力豆余额不足，无法提交资产生成任务"
                                    generatePriceCredits={generatePriceCredits}
                                    generateBalanceCredits={balanceCredits ?? 0}
                                    aspectRatio={type === "scene" ? "16:9" : "1:1"}
                                    className="h-full"
                                />
                            ) : (
                                <VideoVariantSelector
                                    videos={asset.video_assets || []}
                                    onDelete={onDeleteVideo}
                                    onGenerate={(duration) => onGenerateVideo(videoPrompt, duration)}
                                    isGenerating={isGeneratingVideo}
                                    generatePriceCredits={videoGeneratePriceCredits}
                                    generateBalanceCredits={videoBalanceCredits ?? 0}
                                    disableGenerate={!videoGenerateAffordable}
                                    aspectRatio={type === "scene" ? "16:9" : "1:1"}
                                    className="h-full"
                                />
                            )}
                        </div>
                    </div>

                    {/* Right: Info & Settings */}
                    <div className="flex-1 flex flex-col bg-black/20">
                        <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
                            {/* Section: Description */}
                            <section>
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-2 text-gray-400">
                                        <FileText size={14} />
                                        <h3 className="text-xs font-bold uppercase tracking-widest">素材描述</h3>
                                    </div>
                                    {!isEditing && (
                                        <button 
                                            onClick={() => setIsEditing(true)} 
                                            className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors"
                                        >
                                            修改描述
                                        </button>
                                    )}
                                </div>
                                
                                {isEditing ? (
                                    <div className="space-y-3">
                                        <textarea
                                            value={description}
                                            onChange={(e) => setDescription(e.target.value)}
                                            className="w-full h-40 bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-gray-200 resize-none focus:border-indigo-500/50 focus:outline-none focus:ring-4 focus:ring-indigo-500/5 transition-all"
                                            placeholder="请输入详细的素材描述..."
                                        />
                                        <div className="flex justify-end gap-2">
                                            <button 
                                                onClick={() => { setIsEditing(false); setDescription(asset.description); }} 
                                                className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-300 transition-colors"
                                            >
                                                取消
                                            </button>
                                            <button 
                                                onClick={handleSave} 
                                                className="px-5 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/20"
                                            >
                                                保存更改
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="group relative">
                                        <p className="text-[13px] text-gray-300 leading-relaxed bg-white/[0.03] p-5 rounded-2xl border border-white/5 group-hover:border-white/10 transition-all">
                                            {asset.description || "暂未填写描述"}
                                        </p>
                                    </div>
                                )}
                            </section>

                            {/* Section: Prompts */}
                            <section className="space-y-6">
                                {activeTab === "video" ? (
                                    <div className="space-y-4">
                                        <div className="flex items-center gap-2 text-gray-400">
                                            <Wand2 size={14} />
                                            <h3 className="text-xs font-bold uppercase tracking-widest">视频提示词</h3>
                                        </div>
                                        <textarea
                                            value={videoPrompt}
                                            onChange={(e) => setVideoPrompt(e.target.value)}
                                            className="w-full h-32 bg-black/40 border border-white/10 rounded-2xl p-4 text-sm text-gray-300 resize-none focus:border-indigo-500/50 focus:outline-none transition-all"
                                            placeholder="描述您想要的视频动态效果..."
                                        />
                                    </div>
                                ) : (
                                    <div className="space-y-6">
                                        <div className="space-y-4">
                                            <div className="flex items-center gap-2 text-gray-400">
                                                <Palette size={14} />
                                                <h3 className="text-xs font-bold uppercase tracking-widest">全局风格</h3>
                                            </div>
                                            <div className="bg-white/[0.03] rounded-2xl p-5 border border-white/5 space-y-4">
                                                <label className="flex items-center gap-3 cursor-pointer group">
                                                    <div className="relative flex items-center">
                                                        <input
                                                            type="checkbox"
                                                            checked={applyStyle}
                                                            onChange={(e) => setApplyStyle(e.target.checked)}
                                                            className="peer sr-only"
                                                        />
                                                        <div className="h-5 w-9 rounded-full bg-white/10 transition-colors peer-checked:bg-indigo-600" />
                                                        <div className="absolute left-1 top-1 h-3 w-3 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
                                                    </div>
                                                    <span className="text-sm font-bold text-gray-300 group-hover:text-white transition-colors">应用艺术指导风格</span>
                                                </label>

                                                {stylePrompt && (
                                                    <div className="text-[11px] text-gray-500 font-mono bg-black/40 p-3 rounded-xl border border-white/5 leading-relaxed">
                                                        <span className="text-indigo-400 font-bold mr-2">STYLE:</span> 
                                                        {stylePrompt}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="space-y-4">
                                            <button
                                                onClick={() => setShowAdvanced(!showAdvanced)}
                                                className="flex items-center justify-between w-full p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/[0.08] transition-all"
                                            >
                                                <div className="flex items-center gap-2 text-gray-400">
                                                    <Sliders size={14} />
                                                    <span className="text-xs font-bold uppercase tracking-widest">高级设置（负向提示词）</span>
                                                </div>
                                                <ChevronRight size={16} className={`text-gray-500 transform transition-transform duration-300 ${showAdvanced ? 'rotate-90' : ''}`} />
                                            </button>

                                            <AnimatePresence>
                                                {showAdvanced && (
                                                    <motion.div
                                                        initial={{ height: 0, opacity: 0 }}
                                                        animate={{ height: "auto", opacity: 1 }}
                                                        exit={{ height: 0, opacity: 0 }}
                                                        className="overflow-hidden"
                                                    >
                                                        <textarea
                                                            value={negativePrompt}
                                                            onChange={(e) => setNegativePrompt(e.target.value)}
                                                            className="w-full h-32 bg-black/40 border border-white/10 rounded-2xl p-4 text-[11px] text-gray-500 font-mono resize-none focus:border-indigo-500/50 focus:outline-none transition-all"
                                                            placeholder="排除您不想要的视觉元素..."
                                                        />
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    </div>
                                )}
                            </section>
                        </div>

                        {/* Footer Actions */}
                        <div className="p-8 border-t border-white/5 bg-white/[0.02] flex gap-4">
                            <button
                                onClick={onClose}
                                className="flex-1 py-4 rounded-2xl bg-white/5 border border-white/10 text-white font-bold text-sm hover:bg-white/10 transition-all flex items-center justify-center gap-2"
                            >
                                <Check size={18} className="text-indigo-400" />
                                确认完成
                            </button>
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
}

function ImageWithRetry({ src, alt, className }: { src: string, alt: string, className?: string }) {
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(false);
    const [retryCount, setRetryCount] = useState(0);

    // Reset state when src changes
    useEffect(() => {
        setIsLoading(true);
        setError(false);
        setRetryCount(0);
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
                    <RefreshCw className="animate-spin text-white/50" size={24} />
                </div>
            )}
            <img
                src={displaySrc}
                alt={alt}
                className={`${className} ${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
                onLoad={() => setIsLoading(false)}
                onError={() => {
                    setError(true);
                    setIsLoading(true); // Keep showing loader while retrying
                }}
            />
            {error && retryCount >= 10 && (
                <div className="absolute inset-0 flex items-center justify-center bg-red-500/10 backdrop-blur-sm z-20">
                    <span className="text-xs text-red-400 font-bold">加载失败</span>
                </div>
            )}
        </div>
    );
}

function AssetCard({
    asset,
    type,
    isGenerating,
    onClick,
    onDelete,
}: any) {
    const getSelectedVariant = (imageAsset?: { selected_id?: string | null; variants?: Array<{ id: string; url: string; created_at?: string | number }> }) => {
        if (!imageAsset?.variants?.length) return null;
        return imageAsset.variants.find((variant) => variant.id === imageAsset.selected_id) || imageAsset.variants[0];
    };

    const resolveAssetPreview = () => {
        if (type === "character") {
            return getCharacterPreviewImage(asset);
        }

        const selectedVariant = getSelectedVariant(asset.image_asset);
        return {
            previewPath: selectedVariant?.url || asset.image_url,
            previewTimestamp: selectedVariant?.created_at,
        };
    };

    const { previewPath, previewTimestamp } = resolveAssetPreview();
    const fullImageUrl = previewTimestamp
        ? getAssetUrlWithTimestamp(previewPath, typeof previewTimestamp === "number" ? previewTimestamp : new Date(previewTimestamp).getTime())
        : getAssetUrl(previewPath);

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={onClick}
            className="group relative flex flex-col rounded-2xl border border-white/10 bg-white/5 transition-all duration-300 cursor-pointer hover:border-indigo-500/50 hover:bg-white/[0.08] hover:shadow-2xl hover:shadow-indigo-500/10"
        >
            {/* ── Image Container ── */}
            <div className="relative aspect-[3/4] overflow-hidden rounded-t-2xl">
                {previewPath ? (
                    <ImageWithRetry
                        src={fullImageUrl}
                        alt={asset.name}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                ) : (
                    <div className="flex h-full w-full items-center justify-center bg-black/40">
                        <ImageIcon className="text-white/10" size={48} strokeWidth={1} />
                    </div>
                )}

                <div className="absolute right-3 top-3 z-20">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete();
                        }}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/45 text-white/75 shadow-lg shadow-black/30 backdrop-blur-md transition-all hover:border-red-400/30 hover:bg-red-500/25 hover:text-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
                        title="删除"
                    >
                        <Trash2 size={16} />
                    </button>
                </div>

                {/* ── Overlay Gradient ── */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-40 transition-opacity duration-300" />
            </div>

            {/* ── Loading Overlay ── */}
            {isGenerating && (
                <div className="absolute inset-0 z-30 bg-black/70 backdrop-blur-sm flex items-center justify-center flex-col gap-3">
                    <div className="relative">
                        <RefreshCw className="animate-spin text-indigo-400" size={32} />
                        <div className="absolute inset-0 animate-pulse bg-indigo-500/20 blur-xl rounded-full" />
                    </div>
                    <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-indigo-200">Generating</span>
                </div>
            )}

            {/* ── Info Area ── */}
            <div className="flex flex-1 flex-col px-4 pt-3 pb-3">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-[13px] font-bold text-white truncate group-hover:text-indigo-400 transition-colors">
                            {asset.name}
                        </h3>
                    </div>
                    <p className="text-[11px] leading-relaxed text-gray-400 line-clamp-2">
                        {asset.description || "暂未填写描述"}
                    </p>
                </div>
            </div>
        </motion.div>
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
