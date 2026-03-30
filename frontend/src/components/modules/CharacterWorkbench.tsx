"use client";

import { useState, useEffect, type ReactNode } from "react";
import { motion } from "framer-motion";
import { X, RefreshCw, Check, Image as ImageIcon, Lock, Video, Sparkles, Eye } from "lucide-react";
import { api } from "@/lib/api";

import { useProjectStore } from "@/store/projectStore";
import { Image as PhotoIcon } from "lucide-react";
import { getAssetUrl } from "@/lib/utils";

type PanelKey = "full_body" | "three_view" | "headshot";

const DEFAULT_NEGATIVE_PROMPT = "low quality, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, jpeg artifacts, signature, watermark, blurry";
const LATEST_BATCH_WINDOW_MS = 5000;
const CANDIDATE_GRID_CLASS: Record<number, string> = {
    1: "grid-cols-1",
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
};

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

    return sortedVariants.filter((variant, index) => {
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

const getCandidateGridClass = (count: number) => {
    const safeCount = Math.min(Math.max(count, 1), 4);
    return CANDIDATE_GRID_CLASS[safeCount];
};


interface CharacterWorkbenchProps {
    asset: any;
    onClose: () => void;
    onUpdateDescription: (desc: string) => void;
    onGenerate: (type: string, prompt: string, applyStyle: boolean, negativePrompt: string, batchSize: number) => void;
    generatingTypes: { type: string; batchSize: number }[];
    stylePrompt?: string;
    styleNegativePrompt?: string;
    onGenerateVideo?: (prompt: string, duration: number, subType?: string) => void;
    onDeleteVideo?: (videoId: string) => void;
    isGeneratingVideo?: boolean;
}

export default function CharacterWorkbench({ asset, onClose, onUpdateDescription, onGenerate, generatingTypes = [], stylePrompt = "", styleNegativePrompt = "", onGenerateVideo, onDeleteVideo, isGeneratingVideo }: CharacterWorkbenchProps) {
    const [activePanel, setActivePanel] = useState<PanelKey>("full_body");
    const updateProject = useProjectStore(state => state.updateProject);
    const currentProject = useProjectStore(state => state.currentProject);

    // Mode state for Asset Activation v2 (Static/Motion)
    const [fullBodyMode, setFullBodyMode] = useState<'static' | 'motion'>('static');
    const [headshotMode, setHeadshotMode] = useState<'static' | 'motion'>('static');

    // Motion Ref prompts (initialized with PRD templates)
    const [fullBodyMotionPrompt, setFullBodyMotionPrompt] = useState('');
    const [headshotMotionPrompt, setHeadshotMotionPrompt] = useState('');

    // Motion Ref audio URLs
    const [fullBodyAudioUrl, setFullBodyAudioUrl] = useState('');
    const [headshotAudioUrl, setHeadshotAudioUrl] = useState('');
    const [isUploadingAudio, setIsUploadingAudio] = useState(false);

    // Motion Ref generation state
    const [isVideoLoading, setIsVideoLoading] = useState(false);
    const [zoomedImageUrl, setZoomedImageUrl] = useState<string | null>(null);
    const [optimisticSelectedIds, setOptimisticSelectedIds] = useState<Partial<Record<PanelKey, string>>>({});


    // === Reverse Generation: Detect uploaded images ===
    const hasUploadedThreeViews = asset.three_view_asset?.variants?.some((v: any) => v.is_uploaded_source) || false;
    const hasUploadedHeadshot = asset.headshot_asset?.variants?.some((v: any) => v.is_uploaded_source) || false;
    const hasUploadedFullBody = asset.full_body_asset?.variants?.some((v: any) => v.is_uploaded_source) || false;
    const hasAnyUpload = hasUploadedThreeViews || hasUploadedHeadshot || hasUploadedFullBody;
    const hasNonFullBodyUpload = hasUploadedThreeViews || hasUploadedHeadshot;
    const hasFullBodyImage = !!(asset.full_body_image_url || (asset.full_body_asset?.variants?.length > 0));

    // Local state for prompts
    const getInitialPrompt = (type: string, existingPrompt: string) => {
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
    };

    const [fullBodyPrompt, setFullBodyPrompt] = useState(getInitialPrompt("full_body", asset.full_body_prompt));
    const [threeViewPrompt, setThreeViewPrompt] = useState(getInitialPrompt("three_view", asset.three_view_prompt));
    const [headshotPrompt, setHeadshotPrompt] = useState(getInitialPrompt("headshot", asset.headshot_prompt));
    const [videoPrompt, setVideoPrompt] = useState(asset.video_prompt || "");
    const [fullBodyBatchSize, setFullBodyBatchSize] = useState(1);
    const [threeViewBatchSize, setThreeViewBatchSize] = useState(1);
    const [headshotBatchSize, setHeadshotBatchSize] = useState(1);

    // New State for Style Control
    const [applyStyle, setApplyStyle] = useState(true);
    // User's own negative prompt (initially empty or with sensible defaults)
    const [negativePrompt, setNegativePrompt] = useState(styleNegativePrompt || DEFAULT_NEGATIVE_PROMPT);
    // Art Direction Style expanded state (collapsed by default to save space)
    const [showStyleExpanded, setShowStyleExpanded] = useState(false);

    // Get the uploaded image URL for reverse generation reference
    const getUploadedReferenceUrl = () => {
        if (hasUploadedThreeViews) {
            const uploadedVariant = asset.three_view_asset?.variants?.find((v: any) => v.is_uploaded_source);
            return uploadedVariant?.url || asset.three_view_image_url;
        }
        if (hasUploadedHeadshot) {
            const uploadedVariant = asset.headshot_asset?.variants?.find((v: any) => v.is_uploaded_source);
            return uploadedVariant?.url || asset.headshot_image_url;
        }
        return null;
    };

    // Motion Ref generation handler with validation
    const handleGenerateMotionRef = async (assetType: 'full_body' | 'head_shot', prompt: string, audioUrl?: string) => {
        if (!onGenerateVideo) return;

        // Check if source image exists
        const hasSourceImage = assetType === 'full_body'
            ? (asset.full_body_image_url || asset.full_body_asset?.variants?.length > 0)
            : (asset.headshot_image_url || asset.headshot_asset?.variants?.length > 0);

        if (!hasSourceImage) {
            alert(`请先生成一张${assetType === 'full_body' ? '全身图' : '头像'}作为参考图，然后再生成动态参考视频。`);
            return;
        }

        setIsVideoLoading(true); // Start loading state (will be reset by onCanPlay or if no video)
        onGenerateVideo(prompt, 5, assetType);
    };


    // Audio upload handler for Motion Ref
    const handleAudioUpload = async (file: File, assetType: 'full_body' | 'head_shot') => {
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('audio/')) {
            alert('请上传有效的音频文件（MP3, WAV, etc.）');
            return;
        }

        // Validate file size (max 10MB)
        if (file.size > 10 * 1024 * 1024) {
            alert('音频文件不能超过 10MB');
            return;
        }

        setIsUploadingAudio(true);

        try {
            const result = await api.uploadFile(file);
            const url = result.url;

            if (assetType === 'full_body') {
                setFullBodyAudioUrl(url);
                // Automatically update prompt if it's the default "counting" one
                const currentDefault = `Full-body character reference video.\n${asset.description}.\nStanding pose, shifting weight slightly, natural hand gestures while talking, turning body 30 degrees left and right. The character is speaking naturally, counting numbers from one to five in English.\nHead to toe shot, stable camera, flat lighting.`;
                const oldDefault = `Full-body character reference video.\n${asset.description}.\nStanding pose, shifting weight slightly, natural hand gestures while talking, turning body 30 degrees left and right to show costume details. No walking away.\nHead to toe shot, stable camera, flat lighting.`;

                if (fullBodyMotionPrompt === currentDefault || fullBodyMotionPrompt === oldDefault || !fullBodyMotionPrompt) {
                    setFullBodyMotionPrompt(`Full-body character reference video.\n${asset.description}.\nStanding pose, shifting weight slightly, natural hand gestures, turning body 30 degrees left and right. The character is speaking naturally matching the audio, with accurate lip-sync and facial expressions.\nHead to toe shot, stable camera, flat lighting.`);
                }
            } else {
                setHeadshotAudioUrl(url);
                // Automatically update prompt if it's the default "counting" one
                const currentDefault = `High-fidelity portrait video reference.\n${asset.description}.\nFacing camera, speaking naturally, counting numbers from one to five in English, subtle head movements, blinking, rich micro-expressions.\n4k, studio lighting, stable camera.`;
                const oldDefault = `High-fidelity portrait video reference.\n${asset.description}.\nFacing camera, speaking naturally matching the audio, subtle head movements, blinking, rich micro-expressions.\n4k, studio lighting, stable camera.`;

                if (headshotMotionPrompt === currentDefault || headshotMotionPrompt === oldDefault || !headshotMotionPrompt) {
                    setHeadshotMotionPrompt(`High-fidelity portrait video reference.\n${asset.description}.\nFacing camera, speaking naturally matching the audio, with accurate lip-sync and facial expressions, subtle head movements, blinking, rich micro-expressions.\n4k, studio lighting, stable camera.`);
                }
            }
        } catch (error: any) {
            console.error('Failed to upload audio:', error);
            alert(`音频上传失败：${error.message}`);
        } finally {
            setIsUploadingAudio(false);
        }
    };

    // PRD Motion Prompt Templates
    const getMotionDefault = (type: 'full_body' | 'headshot', hasAudio: boolean) => {
        if (type === 'full_body') {
            return hasAudio
                ? `Full-body character reference video.\n${asset.description}.\nStanding pose, shifting weight slightly, natural hand gestures, turning body 30 degrees left and right. The character is speaking naturally matching the audio, with accurate lip-sync and facial expressions.\nHead to toe shot, stable camera, flat lighting.`
                : `Full-body character reference video.\n${asset.description}.\nStanding pose, shifting weight slightly, natural hand gestures while talking, turning body 30 degrees left and right. The character is speaking naturally, counting numbers from one to five in English.\nHead to toe shot, stable camera, flat lighting.`;
        } else {
            return hasAudio
                ? `High-fidelity portrait video reference.\n${asset.description}.\nFacing camera, speaking naturally matching the audio, with accurate lip-sync and facial expressions, subtle head movements, blinking, rich micro-expressions.\n4k, studio lighting, stable camera.`
                : `High-fidelity portrait video reference.\n${asset.description}.\nFacing camera, speaking naturally, counting numbers from one to five in English, subtle head movements, blinking, rich micro-expressions.\n4k, studio lighting, stable camera.`;
        }
    };

    // Initialize prompts if empty (first time load)
    useEffect(() => {
        if (!fullBodyPrompt) {
            setFullBodyPrompt(`Full body character design of ${asset.name}, concept art. ${asset.description}. Standing pose, neutral expression, no emotion, looking at viewer. Clean white background, isolated, no other objects, no scenery, simple background, high quality, masterpiece.`);
        }
        if (!threeViewPrompt) {
            setThreeViewPrompt(`Character Reference Sheet for ${asset.name}. ${asset.description}. Three-view character design: Front view, Side view, and Back view. Full body, standing pose, neutral expression. Consistent clothing and details across all views. Simple white background.`);
        }
        if (!headshotPrompt) {
            setHeadshotPrompt(`Close-up portrait of the SAME character ${asset.name}. ${asset.description}. Zoom in on face and shoulders, detailed facial features, neutral expression, looking at viewer, high quality, masterpiece.`);
        }
        if (!videoPrompt) {
            setVideoPrompt(`Cinematic shot of ${asset.name}, ${asset.description}, looking around, breathing, slight movement, high quality, 4k`);
        }

        if (!fullBodyMotionPrompt) {
            setFullBodyMotionPrompt(getMotionDefault('full_body', !!fullBodyAudioUrl));
        }
        if (!headshotMotionPrompt) {
            setHeadshotMotionPrompt(getMotionDefault('headshot', !!headshotAudioUrl));
        }
    }, [asset.name, asset.description]);

    useEffect(() => {
        setOptimisticSelectedIds({});
    }, [asset.id]);

    useEffect(() => {
        if (styleNegativePrompt && (!negativePrompt || negativePrompt === DEFAULT_NEGATIVE_PROMPT)) {
            setNegativePrompt(styleNegativePrompt);
        }
    }, [styleNegativePrompt]);

    const handleResetMotionPrompt = (type: 'full_body' | 'headshot') => {
        const hasAudio = type === 'full_body' ? !!fullBodyAudioUrl : !!headshotAudioUrl;
        const defaultPrompt = getMotionDefault(type, hasAudio);
        if (type === 'full_body') {
            setFullBodyMotionPrompt(defaultPrompt);
        } else {
            setHeadshotMotionPrompt(defaultPrompt);
        }
    };


    // Update local state when asset updates (e.g. after generation)
    useEffect(() => {
        if (asset.full_body_prompt) setFullBodyPrompt(asset.full_body_prompt);
        else if (hasNonFullBodyUpload && !fullBodyPrompt.includes("STRICTLY MAINTAIN")) {
            setFullBodyPrompt(getInitialPrompt("full_body", ""));
        }

        if (asset.three_view_prompt) setThreeViewPrompt(asset.three_view_prompt);
        else if (hasAnyUpload && !threeViewPrompt.includes("STRICTLY MAINTAIN")) {
            setThreeViewPrompt(getInitialPrompt("three_view", ""));
        }

        if (asset.headshot_prompt) setHeadshotPrompt(asset.headshot_prompt);
        else if (hasAnyUpload && !headshotPrompt.includes("STRICTLY MAINTAIN")) {
            setHeadshotPrompt(getInitialPrompt("headshot", ""));
        }

        if (asset.video_prompt) setVideoPrompt(asset.video_prompt);
    }, [asset, hasAnyUpload, hasNonFullBodyUpload]);

    const handleGenerateClick = (type: "full_body" | "three_view" | "headshot", batchSize: number) => {
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
            const updatedProject = await api.selectAssetVariant(currentProject.id, asset.id, "character", variantId, type);
            updateProject(currentProject.id, updatedProject);
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

    const resolvePanelAsset = (legacyAsset: any, unitAsset: any, legacyUrl?: string, fallbackVariantId?: string) => {
        const legacyVariants = Array.isArray(legacyAsset?.variants) ? legacyAsset.variants : [];
        const unitVariants = Array.isArray(unitAsset?.image_variants) ? unitAsset.image_variants : [];
        const mergedVariantsById = new Map<string, any>();

        [...legacyVariants, ...unitVariants].forEach((variant) => {
            if (!variant?.id) return;
            if (!mergedVariantsById.has(variant.id)) {
                mergedVariantsById.set(variant.id, variant);
            }
        });

        const mergedVariants = Array.from(mergedVariantsById.values()).sort((a: any, b: any) => {
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
        if (optimisticSelectedId && panelAsset.variants?.some((variant: any) => variant.id === optimisticSelectedId)) {
            return optimisticSelectedId;
        }
        return panelAsset.selected_id;
    };

    const getPanelSelectedUrl = (panelKey: PanelKey) => {
        if (panelKey === "full_body") {
            const selected = fullBodyPanelAsset.variants?.find((variant: any) => variant.id === getPanelSelectedVariantId("full_body"));
            return getAssetUrl(selected?.url || asset.full_body_image_url);
        }
        if (panelKey === "three_view") {
            const selected = threeViewPanelAsset.variants?.find((variant: any) => variant.id === getPanelSelectedVariantId("three_view"));
            return getAssetUrl(selected?.url || asset.three_view_image_url);
        }
        const selected = headshotPanelAsset.variants?.find((variant: any) => variant.id === getPanelSelectedVariantId("headshot"));
        return getAssetUrl(selected?.url || asset.headshot_image_url || asset.avatar_url);
    };

    const activeSelectedImageUrl = getPanelSelectedUrl(activePanel);

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 md:p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="asset-surface-strong asset-workbench-shell relative border border-white/10 rounded-2xl w-full max-w-[1500px] h-[90vh] flex flex-col overflow-hidden shadow-2xl"
            >
                <div className="h-16 border-b border-white/10 flex justify-between items-center px-6 bg-black/20">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3">
                            <h2 className="text-xl font-bold text-white">{asset.name} <span className="text-gray-500 font-normal text-sm ml-2">角色工作台</span></h2>
                            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">
                                <span className="text-xs text-gray-400">制作进度</span>
                                <span className="text-xs font-semibold text-white">{completedPanels}/{panelConfigs.length}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full">
                            <span className="text-xs text-blue-400 font-medium">建议保持三张图风格一致，生成效果会更稳定</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <div className="flex-1 grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] overflow-hidden">
                    <aside className="asset-workbench-sidebar border-r border-white/10 overflow-hidden">
                        <div className="flex h-full flex-col">
                            <div className="grid grid-cols-3 border-b border-white/10">
                                {panelConfigs.map((panel, index) => {
                                    const isActive = panel.key === activePanel;
                                    return (
                                        <button
                                            key={panel.key}
                                            type="button"
                                            onClick={() => setActivePanel(panel.key)}
                                            className={`asset-workbench-tab flex min-w-0 items-center justify-start gap-1.5 border-r border-white/10 px-4 py-3 text-sm font-medium transition-colors last:border-r-0 ${isActive
                                                ? "asset-workbench-toggle-active text-white"
                                                : "text-gray-300 hover:bg-white/5 hover:text-white"
                                                }`}
                                        >
                                            <span className="shrink-0 text-xs font-semibold text-gray-400">{index + 1}</span>
                                            <span className="whitespace-nowrap">{panel.title}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="flex-1 p-5">
                                <div className="flex h-full min-h-0 flex-col rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-4">
                                    {activeSelectedImageUrl ? (
                                        <button
                                            type="button"
                                            onClick={() => setZoomedImageUrl(activeSelectedImageUrl)}
                                            className="h-full w-full overflow-hidden rounded-[1.4rem] bg-black/20"
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
                        <div className="asset-workbench-toolbar px-6 pt-2 pb-2">
                            <div className="flex items-center justify-between gap-4">
                                <div className="asset-workbench-toggle flex items-center gap-1 rounded-2xl border p-1 w-fit">
                                    <button
                                        type="button"
                                        onClick={() => handleActiveModeChange("static")}
                                        className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] transition-colors ${activeMode === "static"
                                            ? "border border-cyan-400/25 bg-cyan-400/15 text-cyan-100"
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
                                        className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] transition-colors ${activeMode === "motion"
                                            ? "border border-amber-400/25 bg-amber-400/15 text-amber-100"
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
                                        <div className="variant-selector-batch flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
                                            {[1, 2, 3, 4].map((size) => {
                                                return (
                                                    <button
                                                        key={size}
                                                        type="button"
                                                        onClick={() => setActiveBatchSize(size)}
                                                        className={`px-3 py-1.5 text-[11px] rounded-lg transition-colors ${activeBatchSize === size
                                                            ? "bg-white text-slate-950"
                                                            : "text-gray-300 hover:bg-white/5 hover:text-white"
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
                                            disabled={activePanel === "full_body"
                                                ? getGeneratingInfo("full_body").isGenerating
                                                : activePanel === "three_view"
                                                    ? getGeneratingInfo("three_view").isGenerating
                                                    : getGeneratingInfo("headshot").isGenerating}
                                            className={`variant-selector-generate flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-[11px] font-medium transition-all ${(activePanel === "full_body"
                                                ? getGeneratingInfo("full_body").isGenerating
                                                : activePanel === "three_view"
                                                    ? getGeneratingInfo("three_view").isGenerating
                                                    : getGeneratingInfo("headshot").isGenerating)
                                                ? "bg-white/5 text-gray-400 cursor-not-allowed"
                                                : "bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-lg shadow-emerald-500/20"
                                                }`}
                                        >
                                            <PhotoIcon size={11} />
                                            生成图片
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex-1 overflow-hidden">
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
                                    onGenerateMotionRef={(prompt: string, audioUrl?: string) => handleGenerateMotionRef('full_body', prompt, audioUrl)}
                                    isGeneratingMotion={generatingTypes.some(t => t.type === "video_full_body")}
                                    motionPrompt={fullBodyMotionPrompt}
                                    setMotionPrompt={setFullBodyMotionPrompt}
                                    audioUrl={fullBodyAudioUrl}
                                    onAudioUpload={(file: File) => handleAudioUpload(file, 'full_body')}
                                    isUploadingAudio={isUploadingAudio}
                                    isVideoLoading={isVideoLoading}
                                    setIsVideoLoading={setIsVideoLoading}
                                    onResetPrompt={() => handleResetMotionPrompt('full_body')}
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
                                    onGenerateMotionRef={(prompt: string, audioUrl?: string) => handleGenerateMotionRef('head_shot', prompt, audioUrl)}
                                    isGeneratingMotion={generatingTypes.some(t => t.type === "video_head_shot")}
                                    motionPrompt={headshotMotionPrompt}
                                    setMotionPrompt={setHeadshotMotionPrompt}
                                    audioUrl={headshotAudioUrl}
                                    onAudioUpload={(file: File) => handleAudioUpload(file, 'head_shot')}
                                    isUploadingAudio={isUploadingAudio}
                                    isVideoLoading={isVideoLoading}
                                    setIsVideoLoading={setIsVideoLoading}
                                    onResetPrompt={() => handleResetMotionPrompt('headshot')}
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
    audioUrl = '',
    onAudioUpload,
    isUploadingAudio = false,
    isVideoLoading = false,
    setIsVideoLoading,
    onResetPrompt,
    // Reverse Generation Props
    reverseGenerationMode = false,
    reverseReferenceUrl = null,
    onZoomImage,
}: any) {
    const latestVariants = getLatestBatchVariants(Array.isArray(asset?.variants) ? asset.variants : []);
    const aspectRatioClass = getAspectRatioCardClass(aspectRatio);

    return (
        <div className="h-full overflow-y-auto">
            <div className="grid h-full min-w-0 grid-cols-1 gap-4 p-4">
                <div className="asset-workbench-stage relative min-h-0 overflow-hidden rounded-3xl p-4">
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
                            <div className={`relative flex min-h-[320px] items-center justify-center overflow-hidden rounded-[1.75rem] border border-white/10 bg-black/20 p-4 ${aspectRatioClass}`}>
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
                                        onCanPlay={() => setIsVideoLoading(false)}
                                        onLoadStart={() => setIsVideoLoading(true)}
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

                            <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
                                <div className="asset-workbench-inspector rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
                                    <label className="mb-3 block text-xs font-semibold text-gray-300">音频文件</label>
                                    <label className={`asset-workbench-upload flex min-h-[160px] cursor-pointer items-center justify-center gap-2 rounded-[1.25rem] border border-dashed px-3 py-3 transition-all ${audioUrl
                                        ? 'border-green-500/50 bg-green-500/10 text-green-400'
                                        : 'border-white/15 hover:border-white/25 text-gray-400'
                                        }`}>
                                        <input
                                            type="file"
                                            accept="audio/*"
                                            className="hidden"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) onAudioUpload?.(file);
                                            }}
                                            disabled={isUploadingAudio}
                                        />
                                        {isUploadingAudio ? (
                                            <>
                                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary"></div>
                                                <span className="text-xs">上传中...</span>
                                            </>
                                        ) : audioUrl ? (
                                            <>
                                                <Check size={14} />
                                                <span className="text-xs font-medium">音频已上传</span>
                                            </>
                                        ) : (
                                            <>
                                                <ImageIcon size={14} />
                                                <span className="text-xs">上传音频</span>
                                            </>
                                        )}
                                    </label>
                                </div>

                                <PromptField
                                    label="动态视频提示词"
                                    value={motionPrompt}
                                    onChange={(value: string) => setMotionPrompt?.(value)}
                                    placeholder="请输入动态视频提示词..."
                                    disabled={isLocked}
                                    action={(
                                        <button
                                            type="button"
                                            onClick={() => onResetPrompt?.()}
                                            className="flex items-center gap-1 text-[10px] text-primary transition-colors hover:text-primary/80"
                                            title="恢复推荐提示词"
                                        >
                                            <RefreshCw size={10} />
                                            重置
                                        </button>
                                    )}
                                />
                            </div>

                            <button
                                onClick={() => onGenerateMotionRef?.(motionPrompt, audioUrl)}
                                disabled={isGeneratingMotion}
                                className={`flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium transition-all ${isGeneratingMotion
                                    ? 'bg-white/5 text-gray-500 cursor-not-allowed'
                                    : 'bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-lg shadow-amber-500/20'
                                    }`}
                            >
                                <Video size={16} />
                                生成动态视频
                            </button>
                        </div>
                    ) : (
                        <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
                            <div className="relative">
                                {latestVariants.length > 0 ? (
                                    <div className={`grid gap-4 ${getCandidateGridClass(latestVariants.length)}`}>
                                        {latestVariants.map((variant: any, index: number) => {
                                            const imageUrl = getAssetUrl(variant.url);
                                            const isSelected = selectedVariantId === variant.id;
                                            return (
                                                <button
                                                    key={variant.id}
                                                    type="button"
                                                    onClick={() => onSelect(variant.id)}
                                                    onDoubleClick={() => onZoomImage?.(imageUrl)}
                                                    className={`group flex min-w-0 flex-col overflow-hidden rounded-[1.5rem] border bg-black/15 text-left transition-all ${isSelected
                                                        ? 'border-cyan-400/60 shadow-[0_0_0_1px_rgba(34,211,238,0.22)]'
                                                        : 'border-white/10 hover:border-white/20'
                                                        }`}
                                                    title="单击设为当前图片，双击放大查看"
                                                >
                                                    <div className={`relative w-full ${aspectRatioClass} overflow-hidden bg-black/20`}>
                                                        <img
                                                            src={imageUrl}
                                                            alt={`候选图${index + 1}`}
                                                            className="h-full w-full object-contain"
                                                        />
                                                    </div>
                                                    <div className="border-t border-white/10 px-3 py-2 text-center text-xs text-gray-300">
                                                        候选图{index + 1}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="flex min-h-[260px] items-center justify-center rounded-[1.5rem] border border-dashed border-white/12 bg-white/[0.03] text-sm text-gray-500">
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
        <div className="asset-workbench-inspector rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-gray-300">{label}</span>
                {action}
            </div>
            <textarea
                value={value}
                onChange={(event) => onChange(event.target.value)}
                disabled={disabled}
                className="asset-workbench-textarea min-h-[160px] w-full resize-none rounded-[1.25rem] border border-white/10 bg-black/10 px-4 py-3 text-sm leading-relaxed text-white shadow-none outline-none focus:border-white/20"
                placeholder={placeholder}
            />
        </div>
    );
}
