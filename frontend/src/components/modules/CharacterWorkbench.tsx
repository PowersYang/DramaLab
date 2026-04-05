"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw, Lock, Video, Sparkles, Eye, ChevronLeft, ChevronRight, User, Check, Sliders } from "lucide-react";
import BillingActionButton from "@/components/billing/BillingActionButton";
import { useBillingGuard } from "@/hooks/useBillingGuard";
import { api } from "@/lib/api";
import { applyCharacterVariantSelection, getPreferredCharacterPanel } from "@/lib/characterAssets";
import { isSeriesProject } from "@/lib/projectAssets";

import { useProjectStore, type Character } from "@/store/projectStore";
import { Image as PhotoIcon } from "lucide-react";
import { getAssetUrl, normalizeComparableAssetPath } from "@/lib/utils";

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
    id?: string;
    url?: string | null;
    video_url?: string | null;
    image_url?: string | null;
    created_at?: string | number | null;
    status?: string | null;
    source_image_id?: string | null;
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
    selected_video_id?: string | null;
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
    video_assets?: VideoVariantLike[];
};

const DEFAULT_NEGATIVE_PROMPT = "low quality, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, jpeg artifacts, signature, watermark, blurry";
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

// 候选图稳定按生成时间倒序展示最近 4 张，避免“批次识别”误伤已生成结果。
const getRecentVariants = <T extends { created_at?: string | number | null }>(variants: T[]) => {
    if (!Array.isArray(variants) || variants.length === 0) {
        return [];
    }

    return [...variants]
        .sort((a, b) => parseVariantTime(b.created_at) - parseVariantTime(a.created_at))
        .slice(0, 4);
};

