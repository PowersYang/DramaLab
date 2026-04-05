"use client";

import { useState, useEffect, useRef } from "react";
import { Mic, Play, Pause, Wand2, Headphones, Volume2, Check, Settings2, AlertCircle } from "lucide-react";
import clsx from "clsx";
import BillingActionButton from "@/components/billing/BillingActionButton";
import { useBillingGuard } from "@/hooks/useBillingGuard";
import { useProjectStore } from "@/store/projectStore";
import { api } from "@/lib/api";
import { useTaskStore } from "@/store/taskStore";
import { getAssetUrl } from "@/lib/utils";
import { getEffectiveProjectCharacters } from "@/lib/projectAssets";
import ProjectCharacterSourceHintBanner from "@/components/common/ProjectCharacterSourceHintBanner";
import { PANEL_HEADER_CLASS, PANEL_TITLE_CLASS } from "@/components/modules/panelHeaderStyles";

const AUDIO_SLIDER_CLASS = "w-full h-1.5 appearance-none bg-transparent cursor-pointer [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-white/20 [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-white/20 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:mt-[-3px] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-primary [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary";

export default function VoiceActingStudio() {
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const selectedAudioCharacterId = useProjectStore((state) => state.selectedAudioCharacterId);
    const setSelectedAudioCharacterId = useProjectStore((state) => state.setSelectedAudioCharacterId);
    const enqueueReceipts = useTaskStore((state) => state.enqueueReceipts);
    const waitForJob = useTaskStore((state) => state.waitForJob);

    const [playingAudio, setPlayingAudio] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatingLineId, setGeneratingLineId] = useState<string | null>(null);

    // Per-line settings override
    const [activeSettingsId, setActiveSettingsId] = useState<string | null>(null);
    const [lineSettings, setLineSettings] = useState<Record<string, { speed: number; pitch: number; volume: number }>>({});
    const { account, getTaskPrice, canAffordTask } = useBillingGuard();
    const projectAudioPrice = getTaskPrice("audio.generate.project");
    const lineAudioPrice = getTaskPrice("audio.generate.line");
    const projectAudioAffordable = canAffordTask("audio.generate.project");
    const lineAudioAffordable = canAffordTask("audio.generate.line");
    const effectiveCharacters = getEffectiveProjectCharacters(currentProject);

    // Per-character voice params (defaults)
    const [charParams, setCharParams] = useState<Record<string, { speed: number; pitch: number; volume: number }>>({});

    useEffect(() => {
        if (effectiveCharacters.length === 0) {
            setCharParams({});
            return;
        }
        const params: Record<string, { speed: number; pitch: number; volume: number }> = {};
        effectiveCharacters.forEach((char: any) => {
            params[char.id] = {
                speed: char.voice_speed ?? 1.0,
                pitch: char.voice_pitch ?? 1.0,
                volume: char.voice_volume ?? 50,
            };
        });
        setCharParams(params);
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

    const getDefaultLineSettings = (speakerId?: string | null) => {
        if (!speakerId) {
            return { speed: 1.0, pitch: 1.0, volume: 50 };
        }
        const params = charParams[speakerId];
        if (!params) {
            return { speed: 1.0, pitch: 1.0, volume: 50 };
        }
        return {
            speed: params.speed ?? 1.0,
            pitch: params.pitch ?? 1.0,
            volume: params.volume ?? 50,
        };
    };

    const handlePlay = (url: string) => {
        if (playingAudio === url) {
            audioRef.current?.pause();
            setPlayingAudio(null);
        } else {
            if (audioRef.current) {
                audioRef.current.src = getAssetUrl(url);
                audioRef.current.play();
                setPlayingAudio(url);
            }
        }
    };

    const handleGenerateAll = async () => {
        if (!currentProject) return;
        setIsGenerating(true);
        try {
            const receipt = await api.generateAudio(currentProject.id);
            enqueueReceipts(currentProject.id, [receipt]);
            const job = await waitForJob(receipt.job_id, { intervalMs: 2000 });
            if (job.status !== "succeeded") {
                throw new Error(job.error_message || "音频生成失败");
            }
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
        } catch (error: any) {
            console.error("Failed to generate audio:", error);
            alert(error?.message || "生成整片音频失败");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleGenerateLine = async (frameId: string, speakerId?: string | null) => {
        if (!currentProject) return;
        setGeneratingLineId(frameId);
        try {
            const settings = lineSettings[frameId] || getDefaultLineSettings(speakerId);
            const receipt = await api.generateLineAudio(currentProject.id, frameId, settings.speed, settings.pitch, settings.volume);
            enqueueReceipts(currentProject.id, [receipt]);
            const job = await waitForJob(receipt.job_id, { intervalMs: 2000 });
            if (job.status !== "succeeded") {
                throw new Error(job.error_message || "对白音频生成失败");
            }
            const updatedProject = await api.getProject(currentProject.id);
            updateProject(currentProject.id, updatedProject);
        } catch (error: any) {
            console.error("Failed to generate line audio:", error);
            alert(error?.message || "生成对白音频失败");
        } finally {
            setGeneratingLineId(null);
        }
    };

    return (
        <div className="flex h-full text-white">
            <audio
                ref={audioRef}
                onEnded={() => {
                    setPlayingAudio(null);
                }}
                className="hidden"
            />

            {/* Left Sidebar: 配音角色区 */}
            <div className="w-80 border-r border-white/10 flex flex-col bg-black/20">
                <div className={PANEL_HEADER_CLASS}>
                    <h3 className={PANEL_TITLE_CLASS}>
                        <Headphones size={16} className="text-primary" /> 角色声线
                    </h3>
                </div>
                {currentProject?.series_id && (
                    <div className="px-4 pt-3">
                        <ProjectCharacterSourceHintBanner project={currentProject} />
                    </div>
                )}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {effectiveCharacters.map((char: any) => (
                        <button
                            key={char.id}
                            type="button"
                            onClick={() => setSelectedAudioCharacterId(char.id)}
                            className={clsx(
                                "w-full text-left rounded-2xl p-4 border transition-all",
                                selectedAudioCharacterId === char.id
                                    ? "bg-primary/12 border-primary/30 shadow-[0_12px_30px_rgba(0,0,0,0.18)]"
                                    : "bg-white/5 border-white/5 hover:border-white/10 hover:bg-white/[0.07]"
                            )}
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-14 h-14 rounded-2xl bg-gray-700 overflow-hidden ring-1 ring-white/10 shrink-0">
                                    {(char?.avatar_url || char?.image_url) ? (
                                        <img
                                            src={getAssetUrl(char?.avatar_url || char?.image_url)}
                                            alt={char.name}
                                            className="w-full h-full object-cover"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-base font-bold">{char.name[0]}</div>
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="font-bold text-base text-white truncate">{char.name}</div>
                                    <div className="text-sm text-gray-400 mt-1 truncate">
                                        {[char.gender, char.age].filter(Boolean).join(" · ") || "角色信息待补充"}
                                    </div>
                                </div>
                                {selectedAudioCharacterId === char.id && (
                                    <div className="h-2.5 w-2.5 rounded-full bg-primary shadow-[0_0_12px_rgba(255,255,255,0.28)] shrink-0" />
                                )}
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Main Content: Script Reader */}
            <div className="flex-1 flex flex-col relative">
                {/* Toolbar */}
                <div className="h-14 border-b border-white/10 bg-black/20 flex items-center px-6 justify-between">
                    <h2 className="font-display font-bold text-lg">对白脚本</h2>
                    <BillingActionButton
                        onClick={handleGenerateAll}
                        disabled={isGenerating || !projectAudioAffordable}
                        priceCredits={projectAudioPrice}
                        balanceCredits={account?.balance_credits}
                        className="bg-white/5 hover:bg-white/10 border border-primary/50 hover:border-primary text-primary hover:text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 whitespace-nowrap flex-shrink-0 transition-all disabled:opacity-50"
                        tooltipText={projectAudioPrice == null ? undefined : `预计消耗${projectAudioPrice}算力豆${!projectAudioAffordable ? "，当前余额不足" : ""}`}
                    >
                        {isGenerating ? <Wand2 className="animate-spin" size={16} /> : <Mic size={16} />}
                        {isGenerating ? "生成中..." : "生成全部音频"}
                    </BillingActionButton>
                </div>

                {/* Dialogue List */}
                <div className="flex-1 overflow-y-auto p-8 space-y-6">
                    {currentProject?.frames?.map((frame: any, index: number) => {
                        if (!frame.dialogue) return null;

                        const speakerId = frame.character_ids?.[0];
                        const speaker = effectiveCharacters.find((c: any) => c.id === speakerId);
                        const isSettingsOpen = activeSettingsId === frame.id;
                        const settings = lineSettings[frame.id] || getDefaultLineSettings(speakerId);

                        return (
                            <div key={frame.id} className="flex gap-4 group">
                                {/* Speaker Avatar */}
                                <div className="w-12 flex-shrink-0 flex flex-col items-center gap-1 pt-1">
                                    <div className="w-10 h-10 rounded-full bg-gray-800 overflow-hidden border border-white/10">
                                        {(speaker?.avatar_url || speaker?.image_url) ? (
                                            <img
                                                src={getAssetUrl(speaker?.avatar_url || speaker?.image_url)}
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">?</div>
                                        )}
                                    </div>
                                    <span className="text-[10px] text-gray-500 text-center leading-tight w-16 truncate">
                                        {speaker?.name || "未知角色"}
                                    </span>
                                </div>

                                {/* Dialogue Bubble */}
                                <div className="flex-1 max-w-3xl">
                                    <div className={clsx(
                                        "bg-white/5 rounded-2xl rounded-tl-none p-4 border border-white/5 hover:border-white/10 transition-colors relative",
                                        frame.audio_url && "border-primary/30 bg-primary/5"
                                    )}>

                                        {/* Settings Popover */}
                                        {isSettingsOpen && (
                                            <div className="absolute top-full left-0 mt-2 w-64 bg-black/30 backdrop-blur-xl border border-white/10 rounded-xl p-4 shadow-xl z-10">
                                                <div className="space-y-4">
                                                    <div>
                                                        <label className="flex justify-between text-xs text-gray-400 mb-1">
                                                            语速 <span>{settings.speed}x</span>
                                                        </label>
                                                        <input
                                                            type="range" min="0.5" max="2.0" step="0.1"
                                                            value={settings.speed}
                                                            onChange={(e) => setLineSettings(prev => ({
                                                                ...prev,
                                                                [frame.id]: { ...settings, speed: parseFloat(e.target.value) }
                                                            }))}
                                                            className={AUDIO_SLIDER_CLASS}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="flex justify-between text-xs text-gray-400 mb-1">
                                                            音调 <span>{settings.pitch}</span>
                                                        </label>
                                                        <input
                                                            type="range" min="0.5" max="2.0" step="0.1"
                                                            value={settings.pitch}
                                                            onChange={(e) => setLineSettings(prev => ({
                                                                ...prev,
                                                                [frame.id]: { ...settings, pitch: parseFloat(e.target.value) }
                                                            }))}
                                                            className={AUDIO_SLIDER_CLASS}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="flex justify-between text-xs text-gray-400 mb-1">
                                                            音量 <span>{settings.volume}</span>
                                                        </label>
                                                        <input
                                                            type="range" min="0" max="100" step="1"
                                                            value={settings.volume}
                                                            onChange={(e) => setLineSettings(prev => ({
                                                                ...prev,
                                                                [frame.id]: { ...settings, volume: parseInt(e.target.value) }
                                                            }))}
                                                            className={AUDIO_SLIDER_CLASS}
                                                        />
                                                    </div>
                                                    <BillingActionButton
                                                        onClick={() => {
                                                            handleGenerateLine(frame.id, speakerId);
                                                            setActiveSettingsId(null);
                                                        }}
                                                        disabled={!lineAudioAffordable}
                                                        priceCredits={lineAudioPrice}
                                                        balanceCredits={account?.balance_credits}
                                                        wrapperClassName="w-full"
                                                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/50 bg-white/5 py-2 text-xs font-bold text-primary transition-all hover:border-primary hover:bg-white/10 hover:text-white disabled:opacity-50"
                                                        tooltipText={lineAudioPrice == null ? undefined : `预计消耗${lineAudioPrice}算力豆${!lineAudioAffordable ? "，当前余额不足" : ""}`}
                                                    >
                                                        按当前设置重新生成
                                                    </BillingActionButton>
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex justify-between items-start gap-4">
                                            <p className="text-gray-200 text-lg font-serif leading-relaxed">
                                                &quot;{frame.dialogue}&quot;
                                            </p>

                                            {/* Action Buttons */}
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                <button
                                                    onClick={() => setActiveSettingsId(isSettingsOpen ? null : frame.id)}
                                                    className={clsx(
                                                        "p-1.5 rounded-full hover:bg-white/10 text-gray-400 transition-colors",
                                                        isSettingsOpen && "bg-white/10 text-white"
                                                    )}
                                                >
                                                    <Settings2 size={14} />
                                                </button>

                                                {generatingLineId === frame.id ? (
                                                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                                                        <Wand2 className="animate-spin text-primary" size={14} />
                                                    </div>
                                                ) : frame.audio_url ? (
                                                    <button
                                                        onClick={() => handlePlay(frame.audio_url)}
                                                        className={clsx(
                                                            "w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                                                            playingAudio === frame.audio_url ? "bg-primary text-white" : "bg-white/10 hover:bg-white/20 text-gray-300"
                                                        )}
                                                    >
                                                        {playingAudio === frame.audio_url ? <Pause size={14} /> : <Play size={14} />}
                                                    </button>
                                                ) : (
                                                    <BillingActionButton
                                                        onClick={() => handleGenerateLine(frame.id, speakerId)}
                                                        disabled={!lineAudioAffordable}
                                                        priceCredits={lineAudioPrice}
                                                        balanceCredits={account?.balance_credits}
                                                        className="h-8 rounded-full bg-white/5 hover:bg-white/10 px-3 flex items-center justify-center gap-1.5 text-gray-300 disabled:opacity-40"
                                                        tooltipText={lineAudioPrice == null ? undefined : `预计消耗${lineAudioPrice}算力豆${!lineAudioAffordable ? "，当前余额不足" : ""}`}
                                                        costClassName="px-1.5 py-0.5 text-[10px]"
                                                    >
                                                        <Mic size={14} />
                                                        <span className="text-[11px] font-semibold">生成</span>
                                                    </BillingActionButton>
                                                )}
                                            </div>
                                        </div>

                                        {/* Metadata Footer */}
                                        <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between gap-2 text-xs text-gray-500">
                                            <div className="flex items-center gap-3">
                                                <span className="font-mono">镜头 {index + 1}</span>
                                            </div>
                                            {frame.status === "failed" ? (
                                                <span className="flex items-center gap-1 text-red-400" title={frame.audio_error || "生成失败"}>
                                                    <AlertCircle size={12} /> {frame.audio_error || "音频生成失败"}
                                                </span>
                                            ) : frame.audio_url ? (
                                                <span className="flex items-center gap-1 text-green-500">
                                                    <Check size={12} /> 音频已就绪
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {(!currentProject?.frames?.some((f: any) => f.dialogue)) && (
                        <div className="text-center text-gray-500 py-20">
                            <Volume2 size={48} className="mx-auto mb-4 opacity-20" />
                            <p>当前剧本中暂无对白内容。</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
