"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import { X, RefreshCw, Lock, Video, Sparkles, Eye, ChevronLeft, ChevronRight } from "lucide-react";
import BillingTaskHint from "@/components/billing/BillingTaskHint";
import { useBillingGuard } from "@/hooks/useBillingGuard";
import { api } from "@/lib/api";

import { useProjectStore } from "@/store/projectStore";
import { Image as PhotoIcon } from "lucide-react";
import { getAssetUrl } from "@/lib/utils";

type PanelKey = "full_body" | "three_view" | "headshot";
type MotionAssetType = "full_body" | "head_shot";
type VariantLike = {
    id: string;
    url?: string | null;
    created_at?: string | number | null;
    prompt_used?: string | null;
    is_uploaded_source?: boolean;
};
type VideoVariantLike = {
    url?: string | null;
};
type PanelAssetData = {
    selected_id: string | null;
    variants: VariantLike[];
};
type LegacyPanelAsset = {
    selected_id?: string | null;
    variants?: VariantLike[];
    video_variants?: VideoVariantLike[];
};
type UnitPanelAsset = {
    selected_image_id?: string | null;
    image_variants?: VariantLike[];
    video_variants?: VideoVariantLike[];
};
type CharacterAsset = {
    id: string;
    name?: string | null;
    description?: string | null;
    updated_at?: string | number | null;
    created_at?: string | number | null;
    full_body_prompt?: string | null;
    three_view_prompt?: string | null;
    headshot_prompt?: string | null;
    video_prompt?: string | null;
    full_body_image_url?: string | null;
    three_view_image_url?: string | null;
    headshot_image_url?: string | null;
    avatar_url?: string | null;
    full_body_asset?: LegacyPanelAsset | null;
    three_view_asset?: LegacyPanelAsset | null;
    headshot_asset?: LegacyPanelAsset | null;
    full_body?: UnitPanelAsset | null;
    three_views?: UnitPanelAsset | null;
    head_shot?: UnitPanelAsset | null;
};

const DEFAULT_NEGATIVE_PROMPT = "low quality, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, jpeg artifacts, signature, watermark, blurry";
const LATEST_BATCH_WINDOW_MS = 5000;

const parseVariantTime = (value: string | number | undefined | null) => {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
};

// 通过时间窗口和提示词近似识别“最后一次生成”的那一批候选图。
const getLatestBatchVariants = <T extends { created_at?: string | number; prompt_used?: string | null }>(variants: T[]) => {
    if (!Array.isArray(variants) || variants.length === 0) {
        return [];
    }

    const sortedVariants = [...variants].sort((a, b) => parseVariantTime(b.created_at) - parseVariantTime(a.created_at));
    const latestTime = parseVariantTime(sortedVariants[0]?.created_at);
    const latestPrompt = sortedVariants[0]?.prompt_used || "";
    const strictBatch = sortedVariants.filter((variant, index) => {
        if (index === 0) {
            return true;
        }
        const delta = Math.abs(latestTime - parseVariantTime(variant.created_at));
        if (delta > LATEST_BATCH_WINDOW_MS) {
            return false;
        }
        if (latestPrompt && variant.prompt_used && variant.prompt_used !== latestPrompt) {
            return false;
        }
        return true;
    }).slice(0, 4);

    // 历史数据里同批图片可能分批入库，或 prompt_used 存在轻微差异。
    // 如果严格窗口只剩 1 张，就回退到最近的 4 张，避免“明明生成了 4 张却只显示 1 张”。
    if (strictBatch.length <= 1 && sortedVariants.length > 1) {
        return sortedVariants.slice(0, 4);
    }

    return strictBatch;
};

const getAspectRatioCardClass = (aspectRatio: string) => {
    switch (aspectRatio) {
        case "16:9":
            return "aspect-video";
        case "1:1":
            return "aspect-square";
        case "9:16":
        default:
            return "aspect-[9/16]";
    }
};

interface CharacterWorkbenchProps {
    asset: CharacterAsset;
    onClose: () => void;
    onUpdateDescription: (desc: string) => void;
    onGenerate: (type: string, prompt: string, applyStyle: boolean, negativePrompt: string, batchSize: number) => void;
    generatingTypes: { type: string; batchSize: number }[];
    stylePrompt?: string;
    styleNegativePrompt?: string;
    onGenerateVideo?: (prompt: string, negativePrompt: string, duration: number, subType?: string) => void;
    onDeleteVideo?: (videoId: string) => void;
    isGeneratingVideo?: boolean;
}

