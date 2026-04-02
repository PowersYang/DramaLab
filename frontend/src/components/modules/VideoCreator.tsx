"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Upload, X, Wand2, Plus, Loader2, Layout,
    Video,
    Eraser,
    Check,
    Image as ImageIcon,
    Film
} from "lucide-react";
import BillingActionButton from "@/components/billing/BillingActionButton";
import { useBillingGuard } from "@/hooks/useBillingGuard";





import { useProjectStore } from "@/store/projectStore";
import { api, TaskReceipt, VideoTask } from "@/lib/api";
import { useTaskStore } from "@/store/taskStore";
import { getAssetUrl, getAssetUrlWithTimestamp } from "@/lib/utils";
import PromptBuilder, { PromptSegment, PromptBuilderRef } from "./PromptBuilder";
import type { VideoParams } from "@/store/projectStore";

interface VideoCreatorProps {
    onTaskCreated: (project: any) => void;
    onJobCreated: (receipts: TaskReceipt[]) => void;
    remixData: Partial<VideoTask> | null;
    onRemixClear: () => void;
    params: VideoParams;
    onParamsChange: (params: Partial<VideoParams>) => void;
}

export default function VideoCreator({ onTaskCreated, onJobCreated, remixData, onRemixClear, params, onParamsChange }: VideoCreatorProps) {
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const enqueueReceipts = useTaskStore((state) => state.enqueueReceipts);
    const waitForJob = useTaskStore((state) => state.waitForJob);
    const { account, getTaskPrice, canAffordTask } = useBillingGuard();

    const sortedFrames = useMemo(() => {
        if (!currentProject?.frames) {
            return [];
        }

        // Motion 页和 Storyboard 页保持同一排序基准：按 storyboard_frames.frame_order 展示。
        return [...currentProject.frames].sort((a: any, b: any) => {
            const orderA = typeof a?.frame_order === "number" ? a.frame_order : Number.MAX_SAFE_INTEGER;
            const orderB = typeof b?.frame_order === "number" ? b.frame_order : Number.MAX_SAFE_INTEGER;
            if (orderA !== orderB) {
                return orderA - orderB;
            }
            return String(a?.id || "").localeCompare(String(b?.id || ""));
        });
    }, [currentProject?.frames]);

    // Helper function to generate motion description text
    const getMotionDescription = () => {
        const parts: string[] = [];

        if (params.cameraMovement && params.cameraMovement !== 'none') {
            const cameraDescriptions: Record<string, string> = {
                'pan_left_slow': 'camera slowly pans to the left',
                'pan_right_slow': 'camera slowly pans to the right',
                'pan_left_fast': 'camera quickly pans to the left',
                'pan_right_fast': 'camera quickly pans to the right',
                'tilt_up': 'camera tilts up',
                'tilt_down': 'camera tilts down',
                'zoom_in_slow': 'camera slowly zooms in',
                'zoom_out_slow': 'camera slowly zooms out',
                'zoom_in_fast': 'camera dramatically zooms in',
                'zoom_out_fast': 'camera dramatically zooms out',
                'dolly_in': 'camera dolly in',
                'dolly_out': 'camera dolly out',
                'orbit_left': 'camera orbits to the left',
                'orbit_right': 'camera orbits to the right',
                'crane_up': 'camera cranes up',
                'crane_down': 'camera cranes down'
            };
            parts.push(cameraDescriptions[params.cameraMovement] || '');
        }

        if (params.subjectMotion && params.subjectMotion !== 'still') {
            const subjectDescriptions: Record<string, string> = {
                'subtle': 'subtle movement',
                'natural': 'natural movement',
                'dynamic': 'dynamic action',
                'fast': 'fast-paced action'
            };
            parts.push(subjectDescriptions[params.subjectMotion] || '');
        }

        return parts.filter(p => p).join(', ');
    };

    const [selectedImages, setSelectedImages] = useState<string[]>([]);
    const [uploadingPaths, setUploadingPaths] = useState<Record<string, string>>({}); // Map blobUrl -> serverUrl
    const [activeTab, setActiveTab] = useState<"storyboard" | "upload">("storyboard");

    // R2V Cast Slots: 3 slots for reference videos
    const [castSlots, setCastSlots] = useState<{ url: string; name: string }[]>([]);
    const [selectedFrameId, setSelectedFrameId] = useState<string | null>(null); // Selected frame for R2V
    const [generationMode, setGenerationMode] = useState<"i2v" | "r2v">("i2v"); // Local mode state
    const [extractingFrameId, setExtractingFrameId] = useState<string | null>(null);
    const submitTaskType = generationMode === "r2v" ? "video.generate.frame" : (selectedFrameId ? "video.generate.frame" : "video.generate.asset");
    const videoPrice = getTaskPrice(submitTaskType);
    // 视频生成接口一次提交可能拆成多条 job，这里按“选中素材数 x batchSize”估算总消耗，尽量和后端实际扣费口径对齐。
    const estimatedTaskCount = useMemo(() => {
        if (generationMode === "r2v") {
            return Math.max(selectedImages.length, 1) * Math.max(params.batchSize || 1, 1);
        }
        if (selectedImages.length === 0) {
            return 0;
        }
        return selectedImages.length * Math.max(params.batchSize || 1, 1);
    }, [generationMode, params.batchSize, selectedImages.length]);
    const estimatedVideoCost = videoPrice == null
        ? null
        : estimatedTaskCount > 0
            ? videoPrice * estimatedTaskCount
            : videoPrice;
    const videoAffordable = estimatedVideoCost == null ? canAffordTask(submitTaskType) : (account?.balance_credits ?? 0) >= estimatedVideoCost;

    // Sync from parent params
    useEffect(() => {
        if (params.generationMode) {
            setGenerationMode(params.generationMode as "i2v" | "r2v");
        }
    }, [params.generationMode]);

    const handleExtractLastFrame = async (frameId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (sortedFrames.length === 0) return;

        const frameIndex = sortedFrames.findIndex((f: any) => f.id === frameId);
        if (frameIndex <= 0) return;

        const prevFrame = sortedFrames[frameIndex - 1];
        if (!prevFrame.selected_video_id) return;

        const prevVideo = currentProject?.video_tasks?.find(
            (t: any) => t.id === prevFrame.selected_video_id && t.status === "completed"
        );
        if (!prevVideo) return;

        setExtractingFrameId(frameId);
        try {
            const updatedProject = await api.extractLastFrame(currentProject!.id, frameId, prevVideo.id);
            updateProject(currentProject!.id, updatedProject);
        } catch (error: any) {
            console.error("Failed to extract last frame:", error);
            alert(error?.response?.data?.detail || "Failed to extract last frame");
        } finally {
            setExtractingFrameId(null);
        }
    };

    const handleFrameSelect = (frame: any) => {
        // Prefer rendered_image_url (from extracted last frame / uploaded image), fallback to image_url
        const url = frame.rendered_image_url || frame.image_url;
        if (!url) return;

        // If already selected, deselect
        if (selectedImages.includes(url)) {
            setSelectedImages([]);
            return;
        }

        // Select new image (replace existing)
        setSelectedImages([url]);

        // Auto-fill prompt (Replace existing prompt)
        let newPrompt = frame.image_prompt || frame.action_description || "";
        if (frame.dialogue) {
            newPrompt += ` . Dialogue: ${frame.dialogue}`;
        }
        setSegments([{ type: "text", value: newPrompt, id: "init" }]);
    };
    const [segments, setSegments] = useState<PromptSegment[]>([{ type: "text", value: "", id: "init" }]);
    const promptBuilderRef = useRef<PromptBuilderRef>(null);

    // Computed prompt for API
    const prompt = segments.map(s => s.value).join(" ");

    // negativePrompt moved to params
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitSuccess, setSubmitSuccess] = useState(false);
    const [polishedPrompt, setPolishedPrompt] = useState<{ cn: string; en: string } | null>(null);
    const [isPolishing, setIsPolishing] = useState(false);
    const [feedbackText, setFeedbackText] = useState("");

    const handlePolish = async (feedback: string = "") => {
        const draftPrompt = feedback ? (polishedPrompt?.en || prompt) : prompt;
        if (!draftPrompt) return;
        setIsPolishing(true);
        try {
            let receipt;
            const scriptId = currentProject?.id || "";
            if (generationMode === 'r2v') {
                // R2V mode: use R2V-specific polish with slot info
                const slotInfo = castSlots
                    .filter(slot => slot.url)
                    .map((slot) => ({
                        description: slot.name || 'Unknown character'
                    }));
                receipt = await api.polishR2VPrompt(draftPrompt, slotInfo, feedback, scriptId);
            } else {
                // I2V mode: use video polish
                receipt = await api.polishVideoPrompt(draftPrompt, feedback, scriptId);
            }
            if (currentProject) {
                // Prompt 润色提交成功后立即入队，避免右侧 Queue 只能靠后续轮询补录。
                enqueueReceipts(currentProject.id, [receipt]);
            }
            const job = await waitForJob(receipt.job_id);
            if (job.status !== "succeeded") {
                throw new Error(job.error_message || "AI 润色失败");
            }
            const res = job.result_json || {};
            if (res.prompt_cn && res.prompt_en) {
                setPolishedPrompt({ cn: res.prompt_cn, en: res.prompt_en });
                setFeedbackText("");
            }
        } catch (error) {
            console.error("Polish failed", error);
            alert("AI 润色失败");
        } finally {
            setIsPolishing(false);
        }
    };


    // Handle Remix Data
    useEffect(() => {
        if (remixData) {
            if (remixData.image_url) setSelectedImages([remixData.image_url]);
            if (remixData.prompt) setSegments([{ type: "text", value: remixData.prompt, id: "remix" }]);
            // negativePrompt handled by parent

            // Clear remix data after applying to avoid re-applying on every render
            onRemixClear();
        }
    }, [remixData, onRemixClear]);

    const handleImageSelect = (files: FileList | null) => {
        if (!files) return;

        const newImages: string[] = [];

        Array.from(files).forEach(async (file) => {
            const blobUrl = URL.createObjectURL(file);
            newImages.push(blobUrl);

            // Background Upload
            try {
                const res = await api.uploadFile(file);
                setUploadingPaths(prev => ({ ...prev, [blobUrl]: res.url }));
            } catch (error) {
                console.error("Upload failed", error);
                // Could remove from selectedImages or show error state on the specific image
            }
        });

        setSelectedImages(prev => [...prev, ...newImages]);
    };

    const handleAssetSelect = (url: string) => {
        if (!selectedImages.includes(url)) {
            setSelectedImages(prev => [...prev, url]);
        }
    };

    const removeImage = (index: number) => {
        setSelectedImages(prev => prev.filter((_, i) => i !== index));
    };

    // R2V: Handle Cast Slot Selection
    const handleCastSlotSelect = (slotIndex: number, video: { url: string; name: string }) => {
        setCastSlots(prev => {
            const newSlots = [...prev];
            // Ensure array is long enough
            while (newSlots.length <= slotIndex) {
                newSlots.push({ url: '', name: '' });
            }
            newSlots[slotIndex] = video;
            return newSlots;
        });
    };

    // R2V: Clear Cast Slot
    const handleClearCastSlot = (slotIndex: number) => {
        setCastSlots(prev => {
            const newSlots = [...prev];
            if (newSlots[slotIndex]) {
                newSlots[slotIndex] = { url: '', name: '' };
            }
            return newSlots;
        });
    };

    // R2V: Handle Frame Selection (for description)
    const handleR2VFrameSelect = (frame: any) => {
        setSelectedFrameId(frame.id);
        // Auto-fill prompt with frame description
        let newPrompt = frame.action_description || frame.image_prompt || "";
        if (frame.dialogue) {
            newPrompt += ` Dialogue: ${frame.dialogue}`;
        }
        setSegments([{ type: "text", value: newPrompt, id: `frame-${frame.id}` }]);
    };

    // Insert character into prompt at cursor position
    const insertCharacter = (slotIndex: number) => {
        const slot = castSlots[slotIndex];
        if (!slot?.url) return;

        // Find video to get thumbnail
        const video = availableReferenceVideos.find(v => v.url === slot.url);
        const thumbnail = video?.thumbnail ? getAssetUrl(video.thumbnail) : undefined;

        promptBuilderRef.current?.insertCharacter(slotIndex, slot.name, thumbnail);
    };

    const refreshProjectSnapshot = async (projectId: string) => {
        // 入队成功后的全量项目刷新改为后台执行，避免按钮一直被慢接口占住。
        const updatedProject = await api.getProject(projectId);
        onTaskCreated(updatedProject);
    };

    const handleSubmit = async () => {
        // Validation based on mode
        if (generationMode === 'i2v') {
            if (selectedImages.length === 0 || !prompt || !currentProject) return;
        } else {
            // R2V mode: need at least one cast slot filled
            const filledSlots = castSlots.filter(s => s.url);
            if (filledSlots.length === 0) {
                alert("R2V 模式请至少填充一个角色槽位 (@Ref_A)");
                return;
            }
            if (!prompt || !currentProject) return;
        }
        if (!videoAffordable) {
            alert("当前组织算力豆余额不足，无法提交视频生成任务。");
            return;
        }

        setIsSubmitting(true);
        try {
            // Add motion description to prompt
            const motionDesc = getMotionDescription();
            const finalPrompt = motionDesc ? `${prompt}, ${motionDesc}` : prompt;

            // Determine items to process
            // In I2V: process selected images
            // In R2V: process selected images OR a single task if no image selected
            let itemsToProcess = selectedImages;
            if (generationMode === 'r2v' && selectedImages.length === 0) {
                itemsToProcess = [""]; // Dummy item to trigger one iteration
            }
            // Batch submit for all images
            for (const img of itemsToProcess) {
                let finalImageUrl = img;
                if (img && img.startsWith("blob:")) {
                    if (uploadingPaths[img]) {
                        finalImageUrl = uploadingPaths[img];
                    } else {
                        console.warn("Image upload pending for", img);
                        continue;
                    }
                }

                // Find frame ID - use selectedFrameId directly for R2V mode
                let frameId: string | undefined;
                if (generationMode === 'r2v') {
                    // R2V mode: use the explicitly selected frame
                    frameId = selectedFrameId || undefined;
                } else {
                    // I2V mode: find frame by matching image URL (check rendered_image_url first, then image_url)
                    const frame = currentProject?.frames?.find((f: any) =>
                        (f.rendered_image_url || f.image_url) === img ||
                        f.image_url === img
                    );
                    frameId = frame ? frame.id : undefined;
                }

                // Determine model based on generation mode
                // R2V mode uses wan2.6-r2v, I2V uses selected model
                const actualModel = generationMode === 'r2v' ? 'wan2.6-r2v' : params.model;

                // Get reference video URLs from cast slots for R2V
                const referenceVideos = generationMode === 'r2v'
                    ? castSlots.filter(s => s.url).map(s => s.url)
                    : [];

                const receipts = await api.createVideoTask(
                    currentProject.id,
                    finalImageUrl, // Can be empty string
                    finalPrompt,
                    params.duration,
                    params.seed,
                    params.resolution,
                    params.generateAudio,
                    params.audioUrl,
                    params.promptExtend,
                    params.negativePrompt,
                    params.batchSize,
                    actualModel,  // Use computed model
                    frameId,
                    params.shotType,
                    generationMode,  // Use local state
                    referenceVideos,  // Use cast slots
                    // Kling params
                    params.mode,
                    params.sound,
                    params.cfgScale,
                    // Vidu params
                    params.viduAudio,
                    params.movementAmplitude
                );
                // 多图顺序提交时，每一批任务都应立刻入队，避免用户等整批接口都返回后才看到第一条任务。
                onJobCreated(receipts);
            }

            // Success feedback
            setSubmitSuccess(true);
            setTimeout(() => setSubmitSuccess(false), 1500);

            // 任务已经成功入队，此时就应该结束按钮的提交态；
            // 项目详情刷新放到后台，避免让用户误以为仍在同步生成。
            void refreshProjectSnapshot(currentProject.id).catch((refreshError) => {
                console.error("Failed to refresh project after queueing video task:", refreshError);
            });

            // Clear selection after successful submit
            // setSelectedImages([]); // Keep selection for iterative generation
        } catch (error) {
            console.error("Failed to submit task:", error);
            alert("提交失败");
            // Refresh to remove optimistic updates
            void refreshProjectSnapshot(currentProject.id).catch((refreshError) => {
                console.error("Failed to refresh project after submit error:", refreshError);
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    // Keyboard shortcut
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === "Enter") {
                handleSubmit();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedImages, prompt, currentProject, params]);

    // Available assets for drag/drop or selection
    const availableAssets = currentProject ? [
        ...currentProject.characters.map((c: any) => ({
            url: getAssetUrl(c.image_url),
            title: c.name
        })),
        ...currentProject.scenes.map((s: any) => ({
            url: getAssetUrl(s.image_url),
            title: s.name
        }))
    ].filter(a => a.url) : [];

    // Available Reference Videos (for R2V)
    const availableReferenceVideos = currentProject ? [
        // Character asset video variants (full_body and headshot)
        ...currentProject.characters.flatMap((c: any) => {
            const variants = [];
            // Full body video variants
            if (c.full_body?.video_variants?.length) {
                variants.push(...c.full_body.video_variants.map((v: any) => ({
                    url: v.url,
                    thumbnail: c.full_body?.selected_image_id
                        ? (c.full_body.image_variants?.find((img: any) => img.id === c.full_body.selected_image_id)?.url || c.full_body_image_url)
                        : c.full_body_image_url,
                    title: `${c.name} - Full Body Motion Reference`,
                    assetName: c.name,
                    type: 'character_full_body'
                })));
            }
            // Headshot video variants
            if (c.head_shot?.video_variants?.length) {
                variants.push(...c.head_shot.video_variants.map((v: any) => ({
                    url: v.url,
                    thumbnail: c.head_shot?.selected_image_id
                        ? (c.head_shot.image_variants?.find((img: any) => img.id === c.head_shot.selected_image_id)?.url || c.headshot_image_url)
                        : c.headshot_image_url,
                    title: `${c.name} - Headshot Motion Reference`,
                    assetName: c.name,
                    type: 'character_headshot'
                })));
            }
            return variants;
        }),
        // Character legacy video assets
        ...currentProject.characters.flatMap((c: any) =>
            (c.video_assets || []).map((v: any) => ({
                url: v.video_url,
                thumbnail: v.image_url,
                title: `${c.name} - Video`,
                assetName: c.name,
                type: 'character_legacy'
            }))
        ),
        // Scene video assets
        ...currentProject.scenes.flatMap((s: any) =>
            (s.video_assets || []).map((v: any) => ({
                url: v.video_url,
                thumbnail: v.image_url,
                title: `${s.name} - Video`,
                assetName: s.name,
                type: 'scene'
            }))
        ),
        // Prop video assets
        ...currentProject.props.flatMap((p: any) =>
            (p.video_assets || []).map((v: any) => ({
                url: v.video_url,
                thumbnail: v.image_url,
                title: `${p.name} - Video`,
                assetName: p.name,
                type: 'prop'
            }))
        )
    ].filter(v => v.url && v.url !== 'null' && v.url !== 'undefined') : [];

    return (
        <div className="h-full flex flex-col relative min-h-0">
            {/* Scrollable Content Area */}
            <div className="video-scroll-frame flex-1 overflow-y-auto p-6 custom-scrollbar min-h-0 md:p-8">
                <div className="video-header-block mb-6 rounded-[1.75rem] px-5 py-5 md:px-6">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="video-header-kicker">AI Video Workspace</span>
                        <span className="video-status-badge rounded-full px-2.5 py-1 text-[10px] font-semibold">Motion</span>
                    </div>
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <h2 className="flex items-center gap-3 text-[30px] font-display font-bold leading-none text-white">
                                <div className="w-2 h-8 bg-primary rounded-full" />
                                动态演绎
                            </h2>
                            <p className="video-muted-note mt-3 max-w-2xl text-sm leading-6">
                                保持现有制作路径不变，聚焦于首帧驱动、角色驱动、提示词润色与任务提交的高密度编辑体验。
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full pb-8">
                    {/* Generation Mode Switcher */}
                    <div className="flex items-center justify-center">
                        <div className="video-segmented flex gap-1 rounded-2xl p-1.5">
                            <button
                                onClick={() => {
                                    setGenerationMode("i2v");
                                    onParamsChange({ generationMode: "i2v" });
                                }}
                                className={`video-segmented-button px-5 py-2.5 text-sm rounded-xl flex items-center gap-2 transition-all font-medium ${generationMode === "i2v"
                                    ? "video-segmented-button-active"
                                    : ""
                                    }`}
                            >
                                <ImageIcon size={16} />
                                首帧驱动 (I2V)
                            </button>
                            <button
                                onClick={() => {
                                    setGenerationMode("r2v");
                                    onParamsChange({
                                        generationMode: "r2v",
                                        model: "wan2.6-i2v" // Force Wan 2.6 when switching to R2V
                                    });
                                }}
                                className={`video-segmented-button px-5 py-2.5 text-sm rounded-xl flex items-center gap-2 transition-all font-medium ${generationMode === "r2v"
                                    ? "video-segmented-button-active"
                                    : ""
                                    }`}
                            >
                                <Film size={16} />
                                角色驱动 (R2V)
                            </button>
                        </div>
                    </div>
                    {/* === I2V MODE: Source Selector === */}
                    {generationMode === 'i2v' && (
                        <div className="video-card rounded-[1.6rem] p-5 space-y-4">
                            <div className="flex items-center justify-between">
                                <label className="video-field-label text-sm">首帧图片 (First Frame)</label>
                                <div className="video-segmented flex rounded-xl p-1 gap-1">
                                    <button
                                        onClick={() => setActiveTab("storyboard")}
                                        className={`video-segmented-button px-3 py-1.5 text-xs rounded-lg flex items-center gap-2 transition-all ${activeTab === "storyboard"
                                            ? "video-segmented-button-active"
                                            : ""
                                            }`}
                                    >
                                        <Layout size={14} /> Storyboard
                                    </button>
                                    <button
                                        onClick={() => setActiveTab("upload")}
                                        className={`video-segmented-button px-3 py-1.5 text-xs rounded-lg flex items-center gap-2 transition-all ${activeTab === "upload"
                                            ? "video-segmented-button-active"
                                            : ""
                                            }`}
                                    >
                                        <Upload size={14} /> Upload
                                    </button>
                                </div>
                            </div>

                            {/* Tab Content */}
                            <div className="video-card-soft rounded-[1.25rem] p-4 min-h-[200px]">
                                {activeTab === "storyboard" ? (
                                    <div className="space-y-4">
                                        {sortedFrames.length > 0 ? (() => {
                                            const completedVideoIds = new Set(
                                                currentProject?.video_tasks
                                                    ?.filter((t: any) => t.status === "completed")
                                                    .map((t: any) => t.id) ?? []
                                            );
                                            return (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 max-h-[500px] overflow-y-auto custom-scrollbar pr-2 p-2">
                                                {sortedFrames.map((frame: any, index: number) => {
                                                    const prevFrame = index > 0 ? sortedFrames[index - 1] : null;
                                                    const prevVideoCompleted = prevFrame?.selected_video_id && completedVideoIds.has(prevFrame.selected_video_id);
                                                    const isExtracting = extractingFrameId === frame.id;
                                                    const hasExtracted = !!frame.rendered_image_url;

                                                    return (
                                                    <div
                                                        key={frame.id}
                                                        onClick={() => handleFrameSelect(frame)}
                                                        className={`group relative aspect-video overflow-hidden rounded-xl border cursor-pointer transition-all ${selectedImages.includes(frame.rendered_image_url || frame.image_url)
                                                            ? "video-card-selected border-primary"
                                                            : "video-card-soft hover:border-white/30"
                                                            }`}
                                                    >
                                                        {(frame.rendered_image_url || frame.image_url) ? (
                                                            <img
                                                                src={getAssetUrlWithTimestamp(frame.rendered_image_url || frame.image_url, frame.updated_at)}
                                                                alt={`Frame ${frame.id}`}
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : (
                                                            <div className="video-card-soft flex h-full w-full items-center justify-center text-xs text-gray-500">
                                                                No Image
                                                            </div>
                                                        )}
                                                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                                            <span className="text-xs text-white font-bold">Select</span>
                                                        </div>
                                                        {/* Frame Number Badge */}
                                                        <div className="video-status-badge absolute left-1 top-1 rounded px-1.5 py-0.5 text-[10px] backdrop-blur-sm">
                                                            #{typeof frame.frame_order === "number" ? frame.frame_order + 1 : index + 1}
                                                        </div>
                                                        {/* Extract Last Frame Button */}
                                                        {prevVideoCompleted && (
                                                            <button
                                                                onClick={(e) => handleExtractLastFrame(frame.id, e)}
                                                                disabled={isExtracting}
                                                                className={`absolute bottom-1 right-1 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium backdrop-blur-sm transition-colors ${
                                                                    hasExtracted
                                                                        ? "video-status-badge video-status-badge-success"
                                                                        : "video-status-badge video-status-badge-accent"
                                                                } disabled:opacity-50`}
                                                                title={hasExtracted ? "Re-extract previous video's last frame" : "Use previous video's last frame as input"}
                                                            >
                                                                {isExtracting ? (
                                                                    <Loader2 size={10} className="animate-spin" />
                                                                ) : hasExtracted ? (
                                                                    <><Check size={10} /> Applied</>
                                                                ) : (
                                                                    <><Film size={10} /> Prev End Frame</>
                                                                )}
                                                            </button>
                                                        )}
                                                    </div>
                                                    );
                                                })}
                                            </div>
                                            );
                                        })() : (
                                            <div className="flex flex-col items-center justify-center h-[200px] text-gray-500 gap-2">
                                                <Layout size={32} className="opacity-20" />
                                                <p className="text-xs">No storyboard frames found.</p>
                                            </div>
                                        )}

                                        {/* Selected Preview (Storyboard Mode) */}
                                        {selectedImages.length > 0 && (
                                            <div className="pt-4 border-t video-workspace-divider">
                                                <p className="video-helper-text mb-2">Selected for Generation:</p>
                                                <div className="flex gap-2 flex-wrap">
                                                    {selectedImages.map((img, idx) => {
                                                        // Find frame to get updated_at for cache busting
                                                        const frame = currentProject?.frames?.find((f: any) => (f.rendered_image_url || f.image_url) === img);
                                                        const timestamp = frame?.updated_at || 0;
                                                        return (
                                                            <div key={idx} className="video-card-soft relative w-24 aspect-video rounded-lg overflow-hidden">
                                                                <img
                                                                    src={timestamp ? getAssetUrlWithTimestamp(img, timestamp) : getAssetUrl(img)}
                                                                    alt="Selected"
                                                                    className="w-full h-full object-cover"
                                                                />
                                                                <button
                                                                    onClick={() => removeImage(idx)}
                                                                    className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-red-500"
                                                                >
                                                                    <X size={10} />
                                                                </button>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    /* Upload Mode Content */
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-3 gap-4">
                                            {selectedImages.map((img, idx) => (
                                                <div key={idx} className="video-card-soft group relative aspect-video overflow-hidden rounded-xl">
                                                    <img
                                                        src={getAssetUrl(img)}
                                                        alt={`Input ${idx}`}
                                                        className="w-full h-full object-contain"
                                                    />
                                                    <button
                                                        onClick={() => removeImage(idx)}
                                                        className="absolute top-2 right-2 p-1 bg-black/60 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                    {img.startsWith("blob:") && !uploadingPaths[img] && (
                                                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                                                            <Loader2 className="animate-spin text-white" size={20} />
                                                        </div>
                                                    )}
                                                </div>
                                            ))}

                                            {/* Add Button */}
                                            <div
                                                onClick={() => document.getElementById('image-upload')?.click()}
                                                className="video-card-soft relative aspect-video min-h-[100px] cursor-pointer border-2 border-dashed flex flex-col items-center justify-center rounded-xl transition-colors hover:bg-white/10"
                                            >
                                                <input
                                                    id="image-upload"
                                                    type="file"
                                                    accept="image/*"
                                                    multiple
                                                    className="hidden"
                                                    onChange={(e) => handleImageSelect(e.target.files)}
                                                />
                                                <Plus className="text-gray-400 mb-2" size={24} />
                                                <p className="text-gray-400 text-xs font-medium">Add Image</p>
                                            </div>
                                        </div>

                                        {/* Quick Select from Assets (Only in Upload Mode) */}
                                        {availableAssets.length > 0 && (
                                            <div className="mt-4 pt-4 border-t video-workspace-divider">
                                                <p className="video-helper-text mb-2">Quick Select from Assets:</p>
                                                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                                                    {availableAssets.slice(0, 10).map((asset, i) => (
                                                        <div
                                                            key={i}
                                                            onClick={() => handleAssetSelect(asset.url)}
                                                            className="video-card-soft relative h-16 w-16 flex-shrink-0 cursor-pointer overflow-hidden rounded-lg hover:border-primary"
                                                        >
                                                            <img src={asset.url} alt={asset.title} className="w-full h-full object-cover" />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* === R2V MODE: Cast Slots + Frame Description === */}
                    {generationMode === 'r2v' && (
                        <div className="video-card rounded-[1.6rem] p-5 space-y-6">
                            {/* Frame Description Cards */}
                            <div className="space-y-3">
                                <label className="video-field-label text-sm">选择分镜 (Select Frame)</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[200px] overflow-y-auto custom-scrollbar pr-2">
                                    {sortedFrames.length > 0 ? (
                                        sortedFrames.map((frame: any) => (
                                            <div
                                                key={frame.id}
                                                onClick={() => handleR2VFrameSelect(frame)}
                                                className={`rounded-xl border p-3 cursor-pointer transition-all ${selectedFrameId === frame.id
                                                    ? "video-card-selected border-primary bg-primary/10"
                                                    : "video-card-soft hover:border-white/30"
                                                    }`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    {/* Frame thumbnail */}
                                                    <div className="video-card-soft w-16 h-10 rounded overflow-hidden flex-shrink-0">
                                                        {frame.image_url ? (
                                                            <img
                                                                src={getAssetUrlWithTimestamp(frame.image_url, frame.updated_at)}
                                                                alt=""
                                                                className="w-full h-full object-cover"
                                                            />
                                                        ) : (
                                                            <div className="w-full h-full flex items-center justify-center text-gray-600">
                                                                <Layout size={14} />
                                                            </div>
                                                        )}
                                                    </div>
                                                    {/* Frame description */}
                                                    <div className="flex-1 min-w-0">
                                                        <p className="video-helper-text mb-1">#{frame.id.slice(0, 6)}</p>
                                                        <p className="text-xs text-gray-300 line-clamp-2">
                                                            {frame.action_description || frame.image_prompt || '暂无描述'}
                                                        </p>
                                                        {frame.dialogue && (
                                                            <p className="mt-1 line-clamp-1 text-[10px] italic text-primary">
                                                                “{frame.dialogue}”
                                                            </p>
                                                        )}
                                                    </div>
                                                    {/* Selected indicator */}
                                                    {selectedFrameId === frame.id && (
                                                        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-primary">
                                                            <Check size={12} className="text-white" />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="col-span-2 flex flex-col items-center justify-center h-[100px] text-gray-500 gap-2">
                                            <Layout size={24} className="opacity-20" />
                                            <p className="text-xs">无分镜数据，请先在 Storyboard 阶段生成分镜</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Cast Slots (卡司槽位) */}
                            <div className="space-y-3">
                                <label className="video-field-label text-sm">卡司槽位 (Cast Slots)</label>
                                <div className="grid grid-cols-3 gap-4">
                                    {[0, 1, 2].map((slotIndex) => {
                                        const slot = castSlots[slotIndex];
                                        const slotTitle = slotIndex === 0 ? '主角' : '配角';
                                        const video = slot?.url ? availableReferenceVideos.find(v => v.url === slot.url) : null;

                                        return (
                                            <div
                                                key={slotIndex}
                                                className={`relative rounded-xl border-2 border-dashed transition-all ${slot?.url
                                                    ? "video-card-selected border-primary bg-primary/10"
                                                    : "video-card-soft hover:border-white/40"
                                                    }`}
                                            >
                                                {/* Slot Header */}
                                                <div className="absolute top-2 left-2 z-10">
                                                    <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white">
                                                        角色{slotIndex + 1}
                                                    </span>
                                                </div>

                                                {slot?.url ? (
                                                    /* Filled Slot */
                                                    <div className="aspect-video relative">
                                                        <img
                                                            src={getAssetUrl(video?.thumbnail || '')}
                                                            alt={slot.name}
                                                            className="w-full h-full object-cover rounded-xl"
                                                        />
                                                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 rounded-b-xl">
                                                            <p className="text-xs text-white font-medium truncate">{slot.name}</p>
                                                        </div>
                                                        <button
                                                            onClick={() => handleClearCastSlot(slotIndex)}
                                                            className="absolute top-2 right-2 p-1 bg-black/60 rounded-full text-white hover:bg-red-500 transition-colors"
                                                        >
                                                            <X size={12} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    /* Empty Slot */
                                                    <div className="aspect-video flex flex-col items-center justify-center p-4">
                                                        <p className="text-xs text-gray-400 mb-2">{slotTitle}</p>
                                                        <select
                                                            className="video-select w-full rounded-lg px-2 py-1.5 text-xs text-gray-300"
                                                            value=""
                                                            onChange={(e) => {
                                                                const selectedVideo = availableReferenceVideos.find(v => v.url === e.target.value);
                                                                if (selectedVideo) {
                                                                    handleCastSlotSelect(slotIndex, { url: selectedVideo.url, name: selectedVideo.assetName });
                                                                }
                                                            }}
                                                        >
                                                            <option value="">选择参考视频...</option>
                                                            {availableReferenceVideos.map((v, i) => (
                                                                <option key={i} value={v.url}>{v.assetName} - {v.type}</option>
                                                            ))}
                                                        </select>
                                                        {slotIndex === 0 && (
                                                            <p className="mt-2 text-[10px] text-amber-400">必填</p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                {availableReferenceVideos.length === 0 && (
                                    <p className="video-status-badge video-status-badge-warning rounded-xl p-3 text-xs">
                                        无可用的参考视频。请先在 Assets 阶段为角色/场景生成 Motion Reference 视频。
                                    </p>
                                )}
                            </div>
                        </div>
                    )}


                    {/* 2. Prompt Input */}
                    <div className="video-card rounded-[1.6rem] p-5 space-y-3">
                        <div className="flex justify-between items-center">
                            <label className="video-field-label text-sm">提示词 (Prompt)</label>
                            <div className="flex items-center gap-2">
                                {generationMode === 'i2v' && (
                                    <div className="relative">
                                        <button
                                            onClick={() => promptBuilderRef.current?.insertCamera()}
                                            className="video-inline-button flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors"
                                        >
                                            <Video size={12} /> 运镜
                                        </button>
                                    </div>
                                )}
                                <button
                                    onClick={() => handlePolish()}
                                    disabled={isPolishing || !prompt}
                                    className="video-inline-button flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-primary disabled:opacity-50"
                                >
                                    {isPolishing ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
                                    AI 润色
                                </button>
                                <button
                                    onClick={() => setSegments([{ type: "text", value: "", id: "init" }])}
                                    className="video-inline-button flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors"
                                    title="Clear Prompt"
                                >
                                    <Eraser size={12} /> 清空
                                </button>
                            </div>
                        </div>

                        {/* Character Insert Shortcuts (R2V Mode Only) */}
                        {generationMode === 'r2v' && (
                            <div className="flex gap-2 flex-wrap">
                                {[0, 1, 2].map((idx) => {
                                    const slot = castSlots[idx];
                                    const isActive = slot?.url;
                                    const video = isActive ? availableReferenceVideos.find(v => v.url === slot.url) : null;
                                    return (
                                        <button
                                            key={idx}
                                            onClick={() => insertCharacter(idx)}
                                            disabled={!isActive}
                                            className={`video-chip-button flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-all ${isActive
                                                ? "video-chip-button-active"
                                                : "cursor-not-allowed text-gray-500"
                                                }`}
                                        >
                                            {video?.thumbnail ? (
                                                <img src={getAssetUrl(video.thumbnail)} alt="" className="w-4 h-4 rounded-full object-cover" />
                                            ) : (
                                                <span className="w-4 h-4 rounded-full bg-purple-500/30 flex items-center justify-center text-[10px]">+</span>
                                            )}
                                            <span>插入 {slot?.name || `角色${idx + 1}`}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}

                        <div className="relative">
                            <PromptBuilder
                                ref={promptBuilderRef}
                                segments={segments}
                                onChange={setSegments}
                                placeholder={generationMode === 'r2v'
                                    ? "输入提示词... \n插入角色格式: [character1:名称]\n插入运镜格式: (camera: 运镜指令)"
                                    : "输入提示词，描述画面内容...\n插入运镜格式: (camera: 运镜指令)"
                                }
                            />
                        </div>

                        {/* Polished Result Display - Bilingual */}
                        <AnimatePresence>
                            {polishedPrompt && (
                                <motion.div
                                    initial={{ opacity: 0, y: -10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -10 }}
                                    className="video-card-soft mt-2 space-y-3 rounded-xl p-4"
                                >
                                    <div className="flex justify-between items-start">
                                        <span className="flex items-center gap-1 text-xs font-bold text-primary">
                                            <Wand2 size={12} /> AI 双语润色
                                        </span>
                                        <button
                                            onClick={() => { setPolishedPrompt(null); setFeedbackText(""); }}
                                            className="video-inline-button rounded-md px-1 py-0.5 text-[10px]"
                                        >
                                            ✕
                                        </button>
                                    </div>

                                    {/* Chinese Prompt */}
                                    <div className="space-y-1">
                                        <div className="flex justify-between items-center">
                                            <span className="video-section-title text-[10px]">中文 (预览)</span>
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(polishedPrompt.cn);
                                                    alert("中文提示词已复制");
                                                }}
                                                className="video-inline-button rounded-md px-2 py-0.5 text-[10px]"
                                            >
                                                复制
                                            </button>
                                        </div>
                                        <p className="video-card-soft whitespace-pre-wrap rounded-lg p-3 text-xs leading-relaxed text-gray-300">
                                            {polishedPrompt.cn}
                                        </p>
                                    </div>

                                    {/* English Prompt */}
                                    <div className="space-y-1">
                                        <div className="flex justify-between items-center">
                                            <span className="video-section-title text-[10px]">English (生成用)</span>
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(polishedPrompt.en);
                                                        alert("English prompt copied");
                                                    }}
                                                    className="video-inline-button rounded-md px-2 py-0.5 text-[10px]"
                                                >
                                                    Copy
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setSegments([{ type: "text", value: polishedPrompt.en, id: `polished-${Date.now()}` }]);
                                                        setPolishedPrompt(null);
                                                    }}
                                                    className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-bold text-white transition-colors hover:bg-primary/90"
                                                >
                                                    应用
                                                </button>
                                            </div>
                                        </div>
                                        <p className="video-card-soft whitespace-pre-wrap rounded-lg p-3 text-xs font-mono leading-relaxed text-gray-300">
                                            {polishedPrompt.en}
                                        </p>
                                    </div>

                                    {/* Feedback for iterative refinement */}
                                    <div className="space-y-2 border-t border-white/10 pt-2">
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={feedbackText}
                                                onChange={(e) => setFeedbackText(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" && feedbackText.trim() && !isPolishing) {
                                                        handlePolish(feedbackText.trim());
                                                    }
                                                }}
                                                placeholder="哪里不满意？描述你的修改意见..."
                                                className="video-input flex-1 rounded-lg px-3 py-1.5 text-xs"
                                            />
                                            <button
                                                onClick={() => handlePolish(feedbackText.trim())}
                                                disabled={isPolishing || !feedbackText.trim()}
                                                className="flex items-center gap-1 whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {isPolishing ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
                                                再润色
                                            </button>
                                        </div>
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            {/* 4. Fixed Action Bar */}
            <div className="video-action-bar z-10 p-6">
                <div className="max-w-4xl mx-auto w-full">
                    <BillingActionButton
                        onClick={handleSubmit}
                        disabled={(!prompt || isSubmitting || !videoAffordable) || (generationMode === 'i2v' && selectedImages.length === 0)}
                        priceCredits={estimatedVideoCost}
                        balanceCredits={account?.balance_credits}
                        wrapperClassName="w-full"
                        className={`w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-all transform active:scale-[0.99] ${submitSuccess
                            ? "bg-green-500 text-white"
                            : "bg-primary hover:bg-primary/90 text-white"
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                        tooltipText={estimatedVideoCost == null ? undefined : `预计消耗${estimatedVideoCost}算力豆${!videoAffordable ? "，当前余额不足" : ""}`}
                    >
                        {isSubmitting ? (
                            <>
                                <Loader2 className="animate-spin" /> 提交中...
                            </>
                        ) : submitSuccess ? (
                            <>
                                <Plus /> 已加入队列
                            </>
                        ) : (
                            <>
                                <Plus /> 加入生成队列 (Ctrl+Enter)
                            </>
                        )}
                    </BillingActionButton>
                    <div className="flex justify-center mt-3">
                        <label className="video-muted-note flex cursor-pointer items-center gap-2 text-xs transition-colors hover:text-white">
                            <input type="checkbox" className="rounded border-white/20 bg-white" />
                            提交后清空内容
                        </label>
                    </div>
                </div>
            </div>
        </div>
    );
}
