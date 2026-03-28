import { useEffect, useMemo, useRef, useState } from "react";
import {
    AlertTriangle,
    GripVertical,
    Mic,
    Music,
    Pause,
    Play,
    Scissors,
    Sliders,
    Video,
    Volume2,
} from "lucide-react";
import { useProjectStore } from "@/store/projectStore";
import { getAssetUrl } from "@/lib/utils";

type EditableClip = {
    id: string;
    frameId: string;
    frameOrder: number;
    label: string;
    videoId: string;
    videoUrl: string;
    thumbnailUrl: string;
    sourceDuration: number;
    trimStart: number;
    trimEnd: number;
    dialogue?: string;
    hasDialogue: boolean;
    hasSfx: boolean;
    sfxLabel: string;
};

const TRACK_LABEL_WIDTH = 112;

const normalizeVideoSource = (url: string) => {
    if (!url) {
        return "";
    }
    if (typeof window === "undefined") {
        return url;
    }
    try {
        return new URL(url, window.location.href).href;
    } catch {
        return url;
    }
};

export default function FinalMixStudio() {
    const currentProject = useProjectStore((state) => state.currentProject);
    const updateProject = useProjectStore((state) => state.updateProject);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const timelineRef = useRef<HTMLDivElement | null>(null);
    const pendingSeekRef = useRef<number | null>(null);
    const shouldResumeAfterSeekRef = useRef(false);
    const lastLoadedClipIdRef = useRef<string | null>(null);
    const playIntentRef = useRef(false);

    const [clips, setClips] = useState<EditableClip[]>([]);
    const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
    const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [isScrubbing, setIsScrubbing] = useState(false);
    const [zoom, setZoom] = useState(1);

    const [volumes, setVolumes] = useState({
        video: 1.0,
        voice: 1.0,
        sfx: 0.8,
        bgm: 0.5,
    });

    const frames = currentProject?.frames || [];
    const selectedVideos = currentProject?.video_tasks || [];

    const initialClips = useMemo<EditableClip[]>(() => {
        // Final Mix 编辑器只消费当前帧已选中的视频，形成可裁切、可重排的时间轴片段。
        const baseClips = frames
            .map((frame: any, index: number) => {
                const selectedVideo = selectedVideos.find((task: any) => task.id === frame.selected_video_id && task.video_url);
                if (!selectedVideo) {
                    return null;
                }

                const sourceDuration = typeof selectedVideo.duration === "number" && selectedVideo.duration > 0 ? selectedVideo.duration : 5;
                return {
                    id: `clip-${frame.id}-${selectedVideo.id}`,
                    frameId: frame.id,
                    frameOrder: typeof frame.frame_order === "number" ? frame.frame_order : index,
                    label: `镜头 ${typeof frame.frame_order === "number" ? frame.frame_order + 1 : index + 1}`,
                    videoId: selectedVideo.id,
                    videoUrl: getAssetUrl(selectedVideo.video_url),
                    thumbnailUrl: getAssetUrl(frame.rendered_image_url || frame.image_url),
                    sourceDuration,
                    trimStart: 0,
                    trimEnd: sourceDuration,
                    dialogue: frame.dialogue || "",
                    hasDialogue: Boolean(frame.audio_url),
                    hasSfx: Boolean(frame.sfx_url),
                    sfxLabel: frame.action_description ? `音效：${frame.action_description.slice(0, 14)}...` : "音效",
                } satisfies EditableClip;
            })
            .filter((clip): clip is EditableClip => Boolean(clip));

        const savedTimeline = currentProject?.final_mix_timeline?.clips || [];
        if (savedTimeline.length === 0) {
            return baseClips;
        }

        const baseClipMap = new Map(baseClips.map((clip) => [`${clip.frameId}:${clip.videoId}`, clip]));
        const restoredClips = savedTimeline
            .slice()
            .sort((a, b) => a.clip_order - b.clip_order)
            .map((savedClip) => {
                const baseClip = baseClipMap.get(`${savedClip.frame_id}:${savedClip.video_id}`);
                if (!baseClip) {
                    return null;
                }
                const trimStart = Math.max(0, Math.min(savedClip.trim_start, baseClip.sourceDuration - 0.1));
                const trimEnd = Math.max(trimStart + 0.1, Math.min(savedClip.trim_end, baseClip.sourceDuration));
                return {
                    ...baseClip,
                    trimStart,
                    trimEnd,
                };
            })
            .filter((clip): clip is EditableClip => Boolean(clip));

        const restoredIds = new Set(restoredClips.map((clip) => clip.id));
        const appendedClips = baseClips.filter((clip) => !restoredIds.has(clip.id));
        return [...restoredClips, ...appendedClips];
    }, [currentProject?.final_mix_timeline?.clips, frames, selectedVideos]);

    useEffect(() => {
        setClips((previousClips) => {
            if (previousClips.length === 0) {
                return initialClips;
            }

            // 项目数据刷新后尽量保留用户的本地裁切和重排结果，只更新仍然存在的片段基础信息。
            const previousMap = new Map(previousClips.map((clip) => [clip.id, clip]));
            const merged = initialClips.map((clip) => {
                const previous = previousMap.get(clip.id);
                if (!previous) {
                    return clip;
                }

                const safeTrimStart = Math.min(previous.trimStart, clip.sourceDuration);
                const safeTrimEnd = Math.max(safeTrimStart + 0.1, Math.min(previous.trimEnd, clip.sourceDuration));
                return {
                    ...clip,
                    trimStart: safeTrimStart,
                    trimEnd: safeTrimEnd,
                };
            });

            const preservedOrder = previousClips
                .map((clip) => merged.find((candidate) => candidate.id === clip.id))
                .filter((clip): clip is EditableClip => Boolean(clip));
            const appended = merged.filter((clip) => !preservedOrder.some((candidate) => candidate.id === clip.id));
            return [...preservedOrder, ...appended];
        });
    }, [initialClips]);

    useEffect(() => {
        if (!selectedClipId || clips.some((clip) => clip.id === selectedClipId)) {
            return;
        }
        setSelectedClipId(clips[0]?.id || null);
    }, [clips, selectedClipId]);

    useEffect(() => {
        if (!selectedClipId && clips.length > 0) {
            setSelectedClipId(clips[0].id);
        }
    }, [clips, selectedClipId]);

    const clipDurations = useMemo(() => clips.map((clip) => Math.max(clip.trimEnd - clip.trimStart, 0.1)), [clips]);
    const totalDuration = useMemo(() => clipDurations.reduce((sum, duration) => sum + duration, 0), [clipDurations]);

    const resolveClipAtTime = (time: number) => {
        if (clips.length === 0) {
            return { clipIndex: -1, clip: null as EditableClip | null, clipStartTime: 0, localClipTime: 0 };
        }

        const boundedTime = Math.max(0, Math.min(time, totalDuration));
        let elapsed = 0;
        for (let index = 0; index < clips.length; index += 1) {
            const clipDuration = clipDurations[index];
            const nextElapsed = elapsed + clipDuration;
            // 时间正好落在片段分界点时，应归属下一个片段，才能保证镜头尾部自动顺播。
            const isWithinCurrentClip = boundedTime < nextElapsed || index === clips.length - 1;
            if (isWithinCurrentClip) {
                return {
                    clipIndex: index,
                    clip: clips[index],
                    clipStartTime: elapsed,
                    localClipTime: Math.max(0, Math.min(boundedTime - elapsed, clipDuration)),
                };
            }
            elapsed = nextElapsed;
        }

        return { clipIndex: clips.length - 1, clip: clips[clips.length - 1], clipStartTime: elapsed, localClipTime: 0 };
    };

    const activeClipInfo = useMemo(() => resolveClipAtTime(currentTime), [clips, clipDurations, currentTime]);
    const activeClip = activeClipInfo.clip;

    useEffect(() => {
        if (clips.length === 0) {
            setCurrentTime(0);
            setIsPlaying(false);
            return;
        }
        if (currentTime > totalDuration) {
            setCurrentTime(totalDuration);
        }
    }, [clips.length, currentTime, totalDuration]);

    // 右侧编辑器的选中态和中间播放器的活跃片段分开管理，避免播放进度推进时把用户手动选中的片段冲掉。
    const selectedClip = useMemo(() => clips.find((clip) => clip.id === selectedClipId) || null, [clips, selectedClipId]);

    const currentPreviewUrl = activeClip?.videoUrl || "";

    const seekTimeline = (nextTime: number, autoPlayAfterSeek = false) => {
        if (clips.length === 0 || totalDuration <= 0) {
            setCurrentTime(0);
            return;
        }

        const boundedTime = Math.max(0, Math.min(nextTime, totalDuration));
        const nextClipInfo = resolveClipAtTime(boundedTime);
        if (!nextClipInfo.clip) {
            setCurrentTime(0);
            return;
        }

        const nextVideoTime = nextClipInfo.clip.trimStart + nextClipInfo.localClipTime;
        setCurrentTime(boundedTime);
        setSelectedClipId(nextClipInfo.clip.id);
        shouldResumeAfterSeekRef.current = autoPlayAfterSeek;
        playIntentRef.current = autoPlayAfterSeek;

        const player = videoRef.current;
        if (player && normalizeVideoSource(player.currentSrc || player.src) === normalizeVideoSource(nextClipInfo.clip.videoUrl)) {
            player.currentTime = nextVideoTime;
            if (autoPlayAfterSeek) {
                void player.play().catch((error) => {
                    console.error("Failed to resume final mix playback:", error);
                });
            }
            return;
        }

        pendingSeekRef.current = nextVideoTime;
    };

    useEffect(() => {
        const player = videoRef.current;
        if (!player) {
            return;
        }

        const handleLoadedMetadata = () => {
            const pendingTime = pendingSeekRef.current;
            if (pendingTime != null) {
                player.currentTime = Math.max(0, Math.min(pendingTime, Number.isFinite(player.duration) ? player.duration : pendingTime));
                pendingSeekRef.current = null;
            } else if (activeClip) {
                player.currentTime = Math.max(0, Math.min(activeClip.trimStart, Number.isFinite(player.duration) ? player.duration : activeClip.trimStart));
            }

            if (shouldResumeAfterSeekRef.current) {
                shouldResumeAfterSeekRef.current = false;
                void player.play().catch((error) => {
                    console.error("Failed to continue final mix playback:", error);
                });
            }
        };

        const handleTimeUpdate = () => {
            if (!activeClip || isScrubbing) {
                return;
            }

            const localPlayableTime = Math.max(0, player.currentTime - activeClip.trimStart);
            const boundedLocalTime = Math.min(localPlayableTime, Math.max(activeClip.trimEnd - activeClip.trimStart, 0.1));
            setCurrentTime(activeClipInfo.clipStartTime + boundedLocalTime);

            // 当前片段播放到裁切出点后，自动切到下一片段，形成真正的时间轴连播。
            if (player.currentTime >= activeClip.trimEnd - 0.02) {
                if (activeClipInfo.clipIndex < clips.length - 1) {
                    seekTimeline(
                        activeClipInfo.clipStartTime + Math.max(activeClip.trimEnd - activeClip.trimStart, 0.1),
                        playIntentRef.current
                    );
                } else {
                    playIntentRef.current = false;
                    player.pause();
                    setIsPlaying(false);
                    setCurrentTime(totalDuration);
                }
            }
        };

        const handlePlay = () => {
            playIntentRef.current = true;
            setIsPlaying(true);
        };
        const handlePause = () => {
            setIsPlaying(false);
        };
        const handleEnded = () => {
            if (activeClipInfo.clipIndex < clips.length - 1) {
                const nextClipStartTime = clipDurations
                    .slice(0, activeClipInfo.clipIndex + 1)
                    .reduce((sum, item) => sum + item, 0);
                seekTimeline(nextClipStartTime, true);
            } else {
                playIntentRef.current = false;
                setIsPlaying(false);
                setCurrentTime(totalDuration);
            }
        };

        player.addEventListener("loadedmetadata", handleLoadedMetadata);
        player.addEventListener("timeupdate", handleTimeUpdate);
        player.addEventListener("play", handlePlay);
        player.addEventListener("pause", handlePause);
        player.addEventListener("ended", handleEnded);

        return () => {
            player.removeEventListener("loadedmetadata", handleLoadedMetadata);
            player.removeEventListener("timeupdate", handleTimeUpdate);
            player.removeEventListener("play", handlePlay);
            player.removeEventListener("pause", handlePause);
            player.removeEventListener("ended", handleEnded);
        };
    }, [activeClip, activeClipInfo.clipIndex, activeClipInfo.clipStartTime, clipDurations, clips.length, isPlaying, isScrubbing, totalDuration]);

    useEffect(() => {
        const player = videoRef.current;
        if (!player || !activeClip) {
            lastLoadedClipIdRef.current = null;
            return;
        }

        const nextSeekTime = activeClip.trimStart + activeClipInfo.localClipTime;
        const isSwitchingSourceClip = lastLoadedClipIdRef.current !== activeClip.id;
        if (isSwitchingSourceClip) {
            // 只有真正切片段时才重载 video，避免普通拖动时间轴时反复回到开头。
            player.pause();
            pendingSeekRef.current = nextSeekTime;
            lastLoadedClipIdRef.current = activeClip.id;
            player.load();
            return;
        }

        // 同一片段内的 seek 直接调 currentTime，不触发 load，保证播放和拖动稳定。
        const boundedTime = Math.max(
            activeClip.trimStart,
            Math.min(nextSeekTime, Number.isFinite(player.duration) ? player.duration : activeClip.trimEnd)
        );
        if (Math.abs(player.currentTime - boundedTime) > 0.05) {
            player.currentTime = boundedTime;
        }
    }, [activeClip?.id, activeClip?.trimEnd, activeClip?.trimStart, activeClipInfo.localClipTime]);

    useEffect(() => {
        if (!isScrubbing) {
            return;
        }

        const handlePointerUp = () => setIsScrubbing(false);
        window.addEventListener("pointerup", handlePointerUp);
        return () => window.removeEventListener("pointerup", handlePointerUp);
    }, [isScrubbing]);

    const updateClipTrim = (clipId: string, patch: Partial<Pick<EditableClip, "trimStart" | "trimEnd">>) => {
        setClips((previous) =>
            previous.map((clip) => {
                if (clip.id !== clipId) {
                    return clip;
                }

                const nextTrimStart = patch.trimStart ?? clip.trimStart;
                const nextTrimEnd = patch.trimEnd ?? clip.trimEnd;
                const safeTrimStart = Math.max(0, Math.min(nextTrimStart, clip.sourceDuration - 0.1));
                const safeTrimEnd = Math.max(safeTrimStart + 0.1, Math.min(nextTrimEnd, clip.sourceDuration));
                return {
                    ...clip,
                    trimStart: safeTrimStart,
                    trimEnd: safeTrimEnd,
                };
            })
        );
    };

    const reorderClips = (fromClipId: string, toClipId: string) => {
        if (fromClipId === toClipId) {
            return;
        }

        setClips((previous) => {
            const next = [...previous];
            const fromIndex = next.findIndex((clip) => clip.id === fromClipId);
            const toIndex = next.findIndex((clip) => clip.id === toClipId);
            if (fromIndex < 0 || toIndex < 0) {
                return previous;
            }

            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            return next;
        });
    };

    const togglePlayback = async () => {
        const player = videoRef.current;
        if (!player || !activeClip) {
            return;
        }

        if (player.paused) {
            playIntentRef.current = true;
            shouldResumeAfterSeekRef.current = false;
            try {
                await player.play();
            } catch (error) {
                console.error("Failed to play final mix preview:", error);
            }
            return;
        }

        playIntentRef.current = false;
        player.pause();
    };

    const seekFromClientX = (clientX: number, autoPlayAfterSeek = false) => {
        const timeline = timelineRef.current;
        if (!timeline || totalDuration <= 0) {
            return;
        }

        // 左侧轨道标题列不参与播放头定位，避免点击标题区时跳时码。
        const rect = timeline.getBoundingClientRect();
        const rawX = clientX - rect.left + timeline.scrollLeft - TRACK_LABEL_WIDTH;
        const playableWidth = Math.max(timeline.scrollWidth - TRACK_LABEL_WIDTH, 1);
        const boundedX = Math.max(0, Math.min(rawX, playableWidth));
        const nextTime = (boundedX / playableWidth) * totalDuration;
        seekTimeline(nextTime, autoPlayAfterSeek);
    };

    const formatTime = (seconds: number) => {
        if (!Number.isFinite(seconds) || seconds < 0) {
            return "0:00";
        }
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    const playheadLeftPx = useMemo(() => {
        const timelineWidth = timelineRef.current?.scrollWidth || 0;
        const playableWidth = Math.max(timelineWidth - TRACK_LABEL_WIDTH, 0);
        return TRACK_LABEL_WIDTH + (totalDuration > 0 ? (currentTime / totalDuration) * playableWidth : 0);
    }, [currentTime, totalDuration]);

    const totalClipCount = clips.length;

    useEffect(() => {
        if (!currentProject) {
            return;
        }

        const nextTimeline = {
            clips: clips.map((clip, index) => ({
                frame_id: clip.frameId,
                video_id: clip.videoId,
                clip_order: index,
                trim_start: Number(clip.trimStart.toFixed(3)),
                trim_end: Number(clip.trimEnd.toFixed(3)),
            })),
        };

        const existingTimeline = currentProject.final_mix_timeline || { clips: [] };
        const nextSerialized = JSON.stringify(nextTimeline);
        const existingSerialized = JSON.stringify(existingTimeline);
        if (nextSerialized === existingSerialized) {
            return;
        }

        // Final Mix 草稿先持久化到前端项目状态，供 Assembly/Export 请求直接带给后端执行。
        updateProject(currentProject.id, {
            final_mix_timeline: nextTimeline,
            merged_video_url: undefined,
        });
    }, [clips, currentProject?.id, updateProject]);

    return (
        <div className="flex flex-col h-full text-white">
            <div className="flex-1 flex border-b border-white/10 min-h-0">
                <div className="flex-1 bg-black/80 flex items-center justify-center relative p-8">
                    <div className="aspect-video bg-black/20 border border-white/10 rounded-lg w-full max-w-4xl flex items-center justify-center relative overflow-hidden shadow-2xl">
                        {currentPreviewUrl ? (
                            <video
                                ref={videoRef}
                                src={currentPreviewUrl}
                                className="w-full h-full object-contain bg-black"
                                playsInline
                                preload="metadata"
                            />
                        ) : (
                            <div className="text-gray-500 flex flex-col items-center gap-4 px-8 text-center">
                                <AlertTriangle size={48} className="opacity-30" />
                                <div className="space-y-1">
                                    <div className="font-medium text-white/70">暂无可编辑片段</div>
                                    <div className="text-sm text-white/40">
                                        先在“视频组装”中为每一帧选择视频，再来这里做重排和裁切。
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="absolute inset-x-0 bottom-0 p-4 flex items-end justify-between bg-gradient-to-t from-black/70 via-black/10 to-transparent pointer-events-none">
                            <div className="bg-black/50 px-3 py-1 rounded text-xs backdrop-blur-sm">
                                {activeClip?.label || "暂无片段"}
                            </div>
                            <div className="bg-black/50 px-3 py-1 rounded text-xs backdrop-blur-sm font-mono">
                                {formatTime(currentTime)} / {formatTime(totalDuration)}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="w-96 bg-black/20 border-l border-white/10 flex flex-col">
                    <div className="p-4 border-b border-white/10">
                        <h3 className="font-display font-bold text-sm flex items-center gap-2">
                            <Scissors size={16} className="text-primary" /> 片段编辑
                            <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30 font-medium ml-2">预览草稿</span>
                        </h3>
                        <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                            当前可进行片段重排和入出点裁切，供预览检查使用；导出链路暂未接入这些编辑参数。
                        </p>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-3">
                        {clips.length === 0 ? (
                            <div className="text-sm text-gray-500 text-center py-10">暂无已选片段</div>
                        ) : (
                            clips.map((clip, index) => {
                                const clipDuration = Math.max(clip.trimEnd - clip.trimStart, 0.1);
                                const isSelected = clip.id === selectedClip?.id;
                                return (
                                    <div
                                        key={clip.id}
                                        draggable
                                        onDragStart={() => setDraggingClipId(clip.id)}
                                        onDragOver={(event) => event.preventDefault()}
                                        onDrop={() => {
                                            if (draggingClipId) {
                                                reorderClips(draggingClipId, clip.id);
                                            }
                                            setDraggingClipId(null);
                                        }}
                                        onDragEnd={() => setDraggingClipId(null)}
                                        onClick={() => setSelectedClipId(clip.id)}
                                        className={`rounded-xl border p-3 cursor-pointer transition-all ${isSelected ? "border-primary bg-primary/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="text-gray-500">
                                                <GripVertical size={16} />
                                            </div>
                                            <div className="w-20 aspect-video rounded overflow-hidden bg-black/40 border border-white/10">
                                                {clip.thumbnailUrl ? <img src={clip.thumbnailUrl} className="w-full h-full object-cover" /> : null}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-sm font-semibold text-white truncate">{clip.label}</span>
                                                    <span className="text-[10px] text-gray-400 font-mono">{formatTime(clipDuration)}</span>
                                                </div>
                                                <div className="text-[11px] text-gray-500 mt-1">
                                                    顺序 {index + 1} · 入点 {formatTime(clip.trimStart)} · 出点 {formatTime(clip.trimEnd)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    <div className="border-t border-white/10 p-4 space-y-4">
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-semibold text-white">裁切</h4>
                            <div className="text-[11px] text-gray-500">{selectedClip ? selectedClip.label : "请选择片段"}</div>
                        </div>

                        {selectedClip ? (
                            <>
                                <div className="space-y-2">
                                    <div className="flex justify-between text-xs text-gray-400">
                                        <span>入点</span>
                                        <span>{formatTime(selectedClip.trimStart)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0"
                                        max={Math.max(selectedClip.sourceDuration - 0.1, 0.1)}
                                        step="0.1"
                                        value={selectedClip.trimStart}
                                        onChange={(event) => updateClipTrim(selectedClip.id, { trimStart: Number(event.target.value) })}
                                        className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <div className="flex justify-between text-xs text-gray-400">
                                        <span>出点</span>
                                        <span>{formatTime(selectedClip.trimEnd)}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min={Math.min(selectedClip.trimStart + 0.1, selectedClip.sourceDuration)}
                                        max={selectedClip.sourceDuration}
                                        step="0.1"
                                        value={selectedClip.trimEnd}
                                        onChange={(event) => updateClipTrim(selectedClip.id, { trimEnd: Number(event.target.value) })}
                                        className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-3 text-xs">
                                    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                        <div className="text-gray-500">原始时长</div>
                                        <div className="text-white font-mono mt-1">{formatTime(selectedClip.sourceDuration)}</div>
                                    </div>
                                    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                                        <div className="text-gray-500">可播放时长</div>
                                        <div className="text-white font-mono mt-1">{formatTime(Math.max(selectedClip.trimEnd - selectedClip.trimStart, 0.1))}</div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="text-xs text-gray-500">请先在右侧列表中选择一个片段进行裁切。</div>
                        )}
                    </div>

                    <div className="border-t border-white/10 p-4 space-y-3">
                        <h4 className="text-sm font-semibold flex items-center gap-2">
                            <Sliders size={14} className="text-primary" /> 音频混合
                        </h4>

                        {[
                            { id: "video", label: "视频原声", icon: <Video size={14} /> },
                            { id: "voice", label: "对白", icon: <Mic size={14} /> },
                            { id: "sfx", label: "音效", icon: <Volume2 size={14} /> },
                            { id: "bgm", label: "背景音乐", icon: <Music size={14} /> },
                        ].map((track) => (
                            <div key={track.id} className="space-y-2">
                                <div className="flex justify-between text-xs text-gray-400">
                                    <span className="flex items-center gap-2">{track.icon} {track.label}</span>
                                    <span>{Math.round(volumes[track.id as keyof typeof volumes] * 100)}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={volumes[track.id as keyof typeof volumes]}
                                    onChange={(event) => setVolumes((previous) => ({ ...previous, [track.id]: parseFloat(event.target.value) }))}
                                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="h-72 bg-black/10 border-t border-white/10 flex flex-col">
                <div className="h-10 border-b border-white/5 flex items-center px-4 justify-between bg-black/20">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={togglePlayback}
                            disabled={!activeClip}
                            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                        <span className="font-mono text-xs text-gray-400 ml-2">
                            {formatTime(currentTime)} / {formatTime(totalDuration)}
                        </span>
                        <span className="text-xs text-gray-500 ml-3">{totalClipCount} 个片段</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setZoom(Math.max(0.5, zoom - 0.1))} className="text-gray-500 hover:text-white">-</button>
                        <span className="text-xs text-gray-500">缩放</span>
                        <button onClick={() => setZoom(Math.min(2, zoom + 0.1))} className="text-gray-500 hover:text-white">+</button>
                    </div>
                </div>

                <div
                    ref={timelineRef}
                    className="flex-1 overflow-x-auto overflow-y-hidden relative custom-scrollbar cursor-pointer select-none"
                    onClick={(event) => {
                        if (isScrubbing) {
                            return;
                        }
                        seekFromClientX(event.clientX, playIntentRef.current);
                    }}
                    onPointerDown={(event) => {
                        setIsScrubbing(true);
                        seekFromClientX(event.clientX, playIntentRef.current);
                    }}
                    onPointerMove={(event) => {
                        if (!isScrubbing) {
                            return;
                        }
                        seekFromClientX(event.clientX, playIntentRef.current);
                    }}
                >
                    <div className="absolute top-0 bottom-0 w-px bg-red-500 z-20 pointer-events-none" style={{ left: `${playheadLeftPx}px` }} />

                    <div className="min-w-full h-full flex flex-col" style={{ width: `${100 * zoom}%` }}>
                        <div className="h-16 border-b border-white/5 bg-white/[0.03] relative flex items-center px-2">
                            <div className="absolute left-0 top-0 bottom-0 w-28 bg-white/5 z-10 flex items-center justify-center border-r border-white/5 text-xs font-bold text-gray-500">
                                视频
                            </div>
                            <div className="ml-28 flex-1 flex gap-1 h-12">
                                {clips.map((clip) => (
                                    <div
                                        key={clip.id}
                                        className={`rounded overflow-hidden relative border transition-all ${clip.id === activeClip?.id ? "border-primary bg-primary/20" : "border-blue-500/30 bg-blue-900/30"}`}
                                        style={{ width: `${(Math.max(clip.trimEnd - clip.trimStart, 0.1) / Math.max(totalDuration, 0.1)) * 100}%` }}
                                    >
                                        {clip.thumbnailUrl ? <img src={clip.thumbnailUrl} className="w-full h-full object-cover opacity-50" /> : null}
                                        <div className="absolute inset-x-0 top-0 h-1 bg-primary/50" />
                                        <div className="absolute inset-x-0 bottom-0 h-1 bg-cyan-400/50" />
                                        <div className="absolute bottom-1 left-1 text-[10px] text-blue-100">{clip.label}</div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="h-12 border-b border-white/5 bg-white/[0.03] relative flex items-center px-2">
                            <div className="absolute left-0 top-0 bottom-0 w-28 bg-white/5 z-10 flex items-center justify-center border-r border-white/5 text-xs font-bold text-gray-500">
                                对白
                            </div>
                            <div className="ml-28 flex-1 flex gap-1 h-8">
                                {clips.map((clip) => (
                                    <div key={clip.id} className="relative" style={{ width: `${(Math.max(clip.trimEnd - clip.trimStart, 0.1) / Math.max(totalDuration, 0.1)) * 100}%` }}>
                                        {clip.hasDialogue ? (
                                            <div className="absolute inset-x-1 inset-y-1 bg-green-900/40 border border-green-500/40 rounded flex items-center justify-center">
                                                <div className="w-full h-full flex items-center gap-0.5 px-2 overflow-hidden">
                                                    {Array.from({ length: 10 }).map((_, index) => (
                                                        <div key={index} className="w-1 bg-green-500/50 rounded-full" style={{ height: `${35 + ((index * 11) % 60)}%` }} />
                                                    ))}
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="h-12 border-b border-white/5 bg-white/[0.03] relative flex items-center px-2">
                            <div className="absolute left-0 top-0 bottom-0 w-28 bg-white/5 z-10 flex items-center justify-center border-r border-white/5 text-xs font-bold text-gray-500">
                                音效
                            </div>
                            <div className="ml-28 flex-1 flex gap-1 h-8">
                                {clips.map((clip) => (
                                    <div key={clip.id} className="relative" style={{ width: `${(Math.max(clip.trimEnd - clip.trimStart, 0.1) / Math.max(totalDuration, 0.1)) * 100}%` }}>
                                        {clip.hasSfx ? (
                                            <div className="absolute inset-x-1 inset-y-1 bg-yellow-900/40 border border-yellow-500/40 rounded flex items-center justify-center">
                                                <span className="text-[9px] text-yellow-500 truncate px-1">{clip.sfxLabel}</span>
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="h-12 border-b border-white/5 bg-white/[0.03] relative flex items-center px-2">
                            <div className="absolute left-0 top-0 bottom-0 w-28 bg-white/5 z-10 flex items-center justify-center border-r border-white/5 text-xs font-bold text-gray-500">
                                BGM
                            </div>
                            <div className="ml-28 flex-1 h-8 relative">
                                {clips.length > 0 ? (
                                    <div className="absolute left-0 right-0 top-1 bottom-1 bg-purple-900/40 border border-purple-500/40 rounded mx-1 flex items-center px-4">
                                        <Music size={12} className="text-purple-400 mr-2" />
                                        <span className="text-[10px] text-purple-300">电影感氛围背景音乐</span>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