// 视频预览也统一按最新优先排序，兼容新版 unit 视频和旧版 video task。
const getRecentVideoVariants = <T extends VideoVariantLike>(videos: T[]) => {
    if (!Array.isArray(videos) || videos.length === 0) {
        return [];
    }

    return [...videos]
        .filter((video) => !!(video?.url || video?.video_url))
        .sort((a, b) => parseVariantTime(b.created_at) - parseVariantTime(a.created_at));
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
    const inFlightSelectionRef = useRef<Partial<Record<PanelKey, boolean>>>({});
    const latestSelectionRef = useRef<Partial<Record<PanelKey, string>>>({});

    useEffect(() => {
        // 每次切到新的角色时，默认打开真正有候选图的分面，避免用户刚生成了 4 张却总落在只有 1 张主图的默认页。
        setActivePanel(getPreferredCharacterPanel(asset as Character));
        setOptimisticSelectedIds({});
        latestSelectionRef.current = {};
        inFlightSelectionRef.current = {};
    }, [asset.id]);


    // === Reverse Generation: Detect uploaded images ===
    const hasUploadedThreeViews = [
        ...(asset.three_view_asset?.variants || []),
        ...(asset.three_views?.image_variants || []),
    ].some((v: VariantLike) => v.is_uploaded_source);
    const hasUploadedHeadshot = [
        ...(asset.headshot_asset?.variants || []),
        ...(asset.head_shot?.image_variants || []),
    ].some((v: VariantLike) => v.is_uploaded_source);
    const hasUploadedFullBody = [
        ...(asset.full_body_asset?.variants || []),
        ...(asset.full_body?.image_variants || []),
    ].some((v: VariantLike) => v.is_uploaded_source);
    const hasAnyUpload = hasUploadedThreeViews || hasUploadedHeadshot || hasUploadedFullBody;
    const hasNonFullBodyUpload = hasUploadedThreeViews || hasUploadedHeadshot;
    const hasFullBodyImage = !!(
        asset.full_body_image_url
        || ((asset.full_body_asset?.variants?.length || 0) > 0)
        || ((asset.full_body?.image_variants?.length || 0) > 0)
    );

    // Local state for prompts
    const getInitialPrompt = useCallback((type: string, existingPrompt?: string | null) => {
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
            const uploadedVariant = [
                ...(asset.three_view_asset?.variants || []),
                ...(asset.three_views?.image_variants || []),
            ].find((v: VariantLike) => v.is_uploaded_source);
            return uploadedVariant?.url || asset.three_view_image_url;
        }
        if (hasUploadedHeadshot) {
            const uploadedVariant = [
                ...(asset.headshot_asset?.variants || []),
                ...(asset.head_shot?.image_variants || []),
            ].find((v: VariantLike) => v.is_uploaded_source);
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
            ? (asset.full_body_image_url || (asset.full_body_asset?.variants?.length || 0) > 0 || (asset.full_body?.image_variants?.length || 0) > 0)
            : (asset.headshot_image_url || (asset.headshot_asset?.variants?.length || 0) > 0 || (asset.head_shot?.image_variants?.length || 0) > 0);

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

    const flushVariantSelection = useCallback(async (type: PanelKey) => {
        if (!currentProject || inFlightSelectionRef.current[type]) {
            return;
        }

        const requestedVariantId = latestSelectionRef.current[type];
        if (!requestedVariantId) {
            return;
        }

        inFlightSelectionRef.current[type] = true;

        try {
            const updatedProject = await api.selectAssetVariant(currentProject.id, asset.id, "character", requestedVariantId, type);

            // 用户连续切图时只认最后一次点击，旧请求返回不能把更新后的选中态再覆盖回去。
            if (latestSelectionRef.current[type] === requestedVariantId) {
                updateProject(currentProject.id, updatedProject);
            }
        } catch (error) {
            console.error("Failed to select variant:", error);
            if (latestSelectionRef.current[type] === requestedVariantId) {
                const refreshedProject = await api.getProject(currentProject.id);
                updateProject(currentProject.id, refreshedProject);
                setOptimisticSelectedIds((current) => {
                    const next = { ...current };
                    delete next[type];
                    return next;
                });
            }
        } finally {
            inFlightSelectionRef.current[type] = false;
            if (latestSelectionRef.current[type] !== requestedVariantId) {
                void flushVariantSelection(type);
            }
        }
    }, [asset.id, currentProject, updateProject]);

    const handleSelectVariant = (type: PanelKey, variantId: string) => {
        if (!currentProject) return;

        setOptimisticSelectedIds((current) => ({ ...current, [type]: variantId }));
        latestSelectionRef.current[type] = variantId;

        // 点击后先同步本地项目状态，确保弹窗左侧预览和角色卡片列表立即切到新图。
        const nextCharacters = currentProject.characters?.map((character) =>
            character.id === asset.id ? applyCharacterVariantSelection(character as any, type, variantId) : character
        );
        const nextSeriesCharacterLinks = isSeriesProject(currentProject)
            ? currentProject.series_character_links?.map((link: any) =>
                link.character_id === asset.id || link.character?.id === asset.id
                    ? {
                        ...link,
                        character: link.character ? applyCharacterVariantSelection(link.character as any, type, variantId) : link.character,
                    }
                    : link
            )
            : undefined;
        updateProject(currentProject.id, {
            characters: nextCharacters,
            ...(nextSeriesCharacterLinks ? { series_character_links: nextSeriesCharacterLinks } : {}),
        } as any);

        void flushVariantSelection(type);
    };

    const resolvePanelAsset = (legacyAsset: LegacyPanelAsset | null | undefined, unitAsset: UnitPanelAsset | null | undefined, legacyUrl?: string | null, fallbackVariantId?: string): PanelAssetData => {
        const legacyVariants = Array.isArray(legacyAsset?.variants) ? legacyAsset.variants : [];
        const unitVariants = Array.isArray(unitAsset?.image_variants) ? unitAsset.image_variants : [];
        const mergedVariantsById = new Map<string, VariantLike>();

        [...legacyVariants, ...unitVariants].forEach((variant) => {
            if (!variant?.id) return;
            if (!mergedVariantsById.has(variant.id)) {
                mergedVariantsById.set(variant.id, variant);
            }
        });

        const mergedVariants = Array.from(mergedVariantsById.values()).sort((a, b) => parseVariantTime(b?.created_at) - parseVariantTime(a?.created_at));

        if (mergedVariants.length === 0 && legacyUrl) {
            mergedVariants.push({
                id: legacyAsset?.selected_id || unitAsset?.selected_image_id || fallbackVariantId || `${asset.id}-legacy`,
                url: legacyUrl,
                created_at: asset.updated_at || asset.created_at || Date.now(),
            });
        }

        const selectedVariant =
            mergedVariants.find((variant) => variant.id === legacyAsset?.selected_id)
            || mergedVariants.find((variant) => variant.id === unitAsset?.selected_image_id)
            || mergedVariants.find((variant) => legacyUrl && variant.url === legacyUrl);

        return {
            selected_id: selectedVariant?.id || legacyAsset?.selected_id || unitAsset?.selected_image_id || null,
            variants: mergedVariants,
        };
    };

    const fullBodyPanelAsset = resolvePanelAsset(asset.full_body_asset, asset.full_body, asset.full_body_image_url, `${asset.id}-full-body-legacy`);
    const threeViewPanelAsset = resolvePanelAsset(asset.three_view_asset, asset.three_views, asset.three_view_image_url, `${asset.id}-three-view-legacy`);
    const headshotPanelAsset = resolvePanelAsset(asset.headshot_asset, asset.head_shot, asset.headshot_image_url || asset.avatar_url, `${asset.id}-headshot-legacy`);

    // 统一把新版 unit 视频和旧版 video task 对齐到当前面板，保证历史动态结果也能显示。
    const resolvePanelMotionVideos = (panelKey: Extract<PanelKey, "full_body" | "headshot">) => {
        const unitVideos = panelKey === "full_body" ? (asset.full_body?.video_variants || []) : (asset.head_shot?.video_variants || []);
        const panelAsset = panelKey === "full_body" ? fullBodyPanelAsset : headshotPanelAsset;
        const panelImageUrls = new Set(
            [
                ...(panelAsset.variants || []).map((variant) => variant.url),
                panelKey === "full_body" ? asset.full_body_image_url : (asset.headshot_image_url || asset.avatar_url),
            ].map((value) => normalizeComparableAssetPath(value)).filter(Boolean),
        );
        const projectVideos = (currentProject?.video_tasks || [])
            .filter((task) => {
                if (!task?.video_url || (task.status && !["completed", "succeeded"].includes(task.status))) {
                    return false;
                }

                // 历史动态任务不一定回填 asset_id；这里退回到源图地址匹配，避免旧结果在弹窗里“凭空消失”。
                const imageMatchesPanel = !!task.image_url && panelImageUrls.has(normalizeComparableAssetPath(task.image_url));
                return task.asset_id === asset.id || imageMatchesPanel;
            });
        const legacyVideos = [...(asset.video_assets || []), ...projectVideos]
            .filter((task) => task?.video_url && (!task.status || ["completed", "succeeded"].includes(task.status)))
            .map((task) => ({
                id: task.id,
                url: task.video_url,
                video_url: task.video_url,
                image_url: task.image_url,
                created_at: task.created_at,
                status: task.status,
            }));
        const matchedLegacyVideos = legacyVideos.filter((task) => task.image_url && panelImageUrls.has(normalizeComparableAssetPath(task.image_url)));
        const fallbackLegacyVideos = matchedLegacyVideos.length > 0 ? matchedLegacyVideos : legacyVideos;
        const mergedById = new Map<string, VideoVariantLike>();

        [...unitVideos, ...fallbackLegacyVideos].forEach((video, index) => {
            const resolvedUrl = video?.url || video?.video_url;
            if (!resolvedUrl) return;
            const resolvedId = video?.id || `${panelKey}-video-${index}-${resolvedUrl}`;
            if (!mergedById.has(resolvedId)) {
                mergedById.set(resolvedId, { ...video, id: resolvedId, url: resolvedUrl });
            }
        });

        return getRecentVideoVariants(Array.from(mergedById.values()));
    };

    const fullBodyMotionVideos = resolvePanelMotionVideos("full_body");
    const headshotMotionVideos = resolvePanelMotionVideos("headshot");

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
        if (panelAsset.selected_id && panelAsset.variants?.some((variant) => variant.id === panelAsset.selected_id)) {
            return panelAsset.selected_id;
        }
        return null;
    };

    const getPanelSelectedUrl = (panelKey: PanelKey) => {
        if (panelKey === "full_body") {
            const selected = fullBodyPanelAsset.variants?.find((variant) => variant.id === getPanelSelectedVariantId("full_body"));
            return getAssetUrl(selected?.url || asset.full_body_image_url || fullBodyPanelAsset.variants?.[0]?.url);
        }
        if (panelKey === "three_view") {
            const selected = threeViewPanelAsset.variants?.find((variant) => variant.id === getPanelSelectedVariantId("three_view"));
            return getAssetUrl(selected?.url || asset.three_view_image_url || threeViewPanelAsset.variants?.[0]?.url);
        }
        const selected = headshotPanelAsset.variants?.find((variant) => variant.id === getPanelSelectedVariantId("headshot"));
        return getAssetUrl(selected?.url || asset.headshot_image_url || asset.avatar_url || headshotPanelAsset.variants?.[0]?.url);
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
            previewUrl: getPanelSelectedUrl("full_body"),
            variantsCount: fullBodyPanelAsset.variants?.length || 0,
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
            previewUrl: getPanelSelectedUrl("three_view"),
            variantsCount: threeViewPanelAsset.variants?.length || 0,
            isGenerating: getGeneratingInfo("three_view").isGenerating,
            isLocked: !(fullBodyPanelAsset.variants?.length > 0 || asset.full_body_image_url || hasAnyUpload),
            motionEnabled: false
        },
        {
            key: "headshot" as const,
            title: "头像",
            subtitle: "面部细节与表情参考",
            hint: "更适合锁定五官、妆容和近景表情特征。",
            icon: Eye,
            accent: "from-amber-400/25 via-orange-500/15 to-transparent",
            previewUrl: getPanelSelectedUrl("headshot"),
            variantsCount: headshotPanelAsset.variants?.length || 0,
            isGenerating: getGeneratingInfo("headshot").isGenerating,
            isLocked: !(fullBodyPanelAsset.variants?.length > 0 || asset.full_body_image_url || hasAnyUpload),
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
            if (nextMode === "motion" && !(fullBodyPanelAsset.variants?.length > 0 || asset.full_body_image_url)) {
                alert("请先生成静态图片。");
                return;
            }
            setFullBodyMode(nextMode);
            return;
        }

        if (activePanel === "headshot") {
            if (nextMode === "motion" && !(headshotPanelAsset.variants?.length > 0 || asset.headshot_image_url || asset.avatar_url)) {
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

    const activeSelectedImageUrl = getPanelSelectedUrl(activePanel);
    const activePanelConfig = panelConfigs.find((panel) => panel.key === activePanel);

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-4 md:p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="asset-surface-strong asset-workbench-shell relative flex h-[90vh] w-full max-w-[1520px] flex-col overflow-hidden rounded-[30px] border border-white/10 shadow-2xl"
            >
                <div className="flex h-20 items-center justify-between border-b border-white/5 bg-white/[0.02] px-8">
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-4">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                                <User size={20} />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold text-white tracking-tight">{asset.name}</h2>
                                <p className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.2em] mt-0.5">Character Studio</p>
                            </div>
                        </div>
                        
                        <div className="h-8 w-px bg-white/5" />
                        
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10">
                                <span className="text-[10px] font-bold text-gray-500 uppercase">制作进度</span>
                                <div className="flex gap-1">
                                    {panelConfigs.map((p, i) => (
                                        <div key={i} className={`h-1.5 w-4 rounded-full ${i < completedPanels ? 'bg-indigo-500' : 'bg-white/10'}`} />
                                    ))}
                                </div>
                            </div>
                            <span className="text-xs font-bold text-gray-400">{completedPanels} / {panelConfigs.length} 已就绪</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2.5 hover:bg-white/10 rounded-full text-gray-500 hover:text-white transition-all">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] overflow-hidden">
                    <aside className="bg-black/20 border-r border-white/5 flex flex-col overflow-hidden">
                        {/* Tab Navigation */}
                        <div className="p-4 grid grid-cols-3 gap-2 border-b border-white/5 bg-black/20">
                            {panelConfigs.map((panel, index) => {
                                const isActive = panel.key === activePanel;
                                const isLocked = panel.isLocked;
                                return (
                                    <button
                                        key={panel.key}
                                        type="button"
                                        disabled={isLocked}
                                        onClick={() => setActivePanel(panel.key)}
                                        className={`flex flex-col items-center gap-2 py-3.5 rounded-2xl transition-all duration-300 ${
                                            isActive 
                                                ? "bg-indigo-600 text-white shadow-xl shadow-indigo-600/20 ring-1 ring-white/20" 
                                                : isLocked
                                                    ? "opacity-30 cursor-not-allowed grayscale"
                                                : "text-gray-500 hover:bg-white/5 hover:text-gray-300"
                                        }`}
                                    >
                                        <div className="relative">
                                            <panel.icon size={20} />
                                            {isLocked && <Lock size={10} className="absolute -top-1 -right-1 text-gray-500" />}
                                        </div>
                                        <span className="text-[10px] font-bold uppercase tracking-widest">{panel.title}</span>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Selected Preview Area */}
                        <div className="flex-1 flex flex-col overflow-hidden p-6 space-y-6">
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center gap-2">
                                    <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em]">Active Preview</span>
                                </div>
                                <h3 className="text-sm font-bold text-white mt-1">{activePanelConfig?.title}</h3>
                            </div>

                            <div className="relative flex-1 rounded-[32px] overflow-hidden border border-white/10 bg-black/40 shadow-2xl group">
                                {activeSelectedImageUrl ? (
                                    <>
                                        <img
                                            src={activeSelectedImageUrl}
                                            alt="Preview"
                                            className="h-full w-full object-contain transition-transform duration-700 group-hover:scale-105"
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                        <button
                                            type="button"
                                            onClick={() => setZoomedImageUrl(activeSelectedImageUrl)}
                                            className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300"
                                        >
                                            <div className="p-4 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white transform scale-90 group-hover:scale-100 transition-transform">
                                                <Eye size={24} />
                                            </div>
                                        </button>
                                    </>
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center gap-4 text-gray-500">
                                        <div className="p-6 rounded-3xl bg-white/[0.02] border border-white/[0.05]">
                                            <PhotoIcon size={40} strokeWidth={1} />
                                        </div>
                                        <p className="text-xs font-bold uppercase tracking-widest">Awaiting Generation</p>
                                    </div>
                                )}
                            </div>

                            <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/5">
                                <p className="text-[11px] leading-relaxed text-gray-500 italic">
                                    {activePanelConfig?.hint}
                                </p>
                            </div>
                        </div>
                    </aside>

                    <main className="flex flex-col overflow-hidden bg-black/20">
                        {/* ── Top Control Bar ── */}
                        <div className="h-20 flex items-center justify-between px-8 border-b border-white/5 bg-black/20">
                            <div className="flex items-center gap-4">
                                <div className="flex p-1 bg-black/40 rounded-xl border border-white/5">
                                    <button
                                        type="button"
                                        onClick={() => handleActiveModeChange("static")}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                                            activeMode === "static" 
                                                ? "bg-white/10 text-white shadow-lg" 
                                                : "text-gray-500 hover:text-gray-300"
                                        }`}
                                    >
                                        <PhotoIcon size={14} />
                                        静态
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => supportsActiveMotion && handleActiveModeChange("motion")}
                                        disabled={!supportsActiveMotion}
                                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                                            activeMode === "motion" 
                                                ? "bg-indigo-600 text-white shadow-lg" 
                                                : !supportsActiveMotion 
                                                    ? "opacity-30 grayscale cursor-not-allowed" 
                                                : "text-gray-500 hover:text-gray-300"
                                        }`}
                                    >
                                        <Video size={14} />
                                        动态
                                    </button>
                                </div>
                            </div>

                            {activeMode === "static" && (
                                <div className="flex items-center gap-6">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mr-2">批量</span>
                                        <div className="flex p-1 bg-black/40 rounded-xl border border-white/5">
                                            {[1, 2, 3, 4].map((size) => (
                                                <button
                                                    key={size}
                                                    type="button"
                                                    onClick={() => setActiveBatchSize(size)}
                                                    className={`w-10 h-8 flex items-center justify-center rounded-lg text-xs font-bold transition-all ${
                                                        activeBatchSize === size 
                                                            ? "bg-white/10 text-white" 
                                                            : "text-gray-500 hover:text-gray-300"
                                                    }`}
                                                >
                                                    {size}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <BillingActionButton
                                        type="button"
                                        onClick={handleToolbarGenerate}
                                        disabled={getGeneratingInfo(activePanel).isGenerating || !assetGenerateAffordable}
                                        className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold transition-all ${
                                            getGeneratingInfo(activePanel).isGenerating || !assetGenerateAffordable
                                                ? "bg-white/5 text-gray-500 border border-white/5 cursor-not-allowed"
                                                : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-xl shadow-indigo-600/20"
                                        }`}
                                        priceCredits={assetGeneratePrice}
                                        balanceCredits={account?.balance_credits}
                                    >
                                        <Sparkles size={14} className={getGeneratingInfo(activePanel).isGenerating ? "animate-spin" : ""} />
                                        {getGeneratingInfo(activePanel).isGenerating ? "正在生成" : "生成参考图"}
                                    </BillingActionButton>
                                </div>
                            )}
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
                                    motionRefVideos={fullBodyMotionVideos}
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
                                    balanceCredits={account?.balance_credits ?? undefined}
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
                                    motionRefVideos={headshotMotionVideos}
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
                                    balanceCredits={account?.balance_credits ?? undefined}
                                    onZoomImage={setZoomedImageUrl}
                                />
                            )}
                        </div>
                    </main>
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
    motionRefPrice?: number | null;
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
    const latestVariants = getRecentVariants(Array.isArray(asset?.variants) ? asset.variants : []);
    const latestMotionVideo = getRecentVideoVariants(motionRefVideos)[0];
    const railRef = useRef<HTMLDivElement | null>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);

    return (
        <div className="h-full flex flex-col overflow-hidden relative">
            {isLocked && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 backdrop-blur-md p-6 text-center">
                    <div className="flex flex-col items-center gap-4 text-gray-500 max-w-sm">
                        <div className="p-6 rounded-full bg-white/5 border border-white/10">
                            <Lock size={40} strokeWidth={1.5} />
                        </div>
                        <h3 className="text-lg font-bold text-white">板块已锁定</h3>
                        <p className="text-sm leading-relaxed">请先生成“主素材”，确保角色核心特征确立后，再继续当前板块的创作。</p>
                    </div>
                </div>
            )}

            <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar p-8 space-y-12">
                {/* ── Variant Grid Section ── */}
                <section>
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">
                                {mode === 'static' ? '生成结果' : '动态参考'}
                                <span className="ml-3 px-2 py-0.5 rounded-full bg-white/5 text-[9px] text-gray-500 font-bold border border-white/5">
                                    {mode === 'static' ? latestVariants.length : motionRefVideos.length} RECORDS
                                </span>
                            </h3>
                        </div>
                    </div>

                    {mode === 'static' ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-6">
                            {latestVariants.map((variant) => (
                                <motion.div
                                    key={variant.id}
                                    layout
                                    onClick={() => onSelect(variant.id)}
                                    onDoubleClick={() => onZoomImage?.(getAssetUrl(variant.url))}
                                    className={`group relative aspect-[3/4] rounded-2xl overflow-hidden border-2 transition-all duration-300 cursor-pointer ${
                                        selectedVariantId === variant.id 
                                            ? "border-indigo-500 shadow-xl shadow-indigo-500/20 scale-[1.02]" 
                                            : "border-white/5 hover:border-white/20 hover:bg-white/5"
                                    }`}
                                >
                                    <img src={getAssetUrl(variant.url)} alt="Variant" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" />
                                    <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-all" />
                                    {selectedVariantId === variant.id && (
                                        <div className="absolute top-2 right-2 p-1.5 rounded-full bg-indigo-600 text-white shadow-lg ring-2 ring-white/20">
                                            <Check size={12} />
                                        </div>
                                    )}
                                </motion.div>
                            ))}
                            
                            {isGenerating && Array.from({ length: generatingBatchSize }).map((_, i) => (
                                <div key={`gen-${i}`} className="aspect-[3/4] rounded-2xl bg-white/[0.02] border border-dashed border-white/10 flex flex-col items-center justify-center gap-4 animate-pulse">
                                    <RefreshCw size={24} className="text-indigo-500/50 animate-spin" />
                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Generating</span>
                                </div>
                            ))}

                            {latestVariants.length === 0 && !isGenerating && (
                                <div className="col-span-full py-20 flex flex-col items-center justify-center text-gray-500 border border-dashed border-white/5 rounded-3xl">
                                    <Sparkles size={40} strokeWidth={1} className="mb-4 opacity-20" />
                                    <p className="text-xs font-bold uppercase tracking-widest">No Variants Generated Yet</p>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                            {motionRefVideos.map((video) => (
                                <div key={video.id} className="group relative aspect-[3/4] rounded-2xl overflow-hidden border border-white/10 bg-black/40">
                                    <video src={getAssetUrl(video.url || video.video_url)} className="h-full w-full object-cover" controls />
                                    <div className="absolute top-3 right-3 p-2 rounded-lg bg-black/60 backdrop-blur-md text-white/50 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Video size={14} />
                                    </div>
                                </div>
                            ))}
                            {isGeneratingMotion && (
                                <div className="aspect-[3/4] rounded-2xl bg-white/[0.02] border border-dashed border-white/10 flex flex-col items-center justify-center gap-4 animate-pulse">
                                    <RefreshCw size={24} className="text-indigo-500/50 animate-spin" />
                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Rendering</span>
                                </div>
                            )}
                        </div>
                    )}
                </section>

                {/* ── Prompt Editor Section ── */}
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">
                                    {mode === 'static' ? '提示词' : '动态描述'}
                                </h3>
                            </div>
                        </div>
                        
                        <div className="relative">
                            <textarea
                                value={mode === 'static' ? prompt : motionPrompt}
                                onChange={(e) => mode === 'static' ? setPrompt(e.target.value) : setMotionPrompt?.(e.target.value)}
                                className="w-full h-48 bg-black/40 border border-white/10 rounded-[24px] p-6 text-[13px] leading-relaxed text-gray-200 resize-none focus:border-indigo-500/50 focus:outline-none focus:ring-4 focus:ring-indigo-500/5 transition-all custom-scrollbar"
                                placeholder={mode === 'static' ? "描述角色外貌、服饰、姿态..." : "描述动作幅度、运镜方式..."}
                            />
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="h-1.5 w-1.5 rounded-full bg-white/10" />
                                <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-[0.2em]">控制与设置</h3>
                            </div>
                        </div>

                        <div className="space-y-4">
                            {mode === 'static' ? (
                                <>
                                    <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
                                        <div className="flex flex-col gap-1">
                                            <span className="text-xs font-bold text-gray-300">艺术指导风格</span>
                                            <span className="text-[10px] text-gray-500">自动应用全局项目视觉定调</span>
                                        </div>
                                        <div className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]" />
                                    </div>

                                    <div className="space-y-3">
                                        <button
                                            onClick={() => setShowAdvanced(!showAdvanced)}
                                            className="flex items-center justify-between w-full p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/[0.08] transition-all"
                                        >
                                            <div className="flex items-center gap-2 text-gray-400">
                                                <Sliders size={14} />
                                                <span className="text-xs font-bold uppercase tracking-widest">负向提示词</span>
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
                                                        className="w-full h-32 bg-black/40 border border-white/10 rounded-2xl p-4 text-[11px] text-gray-500 font-mono resize-none focus:border-indigo-500/50 focus:outline-none transition-all custom-scrollbar"
                                                        placeholder="排除不想要的特征..."
                                                    />
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                </>
                            ) : (
                                <div className="space-y-4">
                                    <div className="p-6 rounded-3xl bg-indigo-600/10 border border-indigo-500/20">
                                        <h4 className="text-[10px] font-bold text-indigo-400 uppercase tracking-[0.2em] mb-4">动态生成设置</h4>
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-gray-400 font-medium">生成时长</span>
                                            <span className="font-bold text-white">5.0s</span>
                                        </div>
                                    </div>
                                    
                                    <BillingActionButton
                                        onClick={() => onGenerateMotionRef?.(motionPrompt, motionNegativePrompt)}
                                        disabled={isGeneratingMotion || !motionRefAffordable}
                                        className={`w-full py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${
                                            isGeneratingMotion || !motionRefAffordable
                                                ? "bg-white/5 text-gray-500 border border-white/5 cursor-not-allowed"
                                                : "bg-indigo-600 text-white hover:bg-indigo-500 shadow-xl shadow-indigo-600/20"
                                        }`}
                                        priceCredits={motionRefPrice}
                                        balanceCredits={balanceCredits}
                                    >
                                        <Sparkles size={16} className={isGeneratingMotion ? "animate-spin" : ""} />
                                        {isGeneratingMotion ? "正在制作动态参考..." : "立即生成动态参考"}
                                    </BillingActionButton>
                                </div>
                            )}
                        </div>
                    </div>
                </section>
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
        <div className="bg-black/40 border border-white/10 rounded-[24px] p-6 space-y-4">
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{label}</span>
                {action}
            </div>
            <textarea
                value={value}
                onChange={(event) => onChange(event.target.value)}
                disabled={disabled}
                className="w-full h-32 bg-transparent border-none text-[13px] leading-relaxed text-gray-200 resize-none focus:outline-none custom-scrollbar"
                placeholder={placeholder}
            />
        </div>
    );
}
