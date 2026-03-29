"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, RefreshCw, Check, Image as ImageIcon, Lock, Video, Sparkles, Eye } from "lucide-react";
import { api } from "@/lib/api";

import { VariantSelector } from "../common/VariantSelector";
import { VideoVariantSelector } from "../common/VideoVariantSelector";
import { useProjectStore } from "@/store/projectStore";
import { Image as PhotoIcon } from "lucide-react";
import { getAssetUrl } from "@/lib/utils";


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
    const [activePanel, setActivePanel] = useState<"full_body" | "three_view" | "headshot" | "video">("full_body");
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

    // New State for Style Control
    const [applyStyle, setApplyStyle] = useState(true);
    // User's own negative prompt (initially empty or with sensible defaults)
    const [negativePrompt, setNegativePrompt] = useState("low quality, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, jpeg artifacts, signature, watermark, blurry");
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

    const handleSelectVariant = async (type: "full_body" | "three_view" | "headshot", variantId: string) => {
        if (!currentProject) return;

        try {
            const updatedProject = await api.selectAssetVariant(currentProject.id, asset.id, "character", variantId, type);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to select variant:", error);
        }
    };

    const handleDeleteVariant = async (type: "full_body" | "three_view" | "headshot", variantId: string) => {
        if (!currentProject) return;

        try {
            const updatedProject = await api.deleteAssetVariant(currentProject.id, asset.id, "character", variantId);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to delete variant:", error);
        }
    };

    const handleFavoriteVariant = async (type: "full_body" | "three_view" | "headshot", variantId: string, isFavorited: boolean) => {
        if (!currentProject) return;

        try {
            const updatedProject = await api.favoriteAssetVariant(currentProject.id, asset.id, "character", variantId, isFavorited, type);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to favorite variant:", error);
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
            title: "三视图",
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
            title: "头像特写",
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

    const activePanelConfig = panelConfigs.find((panel) => panel.key === activePanel) ?? panelConfigs[0];
    const completedPanels = panelConfigs.filter((panel) => !!panel.previewUrl || panel.variantsCount > 0).length;

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 md:p-8">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="asset-surface-strong border border-white/10 rounded-2xl w-full max-w-[1500px] h-[90vh] flex flex-col overflow-hidden shadow-2xl"
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
                    <aside className="border-r border-white/10 bg-black/25 overflow-hidden">
                        <div className="grid grid-cols-1 gap-3 p-4">
                            {panelConfigs.map((panel, index) => {
                                const Icon = panel.icon;
                                const isActive = panel.key === activePanel;
                                const hasPreview = !!panel.previewUrl || panel.variantsCount > 0;
                                const previewUrl = hasPreview ? getAssetUrl(panel.previewUrl) : null;

                                return (
                                    <button
                                        key={panel.key}
                                        type="button"
                                        onClick={() => setActivePanel(panel.key)}
                                        className={`w-full text-left rounded-2xl border p-4 transition-all ${isActive
                                            ? 'border-primary/40 bg-white/[0.06] shadow-lg shadow-primary/10'
                                            : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]'
                                            }`}
                                    >
                                        <div className="flex items-start gap-3">
                                            <div className="relative shrink-0">
                                                <div className={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br ${panel.accent} border border-white/10`}>
                                                    {previewUrl ? (
                                                        <img
                                                            src={previewUrl}
                                                            alt={panel.title}
                                                            className="h-full w-full object-cover"
                                                        />
                                                    ) : (
                                                        <Icon size={20} className={isActive ? "text-white" : "text-gray-300"} />
                                                    )}
                                                </div>
                                                <div className="absolute -bottom-1 -right-1 rounded-full border border-black/30 bg-black/70 px-1.5 py-0.5 text-[10px] text-gray-300">
                                                    {index + 1}
                                                </div>
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div>
                                                        <div className="text-[11px] tracking-[0.2em] text-gray-500">步骤 {index + 1}</div>
                                                        <div className={`text-sm font-semibold ${isActive ? 'text-white' : 'text-gray-200'}`}>{panel.title}</div>
                                                    </div>
                                                    {panel.isGenerating ? (
                                                        <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 text-[11px] text-sky-300">生成中</span>
                                                    ) : panel.isLocked ? (
                                                        <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-gray-500">待解锁</span>
                                                    ) : hasPreview ? (
                                                        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-300">已产出</span>
                                                    ) : (
                                                        <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[11px] text-amber-300">待制作</span>
                                                    )}
                                                </div>

                                                <p className="mt-2 text-xs text-gray-400 leading-5">{panel.subtitle}</p>

                                                <div className="mt-3 flex items-center justify-between text-[11px] text-gray-500">
                                                    <span>{panel.variantsCount} 个候选</span>
                                                    <span>{panel.motionEnabled ? "支持静态/动态" : "静态板块"}</span>
                                                </div>

                                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
                                                    <div
                                                        className={`h-full rounded-full transition-all ${hasPreview ? 'bg-gradient-to-r from-emerald-400 to-cyan-400' : panel.isLocked ? 'bg-white/10' : 'bg-gradient-to-r from-amber-400 to-orange-400'}`}
                                                        style={{ width: `${hasPreview ? 100 : panel.isLocked ? 20 : 45}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </aside>

                    <div className="overflow-hidden flex flex-col bg-gradient-to-br from-white/[0.02] via-transparent to-black/10">
                        <div className="border-b border-white/10 px-6 py-4 bg-black/10">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <div className="text-[11px] uppercase tracking-[0.22em] text-gray-500">{activePanelConfig.subtitle}</div>
                                    <h3 className="mt-1 text-xl font-semibold text-white">{activePanelConfig.title}</h3>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-gray-300">
                                        {activePanelConfig.variantsCount} 个候选结果
                                    </span>
                                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-gray-300">
                                        {activePanelConfig.motionEnabled ? "静态 + 动态工作流" : "静态工作流"}
                                    </span>
                                </div>
                            </div>
                            <p className="mt-3 text-sm text-gray-400">{activePanelConfig.hint}</p>
                            <div className="mt-4 flex flex-wrap gap-2">
                                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-gray-400">先看左侧状态，再集中处理当前板块</span>
                                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-gray-400">候选图在主预览下方统一切换</span>
                                <span className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] text-gray-400">提示词编辑已独立到右侧</span>
                            </div>
                        </div>

                        <div className="flex-1 overflow-hidden">
                            {activePanel === "full_body" && (
                                <WorkbenchPanel
                                    title="主素材（全身图）"
                                    asset={asset.full_body_asset}
                                    currentImageUrl={asset.full_body_image_url}
                                    onSelect={(id: string) => handleSelectVariant("full_body", id)}
                                    onDelete={(id: string) => handleDeleteVariant("full_body", id)}
                                    onFavorite={(id: string, isFav: boolean) => handleFavoriteVariant("full_body", id, isFav)}
                                    prompt={fullBodyPrompt}
                                    setPrompt={setFullBodyPrompt}
                                    onGenerate={(batchSize: number) => handleGenerateClick("full_body", batchSize)}
                                    isGenerating={getGeneratingInfo("full_body").isGenerating}
                                    generatingBatchSize={getGeneratingInfo("full_body").batchSize}
                                    description="角色一致性的主参考图，也是后续三视图和头像的基础来源。"
                                    aspectRatio="9:16"
                                    reverseGenerationMode={hasNonFullBodyUpload && !hasFullBodyImage}
                                    reverseReferenceUrl={getUploadedReferenceUrl()}
                                    supportsMotion={true}
                                    mode={fullBodyMode}
                                    onModeChange={setFullBodyMode}
                                    hasStaticImage={!!asset.full_body_image_url || (asset.full_body_asset?.variants?.length > 0)}
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
                                    panelHint="先稳定人物整体造型、服装和比例，后续两个板块会更容易保持统一。"
                                />
                            )}

                            {activePanel === "three_view" && (
                                <WorkbenchPanel
                                    title="三视图"
                                    asset={asset.three_view_asset}
                                    currentImageUrl={asset.three_view_image_url}
                                    onSelect={(id: string) => handleSelectVariant("three_view", id)}
                                    onDelete={(id: string) => handleDeleteVariant("three_view", id)}
                                    onFavorite={(id: string, isFav: boolean) => handleFavoriteVariant("three_view", id, isFav)}
                                    prompt={threeViewPrompt}
                                    setPrompt={setThreeViewPrompt}
                                    onGenerate={(batchSize: number) => handleGenerateClick("three_view", batchSize)}
                                    isGenerating={getGeneratingInfo("three_view").isGenerating}
                                    generatingBatchSize={getGeneratingInfo("three_view").batchSize}
                                    isLocked={!asset.full_body_image_url && !hasAnyUpload}
                                    description="用于保证角色在正面、侧面、背面三个视角下保持结构一致。"
                                    aspectRatio="16:9"
                                    panelHint="这个板块更偏结构校对，适合快速确认服装层级、轮廓和背面设计。"
                                />
                            )}

                            {activePanel === "headshot" && (
                                <WorkbenchPanel
                                    title="头像特写"
                                    asset={asset.headshot_asset}
                                    currentImageUrl={asset.headshot_image_url || asset.avatar_url}
                                    onSelect={(id: string) => handleSelectVariant("headshot", id)}
                                    onDelete={(id: string) => handleDeleteVariant("headshot", id)}
                                    onFavorite={(id: string, isFav: boolean) => handleFavoriteVariant("headshot", id, isFav)}
                                    prompt={headshotPrompt}
                                    setPrompt={setHeadshotPrompt}
                                    onGenerate={(batchSize: number) => handleGenerateClick("headshot", batchSize)}
                                    isGenerating={getGeneratingInfo("headshot").isGenerating}
                                    generatingBatchSize={getGeneratingInfo("headshot").batchSize}
                                    isLocked={!asset.full_body_image_url && !hasAnyUpload}
                                    description="用于保留面部细节、妆容和表情特征，适合做近景参考。"
                                    aspectRatio="1:1"
                                    supportsMotion={true}
                                    mode={headshotMode}
                                    onModeChange={setHeadshotMode}
                                    hasStaticImage={!!asset.headshot_image_url || (asset.headshot_asset?.variants?.length > 0)}
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
                                    panelHint="头像更适合单独抠细节，比如眼神、发际线、妆面和微表情。"
                                />
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer: Negative Prompt & Art Direction Settings */}
                <div className="border-t border-white/10 bg-black/20 flex flex-col">
                    {/* Top Row: User's Negative Prompt + Apply Style Toggle */}
                    <div className="px-6 py-3 flex items-start gap-4">
                        {/* User's Negative Prompt (Editable) */}
                        <div className="flex-1">
                            <label className="text-xs font-bold text-gray-500 mb-2 block">负向提示词</label>
                            <textarea
                                value={negativePrompt}
                                onChange={(e) => setNegativePrompt(e.target.value)}
                                className="w-full h-16 bg-black/40 border border-white/10 rounded-lg p-3 text-xs text-gray-300 resize-none focus:outline-none focus:border-primary/50 font-mono"
                                placeholder="请输入需要规避的元素..."
                            />
                        </div>

                        {/* Apply Style Toggle */}
                        <div className="pt-6">
                            <div className="flex items-center gap-2 bg-black/40 px-4 py-2 rounded-lg border border-white/10">
                                <input
                                    type="checkbox"
                                    id="applyStyleFooter"
                                    checked={applyStyle}
                                    onChange={(e) => setApplyStyle(e.target.checked)}
                                    className="rounded border-gray-600 bg-gray-700 text-primary focus:ring-primary w-4 h-4"
                                />
                                <label htmlFor="applyStyleFooter" className="text-xs font-bold text-gray-300 cursor-pointer select-none whitespace-nowrap">
                                    应用艺术指导风格
                                </label>
                            </div>
                        </div>
                    </div>

                    {/* Art Direction Style Display (Collapsible) - Only show toggle when style exists */}
                    {applyStyle && (stylePrompt || styleNegativePrompt) && (
                        <div className="border-t border-white/5">
                            <button
                                onClick={() => setShowStyleExpanded(!showStyleExpanded)}
                                className="w-full px-6 py-2 flex items-center justify-between hover:bg-white/5 transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-gradient-to-r from-purple-500 to-blue-500" />
                                    <span className="text-xs font-bold text-gray-400">艺术指导风格（生成时自动拼接）</span>
                                </div>
                                <ChevronRight size={14} className={`text-gray-500 transform transition-transform ${showStyleExpanded ? 'rotate-90' : ''}`} />
                            </button>

                            <AnimatePresence>
                                {showStyleExpanded && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: "auto", opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        className="overflow-hidden"
                                    >
                                        <div className="px-6 pb-4">
                                            <div className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-white/10 rounded-lg p-4">
                                                {stylePrompt && (
                                                    <div className="mb-3">
                                                        <span className="text-xs font-bold text-green-400 block mb-1">+ 风格提示词：</span>
                                                        <p className="text-xs text-gray-400 font-mono bg-black/20 p-2 rounded border border-white/5 leading-relaxed">
                                                            {stylePrompt}
                                                        </p>
                                                    </div>
                                                )}

                                                {styleNegativePrompt && (
                                                    <div>
                                                        <span className="text-xs font-bold text-red-400 block mb-1">+ 负向提示词：</span>
                                                        <p className="text-xs text-gray-400 font-mono bg-black/20 p-2 rounded border border-white/5 leading-relaxed">
                                                            {styleNegativePrompt}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    )}
                </div>
            </motion.div>
        </div>
    );
}

function WorkbenchPanel({
    title,
    asset,
    currentImageUrl,
    onSelect,
    onDelete,
    onFavorite,

    prompt,
    setPrompt,
    onGenerate,
    isGenerating,
    generatingBatchSize,
    status,
    isLocked,
    description,
    aspectRatio = "9:16",
    // Video specific
    isVideo = false,
    videos,
    onDeleteVideo,
    onGenerateVideo,

    // Motion Ref Mode (Asset Activation v2)
    supportsMotion = false,
    mode = 'static',  // 'static' | 'motion'
    onModeChange,
    hasStaticImage = false,
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
    panelHint,
    // Reverse Generation Props
    reverseGenerationMode = false,
    reverseReferenceUrl = null
}: any) {
    const variantsCount = asset?.variants?.length || 0;
    const hasResult = !!currentImageUrl || variantsCount > 0;
    const selectedVariant = asset?.variants?.find((variant: any) => variant.id === asset?.selected_id);
    const modeLabel = supportsMotion ? (mode === "motion" ? "动态制作中" : "静态制作中") : "静态制作";

    return (
        <div className="h-full overflow-y-auto">
            <div className="grid h-full min-w-0 grid-cols-1 gap-6 p-6 xl:grid-cols-[minmax(0,1.35fr)_360px]">
                <div className="min-h-0 rounded-3xl border border-white/10 bg-black/20 overflow-hidden">
                    <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                        <div>
                            <h3 className="text-sm font-semibold uppercase tracking-[0.22em] text-gray-300">{title}</h3>
                            <p className="mt-1 text-sm text-gray-500">{description}</p>
                        </div>

                        {/* 静态/动态模式切换只保留在支持的视频板块，避免在所有面板重复占空间。 */}
                        {supportsMotion && (
                            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/10">
                                <button
                                    onClick={() => onModeChange?.('static')}
                                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${mode === 'static'
                                        ? 'bg-primary/20 text-primary'
                                        : 'text-gray-400 hover:text-white'
                                        }`}
                                >
                                    <PhotoIcon size={12} />
                                    静态
                                </button>
                                <button
                                    onClick={() => {
                                        if (!hasStaticImage) {
                                            alert('请先生成静态图片。');
                                            return;
                                        }
                                        onModeChange?.('motion');
                                    }}
                                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${mode === 'motion'
                                        ? 'bg-purple-500/20 text-purple-400'
                                        : 'text-gray-400 hover:text-white'
                                        }`}
                                >
                                    <Video size={12} />
                                    动态
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="relative h-[calc(100%-73px)] min-h-[520px] bg-black/30 p-5">
                        {isLocked && (
                            <div className="absolute inset-0 bg-black/80 z-20 flex items-center justify-center text-center p-6">
                                <div className="text-gray-500 flex flex-col items-center gap-2">
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
                                            className="h-14 w-14 rounded-xl object-cover border border-white/20"
                                        />
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="h-full overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-gray-700">
                            {mode === 'motion' && supportsMotion ? (
                                <div className="flex flex-col gap-4 p-4">
                                    <div className="flex items-center gap-2 pb-2 border-b border-purple-500/20">
                                        <div className="w-1 h-4 bg-gradient-to-b from-purple-400 to-pink-500 rounded-full"></div>
                                        <span className="text-xs font-bold text-purple-300 tracking-wider">动态参考</span>
                                    </div>

                                    <div className={`relative w-full ${aspectRatio === '9:16' ? 'aspect-[9/16] max-h-[40vh]' : aspectRatio === '1:1' ? 'aspect-square max-h-[35vh]' : 'aspect-video'} bg-gradient-to-br from-gray-900/80 to-black rounded-xl overflow-hidden border border-white/5 shadow-xl backdrop-blur-sm`}>
                                        {isGeneratingMotion ? (
                                            <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-md flex flex-col items-center justify-center gap-4">
                                                <div className="relative">
                                                    <RefreshCw size={48} className="text-purple-400 animate-spin" />
                                                    <div className="absolute inset-0 blur-xl bg-purple-500/30 animate-pulse"></div>
                                                </div>
                                                <div className="flex flex-col items-center">
                                                    <span className="text-sm font-bold text-white tracking-widest animate-pulse">正在生成视频</span>
                                                    <span className="text-[10px] text-purple-300/60 mt-1">AI 正在处理动态内容...</span>
                                                </div>
                                            </div>
                                        ) : isVideoLoading && motionRefVideos?.length > 0 ? (
                                            <div className="absolute inset-0 z-10 bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
                                                <RefreshCw size={32} className="text-gray-400 animate-spin" />
                                                <span className="text-xs text-gray-400 font-medium">正在加载视频文件...</span>
                                            </div>
                                        ) : null}

                                        {motionRefVideos?.length > 0 ? (
                                            <video
                                                key={motionRefVideos[motionRefVideos.length - 1]?.url}
                                                src={getAssetUrl(motionRefVideos[motionRefVideos.length - 1]?.url)}
                                                onCanPlay={() => setIsVideoLoading(false)}
                                                onLoadStart={() => setIsVideoLoading(true)}
                                                className="w-full h-full object-contain"
                                                controls
                                                loop
                                                autoPlay
                                                muted
                                            />
                                        ) : !isGeneratingMotion && (
                                            <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 gap-2">
                                                <Video size={40} className="opacity-50" />
                                                <span className="text-sm">暂无动态参考</span>
                                                <span className="text-xs opacity-70">可在下方生成</span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="bg-black/20 rounded-lg border border-white/10 p-3">
                                        <label className="text-xs font-bold text-gray-500 mb-2 block">音频输入（可选）</label>
                                        <p className="text-xs text-gray-600 mb-3">上传音频后可驱动口型和动作节奏</p>

                                        <label className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed cursor-pointer transition-all ${audioUrl
                                            ? 'border-green-500/50 bg-green-500/10 text-green-400'
                                            : 'border-indigo-500/30 hover:border-indigo-400/50 hover:bg-indigo-500/5 text-gray-400'
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
                                                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary/30 border-t-primary"></div>
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
                                                    <span className="text-xs">上传音频文件</span>
                                                </>
                                            )}
                                        </label>
                                    </div>

                                    <div className="flex flex-col gap-2">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-bold text-gray-500">动态提示词</label>
                                            <button
                                                onClick={() => onResetPrompt?.()}
                                                className="text-[10px] text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
                                                title="恢复推荐提示词"
                                            >
                                                <RefreshCw size={10} />
                                                重置
                                            </button>
                                        </div>
                                        <textarea
                                            value={motionPrompt}
                                            onChange={(e) => setMotionPrompt?.(e.target.value)}
                                            className="w-full h-24 bg-black/40 border border-white/10 rounded-lg p-3 text-xs text-gray-300 resize-none focus:outline-none focus:border-primary/50 font-mono leading-relaxed"
                                            placeholder="请输入你想要的动态描述..."
                                        />
                                    </div>

                                    <button
                                        onClick={() => onGenerateMotionRef?.(motionPrompt, audioUrl)}
                                        disabled={isGeneratingMotion}
                                        className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${isGeneratingMotion
                                            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                            : 'bg-primary hover:bg-primary/90 text-white shadow-lg'
                                            }`}
                                    >
                                        <Video size={16} />
                                        生成动态参考
                                    </button>
                                </div>
                            ) : isVideo ? (
                                <VideoVariantSelector
                                    videos={videos}
                                    onDelete={onDeleteVideo}
                                    onGenerate={onGenerateVideo}
                                    isGenerating={isGenerating}
                                    aspectRatio={aspectRatio}
                                    className="h-full"
                                />
                            ) : (
                                <VariantSelector
                                    asset={asset}
                                    currentImageUrl={currentImageUrl}
                                    onSelect={onSelect}
                                    onDelete={onDelete}
                                    onFavorite={onFavorite}
                                    onGenerate={onGenerate}
                                    isGenerating={isGenerating}
                                    generatingBatchSize={generatingBatchSize}
                                    aspectRatio={aspectRatio}
                                    className="h-full"
                                />
                            )}
                        </div>

                        {status === "outdated" && !isGenerating && (
                            <div className="absolute top-5 right-5 z-10">
                                <div className="bg-yellow-500/20 border border-yellow-500/50 px-3 py-1 rounded-lg flex items-center gap-2 backdrop-blur-sm">
                                    <RefreshCw size={12} className="text-yellow-500" />
                                    <span className="text-xs font-bold text-yellow-500">建议更新</span>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                <aside className="min-h-0 rounded-3xl border border-white/10 bg-black/20 overflow-hidden">
                    <div className="border-b border-white/10 px-5 py-4">
                        <div className="text-[11px] uppercase tracking-[0.22em] text-gray-500">编辑区</div>
                        <div className="mt-1 text-base font-semibold text-white">提示词与操作建议</div>
                    </div>

                    <div className="h-[calc(100%-73px)] overflow-y-auto p-5 space-y-5">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-gray-300">当前状态</span>
                                {isGenerating ? (
                                    <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 text-[11px] text-sky-300">生成中</span>
                                ) : hasResult ? (
                                    <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[11px] text-emerald-300">已有结果</span>
                                ) : (
                                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-gray-400">等待生成</span>
                                )}
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                    <div className="text-gray-500">候选数量</div>
                                    <div className="mt-1 text-lg font-semibold text-white">{variantsCount}</div>
                                </div>
                                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                    <div className="text-gray-500">已选版本</div>
                                    <div className="mt-1 text-lg font-semibold text-white">{selectedVariant ? "已选择" : "未选择"}</div>
                                </div>
                            </div>
                            <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-gray-400">
                                当前模式：<span className="text-gray-200">{modeLabel}</span>
                            </div>
                        </div>

                        {panelHint && (
                            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-transparent p-4">
                                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                                    <Sparkles size={15} className="text-primary" />
                                    操作建议
                                </div>
                                <p className="mt-2 text-xs leading-6 text-gray-400">{panelHint}</p>
                            </div>
                        )}

                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                            <div className="mb-3 text-xs font-semibold text-gray-300">本板块重点</div>
                            <div className="space-y-2 text-[11px] text-gray-400">
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                                    先用批量生成快速筛图，再收藏或选中最稳定的一版。
                                </div>
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                                    提示词里优先写清人物固定特征，动作和镜头语言放后面。
                                </div>
                                <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                                    如果结果已经接近，优先小修提示词，不建议每次大改整段描述。
                                </div>
                            </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                            <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-semibold text-gray-300">提示词</span>
                                <span className="text-[11px] text-gray-500">{prompt?.length || 0} 字符</span>
                            </div>
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                disabled={isLocked}
                                className="h-[280px] w-full rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-gray-300 resize-none focus:outline-none focus:border-primary/50 font-mono leading-relaxed"
                                placeholder="请输入提示词描述..."
                            />
                            <p className="mt-2 text-[11px] leading-5 text-gray-500">
                                这里保留完整提示词编辑区，图片预览和候选操作放在左侧，避免来回跳读。
                            </p>
                        </div>

                        <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 p-4">
                            <div className="text-xs font-semibold text-gray-300">快速检查</div>
                            <div className="mt-3 space-y-2 text-[11px] text-gray-500">
                                <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2">
                                    <span>角色固定特征是否明确</span>
                                    <span className="text-gray-300">建议确认</span>
                                </div>
                                <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2">
                                    <span>背景是否足够干净</span>
                                    <span className="text-gray-300">建议确认</span>
                                </div>
                                <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2">
                                    <span>是否与其他板块风格一致</span>
                                    <span className="text-gray-300">建议确认</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
}