export default function CharacterWorkbench(props: CharacterWorkbenchProps) {
    const {
        asset,
        onClose,
        onGenerate,
        generatingTypes = [],
        styleNegativePrompt = "",
        onGenerateVideo,
    } = props;
    const [activePanel, setActivePanel] = useState<PanelKey>("full_body");
    const updateProject = useProjectStore(state => state.updateProject);
    const currentProject = useProjectStore(state => state.currentProject);

    // Mode state for Asset Activation v2 (Static/Motion)
    const [fullBodyMode, setFullBodyMode] = useState<'static' | 'motion'>('static');
    const [headshotMode, setHeadshotMode] = useState<'static' | 'motion'>('static');

    // Motion Ref prompts (initialized with PRD templates)
    const [fullBodyMotionPrompt, setFullBodyMotionPrompt] = useState('');
    const [headshotMotionPrompt, setHeadshotMotionPrompt] = useState('');
    const [fullBodyMotionNegativePrompt, setFullBodyMotionNegativePrompt] = useState(styleNegativePrompt || DEFAULT_NEGATIVE_PROMPT);
    const [headshotMotionNegativePrompt, setHeadshotMotionNegativePrompt] = useState(styleNegativePrompt || DEFAULT_NEGATIVE_PROMPT);

    // Motion Ref generation state
    const [isVideoLoading, setIsVideoLoading] = useState(false);
    const [zoomedImageUrl, setZoomedImageUrl] = useState<string | null>(null);
    const [optimisticSelectedIds, setOptimisticSelectedIds] = useState<Partial<Record<PanelKey, string>>>({});


    // === Reverse Generation: Detect uploaded images ===
    const hasUploadedThreeViews = asset.three_view_asset?.variants?.some((v: VariantLike) => v.is_uploaded_source) || false;
    const hasUploadedHeadshot = asset.headshot_asset?.variants?.some((v: VariantLike) => v.is_uploaded_source) || false;
    const hasUploadedFullBody = asset.full_body_asset?.variants?.some((v: VariantLike) => v.is_uploaded_source) || false;
    const hasAnyUpload = hasUploadedThreeViews || hasUploadedHeadshot || hasUploadedFullBody;
    const hasNonFullBodyUpload = hasUploadedThreeViews || hasUploadedHeadshot;
    const hasFullBodyImage = !!(asset.full_body_image_url || (asset.full_body_asset?.variants?.length > 0));

    // Local state for prompts
    const getInitialPrompt = useCallback((type: string, existingPrompt: string) => {
        if (existingPrompt) return existingPrompt;

        const baseDesc = asset.description || "";
        const name = asset.name || "Character";

        if (type === "full_body") {
            const prefix = hasNonFullBodyUpload ? "STRICTLY MAINTAIN the SAME character appearance, face, hairstyle, skin tone, and clothing as the reference image. " : "";
            return `${prefix}Full body character design of ${name}, concept art. ${baseDesc}. Standing pose, neutral expression, no emotion, looking at viewer. Clean white background, isolated, no other objects, no scenery, simple background, high quality, masterpiece.`;
        }
        if (type === "three_view") {
            const prefix = (hasFullBodyImage || hasAnyUpload) ? "STRICTLY MAINTAIN the SAME character appearance, face, hairstyle, and clothing as the reference image. " : "";
            return `${prefix}Character Reference Sheet for ${name}. ${baseDesc}. Three-view character design: Front view, Side view, and Back view. Full body, standing pose, neutral expression. Consistent clothing and details across all views. Simple white background, clean lines, studio lighting, high quality.`;
        }
        if (type === "headshot") {
            const prefix = (hasFullBodyImage || hasAnyUpload) ? "STRICTLY MAINTAIN the SAME face, hairstyle, skin tone, and facial features as the reference image. " : "";
            return `${prefix}Close-up portrait of the SAME character ${name}. ${baseDesc}. Zoom in on face and shoulders, detailed facial features, neutral expression, looking at viewer, high quality, masterpiece.`;
        }
        return "";
    }, [asset.description, asset.name, hasAnyUpload, hasFullBodyImage, hasNonFullBodyUpload]);

    const [fullBodyPrompt, setFullBodyPrompt] = useState(getInitialPrompt("full_body", asset.full_body_prompt));
    const [threeViewPrompt, setThreeViewPrompt] = useState(getInitialPrompt("three_view", asset.three_view_prompt));
    const [headshotPrompt, setHeadshotPrompt] = useState(getInitialPrompt("headshot", asset.headshot_prompt));
    const [fullBodyBatchSize, setFullBodyBatchSize] = useState(1);
    const [threeViewBatchSize, setThreeViewBatchSize] = useState(1);
    const [headshotBatchSize, setHeadshotBatchSize] = useState(1);

    // New State for Style Control
    const [applyStyle] = useState(true);
    // User's own negative prompt (initially empty or with sensible defaults)
    const [negativePrompt, setNegativePrompt] = useState(styleNegativePrompt || DEFAULT_NEGATIVE_PROMPT);
    const { account, getTaskPrice, canAffordTask } = useBillingGuard();
    const assetGeneratePrice = getTaskPrice("asset.generate");
    const motionRefGeneratePrice = getTaskPrice("asset.motion_ref.generate");
    const assetGenerateAffordable = canAffordTask("asset.generate");
    const motionRefAffordable = canAffordTask("asset.motion_ref.generate");

    // Get the uploaded image URL for reverse generation reference
    const getUploadedReferenceUrl = () => {
        if (hasUploadedThreeViews) {
            const uploadedVariant = asset.three_view_asset?.variants?.find((v: VariantLike) => v.is_uploaded_source);
            return uploadedVariant?.url || asset.three_view_image_url;
        }
        if (hasUploadedHeadshot) {
            const uploadedVariant = asset.headshot_asset?.variants?.find((v: VariantLike) => v.is_uploaded_source);
            return uploadedVariant?.url || asset.headshot_image_url;
        }
        return null;
    };

    // Motion Ref generation handler with validation
    const handleGenerateMotionRef = async (assetType: MotionAssetType, prompt: string, negativePromptForMotion: string) => {
        if (!onGenerateVideo) return;
        if (!motionRefAffordable) {
            alert("当前组织算力豆余额不足，无法提交动态参考视频任务。");
            return;
        }

        // Check if source image exists
        const hasSourceImage = assetType === 'full_body'
            ? (asset.full_body_image_url || asset.full_body_asset?.variants?.length > 0)
            : (asset.headshot_image_url || asset.headshot_asset?.variants?.length > 0);

        if (!hasSourceImage) {
            alert(`请先生成一张${assetType === 'full_body' ? '全身图' : '头像'}作为参考图，然后再生成动态参考视频。`);
            return;
        }

        setIsVideoLoading(true); // Start loading state (will be reset by onCanPlay or if no video)
        onGenerateVideo(prompt, negativePromptForMotion, 5, assetType);
    };

    // PRD Motion Prompt Templates
    const getMotionDefault = useCallback((type: 'full_body' | 'headshot') => {
        if (type === 'full_body') {
            return `Full-body character reference video.\n${asset.description}.\nStanding pose, shifting weight slightly, natural hand gestures while talking, turning body 30 degrees left and right. Stable camera, flat lighting, keep the costume and face consistent.`;
        } else {
            return `High-fidelity portrait video reference.\n${asset.description}.\nFacing camera, subtle head movements, blinking, micro-expressions, stable framing, keep face details consistent.`;
        }
    }, [asset.description]);

    // Initialize prompts if empty (first time load)
    useEffect(() => {
        setFullBodyPrompt((currentPrompt) => currentPrompt || `Full body character design of ${asset.name}, concept art. ${asset.description}. Standing pose, neutral expression, no emotion, looking at viewer. Clean white background, isolated, no other objects, no scenery, simple background, high quality, masterpiece.`);
        setThreeViewPrompt((currentPrompt) => currentPrompt || `Character Reference Sheet for ${asset.name}. ${asset.description}. Three-view character design: Front view, Side view, and Back view. Full body, standing pose, neutral expression. Consistent clothing and details across all views. Simple white background.`);
        setHeadshotPrompt((currentPrompt) => currentPrompt || `Close-up portrait of the SAME character ${asset.name}. ${asset.description}. Zoom in on face and shoulders, detailed facial features, neutral expression, looking at viewer, high quality, masterpiece.`);
        setFullBodyMotionPrompt((currentPrompt) => currentPrompt || getMotionDefault('full_body'));
        setHeadshotMotionPrompt((currentPrompt) => currentPrompt || getMotionDefault('headshot'));
    }, [asset.name, asset.description, getMotionDefault]);

    useEffect(() => {
        setOptimisticSelectedIds({});
    }, [asset.id]);

    useEffect(() => {
        if (styleNegativePrompt && (!negativePrompt || negativePrompt === DEFAULT_NEGATIVE_PROMPT)) {
            setNegativePrompt(styleNegativePrompt);
        }
    }, [negativePrompt, styleNegativePrompt]);

    // Update local state when asset updates (e.g. after generation)
    useEffect(() => {
        if (asset.full_body_prompt) {
            setFullBodyPrompt(asset.full_body_prompt);
        } else if (hasNonFullBodyUpload) {
            setFullBodyPrompt((currentPrompt) => currentPrompt.includes("STRICTLY MAINTAIN") ? currentPrompt : getInitialPrompt("full_body", ""));
        }

        if (asset.three_view_prompt) {
            setThreeViewPrompt(asset.three_view_prompt);
        } else if (hasAnyUpload) {
            setThreeViewPrompt((currentPrompt) => currentPrompt.includes("STRICTLY MAINTAIN") ? currentPrompt : getInitialPrompt("three_view", ""));
        }

        if (asset.headshot_prompt) {
            setHeadshotPrompt(asset.headshot_prompt);
        } else if (hasAnyUpload) {
            setHeadshotPrompt((currentPrompt) => currentPrompt.includes("STRICTLY MAINTAIN") ? currentPrompt : getInitialPrompt("headshot", ""));
        }
    }, [
        asset,
        asset.full_body_prompt,
        asset.headshot_prompt,
        asset.three_view_prompt,
        hasAnyUpload,
        getInitialPrompt,
        hasNonFullBodyUpload,
    ]);

    const handleGenerateClick = (type: "full_body" | "three_view" | "headshot", batchSize: number) => {
        if (!assetGenerateAffordable) {
            alert("当前组织算力豆余额不足，无法提交资产生成任务。");
            return;
        }
        let prompt = "";
        if (type === "full_body") prompt = fullBodyPrompt;
        else if (type === "three_view") prompt = threeViewPrompt;
        else if (type === "headshot") prompt = headshotPrompt;

        onGenerate(type, prompt, applyStyle, negativePrompt, batchSize);
    };

    // Helper to check if a specific type is generating
    const getGeneratingInfo = (type: string) => {
        if (!Array.isArray(generatingTypes) || generatingTypes.length === 0) {
            return { isGenerating: false, batchSize: 1 };
        }
        const task = generatingTypes.find(t => t?.type === type || t?.type === "all");
        return task ? { isGenerating: true, batchSize: task.batchSize || 1 } : { isGenerating: false, batchSize: 1 };
    };

    const handleSelectVariant = async (type: PanelKey, variantId: string) => {
        if (!currentProject) return;
        setOptimisticSelectedIds((current) => ({ ...current, [type]: variantId }));

        try {
            const panelAsset = getPanelAsset(type);
            const selectedVariantUrl = panelAsset.variants?.find((variant) => variant.id === variantId)?.url;
            await api.selectAssetVariant(currentProject.id, asset.id, "character", variantId, type);
            if (selectedVariantUrl) {
                const attributes =
                    type === "full_body"
                        ? { full_body_image_url: selectedVariantUrl, image_url: selectedVariantUrl }
                        : type === "three_view"
                            ? { three_view_image_url: selectedVariantUrl }
                            : { headshot_image_url: selectedVariantUrl, avatar_url: selectedVariantUrl };
                await api.updateAssetAttributes(currentProject.id, asset.id, "character", attributes);
            }

            // 选中主图后直接刷新整份项目，避免角色卡片列表、弹窗和局部 store 合并状态出现分叉。
            const refreshedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, refreshedProject);
        } catch (error) {
            console.error("Failed to select variant:", error);
            setOptimisticSelectedIds((current) => {
                const next = { ...current };
                delete next[type];
                return next;
            });
        }
    };

    // 用统一的面板元信息，避免 UI 状态和业务数据在多个地方分叉。
    const panelConfigs = [
        {
            key: "full_body" as const,
            title: "主素材",
            subtitle: "角色一致性的主参考图",
            hint: "建议先完成主素材，再衍生三视图和头像。",
            icon: PhotoIcon,
            accent: "from-cyan-400/30 via-sky-500/15 to-transparent",
            previewUrl: asset.full_body_image_url,
            variantsCount: asset.full_body_asset?.variants?.length || 0,
            isGenerating: getGeneratingInfo("full_body").isGenerating,
            isLocked: false,
            motionEnabled: true
        },
        {
            key: "three_view" as const,
            title: "三视角",
            subtitle: "正侧背结构参考",
            hint: "适合控制角色服装和体态在多视角下的一致性。",
            icon: Sparkles,
            accent: "from-emerald-400/25 via-teal-500/15 to-transparent",
            previewUrl: asset.three_view_image_url,
            variantsCount: asset.three_view_asset?.variants?.length || 0,
            isGenerating: getGeneratingInfo("three_view").isGenerating,
            isLocked: !asset.full_body_image_url && !hasAnyUpload,
            motionEnabled: false
        },
        {
            key: "headshot" as const,
            title: "头像",
            subtitle: "面部细节与表情参考",
            hint: "更适合锁定五官、妆容和近景表情特征。",
            icon: Eye,
            accent: "from-amber-400/25 via-orange-500/15 to-transparent",
            previewUrl: asset.headshot_image_url || asset.avatar_url,
            variantsCount: asset.headshot_asset?.variants?.length || 0,
            isGenerating: getGeneratingInfo("headshot").isGenerating,
            isLocked: !asset.full_body_image_url && !hasAnyUpload,
            motionEnabled: true
        }
    ];

    const completedPanels = panelConfigs.filter((panel) => !!panel.previewUrl || panel.variantsCount > 0).length;
    const supportsActiveMotion = activePanel === "full_body" || activePanel === "headshot";
    const activeMode = activePanel === "full_body"
        ? fullBodyMode
        : activePanel === "headshot"
            ? headshotMode
            : "static";

    const handleActiveModeChange = (nextMode: "static" | "motion") => {
        if (activePanel === "full_body") {
            if (nextMode === "motion" && !(asset.full_body_image_url || asset.full_body_asset?.variants?.length > 0)) {
                alert("请先生成静态图片。");
                return;
            }
            setFullBodyMode(nextMode);
            return;
        }

        if (activePanel === "headshot") {
            if (nextMode === "motion" && !(asset.headshot_image_url || asset.headshot_asset?.variants?.length > 0)) {
                alert("请先生成静态图片。");
                return;
            }
            setHeadshotMode(nextMode);
        }
    };

    const activeBatchSize = activePanel === "full_body"
        ? fullBodyBatchSize
        : activePanel === "three_view"
            ? threeViewBatchSize
            : headshotBatchSize;

    const setActiveBatchSize = (size: number) => {
        if (activePanel === "full_body") setFullBodyBatchSize(size);
        else if (activePanel === "three_view") setThreeViewBatchSize(size);
        else setHeadshotBatchSize(size);
    };

    const handleToolbarGenerate = () => {
        if (activePanel === "full_body") handleGenerateClick("full_body", fullBodyBatchSize);
        else if (activePanel === "three_view") handleGenerateClick("three_view", threeViewBatchSize);
        else handleGenerateClick("headshot", headshotBatchSize);
    };

    const resolvePanelAsset = (legacyAsset: LegacyPanelAsset | null | undefined, unitAsset: UnitPanelAsset | null | undefined, legacyUrl?: string, fallbackVariantId?: string): PanelAssetData => {
        const legacyVariants = Array.isArray(legacyAsset?.variants) ? legacyAsset.variants : [];
        const unitVariants = Array.isArray(unitAsset?.image_variants) ? unitAsset.image_variants : [];
        const mergedVariantsById = new Map<string, VariantLike>();

        [...legacyVariants, ...unitVariants].forEach((variant) => {
            if (!variant?.id) return;
            if (!mergedVariantsById.has(variant.id)) {
                mergedVariantsById.set(variant.id, variant);
            }
        });

        const mergedVariants = Array.from(mergedVariantsById.values()).sort((a, b) => {
            const timeA = a?.created_at ? new Date(a.created_at).getTime() : 0;
            const timeB = b?.created_at ? new Date(b.created_at).getTime() : 0;
            return timeB - timeA;
        });

        if (mergedVariants.length === 0 && legacyUrl) {
            mergedVariants.push({
                id: legacyAsset?.selected_id || unitAsset?.selected_image_id || fallbackVariantId || `${asset.id}-legacy`,
                url: legacyUrl,
                created_at: asset.updated_at || asset.created_at || Date.now(),
            });
        }

        return {
            selected_id: legacyAsset?.selected_id || unitAsset?.selected_image_id || mergedVariants[0]?.id || null,
            variants: mergedVariants,
        };
    };

    const fullBodyPanelAsset = resolvePanelAsset(asset.full_body_asset, asset.full_body, asset.full_body_image_url, `${asset.id}-full-body-legacy`);
    const threeViewPanelAsset = resolvePanelAsset(asset.three_view_asset, asset.three_views, asset.three_view_image_url, `${asset.id}-three-view-legacy`);
    const headshotPanelAsset = resolvePanelAsset(asset.headshot_asset, asset.head_shot, asset.headshot_image_url || asset.avatar_url, `${asset.id}-headshot-legacy`);

    const getPanelAsset = (panelKey: PanelKey) => {
        if (panelKey === "full_body") return fullBodyPanelAsset;
        if (panelKey === "three_view") return threeViewPanelAsset;
        return headshotPanelAsset;
    };

    const getPanelSelectedVariantId = (panelKey: PanelKey) => {
        const panelAsset = getPanelAsset(panelKey);
        const optimisticSelectedId = optimisticSelectedIds[panelKey];
        if (optimisticSelectedId && panelAsset.variants?.some((variant) => variant.id === optimisticSelectedId)) {
            return optimisticSelectedId;
        }
        return panelAsset.selected_id;
    };

    const getPanelSelectedUrl = (panelKey: PanelKey) => {
        if (panelKey === "full_body") {
            const selected = fullBodyPanelAsset.variants?.find((variant) => variant.id === getPanelSelectedVariantId("full_body"));
            return getAssetUrl(selected?.url || asset.full_body_image_url);
        }
        if (panelKey === "three_view") {
            const selected = threeViewPanelAsset.variants?.find((variant) => variant.id === getPanelSelectedVariantId("three_view"));
            return getAssetUrl(selected?.url || asset.three_view_image_url);
        }
        const selected = headshotPanelAsset.variants?.find((variant) => variant.id === getPanelSelectedVariantId("headshot"));
        return getAssetUrl(selected?.url || asset.headshot_image_url || asset.avatar_url);
    };

    const activeSelectedImageUrl = getPanelSelectedUrl(activePanel);
    const activePanelConfig = panelConfigs.find((panel) => panel.key === activePanel);

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 md:p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="asset-surface-strong asset-workbench-shell relative flex h-[90vh] w-full max-w-[1520px] flex-col overflow-hidden rounded-[30px] border border-white/10 shadow-2xl"
            >
                <div className="flex h-16 items-center justify-between border-b border-white/10 bg-black/15 px-6">
                    <div className="flex min-w-0 items-center gap-4">
                        <div className="flex min-w-0 items-center gap-3">
                            <h2 className="text-xl font-bold text-white">{asset.name} <span className="text-gray-500 font-normal text-sm ml-2">角色工作台</span></h2>
                            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                                <span className="text-xs text-gray-400">制作进度</span>
                                <span className="text-xs font-semibold text-white">{completedPanels}/{panelConfigs.length}</span>
                            </div>
                        </div>
                        <div className="hidden items-center gap-2 rounded-full border border-sky-400/15 bg-sky-400/10 px-3 py-1 xl:flex">
                            <span className="text-xs text-blue-400 font-medium">建议保持三张图风格一致，生成效果会更稳定</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] overflow-hidden">
                    <aside className="asset-workbench-sidebar overflow-hidden border-r border-white/10">
                        <div className="flex h-full flex-col px-5 pb-5 pt-4">
                            <div className="asset-workbench-tab-strip grid grid-cols-3">
                                {panelConfigs.map((panel, index) => {
                                    const isActive = panel.key === activePanel;
                                    return (
                                        <button
                                            key={panel.key}
                                            type="button"
                                            onClick={() => setActivePanel(panel.key)}
                                            className={`asset-workbench-tab flex min-w-0 items-center justify-center gap-1.5 px-3 py-3 text-sm font-medium transition-all ${isActive
                                                ? "asset-workbench-tab-active text-white"
                                                : "text-gray-300 hover:text-white"
                                                }`}
                                        >
                                            <span className="shrink-0 text-xs font-semibold text-gray-400">{index + 1}</span>
                                            <span className="whitespace-nowrap">{panel.title}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="flex items-start justify-between gap-3 px-1 pb-3 pt-5">
                                <div className="min-w-0">
                                    <div className="text-[11px] uppercase tracking-[0.22em] text-gray-500">Selected</div>
                                    <div className="mt-2 text-sm font-semibold text-white">{activePanelConfig?.title || "当前图片"}</div>
                                    <p className="mt-1 text-xs leading-5 text-gray-400">{activePanelConfig?.hint || "右侧候选图单击后，这里会同步更新。"}</p>
                                </div>
                            </div>

                            <div className="flex-1">
                                <div className="asset-workbench-preview relative flex h-full min-h-0 flex-col overflow-hidden p-4">
                                    {activeSelectedImageUrl ? (
                                        <button
                                            type="button"
                                            onClick={() => setZoomedImageUrl(activeSelectedImageUrl)}
                                            className="asset-workbench-preview-image h-full w-full overflow-hidden"
                                            title="点击放大查看"
                                        >
                                            <img
                                                src={activeSelectedImageUrl}
                                                alt="当前选中的图片"
                                                className="h-full w-full object-contain"
                                            />
                                        </button>
                                    ) : (
                                        <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-gray-500">
                                            <PhotoIcon size={28} className="opacity-50" />
                                            <span className="text-sm">暂未选中图片</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </aside>

                    <div className="overflow-hidden flex flex-col">
                        <div className="asset-workbench-toolbar px-6 pt-4 pb-3">
                            <div className="flex items-center justify-between gap-4">
                                <div className="asset-workbench-toggle flex w-fit items-center gap-1 rounded-[16px] p-1">
                                    <button
                                        type="button"
                                        onClick={() => handleActiveModeChange("static")}
                                        className={`flex items-center gap-1.5 rounded-[14px] px-3.5 py-2 text-[11px] font-medium transition-all ${activeMode === "static"
                                            ? "asset-workbench-toggle-active text-white"
                                            : "text-gray-400 hover:bg-white/5 hover:text-white"
                                            }`}
                                    >
                                        <PhotoIcon size={12} />
                                        静态
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => supportsActiveMotion && handleActiveModeChange("motion")}
                                        disabled={!supportsActiveMotion}
                                        className={`flex items-center gap-1.5 rounded-[14px] px-3.5 py-2 text-[11px] font-medium transition-all ${activeMode === "motion"
                                            ? "asset-workbench-toggle-active asset-workbench-toggle-active-motion text-white"
                                            : supportsActiveMotion
                                                ? "text-gray-400 hover:bg-white/5 hover:text-white"
                                                : "text-gray-600 cursor-not-allowed"
                                            }`}
                                    >
                                        <Video size={12} />
                                        动态
                                    </button>
                                </div>

                                {activeMode === "static" && (
                                    <div className="flex items-center gap-3">
                                        <div className="variant-selector-batch flex items-center gap-1 rounded-[16px] p-1">
                                            {[1, 2, 3, 4].map((size) => {
                                                return (
                                                    <button
                                                        key={size}
                                                        type="button"
                                                        onClick={() => setActiveBatchSize(size)}
                                                        className={`variant-selector-batch-button rounded-[12px] px-3 py-2 text-[11px] font-medium transition-all ${activeBatchSize === size
                                                            ? "variant-selector-batch-button-active"
                                                            : "text-gray-300 hover:text-white"
                                                            }`}
                                                    >
                                                        x{size}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleToolbarGenerate}
                                            disabled={(activePanel === "full_body"
                                                ? getGeneratingInfo("full_body").isGenerating
                                                : activePanel === "three_view"
                                                    ? getGeneratingInfo("three_view").isGenerating
                                                    : getGeneratingInfo("headshot").isGenerating) || !assetGenerateAffordable}
                                            className={`variant-selector-generate flex items-center gap-1.5 rounded-[14px] px-4 py-2 text-[11px] font-semibold transition-all ${((activePanel === "full_body"
                                                ? getGeneratingInfo("full_body").isGenerating
                                                : activePanel === "three_view"
                                                    ? getGeneratingInfo("three_view").isGenerating
                                                    : getGeneratingInfo("headshot").isGenerating) || !assetGenerateAffordable)
                                                ? "bg-white/5 text-gray-400 cursor-not-allowed"
                                                : "variant-selector-generate-active"
                                                }`}
                                            title={!assetGenerateAffordable ? "当前组织算力豆余额不足，无法提交资产生成任务" : undefined}
                                        >
                                            <PhotoIcon size={11} />
                                            生成图片
                                        </button>
                                        <BillingTaskHint priceCredits={assetGeneratePrice} balanceCredits={account?.balance_credits} compact />
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex-1 overflow-hidden px-2 pb-2">
                            {activePanel === "full_body" && (
                                <WorkbenchPanel
                                    asset={fullBodyPanelAsset}
                                    selectedVariantId={getPanelSelectedVariantId("full_body")}
                                    onSelect={(id: string) => handleSelectVariant("full_body", id)}
                                    prompt={fullBodyPrompt}
                                    setPrompt={setFullBodyPrompt}
                                    negativePrompt={negativePrompt}
                                    setNegativePrompt={setNegativePrompt}
                                    isGenerating={getGeneratingInfo("full_body").isGenerating}
                                    generatingBatchSize={getGeneratingInfo("full_body").batchSize}
                                    aspectRatio="9:16"
                                    reverseGenerationMode={hasNonFullBodyUpload && !hasFullBodyImage}
                                    reverseReferenceUrl={getUploadedReferenceUrl()}
                                    supportsMotion={true}
                                    mode={fullBodyMode}
                                    motionRefVideos={asset.full_body?.video_variants || []}
                                    onGenerateMotionRef={(prompt: string, negativePromptForMotion: string) => handleGenerateMotionRef('full_body', prompt, negativePromptForMotion)}
                                    isGeneratingMotion={generatingTypes.some(t => t.type === "video_full_body")}
                                    motionPrompt={fullBodyMotionPrompt}
                                    setMotionPrompt={setFullBodyMotionPrompt}
                                    motionNegativePrompt={fullBodyMotionNegativePrompt}
                                    setMotionNegativePrompt={setFullBodyMotionNegativePrompt}
                                    isVideoLoading={isVideoLoading}
                                    setIsVideoLoading={setIsVideoLoading}
                                    motionRefAffordable={motionRefAffordable}
                                    motionRefPrice={motionRefGeneratePrice}
                                    balanceCredits={account?.balance_credits}
                                    onZoomImage={setZoomedImageUrl}
                                />
                            )}

                            {activePanel === "three_view" && (
                                <WorkbenchPanel
                                    asset={threeViewPanelAsset}
                                    selectedVariantId={getPanelSelectedVariantId("three_view")}
                                    onSelect={(id: string) => handleSelectVariant("three_view", id)}
                                    prompt={threeViewPrompt}
                                    setPrompt={setThreeViewPrompt}
                                    negativePrompt={negativePrompt}
                                    setNegativePrompt={setNegativePrompt}
                                    isGenerating={getGeneratingInfo("three_view").isGenerating}
                                    generatingBatchSize={getGeneratingInfo("three_view").batchSize}
                                    isLocked={!asset.full_body_image_url && !hasAnyUpload}
                                    aspectRatio="16:9"
                                    onZoomImage={setZoomedImageUrl}
                                />
                            )}

                            {activePanel === "headshot" && (
                                <WorkbenchPanel
                                    asset={headshotPanelAsset}
                                    selectedVariantId={getPanelSelectedVariantId("headshot")}
                                    onSelect={(id: string) => handleSelectVariant("headshot", id)}
                                    prompt={headshotPrompt}
                                    setPrompt={setHeadshotPrompt}
                                    negativePrompt={negativePrompt}
                                    setNegativePrompt={setNegativePrompt}
                                    isGenerating={getGeneratingInfo("headshot").isGenerating}
                                    generatingBatchSize={getGeneratingInfo("headshot").batchSize}
                                    isLocked={!asset.full_body_image_url && !hasAnyUpload}
                                    aspectRatio="1:1"
                                    supportsMotion={true}
                                    mode={headshotMode}
                                    motionRefVideos={asset.head_shot?.video_variants || []}
                                    onGenerateMotionRef={(prompt: string, negativePromptForMotion: string) => handleGenerateMotionRef('head_shot', prompt, negativePromptForMotion)}
                                    isGeneratingMotion={generatingTypes.some(t => t.type === "video_head_shot")}
                                    motionPrompt={headshotMotionPrompt}
                                    setMotionPrompt={setHeadshotMotionPrompt}
                                    motionNegativePrompt={headshotMotionNegativePrompt}
                                    setMotionNegativePrompt={setHeadshotMotionNegativePrompt}
                                    isVideoLoading={isVideoLoading}
                                    setIsVideoLoading={setIsVideoLoading}
                                    motionRefAffordable={motionRefAffordable}
                                    motionRefPrice={motionRefGeneratePrice}
                                    balanceCredits={account?.balance_credits}
                                    onZoomImage={setZoomedImageUrl}
                                />
                            )}
                        </div>
                    </div>
                </div>

                {zoomedImageUrl && (
                    <div
                        className="absolute inset-0 z-[60] flex items-center justify-center bg-black/85 p-6"
                        onClick={() => setZoomedImageUrl(null)}
                    >
                        <button
                            type="button"
                            onClick={() => setZoomedImageUrl(null)}
                            className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
                        >
                            <X size={20} />
                        </button>
                        <img
                            src={zoomedImageUrl}
                            alt="放大预览"
                            className="max-h-full max-w-full object-contain"
                        />
                    </div>
                )}
            </motion.div>
        </div>
    );
}

interface WorkbenchPanelProps {
    asset: PanelAssetData;
    selectedVariantId: string | null;
    onSelect: (id: string) => void;
    prompt: string;
    setPrompt: (value: string) => void;
    negativePrompt: string;
    setNegativePrompt: (value: string) => void;
    isGenerating: boolean;
    generatingBatchSize: number;
    isLocked?: boolean;
    aspectRatio?: "9:16" | "16:9" | "1:1";
    supportsMotion?: boolean;
    mode?: "static" | "motion";
    motionRefVideos?: VideoVariantLike[];
    onGenerateMotionRef?: (prompt: string, negativePrompt: string) => void;
    isGeneratingMotion?: boolean;
    motionPrompt?: string;
    setMotionPrompt?: (value: string) => void;
    motionNegativePrompt?: string;
    setMotionNegativePrompt?: (value: string) => void;
    isVideoLoading?: boolean;
    setIsVideoLoading?: (loading: boolean) => void;
    reverseGenerationMode?: boolean;
    reverseReferenceUrl?: string | null;
    motionRefAffordable?: boolean;
    motionRefPrice?: number;
    balanceCredits?: number;
    onZoomImage?: (url: string) => void;
}

function WorkbenchPanel({
    asset,
    selectedVariantId,
    onSelect,
    prompt,
    setPrompt,
    negativePrompt,
    setNegativePrompt,
    isGenerating,
    generatingBatchSize,
    isLocked,
    aspectRatio = "9:16",
    // Motion Ref Mode (Asset Activation v2)
    supportsMotion = false,
    mode = 'static',  // 'static' | 'motion'
    motionRefVideos = [],
    onGenerateMotionRef,
    isGeneratingMotion = false,
    motionPrompt = '',
    setMotionPrompt,
    motionNegativePrompt = '',
    setMotionNegativePrompt,
    isVideoLoading = false,
    setIsVideoLoading,
    // Reverse Generation Props
    reverseGenerationMode = false,
    reverseReferenceUrl = null,
    motionRefAffordable = true,
    motionRefPrice,
    balanceCredits,
    onZoomImage,
}: WorkbenchPanelProps) {
    const latestVariants = getLatestBatchVariants(Array.isArray(asset?.variants) ? asset.variants : []);
    const railRef = useRef<HTMLDivElement | null>(null);
    const aspectRatioClass = getAspectRatioCardClass(aspectRatio);
    const candidateCardBasis = latestVariants.length <= 1
        ? "min(100%, 540px)"
        : latestVariants.length === 2
            ? "clamp(240px, calc((100% - 16px) / 2), 420px)"
            : latestVariants.length === 3
                ? "clamp(220px, calc((100% - 32px) / 3), 320px)"
                : "clamp(200px, calc((100% - 48px) / 4), 280px)";
    const candidateHeightClass = aspectRatio === "1:1"
        ? "h-[220px] sm:h-[240px] lg:h-[260px]"
        : aspectRatio === "16:9"
            ? "h-[200px] sm:h-[220px] lg:h-[240px]"
            : "h-[220px] sm:h-[250px] lg:h-[280px]";
    const showCarouselControls = latestVariants.length >= 4;
    const scrollCandidates = (direction: "prev" | "next") => {
        if (!railRef.current) return;
        const viewportWidth = railRef.current.clientWidth;
        railRef.current.scrollBy({
            left: direction === "next" ? viewportWidth * 0.72 : -viewportWidth * 0.72,
            behavior: "smooth",
        });
    };

    return (
        <div className="h-full overflow-y-auto">
            <div className="grid h-full min-w-0 grid-cols-1 gap-4 p-4 pt-0">
                <div className="asset-workbench-stage relative min-h-0 overflow-hidden rounded-[28px] p-4 md:p-5">
                    {isLocked && (
                        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 p-6 text-center">
                            <div className="flex flex-col items-center gap-2 text-gray-500">
                                <Lock size={32} />
                                <span className="text-sm">请先完成主素材，再继续当前板块</span>
                            </div>
                        </div>
                    )}

                    {reverseGenerationMode && (
                        <div className="absolute inset-x-5 top-5 z-10 rounded-2xl border border-primary/30 bg-black/70 p-4 backdrop-blur-md">
                            <div className="flex items-center gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                                    <RefreshCw size={18} />
                                </div>
                                <div className="min-w-0">
                                    <div className="text-sm font-semibold text-white">检测到已上传参考图</div>
                                    <p className="mt-1 text-xs text-gray-400">可以基于现有上传图继续反推完整主素材，不需要重头开始。</p>
                                </div>
                                {reverseReferenceUrl && (
                                    <img
                                        src={typeof reverseReferenceUrl === 'string' && reverseReferenceUrl.startsWith('http')
                                            ? reverseReferenceUrl
                                            : `${window.location.origin}/${reverseReferenceUrl}`}
                                        alt="Reference"
                                        className="h-14 w-14 rounded-xl border border-white/20 object-cover"
                                    />
                                )}
                            </div>
                        </div>
                    )}

                    {mode === "motion" && supportsMotion ? (
                        <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
                            <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <div className="text-[11px] uppercase tracking-[0.22em] text-gray-500">Motion</div>
                                    <div className="mt-2 text-sm font-semibold text-white">动态视频预览</div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        onClick={() => onGenerateMotionRef?.(motionPrompt, motionNegativePrompt)}
                                        disabled={isGeneratingMotion || !motionRefAffordable}
                                        className={`variant-selector-generate flex items-center gap-1.5 rounded-[14px] px-4 py-2 text-[11px] font-semibold transition-all ${isGeneratingMotion || !motionRefAffordable
                                            ? 'bg-white/5 text-gray-500 cursor-not-allowed'
                                            : 'variant-selector-generate-active'
                                            }`}
                                        title={!motionRefAffordable ? "当前组织算力豆余额不足，无法提交动态参考视频任务" : undefined}
                                    >
                                        <Video size={14} />
                                        生成视频
                                    </button>
                                    <BillingTaskHint priceCredits={motionRefPrice} balanceCredits={balanceCredits} compact />
                                </div>
                            </div>

                            <div className={`relative flex min-h-[220px] items-center justify-center overflow-hidden border border-white/10 bg-black/20 p-4 ${aspectRatioClass}`}>
                                {isGeneratingMotion ? (
                                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-black/60 backdrop-blur-md">
                                        <div className="relative">
                                            <RefreshCw size={48} className="animate-spin text-amber-300" />
                                            <div className="absolute inset-0 animate-pulse bg-amber-400/20 blur-xl"></div>
                                        </div>
                                        <div className="flex flex-col items-center">
                                            <span className="text-sm font-bold tracking-widest text-white">正在生成视频</span>
                                            <span className="mt-1 text-[10px] text-amber-100/70">AI 正在处理动态内容...</span>
                                        </div>
                                    </div>
                                ) : isVideoLoading && motionRefVideos?.length > 0 ? (
                                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/40 backdrop-blur-sm">
                                        <RefreshCw size={32} className="animate-spin text-gray-300" />
                                        <span className="text-xs font-medium text-gray-300">正在加载视频文件...</span>
                                    </div>
                                ) : null}

                                {motionRefVideos?.length > 0 ? (
                                    <video
                                        key={motionRefVideos[motionRefVideos.length - 1]?.url}
                                        src={getAssetUrl(motionRefVideos[motionRefVideos.length - 1]?.url)}
                                        onCanPlay={() => setIsVideoLoading?.(false)}
                                        onLoadStart={() => setIsVideoLoading?.(true)}
                                        className="h-full w-full object-contain"
                                        controls
                                        loop
                                        autoPlay
                                        muted
                                    />
                                ) : !isGeneratingMotion && (
                                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-gray-500">
                                        <Video size={40} className="opacity-50" />
                                        <span className="text-sm">暂无动态参考</span>
                                        <span className="text-xs opacity-70">可在下方生成</span>
                                    </div>
                                )}
                            </div>

                            <PromptField
                                label="正向提示词"
                                value={motionPrompt}
                                onChange={(value: string) => setMotionPrompt?.(value)}
                                placeholder="请输入动态视频正向提示词..."
                                disabled={isLocked}
                            />

                            <PromptField
                                label="负向提示词"
                                value={motionNegativePrompt}
                                onChange={(value: string) => setMotionNegativePrompt?.(value)}
                                placeholder="请输入动态视频负向提示词..."
                                disabled={isLocked}
                            />
                        </div>
                    ) : (
                        <div className="flex h-full min-h-0 flex-col gap-5 overflow-y-auto">
                            <div className="relative">
                                {showCarouselControls && (
                                    <div className="mb-3 flex items-center justify-end gap-2">
                                        <button
                                            type="button"
                                            onClick={() => scrollCandidates("prev")}
                                            className="asset-workbench-carousel-button"
                                            title="查看上一张候选图"
                                        >
                                            <ChevronLeft size={16} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => scrollCandidates("next")}
                                            className="asset-workbench-carousel-button"
                                            title="查看下一张候选图"
                                        >
                                            <ChevronRight size={16} />
                                        </button>
                                    </div>
                                )}
                                {latestVariants.length > 0 ? (
                                    <div ref={railRef} className="asset-workbench-candidate-rail flex gap-4 overflow-x-auto pb-2 pr-1">
                                        {latestVariants.map((variant, index) => {
                                            const imageUrl = getAssetUrl(variant.url);
                                            const isSelected = selectedVariantId === variant.id;
                                            return (
                                                <button
                                                    key={variant.id}
                                                    type="button"
                                                    onClick={() => onSelect(variant.id)}
                                                    onDoubleClick={() => onZoomImage?.(imageUrl)}
                                                    className={`asset-workbench-candidate group flex min-w-0 shrink-0 snap-start flex-col overflow-hidden border text-left transition-all ${isSelected
                                                        ? 'asset-workbench-candidate-active border-white/20'
                                                        : 'border-white/10 hover:border-white/20'
                                                        }`}
                                                    style={{ flexBasis: candidateCardBasis }}
                                                    title="单击设为当前图片，双击放大查看"
                                                >
                                                    <div className={`relative w-full overflow-hidden ${candidateHeightClass}`}>
                                                        <img
                                                            src={imageUrl}
                                                            alt={`候选图${index + 1}`}
                                                            className="h-full w-full object-contain"
                                                        />
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="flex min-h-[240px] items-center justify-center rounded-[22px] border border-dashed border-white/12 bg-white/[0.03] text-sm text-gray-500">
                                        暂无候选图
                                    </div>
                                )}

                                {isGenerating && (
                                    <div className="variant-selector-loading absolute inset-0 z-10 flex items-center justify-center rounded-[1.5rem] bg-black/45 backdrop-blur-sm">
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="variant-selector-spinner h-10 w-10 animate-spin rounded-full border-b-2"></div>
                                            <span className="font-medium text-white">正在生成 {generatingBatchSize} 个候选版本...</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <PromptField
                                label="正向提示词"
                                value={prompt}
                                onChange={setPrompt}
                                placeholder="请输入正向提示词..."
                                disabled={isLocked}
                            />

                            <PromptField
                                label="负向提示词"
                                value={negativePrompt}
                                onChange={setNegativePrompt}
                                placeholder="请输入负向提示词..."
                                disabled={isLocked}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function PromptField({
    label,
    value,
    onChange,
    placeholder,
    disabled,
    action,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
    disabled?: boolean;
    action?: ReactNode;
}) {
    return (
        <div className="asset-workbench-inspector border border-white/10 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-gray-300">{label}</span>
                {action}
            </div>
            <textarea
                value={value}
                onChange={(event) => onChange(event.target.value)}
                disabled={disabled}
                className="asset-workbench-textarea min-h-[156px] w-full resize-none px-0 py-2 text-sm leading-7 text-white shadow-none outline-none"
                placeholder={placeholder}
            />
        </div>
    );
}
