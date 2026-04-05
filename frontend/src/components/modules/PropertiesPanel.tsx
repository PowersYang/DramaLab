"use client";

import { motion } from "framer-motion";
import { FileText, Layout, Video, Mic, Music, Film, Palette, Wand2, Sparkles } from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import { useTaskStore } from "@/store/taskStore";
import { useState, useEffect, useRef } from "react";
import { api } from "@/lib/api";
import { getAssetUrl } from "@/lib/utils";
import { getEffectiveProjectCharacters, getEffectiveProjectCharacterCount } from "@/lib/projectAssets";
import ProjectCharacterSourceHintBanner from "@/components/common/ProjectCharacterSourceHintBanner";
import { PANEL_HEADER_CLASS, PANEL_TITLE_CLASS } from "@/components/modules/panelHeaderStyles";

interface PropertiesPanelProps {
    activeStep: string;
    embedded?: boolean;
}

const AUDIO_SLIDER_CLASS = "w-full h-1.5 appearance-none bg-transparent cursor-pointer [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-slate-400/35 [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-slate-400/35 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:mt-[-3px] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary";

export default function PropertiesPanel({ activeStep, embedded = false }: PropertiesPanelProps) {
    const currentProject = useProjectStore((state) => state.currentProject);

    // Hide panel for Motion step as it has its own sidebar
    if (activeStep === "motion" || activeStep === "assembly") return null;

    const renderContent = () => {
        switch (activeStep) {
            case "script":
                return <ScriptInspector project={currentProject} />;
            case "assets":
                return <AssetsInspector />;
            case "storyboard":
                return <StoryboardInspector />;
            case "motion":
                return <MotionInspector />;
            case "audio":
                return <AudioInspector />;
            case "mix":
                return <MixInspector />;
            case "export":
                return <ExportInspector />;
            default:
                return <div className="p-4 text-gray-500">请选择左侧步骤查看对应属性。</div>;
        }
    };

    if (embedded) {
        return (
            <div className="h-full overflow-y-auto p-4 space-y-6">
                {renderContent()}
            </div>
        );
    }

    return (
        <motion.aside
            initial={{ x: 100, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="studio-inspector w-72 h-full flex flex-col z-50"
        >
            <div className={PANEL_HEADER_CLASS}>
                <h2 className={PANEL_TITLE_CLASS}>属性面板</h2>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {renderContent()}
            </div>
        </motion.aside>
    );
}

// --- Sub-Inspectors ---

function ScriptInspector({ project }: { project: any }) {
    if (!project) return null;
    const wordCount = project.originalText?.length || 0;
    const charCount = getEffectiveProjectCharacterCount(project);
    const sceneCount = project.scenes?.length || 0;

    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <FileText size={14} /> 项目统计
                </h3>
                <div className="grid grid-cols-2 gap-2">
                    <StatBox label="字数" value={wordCount} />
                    <StatBox label="角色" value={charCount} />
                    <StatBox label="场景" value={sceneCount} />
                    <StatBox label="预计时长" value="约2分钟" />
                </div>
            </div>

            <div className="pt-4 border-t border-white/10">
                {project?.series_id && (
                    <ProjectCharacterSourceHintBanner project={project} className="mb-4" />
                )}
                <ArtDirectionStyleDisplay project={project} />
            </div>
        </div>
    );
}

function AssetsInspector() {
    const currentProject = useProjectStore((state) => state.currentProject);

    return (
        <div className="space-y-6">
            <div>
                <ArtDirectionStyleDisplay project={currentProject} />
            </div>
        </div>
    );
}

function ArtDirectionStyleDisplay({ project }: { project: any }) {
    const updateProject = useProjectStore((state) => state.updateProject);
    const resolvedArtDirection = project?.art_direction_resolved || project?.art_direction;
    const artDirectionStyle = resolvedArtDirection?.style_config;
    const styleDescription = artDirectionStyle?.description?.trim();
    const [positivePromptInput, setPositivePromptInput] = useState("");
    const [negativePromptInput, setNegativePromptInput] = useState("");
    const [isOverriding, setIsOverriding] = useState(false);
    const [overrideError, setOverrideError] = useState<string | null>(null);
    const [overrideMessage, setOverrideMessage] = useState<string | null>(null);

    useEffect(() => {
        // 中文注释：项目切换或后端回包更新后，输入框总是回到“当前生效美术设定”的最新值，避免编辑旧快照。
        setPositivePromptInput(artDirectionStyle?.positive_prompt || "");
        setNegativePromptInput(artDirectionStyle?.negative_prompt || "");
        setOverrideError(null);
        setOverrideMessage(null);
    }, [project?.id, artDirectionStyle?.positive_prompt, artDirectionStyle?.negative_prompt]);

    const handleOverrideProjectArtDirection = async () => {
        if (!project?.id || !artDirectionStyle) return;

        const nextPositivePrompt = positivePromptInput.trim();
        const nextNegativePrompt = negativePromptInput.trim();
        if (!nextPositivePrompt) {
            setOverrideError("请先填写正向提示词，再执行项目覆写。");
            setOverrideMessage(null);
            return;
        }

        setIsOverriding(true);
        setOverrideError(null);
        setOverrideMessage(null);
        try {
            // 中文注释：这里显式走项目覆写接口，后端会把来源切到 project_override，不再继承剧集默认风格。
            const selectedStyleId =
                resolvedArtDirection?.selected_style_id ||
                artDirectionStyle.id ||
                `project-style-${project.id}`;
            const updated = await api.updateProjectArtDirectionOverride(project.id, selectedStyleId, {
                ...artDirectionStyle,
                id: artDirectionStyle.id || selectedStyleId,
                name: artDirectionStyle.name || "项目覆写风格",
                description: artDirectionStyle.description || "",
                positive_prompt: nextPositivePrompt,
                negative_prompt: nextNegativePrompt,
            });
            updateProject(project.id, updated);
            setOverrideMessage("已覆盖项目美术设定，当前项目将优先使用该提示词。");
        } catch (error) {
            setOverrideError(error instanceof Error ? error.message : "覆盖项目美术设定失败，请稍后重试。");
        } finally {
            setIsOverriding(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
                <Palette className="text-primary" size={16} />
                <h3 className="font-bold text-white text-sm">美术设定</h3>
            </div>

            {artDirectionStyle ? (
                <div className="space-y-3">
                    <div>
                        <label className="text-xs font-bold text-gray-400 uppercase mb-1.5 block">风格名称</label>
                        <div className="text-sm font-bold text-white bg-gradient-to-r from-blue-500/20 to-purple-500/20 p-2.5 rounded-lg border border-white/10">
                            {artDirectionStyle.name}
                        </div>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-gray-400 uppercase mb-1.5 block">风格描述</label>
                        <div className="bg-black/40 border border-white/5 rounded-lg p-2.5 text-xs text-gray-300 leading-relaxed min-h-20 max-h-[20vh] overflow-y-auto">
                            {styleDescription || "暂无风格描述"}
                        </div>
                    </div>

                    <div className="grid h-[clamp(16rem,42vh,30rem)] min-h-[16rem] grid-rows-2 gap-3">
                        {/* 中文注释：提示词编辑区按当前页面高度自适应，正负提示词各占一半可用高度。 */}
                        <div className="flex min-h-0 flex-col">
                            <label className="text-xs font-bold text-gray-400 uppercase mb-1.5 block">正向提示词</label>
                            <textarea
                                value={positivePromptInput}
                                onChange={(event) => setPositivePromptInput(event.target.value)}
                                placeholder="请输入项目级正向提示词"
                                className="min-h-0 flex-1 resize-none rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-gray-200 leading-relaxed outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                            />
                        </div>

                        <div className="flex min-h-0 flex-col">
                            <label className="text-xs font-bold text-gray-400 uppercase mb-1.5 block">负向提示词</label>
                            <textarea
                                value={negativePromptInput}
                                onChange={(event) => setNegativePromptInput(event.target.value)}
                                placeholder="请输入项目级负向提示词"
                                className="min-h-0 flex-1 resize-none rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-gray-200 leading-relaxed outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
                            />
                        </div>
                    </div>

                    <div className="space-y-2 pt-1">
                        <button
                            type="button"
                            onClick={() => void handleOverrideProjectArtDirection()}
                            disabled={isOverriding || !project?.series_id}
                            className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-55"
                        >
                            {isOverriding ? "覆盖中..." : "覆盖项目美术设定"}
                        </button>
                        <p className="text-[10px] text-gray-500">
                            覆盖后将不再继承剧集默认美术风格，仅对当前项目生效。
                        </p>
                        {overrideError ? <p className="text-[10px] text-rose-300">{overrideError}</p> : null}
                        {overrideMessage ? <p className="text-[10px] text-emerald-300">{overrideMessage}</p> : null}
                    </div>
                </div>
            ) : (
                <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-500 mb-2">尚未配置美术设定</p>
                    <p className="text-[9px] text-gray-600">
                        请前往左侧“美术设定”完成风格配置
                    </p>
                </div>
            )}
        </div>
    );
}

function StoryboardInspector() {
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const selectedFrameId = useProjectStore((state) => state.selectedFrameId);
    const enqueueReceipts = useTaskStore((state) => state.enqueueReceipts);
    const waitForJob = useTaskStore((state) => state.waitForJob);

    const effectiveCharacters = getEffectiveProjectCharacters(currentProject);

    const selectedFrame = currentProject?.frames?.find((f: any) => f.id === selectedFrameId);

    const updateFrame = async (data: any) => {
        if (!currentProject || !selectedFrame) return;

        // Optimistically update local state first
        const updatedFrames = currentProject.frames.map((f: any) =>
            f.id === selectedFrameId ? { ...f, ...data } : f
        );
        updateProject(currentProject.id, { frames: updatedFrames });

        // Sync to backend (fire and forget for speed, but log errors)
        try {
            await api.updateFrame(currentProject.id, selectedFrame.id, data);
        } catch (error) {
            console.error("Failed to sync frame to backend:", error);
            // Note: We don't revert optimistic update to keep UI responsive
        }
    };

    const handleComposePrompt = () => {
        if (!selectedFrame || !currentProject) return;

        const scene = currentProject.scenes?.find((s: any) => s.id === selectedFrame.scene_id);
        const characters = effectiveCharacters.filter((c: any) => selectedFrame.character_ids?.includes(c.id));

        // Construct prompt based on User Guide: Motion + Camera (+ Context)
        const promptParts = [];

        // 1. Motion / Action (Subject + Action)
        let motionPart = "";
        if (characters && characters.length > 0) {
            const charDescriptions = characters.map((c: any) => {
                let desc = `${c.name} (${c.description}`;
                if (c.clothing) desc += `, wearing ${c.clothing}`;
                desc += `)`;
                return desc;
            }).join(", ");
            motionPart += `Characters: ${charDescriptions}. `;
        }
        motionPart += `${selectedFrame.action_description || ""}`;
        if (selectedFrame.facial_expression) motionPart += `, ${selectedFrame.facial_expression}`;
        if (motionPart.trim()) promptParts.push(motionPart.trim());

        // 2. Camera (Movement + Angle)
        let cameraPart = "";
        if (selectedFrame.camera_angle) cameraPart += `${selectedFrame.camera_angle}`;
        if (selectedFrame.camera_movement) {
            if (cameraPart) cameraPart += ", ";
            cameraPart += `${selectedFrame.camera_movement}`;
        }
        if (selectedFrame.composition) {
            if (cameraPart) cameraPart += ", ";
            cameraPart += `${selectedFrame.composition}`;
        }
        if (cameraPart.trim()) promptParts.push(cameraPart.trim());

        // 3. Scene / Context (Environment + Atmosphere)
        let scenePart = "";
        if (scene) {
            scenePart += `${scene.description || scene.name}`;
            if (scene.time_of_day) scenePart += `, ${scene.time_of_day}`;
            if (scene.lighting_mood) scenePart += `, ${scene.lighting_mood}`;
        }
        if (selectedFrame.atmosphere) {
            if (scenePart) scenePart += ", ";
            scenePart += `${selectedFrame.atmosphere}`;
        }
        if (scenePart.trim()) promptParts.push(scenePart.trim());

        // Join with periods for clear separation
        const finalPrompt = promptParts.join(" . ");
        updateFrame({ image_prompt: finalPrompt });
    };

    const toggleCharacter = (charId: string) => {
        const currentIds = selectedFrame.character_ids || [];
        const newIds = currentIds.includes(charId)
            ? currentIds.filter((id: string) => id !== charId)
            : [...currentIds, charId];
        updateFrame({ character_ids: newIds });
    };

    // State for bilingual polish results
    const [polishedPrompts, setPolishedPrompts] = useState<Record<string, { cn: string; en: string }>>({});
    const [isPolishing, setIsPolishing] = useState(false);
    const [feedbackText, setFeedbackText] = useState("");

    if (!currentProject) return null;

    const polishedPrompt = selectedFrame ? polishedPrompts[selectedFrame.id] : null;

    const handlePolish = async (feedback: string = "") => {
        if (!selectedFrame || !currentProject) return;
        setIsPolishing(true);

        // Construct assets list for context
        const assets = [];
        if (selectedFrame.scene_id) {
            const scene = currentProject.scenes?.find((s: any) => s.id === selectedFrame.scene_id);
            if (scene) assets.push({ type: 'Scene', name: scene.name, description: scene.description });
        }
        if (selectedFrame.character_ids) {
            selectedFrame.character_ids.forEach((cid: string) => {
                const char = effectiveCharacters.find((c: any) => c.id === cid);
                if (char) assets.push({ type: 'Character', name: char.name, description: char.description });
            });
        }
        if (selectedFrame.prop_ids) {
            selectedFrame.prop_ids.forEach((pid: string) => {
                const prop = currentProject.props?.find((p: any) => p.id === pid);
                if (prop) assets.push({ type: 'Prop', name: prop.name, description: prop.description });
            });
        }

        // Use current polished result as draft when refining with feedback
        const draft = feedback
            ? (polishedPrompt?.en || selectedFrame.image_prompt || selectedFrame.action_description)
            : (selectedFrame.image_prompt || selectedFrame.action_description);

        try {
            const receipt = await api.refineFramePrompt(currentProject.id, selectedFrame.id, draft, assets, feedback);
            // 提交成功后立即写入任务 store，避免右侧队列要等轮询或首次 fetchJob 才出现。
            enqueueReceipts(currentProject.id, [receipt]);
            const job = await waitForJob(receipt.job_id, { intervalMs: 1500 });
            const result = job.result_json || {};
            if (job.status === "succeeded" && result.prompt_cn && result.prompt_en) {
                setPolishedPrompts(prev => ({
                    ...prev,
                    [selectedFrame.id]: { cn: result.prompt_cn, en: result.prompt_en }
                }));
                setFeedbackText("");
            } else {
                throw new Error(job.error_message || "提示词润色失败");
            }
        } catch (err) {
            console.error("Polish failed", err);
            alert("提示词润色失败");
        } finally {
            setIsPolishing(false);
        }
    };

    if (!selectedFrame) {
        return (
            <div className="space-y-6">
                <div className="p-4 bg-white/5 rounded-lg border border-white/10 text-center text-gray-500 text-xs">
                    请选择一个分镜帧以编辑其详情。
                </div>
                <p className="text-xs text-gray-500 text-center">
                    提示：可通过侧边栏中的 ⚙️ 图标配置画幅比例。
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Layout size={14} /> 分镜编辑
                </h3>
                <div className="text-xs text-gray-400">
                    正在编辑第 {currentProject?.frames?.findIndex((f: any) => f.id === selectedFrameId) + 1} 帧
                </div>
            </div>

            {/* Action Description */}
            <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase">动作 / 画面</label>
                <textarea
                    className="w-full h-24 bg-black/20 border border-white/10 rounded-lg p-3 text-xs text-gray-300 resize-none focus:outline-none focus:border-primary/50"
                    value={selectedFrame.action_description || ""}
                    onChange={(e) => updateFrame({ action_description: e.target.value })}
                    placeholder="描述这一帧中的动作与画面..."
                />
            </div>

            {/* Dialogue */}
            <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase">对白</label>
                <textarea
                    className="w-full h-16 bg-black/20 border border-white/10 rounded-lg p-3 text-xs text-gray-300 resize-none focus:outline-none focus:border-primary/50"
                    value={selectedFrame.dialogue || ""}
                    onChange={(e) => updateFrame({ dialogue: e.target.value })}
                    placeholder="角色名：对白内容"
                />
            </div>

            {/* Reference Assets */}
            <div className="space-y-2">
                {(() => {
                    // Calculate current reference count
                    const selectedScene = currentProject?.scenes?.find((s: any) => s.id === selectedFrame.scene_id);
                    const sceneHasImage = selectedScene?.image_url;

                    const selectedChars = effectiveCharacters.filter((c: any) => selectedFrame.character_ids?.includes(c.id));
                    const charImageCount = selectedChars?.filter((c: any) => c.image_url || c.avatar_url).length || 0;

                    const selectedProps = currentProject?.props?.filter((p: any) => selectedFrame.prop_ids?.includes(p.id));
                    const propImageCount = selectedProps?.filter((p: any) => p.image_url).length || 0;

                    const referenceCount = (sceneHasImage ? 1 : 0) + charImageCount + propImageCount;

                    // Dynamic limit based on model
                    const i2iModel = currentProject?.model_settings?.i2i_model;
                    const referenceLimit = i2iModel === 'wan2.6-image' ? 4 : 3;
                    const isLimitReached = referenceCount >= referenceLimit;

                    return (
                        <>
                            <div className="flex justify-between items-center">
                                <label className="text-xs font-bold text-gray-500 uppercase">参考资产</label>
                                <span className={`text-[10px] ${isLimitReached ? "text-yellow-500 font-bold" : "text-gray-500"}`}>
                                    {referenceCount}/{referenceLimit} 张图片
                                </span>
                            </div>

                            {/* Scene Selector */}
                            <div className="mb-2 space-y-2">
                                <label className="text-[10px] font-bold text-gray-500 uppercase">场景</label>
                                <select
                                    className="w-full bg-black/20 border border-white/10 rounded p-2 text-xs text-gray-300 focus:outline-none"
                                    value={selectedFrame.scene_id || ""}
                                    onChange={(e) => {
                                        // Check if selecting this scene would exceed limit
                                        // Actually, replacing a scene is always fine unless we treat scene as optional toggle.
                                        // Here it's a dropdown, so we always have 0 or 1 scene. 
                                        // If we switch to a scene with image from one without, we might exceed limit.
                                        const newSceneId = e.target.value;
                                        const newScene = currentProject?.scenes?.find((s: any) => s.id === newSceneId);
                                        const newSceneHasImage = newScene?.image_url;

                                        // Predicted count: (newScene ? 1 : 0) + charCount + propCount
                                        // If current scene had image, we lose 1, gain 1 (net 0).
                                        // If current didn't, we gain 1.
                                        const predictedCount = (newSceneHasImage ? 1 : 0) + charImageCount + propImageCount;

                                        if (predictedCount > referenceLimit) {
                                            alert(`无法选择该场景：参考图片数量将超过上限（${referenceLimit}）。请先取消部分角色或道具。`);
                                            return;
                                        }
                                        updateFrame({ scene_id: newSceneId });
                                    }}
                                >
                                    <option value="">选择场景...</option>
                                    {currentProject?.scenes?.map((scene: any) => (
                                        <option key={scene.id} value={scene.id}>{scene.name}</option>
                                    ))}
                                </select>

                                {/* Show Scene Description if selected */}
                                {selectedScene?.description && (
                                    <div className="bg-white/5 p-2 rounded text-[10px] text-gray-400 italic border border-white/5">
                                        <span className="font-bold not-italic text-gray-500">场景说明：</span>
                                        {selectedScene.description}
                                    </div>
                                )}
                            </div>

                            {/* Character Toggles */}
                            <div className="space-y-2">
                                <label className="text-[10px] font-bold text-gray-500 uppercase">角色</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {effectiveCharacters.map((char: any) => {
                                        const isSelected = selectedFrame.character_ids?.includes(char.id);
                                        const hasImage = char.image_url || char.avatar_url;
                                        // Disable if not selected, has image, and limit reached
                                        const isDisabled = !isSelected && hasImage && isLimitReached;

                                        return (
                                            <button
                                                key={char.id}
                                                disabled={isDisabled}
                                                onClick={() => {
                                                    if (isDisabled) return;
                                                    toggleCharacter(char.id);
                                                }}
                                                className={`flex items-center gap-2 p-2 rounded border text-xs transition-all ${isSelected
                                                    ? "bg-primary/20 border-primary text-white"
                                                    : isDisabled
                                                        ? "bg-black/10 border-white/5 text-gray-600 cursor-not-allowed opacity-50"
                                                        : "bg-black/20 border-white/10 text-gray-400 hover:bg-white/5"
                                                    }`}
                                            >
                                                <div className="w-4 h-4 rounded-full bg-gray-700 overflow-hidden">
                                                    {char.avatar_url && <img src={getAssetUrl(char.avatar_url)} className="w-full h-full object-cover" />}
                                                </div>
                                                <span className="truncate">{char.name}</span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Show Selected Characters Descriptions */}
                                {selectedChars && selectedChars.length > 0 && (
                                    <div className="space-y-1">
                                        {selectedChars.map((char: any) => (
                                            <div key={char.id} className="bg-white/5 p-2 rounded text-[10px] text-gray-400 italic border border-white/5">
                                                <span className="font-bold not-italic text-gray-500">{char.name}: </span>
                                                {char.description}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Prop Toggles */}
                            {currentProject?.props && currentProject.props.length > 0 && (
                                <div className="space-y-2">
                                    <label className="text-[10px] font-bold text-gray-500 uppercase">道具</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {currentProject.props.map((prop: any) => {
                                            const isSelected = selectedFrame.prop_ids?.includes(prop.id);
                                            const hasImage = prop.image_url;
                                            const isDisabled = !isSelected && hasImage && isLimitReached;

                                            return (
                                                <button
                                                    key={prop.id}
                                                    disabled={isDisabled}
                                                    onClick={() => {
                                                        if (isDisabled) return;
                                                        // Toggle Prop Logic
                                                        const currentProps = selectedFrame.prop_ids || [];
                                                        const newProps = currentProps.includes(prop.id)
                                                            ? currentProps.filter((id: string) => id !== prop.id)
                                                            : [...currentProps, prop.id];
                                                        updateFrame({ prop_ids: newProps });
                                                    }}
                                                    className={`flex items-center gap-2 p-2 rounded border text-xs transition-all ${isSelected
                                                        ? "bg-primary/20 border-primary text-white"
                                                        : isDisabled
                                                            ? "bg-black/10 border-white/5 text-gray-600 cursor-not-allowed opacity-50"
                                                            : "bg-black/20 border-white/10 text-gray-400 hover:bg-white/5"
                                                        }`}
                                                >
                                                    <div className="w-4 h-4 rounded bg-gray-700 overflow-hidden flex-shrink-0">
                                                        {prop.image_url && <img src={getAssetUrl(prop.image_url)} className="w-full h-full object-cover" />}
                                                    </div>

                                                    <span className="truncate">{prop.name}</span>
                                                </button>
                                            );
                                        })}
                                    </div>

                                    {/* Show Selected Props Descriptions */}
                                    {(() => {
                                        const selectedProps = currentProject.props.filter((p: any) => selectedFrame.prop_ids?.includes(p.id));
                                        if (selectedProps && selectedProps.length > 0) {
                                            return (
                                                <div className="space-y-1">
                                                    {selectedProps.map((prop: any) => (
                                                        <div key={prop.id} className="bg-white/5 p-2 rounded text-[10px] text-gray-400 italic border border-white/5">
                                                            <span className="font-bold not-italic text-gray-500">{prop.name}: </span>
                                                            {prop.description}
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        }
                                        return null;
                                    })()}
                                </div>
                            )}
                        </>
                    );
                })()}
            </div>

            {/* Camera Controls */}
            <div className="space-y-2">
                <label className="text-xs font-bold text-gray-500 uppercase">镜头</label>
                <div className="grid grid-cols-1 gap-2">
                    <select
                        className="bg-black/20 border border-white/10 rounded p-2 text-xs text-gray-300 focus:outline-none"
                        value={selectedFrame.camera_angle || ""}
                        onChange={(e) => updateFrame({ camera_angle: e.target.value })}
                    >
                        <option value="">选择镜头角度...</option>
                        <option value="Wide Shot">远景</option>
                        <option value="Medium Shot">中景</option>
                        <option value="Close Up">特写</option>
                        <option value="Low Angle">低机位</option>
                        <option value="High Angle">高机位</option>
                        <option value="Over the Shoulder">过肩镜头</option>
                    </select>
                </div>
            </div>

            {/* Prompt */}
            <div className="space-y-2">
                <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-500 uppercase">生图提示词</label>
                    <button
                        onClick={handleComposePrompt}
                        className="flex items-center gap-1 text-[10px] bg-white/10 hover:bg-white/20 px-2 py-1 rounded text-white transition-colors"
                        title="根据分镜元数据自动生成提示词"
                    >
                        <Wand2 size={10} /> 自动生成
                    </button>
                    <button
                        onClick={() => handlePolish()}
                        disabled={isPolishing}
                        className="flex items-center gap-1 text-[10px] bg-purple-600 hover:bg-purple-700 px-2 py-1 rounded text-white transition-colors ml-2 disabled:opacity-50"
                        title="AI 润色提示词"
                    >
                        {isPolishing ? <Sparkles size={10} className="animate-spin" /> : <Sparkles size={10} />} 润色
                    </button>
                </div>
                <textarea
                    className="w-full h-32 bg-black/20 border border-white/10 rounded-lg p-3 text-xs text-gray-300 resize-none focus:outline-none focus:border-primary/50"
                    value={selectedFrame.image_prompt || ""}
                    onChange={(e) => updateFrame({ image_prompt: e.target.value })}
                    placeholder="输入完整的生图提示词..."
                />

                {/* Polished Result Display - Bilingual */}
                {polishedPrompt && (
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-3 mt-2 space-y-3"
                    >
                        <div className="flex justify-between items-start">
                            <span className="text-xs font-bold text-purple-400 flex items-center gap-1">
                                <Wand2 size={12} /> AI 双语润色
                            </span>
                            <button
                                onClick={() => {
                                    setPolishedPrompts(prev => {
                                        const newState = { ...prev };
                                        delete newState[selectedFrame.id];
                                        return newState;
                                    });
                                    setFeedbackText("");
                                }}
                                className="text-[10px] text-gray-400 hover:text-white"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Chinese Prompt */}
                        <div className="space-y-1">
                            <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold text-gray-500 uppercase">中文 (预览)</span>
                                <button
                                    onClick={() => {
                                        navigator.clipboard.writeText(polishedPrompt.cn);
                                        alert("中文提示词已复制");
                                    }}
                                    className="text-[10px] text-gray-400 hover:text-white bg-black/20 px-2 py-0.5 rounded"
                                >
                                    复制
                                </button>
                            </div>
                            <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap bg-black/20 p-2 rounded">
                                {polishedPrompt.cn}
                            </p>
                        </div>

                        {/* English Prompt */}
                        <div className="space-y-1">
                            <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold text-gray-500 uppercase">English (生图用)</span>
                                <div className="flex gap-1">
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(polishedPrompt.en);
                                            alert("英文提示词已复制");
                                        }}
                                        className="text-[10px] text-gray-400 hover:text-white bg-black/20 px-2 py-0.5 rounded"
                                    >
                                        复制
                                    </button>
                                    <button
                                        onClick={() => {
                                            updateFrame({
                                                image_prompt: polishedPrompt.en,
                                                image_prompt_cn: polishedPrompt.cn,
                                                image_prompt_en: polishedPrompt.en
                                            });
                                            setPolishedPrompts(prev => {
                                                const newState = { ...prev };
                                                delete newState[selectedFrame.id];
                                                return newState;
                                            });
                                        }}
                                        className="text-[10px] text-white bg-purple-600 hover:bg-purple-500 px-2 py-0.5 rounded font-bold"
                                    >
                                        应用
                                    </button>
                                </div>
                            </div>
                            <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap bg-black/20 p-2 rounded font-mono">
                                {polishedPrompt.en}
                            </p>
                        </div>

                        {/* Feedback for iterative refinement */}
                        <div className="space-y-2 pt-2 border-t border-purple-500/20">
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
                                    className="flex-1 text-[10px] bg-black/30 border border-purple-500/20 rounded px-2 py-1.5 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500/50"
                                />
                                <button
                                    onClick={() => handlePolish(feedbackText.trim())}
                                    disabled={isPolishing || !feedbackText.trim()}
                                    className="text-[10px] text-white bg-purple-600 hover:bg-purple-500 px-2 py-1.5 rounded font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                >
                                    {isPolishing ? <Sparkles size={8} className="animate-spin" /> : <Sparkles size={8} />}
                                    再润色
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </div>
        </div >
    );
}

function MotionInspector() {
    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Video size={14} /> Motion Params
                </h3>
                <div className="space-y-4">
                    <div className="space-y-1">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>Motion Bucket</span>
                            <span>127</span>
                        </div>
                        <input type="range" className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer" />
                    </div>
                    <div className="space-y-1">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>FPS</span>
                            <span>24</span>
                        </div>
                        <input type="range" className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer" />
                    </div>
                </div>
            </div>
        </div>
    );
}

function AudioInspector() {
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const selectedAudioCharacterId = useProjectStore((state) => state.selectedAudioCharacterId);
    const setSelectedAudioCharacterId = useProjectStore((state) => state.setSelectedAudioCharacterId);
    const [voices, setVoices] = useState<any[]>([]);
    const [charParams, setCharParams] = useState<Record<string, { speed: number; pitch: number; volume: number }>>({});
    const [bindingVoiceCharId, setBindingVoiceCharId] = useState<string | null>(null);
    const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
    const [loadingPreviewVoiceId, setLoadingPreviewVoiceId] = useState<string | null>(null);
    const [previewUrlsByVoiceId, setPreviewUrlsByVoiceId] = useState<Record<string, string>>({});
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const effectiveCharacters = getEffectiveProjectCharacters(currentProject);

    useEffect(() => {
        api.getVoices().then(setVoices).catch(console.error);
    }, []);

    useEffect(() => {
        setPreviewUrlsByVoiceId(
            Object.fromEntries(
                voices
                    .filter((voice) => typeof voice.preview_url === "string" && voice.preview_url)
                    .map((voice) => [voice.id, voice.preview_url])
            )
        );
    }, [voices]);

    useEffect(() => {
        if (effectiveCharacters.length === 0) {
            setCharParams({});
            return;
        }
        const nextParams: Record<string, { speed: number; pitch: number; volume: number }> = {};
        effectiveCharacters.forEach((char: any) => {
            nextParams[char.id] = {
                speed: char.voice_speed ?? 1.0,
                pitch: char.voice_pitch ?? 1.0,
                volume: char.voice_volume ?? 50,
            };
        });
        setCharParams(nextParams);
    }, [effectiveCharacters]);

    useEffect(() => {
        const characters = effectiveCharacters;
        if (characters.length === 0) {
            if (selectedAudioCharacterId) {
                setSelectedAudioCharacterId(null);
            }
            return;
        }
        if (!selectedAudioCharacterId || !characters.some((char: any) => char.id === selectedAudioCharacterId)) {
            setSelectedAudioCharacterId(characters[0].id);
        }
    }, [effectiveCharacters, selectedAudioCharacterId, setSelectedAudioCharacterId]);

    const resolveSelectedVoiceId = (voiceId?: string | null) => {
        if (!voiceId) return "";
        if (voices.some((voice) => voice.id === voiceId)) {
            return voiceId;
        }
        const matched = voices.find((voice) => Array.isArray(voice.aliases) && voice.aliases.includes(voiceId));
        return matched?.id || "";
    };

    const selectedCharacter = effectiveCharacters.find((char: any) => char.id === selectedAudioCharacterId);

    const handlePlayPreview = (voiceId: string, url: string) => {
        if (!audioRef.current) return;
        if (previewingVoiceId === voiceId && audioRef.current.src === getAssetUrl(url)) {
            audioRef.current.pause();
            setPreviewingVoiceId(null);
            return;
        }
        audioRef.current.src = getAssetUrl(url);
        void audioRef.current.play();
        setPreviewingVoiceId(voiceId);
    };

    const handlePreviewVoice = async (voiceId: string) => {
        const existingUrl = previewUrlsByVoiceId[voiceId];
        if (existingUrl) {
            handlePlayPreview(voiceId, existingUrl);
            return;
        }
        setLoadingPreviewVoiceId(voiceId);
        try {
            const payload = await api.previewVoice(voiceId);
            const previewUrl = payload.preview_url;
            setPreviewUrlsByVoiceId((prev) => ({ ...prev, [voiceId]: previewUrl }));
            setVoices((prev) => prev.map((voice) => voice.id === voiceId ? { ...voice, preview_url: previewUrl } : voice));
            handlePlayPreview(voiceId, previewUrl);
        } catch (error) {
            console.error("Failed to preview voice:", error);
            alert((error as Error)?.message || "试听音色失败");
        } finally {
            setLoadingPreviewVoiceId(null);
        }
    };

    const handleBindVoice = async (charId: string, voiceId: string, voiceName: string) => {
        if (!currentProject) return;
        const nextCharacters = effectiveCharacters.map((char: any) =>
            char.id === charId ? { ...char, voice_id: voiceId, voice_name: voiceName } : char
        );
        const nextSeriesCharacterLinks = currentProject.series_character_links?.map((link: any) =>
            link.character_id === charId || link.character?.id === charId
                ? {
                    ...link,
                    character: link.character
                        ? { ...link.character, voice_id: voiceId, voice_name: voiceName }
                        : link.character,
                }
                : link
        );
        // 中文注释：系列项目的角色真源在 link.character 上，乐观更新时要同时补上，界面才不会闪回旧值。
        updateProject(currentProject.id, {
            characters: nextCharacters,
            ...(nextSeriesCharacterLinks ? { series_character_links: nextSeriesCharacterLinks } : {}),
        });
        setBindingVoiceCharId(charId);
        try {
            const updatedProject = await api.bindVoice(currentProject.id, charId, voiceId, voiceName);
            updateProject(currentProject.id, updatedProject);
        } catch (error) {
            console.error("Failed to bind voice:", error);
            const refreshedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, refreshedProject);
        } finally {
            setBindingVoiceCharId(null);
        }
    };

    const handleCharParamChange = (charId: string, param: "speed" | "pitch" | "volume", value: number) => {
        setCharParams((prev) => ({
            ...prev,
            [charId]: { ...prev[charId], [param]: value },
        }));
    };

    const saveCharParams = async (charId: string) => {
        const params = charParams[charId];
        if (!currentProject || !params) return;
        try {
            const updated = await api.updateVoiceParams(currentProject.id, charId, params.speed, params.pitch, params.volume);
            updateProject(currentProject.id, updated);
        } catch (error) {
            console.error("Failed to save voice params:", error);
        }
    };

    return (
        <div className="space-y-6">
            <audio
                ref={audioRef}
                onEnded={() => setPreviewingVoiceId(null)}
                className="hidden"
            />
            {currentProject?.series_id && (
                <ProjectCharacterSourceHintBanner project={currentProject} />
            )}
            {!selectedCharacter ? (
                <div className="p-4 bg-white/5 rounded-lg border border-white/10 text-center text-gray-500 text-xs">
                    请选择左侧角色以编辑音色和配音参数。
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 shadow-[0_12px_30px_rgba(0,0,0,0.12)]">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                            <Mic size={14} /> 角色声线设置
                        </h3>
                        <p className="text-[11px] text-gray-500 mt-1">
                            为 {selectedCharacter.name} 选择音色并调整默认配音参数。
                        </p>
                        <div className="space-y-2 mt-4">
                            <label className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.18em]">音色</label>
                            <div className="flex items-center gap-2">
                                <select
                                    className="flex-1 bg-black/25 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-gray-200 focus:outline-none focus:border-primary"
                                    value={resolveSelectedVoiceId(selectedCharacter.voice_id)}
                                    onChange={(e) => {
                                        const voice = voices.find((item) => item.id === e.target.value);
                                        if (voice) {
                                            void handleBindVoice(selectedCharacter.id, voice.id, voice.name);
                                        }
                                    }}
                                >
                                    <option value="">请选择音色...</option>
                                    {voices.map((voice) => (
                                        <option key={voice.id} value={voice.id}>{voice.name}</option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    disabled={!resolveSelectedVoiceId(selectedCharacter.voice_id) || loadingPreviewVoiceId === resolveSelectedVoiceId(selectedCharacter.voice_id)}
                                    onClick={() => {
                                        const voiceId = resolveSelectedVoiceId(selectedCharacter.voice_id);
                                        if (voiceId) {
                                            void handlePreviewVoice(voiceId);
                                        }
                                    }}
                                    className={`h-10 w-10 rounded-xl flex items-center justify-center transition-all ${
                                        previewingVoiceId === resolveSelectedVoiceId(selectedCharacter.voice_id)
                                            ? "bg-primary/15 text-primary shadow-[0_0_20px_rgba(255,255,255,0.08)]"
                                            : "bg-black/25 text-gray-300 hover:bg-white/10"
                                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                                    title="试听音色"
                                >
                                    {loadingPreviewVoiceId === resolveSelectedVoiceId(selectedCharacter.voice_id)
                                        ? <Wand2 size={14} className="animate-spin" />
                                        : <Mic size={14} />}
                                </button>
                            </div>
                            {bindingVoiceCharId === selectedCharacter.id && (
                                <p className="text-[10px] text-primary">正在同步音色配置...</p>
                            )}
                        </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 p-4 space-y-4">
                        <div>
                            <label className="flex justify-between text-xs text-gray-300 mb-1.5">
                                语速 <span className="text-primary">{(charParams[selectedCharacter.id]?.speed ?? 1.0).toFixed(1)}x</span>
                            </label>
                            <input
                                type="range"
                                min="0.5"
                                max="2.0"
                                step="0.1"
                                value={charParams[selectedCharacter.id]?.speed ?? 1.0}
                                onChange={(e) => handleCharParamChange(selectedCharacter.id, "speed", parseFloat(e.target.value))}
                                onPointerUp={() => void saveCharParams(selectedCharacter.id)}
                                className={AUDIO_SLIDER_CLASS}
                            />
                        </div>

                        <div>
                            <label className="flex justify-between text-xs text-gray-300 mb-1.5">
                                音调 <span className="text-primary">{(charParams[selectedCharacter.id]?.pitch ?? 1.0).toFixed(1)}</span>
                            </label>
                            <input
                                type="range"
                                min="0.5"
                                max="2.0"
                                step="0.1"
                                value={charParams[selectedCharacter.id]?.pitch ?? 1.0}
                                onChange={(e) => handleCharParamChange(selectedCharacter.id, "pitch", parseFloat(e.target.value))}
                                onPointerUp={() => void saveCharParams(selectedCharacter.id)}
                                className={AUDIO_SLIDER_CLASS}
                            />
                        </div>

                        <div>
                            <label className="flex justify-between text-xs text-gray-300 mb-1.5">
                                音量 <span className="text-primary">{charParams[selectedCharacter.id]?.volume ?? 50}</span>
                            </label>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="1"
                                value={charParams[selectedCharacter.id]?.volume ?? 50}
                                onChange={(e) => handleCharParamChange(selectedCharacter.id, "volume", parseInt(e.target.value))}
                                onPointerUp={() => void saveCharParams(selectedCharacter.id)}
                                className={AUDIO_SLIDER_CLASS}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function MixInspector() {
    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Music size={14} /> Track Inspector
                </h3>
                <div className="p-4 bg-white/5 rounded-lg border border-white/10 text-center text-xs text-gray-500">
                    Select a clip on the timeline to view details.
                </div>
            </div>
        </div>
    );
}

function ExportInspector() {
    return (
        <div className="space-y-6">
            <div className="space-y-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Film size={14} /> Export History
                </h3>
                <div className="space-y-2">
                    <div className="p-2 bg-white/5 rounded border border-white/10 flex justify-between items-center">
                        <span className="text-xs text-gray-300">Project_v1.mp4</span>
                        <span className="text-[10px] text-gray-500">2h ago</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatBox({ label, value }: { label: string, value: string | number }) {
    return (
        <div className="bg-white/5 border border-white/10 rounded p-2 text-center">
            <div className="text-lg font-bold text-white">{value}</div>
            <div className="text-[10px] text-gray-500 uppercase">{label}</div>
        </div>
    );
}
