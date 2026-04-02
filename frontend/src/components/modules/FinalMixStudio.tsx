import { useEffect, useMemo, useRef, useState } from "react";
import {
    AlertTriangle,
    CheckCircle2,
    Eye,
    EyeOff,
    GripVertical,
    Loader2,
    Mic,
    Music,
    Pause,
    Play,
    Scissors,
    Sliders,
    Video,
    Volume2,
} from "lucide-react";
import { api, type ProjectTimeline, type TimelineClip, type TimelineTrackType } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";
import { getAssetUrl } from "@/lib/utils";

type EditableVideoClip = {
    id: string;
    assetId: string;
    trackId: string;
    frameId: string;
    frameOrder: number;
    label: string;
    videoId: string;
    videoUrl: string;
    thumbnailUrl: string;
    sourceDuration: number;
    trimStart: number;
    trimEnd: number;
};

type AudioLaneClip = {
    id: string;
    assetId: string;
    trackId: string;
    trackType: "dialogue" | "sfx" | "bgm";
    label: string;
    timelineStart: number;
    sourceStart: number;
    sourceEnd: number;
    sourceDuration: number;
    duration: number;
    volume: number;
    fadeInDuration: number;
    fadeOutDuration: number;
    waveformPeaks: number[];
};

type AudioDragState = {
    clipId: string;
    startClientX: number;
    originTimelineStart: number;
};

const TRACK_LABEL_WIDTH = 136;
const DEFAULT_WAVEFORM_BARS = 28;

const TRACK_STYLE_MAP: Record<
    TimelineTrackType,
    {
        label: string;
        shortLabel: string;
        icon: JSX.Element;
        chipTone: string;
        railTone: string;
        blockTone: string;
        waveformTone: string;
        accentTone: string;
    }
> = {
    video: {
        label: "视频母带",
        shortLabel: "VID",
        icon: <Video size={14} />,
        chipTone: "border-cyan-400/30 bg-cyan-400/10 text-cyan-100",
        railTone: "from-cyan-950/60 via-slate-950/90 to-slate-950/95",
        blockTone: "border-cyan-400/25 bg-cyan-500/15 text-cyan-50 shadow-[0_12px_28px_rgba(22,78,99,0.24)]",
        waveformTone: "bg-cyan-100/35",
        accentTone: "bg-cyan-300/80",
    },
    dialogue: {
        label: "对白主轨",
        shortLabel: "VOX",
        icon: <Mic size={14} />,
        chipTone: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
        railTone: "from-emerald-950/50 via-slate-950/90 to-slate-950/95",
        blockTone: "border-emerald-400/25 bg-emerald-500/15 text-emerald-50 shadow-[0_12px_28px_rgba(6,78,59,0.24)]",
        waveformTone: "bg-emerald-100/35",
        accentTone: "bg-emerald-300/80",
    },
    sfx: {
        label: "音效设计",
        shortLabel: "SFX",
        icon: <Volume2 size={14} />,
        chipTone: "border-amber-400/30 bg-amber-400/10 text-amber-100",
        railTone: "from-amber-950/40 via-slate-950/90 to-slate-950/95",
        blockTone: "border-amber-400/25 bg-amber-500/15 text-amber-50 shadow-[0_12px_28px_rgba(120,53,15,0.24)]",
        waveformTone: "bg-amber-100/35",
        accentTone: "bg-amber-300/80",
    },
    bgm: {
        label: "音乐总线",
        shortLabel: "BGM",
        icon: <Music size={14} />,
        chipTone: "border-rose-400/30 bg-rose-400/10 text-rose-100",
        railTone: "from-rose-950/40 via-slate-950/90 to-slate-950/95",
        blockTone: "border-rose-400/25 bg-rose-500/15 text-rose-50 shadow-[0_12px_28px_rgba(136,19,55,0.24)]",
        waveformTone: "bg-rose-100/35",
        accentTone: "bg-rose-300/80",
    },
};

const buildWaveformBars = (seed: string, count = DEFAULT_WAVEFORM_BARS) => {
    const source = seed || "audio";
    return Array.from({ length: count }, (_, index) => {
        const code = source.charCodeAt(index % source.length) || 71;
        return Math.max(18, ((code * (index + 5)) % 72) + 16);
    });
};

const normalizeWaveformPeaks = (peaks: unknown, fallbackSeed: string, count = DEFAULT_WAVEFORM_BARS) => {
    if (!Array.isArray(peaks) || peaks.length === 0) {
        return buildWaveformBars(fallbackSeed, count).map((value) => Number((value / 100).toFixed(4)));
    }
    const numericPeaks = peaks
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .map((value) => Math.max(0, Math.min(value, 1)));
    if (numericPeaks.length === 0) {
        return buildWaveformBars(fallbackSeed, count).map((value) => Number((value / 100).toFixed(4)));
    }
    return numericPeaks;
};

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

const serializeTimelineLayout = (timeline: Pick<ProjectTimeline, "tracks" | "assets" | "clips"> | null) => {
    if (!timeline) {
        return "";
    }
    return JSON.stringify({
        tracks: timeline.tracks,
        assets: timeline.assets,
        clips: timeline.clips,
    });
};

const buildFinalMixDraft = (timeline: ProjectTimeline) => {
    const videoTrackIds = new Set(timeline.tracks.filter((track) => track.track_type === "video").map((track) => track.id));
    const assetById = new Map(timeline.assets.map((asset) => [asset.id, asset]));
    return {
        clips: timeline.clips
            .filter((clip) => videoTrackIds.has(clip.track_id))
            .map((clip) => {
                const asset = assetById.get(clip.asset_id);
                const frameId = asset?.frame_id || clip.metadata?.frame_id;
                const videoId = asset?.video_task_id || clip.metadata?.video_task_id;
                if (!frameId || !videoId) {
                    return null;
                }
                return {
                    frame_id: frameId,
                    video_id: videoId,
                    clip_order: clip.clip_order,
                    trim_start: Number((clip.source_start || 0).toFixed(3)),
                    trim_end: Number((clip.source_end || 0).toFixed(3)),
                };
            })
            .filter((clip): clip is { frame_id: string; video_id: string; clip_order: number; trim_start: number; trim_end: number } => clip !== null),
    };
};

const buildEditableVideoClips = (timeline: ProjectTimeline, currentProject: any): EditableVideoClip[] => {
    const assetById = new Map(timeline.assets.map((asset) => [asset.id, asset]));
    const frameById = new Map((currentProject?.frames || []).map((frame: any) => [frame.id, frame]));
    const videoById = new Map((currentProject?.video_tasks || []).map((task: any) => [task.id, task]));
    const videoTrackIds = new Set(timeline.tracks.filter((track) => track.track_type === "video").map((track) => track.id));

    return timeline.clips
        .filter((clip) => videoTrackIds.has(clip.track_id))
        .slice()
        .sort((a, b) => a.clip_order - b.clip_order || a.timeline_start - b.timeline_start || a.id.localeCompare(b.id))
        .map((clip, index) => {
            const asset = assetById.get(clip.asset_id);
            if (!asset) {
                return null;
            }
            const frame = frameById.get(asset.frame_id || clip.metadata?.frame_id) as any;
            const sourceDuration = Math.max(
                Number(asset.source_duration || (videoById.get(asset.video_task_id || "") as any)?.duration || clip.source_end || 5),
                0.1,
            );
            return {
                id: clip.id,
                assetId: clip.asset_id,
                trackId: clip.track_id,
                frameId: asset.frame_id || clip.metadata?.frame_id || "",
                frameOrder: typeof frame?.frame_order === "number" ? frame.frame_order : index,
                label: asset.label || `镜头 ${index + 1}`,
                videoId: asset.video_task_id || clip.metadata?.video_task_id || "",
                videoUrl: getAssetUrl(asset.source_url),
                thumbnailUrl: getAssetUrl(frame?.rendered_image_url || frame?.image_url || ""),
                sourceDuration,
                trimStart: Number(clip.source_start || 0),
                trimEnd: Number(clip.source_end || sourceDuration),
            } satisfies EditableVideoClip;
        })
        .filter((clip): clip is EditableVideoClip => clip !== null);
};

const buildAudioLaneClips = (timeline: ProjectTimeline): AudioLaneClip[] => {
    const assetById = new Map(timeline.assets.map((asset) => [asset.id, asset]));
    const trackById = new Map(timeline.tracks.map((track) => [track.id, track]));

    return timeline.clips
        .filter((clip) => {
            const trackType = trackById.get(clip.track_id)?.track_type;
            return trackType === "dialogue" || trackType === "sfx" || trackType === "bgm";
        })
        .slice()
        .sort((a, b) => a.timeline_start - b.timeline_start || a.clip_order - b.clip_order || a.id.localeCompare(b.id))
        .map((clip) => {
            const asset = assetById.get(clip.asset_id);
            const track = trackById.get(clip.track_id);
            const trackType = track?.track_type as AudioLaneClip["trackType"];
            const duration = Math.max(Number((clip.source_end || 0) - (clip.source_start || 0)), 0.1);
            return {
                id: clip.id,
                assetId: clip.asset_id,
                trackId: clip.track_id,
                trackType,
                label: asset?.label || "音频片段",
                timelineStart: Number(clip.timeline_start || 0),
                sourceStart: Number(clip.source_start || 0),
                sourceEnd: Number(clip.source_end || 0),
                sourceDuration: Math.max(Number(asset?.source_duration || clip.source_end || 5), 0.1),
                duration,
                volume: Number(clip.volume ?? 1),
                fadeInDuration: Number(clip.fade_in_duration || 0),
                fadeOutDuration: Number(clip.fade_out_duration || 0),
                waveformPeaks: normalizeWaveformPeaks(asset?.metadata?.waveform_peaks, `${clip.id}:${asset?.label || "audio"}`),
            } satisfies AudioLaneClip;
        });
};

const buildUpdatedTimelineFromState = (
    timeline: ProjectTimeline,
    editableClips: EditableVideoClip[],
    editableAudioClips: AudioLaneClip[],
): ProjectTimeline => {
    const assetById = new Map(timeline.assets.map((asset) => [asset.id, asset]));
    const clipById = new Map(timeline.clips.map((clip) => [clip.id, clip]));
    const videoTrackIds = new Set(timeline.tracks.filter((track) => track.track_type === "video").map((track) => track.id));
    const audioTrackIds = new Set(timeline.tracks.filter((track) => track.track_type !== "video").map((track) => track.id));

    let cursor = 0;
    const updatedVideoClips: TimelineClip[] = [];
    editableClips.forEach((editableClip, index) => {
        const baseClip = clipById.get(editableClip.id);
        const asset = assetById.get(editableClip.assetId);
        if (!baseClip || !asset) {
            return;
        }

        const sourceDuration = Math.max(Number(asset.source_duration || editableClip.sourceDuration || 0.1), 0.1);
        const safeTrimStart = Math.max(0, Math.min(editableClip.trimStart, sourceDuration - 0.1));
        const safeTrimEnd = Math.max(safeTrimStart + 0.1, Math.min(editableClip.trimEnd, sourceDuration));
        const clipDuration = safeTrimEnd - safeTrimStart;

        updatedVideoClips.push({
            ...baseClip,
            clip_order: index,
            timeline_start: Number(cursor.toFixed(3)),
            timeline_end: Number((cursor + clipDuration).toFixed(3)),
            source_start: Number(safeTrimStart.toFixed(3)),
            source_end: Number(safeTrimEnd.toFixed(3)),
            metadata: {
                ...(baseClip.metadata || {}),
                frame_id: editableClip.frameId,
                video_task_id: editableClip.videoId,
            },
        });
        cursor += clipDuration;
    });

    const updatedAudioClips: TimelineClip[] = editableAudioClips
        .map((editableClip) => {
            const baseClip = clipById.get(editableClip.id);
            const asset = assetById.get(editableClip.assetId);
            if (!baseClip || !asset) {
                return null;
            }

            const sourceDuration = Math.max(Number(asset.source_duration || editableClip.sourceDuration || 0.1), 0.1);
            const safeSourceStart = Math.max(0, Math.min(editableClip.sourceStart, sourceDuration - 0.1));
            const safeSourceEnd = Math.max(safeSourceStart + 0.1, Math.min(editableClip.sourceEnd, sourceDuration));
            const clipDuration = Math.max(safeSourceEnd - safeSourceStart, 0.1);
            const safeTimelineStart = Math.max(0, editableClip.timelineStart);
            const safeFadeIn = Math.max(0, Math.min(editableClip.fadeInDuration, Math.max(clipDuration - 0.01, 0)));
            const safeFadeOut = Math.max(0, Math.min(editableClip.fadeOutDuration, Math.max(clipDuration - safeFadeIn - 0.01, 0)));

            return {
                ...baseClip,
                timeline_start: Number(safeTimelineStart.toFixed(3)),
                timeline_end: Number((safeTimelineStart + clipDuration).toFixed(3)),
                source_start: Number(safeSourceStart.toFixed(3)),
                source_end: Number(safeSourceEnd.toFixed(3)),
                volume: Number(Math.max(0, Math.min(editableClip.volume, 2)).toFixed(3)),
                fade_in_duration: Number(safeFadeIn.toFixed(3)),
                fade_out_duration: Number(safeFadeOut.toFixed(3)),
            };
        })
        .filter((clip): clip is TimelineClip => clip !== null)
        .sort((a, b) => a.timeline_start - b.timeline_start || a.clip_order - b.clip_order || a.id.localeCompare(b.id))
        .map((clip, index) => ({
            ...clip,
            clip_order: index,
        }));

    const preservedClips = timeline.clips.filter((clip) => !videoTrackIds.has(clip.track_id) && !audioTrackIds.has(clip.track_id));
    return {
        ...timeline,
        clips: [...updatedVideoClips, ...updatedAudioClips, ...preservedClips],
    };
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
    const saveTimerRef = useRef<number | null>(null);
    const lastSavedLayoutRef = useRef("");
    const audioDragStateRef = useRef<AudioDragState | null>(null);

    const [timelineState, setTimelineState] = useState<ProjectTimeline | null>(null);
    const [clips, setClips] = useState<EditableVideoClip[]>([]);
    const [audioClips, setAudioClips] = useState<AudioLaneClip[]>([]);
    const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
    const [selectedAudioClipId, setSelectedAudioClipId] = useState<string | null>(null);
    const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
    const [draggingAudioClipId, setDraggingAudioClipId] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [isScrubbing, setIsScrubbing] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [isLoadingTimeline, setIsLoadingTimeline] = useState(false);
    const [timelineStatus, setTimelineStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
    const [timelineError, setTimelineError] = useState<string | null>(null);

    const selectedClip = useMemo(() => clips.find((clip) => clip.id === selectedClipId) || null, [clips, selectedClipId]);
    const selectedAudioClip = useMemo(() => audioClips.find((clip) => clip.id === selectedAudioClipId) || null, [audioClips, selectedAudioClipId]);

    const clipDurations = useMemo(() => clips.map((clip) => Math.max(clip.trimEnd - clip.trimStart, 0.1)), [clips]);
    const totalDuration = useMemo(() => clipDurations.reduce((sum, duration) => sum + duration, 0), [clipDurations]);
    const maxAudioEnd = useMemo(
        () => audioClips.reduce((max, clip) => Math.max(max, clip.timelineStart + clip.duration), 0),
        [audioClips]
    );
    const timelineDuration = Math.max(totalDuration, maxAudioEnd, 0.1);

    const trackByType = useMemo(() => {
        const map = {
            video: timelineState?.tracks.find((track) => track.track_type === "video") || null,
            dialogue: timelineState?.tracks.find((track) => track.track_type === "dialogue") || null,
            sfx: timelineState?.tracks.find((track) => track.track_type === "sfx") || null,
            bgm: timelineState?.tracks.find((track) => track.track_type === "bgm") || null,
        };
        return map;
    }, [timelineState?.tracks]);

    const resolveClipAtTime = (time: number) => {
        if (clips.length === 0) {
            return { clipIndex: -1, clip: null as EditableVideoClip | null, clipStartTime: 0, localClipTime: 0 };
        }

        const boundedTime = Math.max(0, Math.min(time, totalDuration));
        let elapsed = 0;
        for (let index = 0; index < clips.length; index += 1) {
            const clipDuration = clipDurations[index];
            const nextElapsed = elapsed + clipDuration;
            if (boundedTime < nextElapsed || index === clips.length - 1) {
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

    const activeClipInfo = useMemo(() => resolveClipAtTime(currentTime), [clips, clipDurations, currentTime, totalDuration]);
    const activeClip = activeClipInfo.clip;
    const currentPreviewUrl = activeClip?.videoUrl || "";

    useEffect(() => {
        if (!currentProject?.id) {
            setTimelineState(null);
            setClips([]);
            setAudioClips([]);
            setSelectedClipId(null);
            setSelectedAudioClipId(null);
            setTimelineError(null);
            setTimelineStatus("idle");
            return;
        }

        let cancelled = false;
        setIsLoadingTimeline(true);
        setTimelineError(null);

        api.getProjectTimeline(currentProject.id)
            .then((timeline) => {
                if (cancelled) {
                    return;
                }
                const nextClips = buildEditableVideoClips(timeline, currentProject);
                const nextAudioClips = buildAudioLaneClips(timeline);
                lastSavedLayoutRef.current = serializeTimelineLayout(timeline);
                setTimelineState(timeline);
                setClips(nextClips);
                setAudioClips(nextAudioClips);
                setSelectedClipId(nextClips[0]?.id || null);
                setSelectedAudioClipId(nextAudioClips[0]?.id || null);
                setTimelineStatus("idle");
                updateProject(currentProject.id, {
                    timeline,
                    final_mix_timeline: buildFinalMixDraft(timeline),
                });
            })
            .catch((error) => {
                if (cancelled) {
                    return;
                }
                console.error("Failed to load project timeline:", error);
                setTimelineError((error as Error)?.message || "加载时间轴失败");
                setTimelineStatus("error");
            })
            .finally(() => {
                if (!cancelled) {
                    setIsLoadingTimeline(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [currentProject?.id, updateProject]);

    useEffect(() => {
        return () => {
            if (saveTimerRef.current != null) {
                window.clearTimeout(saveTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!timelineState || !currentProject?.id) {
            return;
        }

        const nextTimeline = buildUpdatedTimelineFromState(timelineState, clips, audioClips);
        const nextSerialized = serializeTimelineLayout(nextTimeline);
        if (!nextSerialized || nextSerialized === lastSavedLayoutRef.current) {
            return;
        }

        if (saveTimerRef.current != null) {
            window.clearTimeout(saveTimerRef.current);
        }
        setTimelineStatus("saving");
        saveTimerRef.current = window.setTimeout(async () => {
            try {
                const savedTimeline = await api.updateProjectTimeline(currentProject.id, {
                    version: nextTimeline.version,
                    tracks: nextTimeline.tracks,
                    assets: nextTimeline.assets,
                    clips: nextTimeline.clips,
                });
                lastSavedLayoutRef.current = serializeTimelineLayout(savedTimeline);
                setTimelineState(savedTimeline);
                setClips(buildEditableVideoClips(savedTimeline, currentProject));
                setAudioClips(buildAudioLaneClips(savedTimeline));
                setTimelineStatus("saved");
                setTimelineError(null);
                updateProject(currentProject.id, {
                    timeline: savedTimeline,
                    final_mix_timeline: buildFinalMixDraft(savedTimeline),
                    merged_video_url: undefined,
                });
            } catch (error) {
                console.error("Failed to save project timeline:", error);
                setTimelineError((error as Error)?.message || "保存时间轴失败");
                setTimelineStatus("error");
            }
        }, 320);
    }, [audioClips, clips, currentProject, timelineState, updateProject]);

    useEffect(() => {
        if (!selectedClipId || clips.some((clip) => clip.id === selectedClipId)) {
            return;
        }
        setSelectedClipId(clips[0]?.id || null);
    }, [clips, selectedClipId]);

    useEffect(() => {
        if (!selectedAudioClipId || audioClips.some((clip) => clip.id === selectedAudioClipId)) {
            return;
        }
        setSelectedAudioClipId(audioClips[0]?.id || null);
    }, [audioClips, selectedAudioClipId]);

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

            if (player.currentTime >= activeClip.trimEnd - 0.02) {
                if (activeClipInfo.clipIndex < clips.length - 1) {
                    seekTimeline(activeClipInfo.clipStartTime + Math.max(activeClip.trimEnd - activeClip.trimStart, 0.1), playIntentRef.current);
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

        const handlePause = () => setIsPlaying(false);

        player.addEventListener("loadedmetadata", handleLoadedMetadata);
        player.addEventListener("timeupdate", handleTimeUpdate);
        player.addEventListener("play", handlePlay);
        player.addEventListener("pause", handlePause);

        return () => {
            player.removeEventListener("loadedmetadata", handleLoadedMetadata);
            player.removeEventListener("timeupdate", handleTimeUpdate);
            player.removeEventListener("play", handlePlay);
            player.removeEventListener("pause", handlePause);
        };
    }, [activeClip, activeClipInfo.clipIndex, activeClipInfo.clipStartTime, clips.length, isScrubbing, totalDuration]);

    useEffect(() => {
        const player = videoRef.current;
        if (!player || !activeClip) {
            lastLoadedClipIdRef.current = null;
            return;
        }

        const nextSeekTime = activeClip.trimStart + activeClipInfo.localClipTime;
        const isSwitchingSourceClip = lastLoadedClipIdRef.current !== activeClip.id;
        if (isSwitchingSourceClip) {
            player.pause();
            pendingSeekRef.current = nextSeekTime;
            lastLoadedClipIdRef.current = activeClip.id;
            player.load();
            return;
        }

        const boundedTime = Math.max(activeClip.trimStart, Math.min(nextSeekTime, Number.isFinite(player.duration) ? player.duration : activeClip.trimEnd));
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

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            const dragState = audioDragStateRef.current;
            const timeline = timelineRef.current;
            if (!dragState || !timeline || timelineDuration <= 0) {
                return;
            }

            const playableWidth = Math.max(timeline.scrollWidth - TRACK_LABEL_WIDTH, 1);
            const deltaX = event.clientX - dragState.startClientX;
            const deltaSeconds = (deltaX / playableWidth) * timelineDuration;
            const nextTimelineStart = Math.max(0, dragState.originTimelineStart + deltaSeconds);

            setAudioClips((previous) =>
                previous.map((clip) =>
                    clip.id === dragState.clipId ? { ...clip, timelineStart: Number(nextTimelineStart.toFixed(3)) } : clip
                )
            );
        };

        const handlePointerUp = () => {
            audioDragStateRef.current = null;
            setDraggingAudioClipId(null);
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
        };
    }, [timelineDuration]);

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

    const updateClipTrim = (clipId: string, patch: Partial<Pick<EditableVideoClip, "trimStart" | "trimEnd">>) => {
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

    const updateAudioClip = (
        clipId: string,
        patch: Partial<Pick<AudioLaneClip, "timelineStart" | "sourceStart" | "sourceEnd" | "volume" | "fadeInDuration" | "fadeOutDuration">>,
    ) => {
        setAudioClips((previous) =>
            previous.map((clip) => {
                if (clip.id !== clipId) {
                    return clip;
                }

                const nextSourceStart = patch.sourceStart ?? clip.sourceStart;
                const nextSourceEnd = patch.sourceEnd ?? clip.sourceEnd;
                const safeSourceStart = Math.max(0, Math.min(nextSourceStart, clip.sourceDuration - 0.1));
                const safeSourceEnd = Math.max(safeSourceStart + 0.1, Math.min(nextSourceEnd, clip.sourceDuration));
                const duration = Math.max(safeSourceEnd - safeSourceStart, 0.1);
                const safeFadeIn = Math.max(0, Math.min(patch.fadeInDuration ?? clip.fadeInDuration, Math.max(duration - 0.01, 0)));
                const safeFadeOut = Math.max(0, Math.min(patch.fadeOutDuration ?? clip.fadeOutDuration, Math.max(duration - safeFadeIn - 0.01, 0)));

                return {
                    ...clip,
                    timelineStart: patch.timelineStart != null ? Number(Math.max(0, patch.timelineStart).toFixed(3)) : clip.timelineStart,
                    sourceStart: Number(safeSourceStart.toFixed(3)),
                    sourceEnd: Number(safeSourceEnd.toFixed(3)),
                    duration: Number(duration.toFixed(3)),
                    volume: patch.volume != null ? Number(Math.max(0, Math.min(patch.volume, 2)).toFixed(3)) : clip.volume,
                    fadeInDuration: Number(safeFadeIn.toFixed(3)),
                    fadeOutDuration: Number(safeFadeOut.toFixed(3)),
                };
            })
        );
    };

    const startDraggingAudioClip = (clip: AudioLaneClip, clientX: number) => {
        audioDragStateRef.current = {
            clipId: clip.id,
            startClientX: clientX,
            originTimelineStart: clip.timelineStart,
        };
        setSelectedAudioClipId(clip.id);
        setDraggingAudioClipId(clip.id);
    };

    const updateTrack = (trackType: TimelineTrackType, patch: Record<string, unknown>) => {
        setTimelineState((previous) => {
            if (!previous) {
                return previous;
            }
            return {
                ...previous,
                tracks: previous.tracks.map((track) => {
                    if (track.track_type !== trackType) {
                        if ("solo" in patch && patch.solo === true) {
                            return { ...track, solo: false };
                        }
                        return track;
                    }
                    return { ...track, ...patch };
                }),
            };
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
        if (!timeline || timelineDuration <= 0) {
            return;
        }
        const rect = timeline.getBoundingClientRect();
        const rawX = clientX - rect.left + timeline.scrollLeft - TRACK_LABEL_WIDTH;
        const playableWidth = Math.max(timeline.scrollWidth - TRACK_LABEL_WIDTH, 1);
        const boundedX = Math.max(0, Math.min(rawX, playableWidth));
        const nextTime = (boundedX / playableWidth) * timelineDuration;
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
        return TRACK_LABEL_WIDTH + (timelineDuration > 0 ? (currentTime / timelineDuration) * playableWidth : 0);
    }, [currentTime, timelineDuration]);

    const renderAudioRow = (trackType: AudioLaneClip["trackType"]) => {
        const track = trackByType[trackType];
        if (!track) {
            return null;
        }
        const trackStyle = TRACK_STYLE_MAP[trackType];
        const rowClips = audioClips.filter((clip) => clip.trackType === trackType);

        return (
            <div key={track.id} className={`relative h-16 border-b border-white/6 bg-gradient-to-r ${trackStyle.railTone}`}>
                <div className="absolute inset-y-0 left-0 z-10 flex w-[136px] items-center border-r border-white/8 bg-black/40 px-4 backdrop-blur-xl">
                    <div className="flex w-full items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-[0.32em] text-white/35">{trackStyle.shortLabel}</div>
                            <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-white">
                                {trackStyle.icon}
                                <span className="truncate">{trackStyle.label}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    updateTrack(trackType, { solo: !track.solo });
                                }}
                                className={`rounded-full border px-2 py-0.5 text-[10px] ${track.solo ? "border-white/30 bg-white/15 text-white" : "border-white/10 bg-white/5 text-white/45"}`}
                            >
                                Solo
                            </button>
                            <button
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    updateTrack(trackType, { enabled: !track.enabled });
                                }}
                                className="text-white/45 transition-colors hover:text-white"
                                title={track.enabled ? "静音轨道" : "启用轨道"}
                            >
                                {track.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="ml-[136px] h-full">
                    {rowClips.map((clip) => {
                        const left = (clip.timelineStart / timelineDuration) * 100;
                        const width = (clip.duration / timelineDuration) * 100;
                        const fadeInPercent = Math.min((clip.fadeInDuration / Math.max(clip.duration, 0.1)) * 100, 100);
                        const fadeOutPercent = Math.min((clip.fadeOutDuration / Math.max(clip.duration, 0.1)) * 100, 100);
                        const waveformBars = clip.waveformPeaks.map((value) => Math.max(14, Math.round(value * 100)));

                        return (
                            <div
                                key={clip.id}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedAudioClipId(clip.id);
                                }}
                                onPointerDown={(event) => {
                                    if (!track.enabled) {
                                        return;
                                    }
                                    event.stopPropagation();
                                    startDraggingAudioClip(clip, event.clientX);
                                }}
                                className={`absolute top-2 h-12 rounded-2xl border px-3 py-2 ${trackStyle.blockTone} ${track.enabled ? "" : "opacity-45"} ${
                                    selectedAudioClipId === clip.id ? "ring-1 ring-white/45" : ""
                                } ${draggingAudioClipId === clip.id ? "cursor-grabbing" : "cursor-grab"}`}
                                style={{ left: `calc(${left}% + ${TRACK_LABEL_WIDTH}px)`, width: `max(${width}%, 72px)` }}
                            >
                                <div className="absolute inset-0 overflow-hidden rounded-2xl">
                                    <div className="absolute inset-y-0 left-0 bg-white/10" style={{ width: `${fadeInPercent}%`, clipPath: "polygon(0 100%, 100% 0, 100% 100%)" }} />
                                    <div className="absolute inset-y-0 right-0 bg-black/20" style={{ width: `${fadeOutPercent}%`, clipPath: "polygon(0 0, 100% 100%, 0 100%)" }} />
                                    <div className="absolute inset-0 flex items-center gap-[2px] px-3">
                                        {waveformBars.map((height, index) => (
                                            <span
                                                key={`${clip.id}-${index}`}
                                                className={`w-1 rounded-full ${trackStyle.waveformTone}`}
                                                style={{ height: `${height}%` }}
                                            />
                                        ))}
                                    </div>
                                </div>
                                <div className="relative flex items-center justify-between gap-2 text-[10px]">
                                    <span className="truncate font-semibold text-white">{clip.label}</span>
                                    <span className="font-mono text-white/55">{Math.round(clip.volume * 100)}%</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const timelineWidthPercent = `${100 * zoom}%`;

    return (
        <div className="relative flex h-full flex-col overflow-hidden bg-[#06080c] text-white">
            <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_30%),radial-gradient(circle_at_85%_15%,rgba(251,191,36,0.08),transparent_22%),linear-gradient(135deg,rgba(8,15,23,0.98),rgba(4,6,10,0.98))]" />
                <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.09) 1px, transparent 1px)", backgroundSize: "48px 48px" }} />
            </div>

            <div className="relative flex min-h-0 flex-1 border-b border-white/8">
                <section className="flex min-h-0 flex-1 flex-col px-8 pb-6 pt-7">
                    <div className="mb-5 flex items-start justify-between gap-6">
                        <div className="space-y-3">
                            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] uppercase tracking-[0.32em] text-white/55">
                                Final Mix Console
                                <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,0.9)]" />
                            </div>
                            <div>
                                <h2 className="font-display text-[30px] font-bold leading-none tracking-[-0.05em] text-white">
                                    专业混剪工作台
                                </h2>
                                <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-white/45">
                                    当前页面已切换到 timeline 真源驱动。片段裁切、轨道增益、静音与独奏会直接写入工程时间轴，并持续驱动后续导出。
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                            <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                                <div className="text-[10px] uppercase tracking-[0.26em] text-white/35">Video Cuts</div>
                                <div className="mt-2 font-mono text-xl text-white">{clips.length}</div>
                            </div>
                            <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                                <div className="text-[10px] uppercase tracking-[0.26em] text-white/35">Audio Clips</div>
                                <div className="mt-2 font-mono text-xl text-white">{audioClips.length}</div>
                            </div>
                            <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-4 py-3 shadow-[0_16px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl">
                                <div className="text-[10px] uppercase tracking-[0.26em] text-white/35">Timeline</div>
                                <div className="mt-2 font-mono text-xl text-white">{formatTime(timelineDuration)}</div>
                            </div>
                        </div>
                    </div>

                    <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-[28px] border border-white/10 bg-black/50 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_40%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_24%,transparent_76%,rgba(255,255,255,0.05))]" />
                        {isLoadingTimeline ? (
                            <div className="relative flex flex-col items-center gap-4 text-white/70">
                                <Loader2 size={40} className="animate-spin text-cyan-200" />
                                <div className="text-sm">正在同步工程时间轴...</div>
                            </div>
                        ) : currentPreviewUrl ? (
                            <>
                                <video
                                    ref={videoRef}
                                    src={currentPreviewUrl}
                                    className="h-full w-full object-contain bg-black"
                                    playsInline
                                    preload="metadata"
                                />
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/80 via-black/20 to-transparent px-5 pb-5 pt-20">
                                    <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-2 backdrop-blur-md">
                                        <div className="text-[10px] uppercase tracking-[0.28em] text-white/35">Active Shot</div>
                                        <div className="mt-1 text-sm font-semibold text-white">{activeClip?.label || "暂无片段"}</div>
                                    </div>
                                    <div className="rounded-2xl border border-white/10 bg-black/35 px-4 py-2 font-mono text-xs text-white/80 backdrop-blur-md">
                                        {formatTime(currentTime)} / {formatTime(totalDuration)}
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className="relative flex flex-col items-center gap-4 px-10 text-center text-white/45">
                                <AlertTriangle size={52} className="opacity-45" />
                                <div className="space-y-2">
                                    <div className="font-display text-2xl font-bold tracking-[-0.04em] text-white/75">暂无可预览片段</div>
                                    <div className="max-w-md text-sm leading-relaxed">
                                        先在“视频组装”中确定镜头，再回到这里做时间轴排布、轨道平衡和最终混音。
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </section>

                <aside className="flex w-[400px] flex-col border-l border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] backdrop-blur-2xl">
                    <div className="border-b border-white/8 px-5 pb-4 pt-5">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-[10px] uppercase tracking-[0.3em] text-white/35">Session State</div>
                                <h3 className="mt-2 font-display text-xl font-bold tracking-[-0.04em] text-white">编辑器控制台</h3>
                            </div>
                            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.24em] ${
                                timelineStatus === "saved"
                                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                                    : timelineStatus === "saving"
                                        ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                                        : timelineStatus === "error"
                                            ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
                                            : "border-white/10 bg-white/[0.05] text-white/55"
                            }`}>
                                {timelineStatus === "saved" ? <CheckCircle2 size={12} /> : timelineStatus === "saving" ? <Loader2 size={12} className="animate-spin" /> : <Scissors size={12} />}
                                {timelineStatus === "saved" ? "Synced" : timelineStatus === "saving" ? "Saving" : timelineStatus === "error" ? "Issue" : "Standby"}
                            </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3">
                            <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                                <div className="text-[10px] uppercase tracking-[0.24em] text-white/35">Picture Lock</div>
                                <div className="mt-2 text-sm font-semibold text-white">{clips.length > 0 ? "已建立剪辑顺序" : "尚未形成剪辑"}</div>
                            </div>
                            <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                                <div className="text-[10px] uppercase tracking-[0.24em] text-white/35">Mix Logic</div>
                                <div className="mt-2 text-sm font-semibold text-white">对白优先 ducking 已启用</div>
                            </div>
                        </div>
                        {timelineError ? (
                            <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-xs leading-relaxed text-rose-100">
                                {timelineError}
                            </div>
                        ) : null}
                    </div>

                    <div className="flex-1 overflow-y-auto px-5 py-5 custom-scrollbar">
                        <section className="mb-6">
                            <div className="mb-3 flex items-center justify-between">
                                <div>
                                    <div className="text-[10px] uppercase tracking-[0.28em] text-white/35">Cut Reel</div>
                                    <div className="mt-1 text-sm font-semibold text-white">视频片段编排</div>
                                </div>
                                <div className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-white/45">
                                    Drag to reorder
                                </div>
                            </div>
                            <div className="space-y-3">
                                {clips.length === 0 ? (
                                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-white/40">
                                        暂无已选片段
                                    </div>
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
                                                className={`group cursor-pointer rounded-[24px] border p-3 transition-all ${
                                                    isSelected
                                                        ? "border-cyan-300/35 bg-cyan-400/10 shadow-[0_14px_38px_rgba(6,182,212,0.16)]"
                                                        : "border-white/8 bg-white/[0.04] hover:border-white/15 hover:bg-white/[0.06]"
                                                }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="rounded-2xl border border-white/10 bg-black/30 p-2 text-white/35 transition-colors group-hover:text-white/70">
                                                        <GripVertical size={14} />
                                                    </div>
                                                    <div className="aspect-video w-24 overflow-hidden rounded-[18px] border border-white/10 bg-black/40">
                                                        {clip.thumbnailUrl ? <img src={clip.thumbnailUrl} className="h-full w-full object-cover" /> : null}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center justify-between gap-3">
                                                            <span className="truncate text-sm font-semibold text-white">{clip.label}</span>
                                                            <span className="font-mono text-[10px] text-white/45">{formatTime(clipDuration)}</span>
                                                        </div>
                                                        <div className="mt-1 text-[11px] text-white/38">
                                                            #{index + 1} · 入点 {formatTime(clip.trimStart)} · 出点 {formatTime(clip.trimEnd)}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </section>

                        <section className="mb-6 rounded-[28px] border border-white/8 bg-white/[0.04] p-4 shadow-[0_14px_38px_rgba(0,0,0,0.22)]">
                            <div className="mb-4 flex items-center justify-between">
                                <div>
                                    <div className="text-[10px] uppercase tracking-[0.28em] text-white/35">Trim Panel</div>
                                    <div className="mt-1 text-sm font-semibold text-white">{selectedClip ? selectedClip.label : "请选择片段"}</div>
                                </div>
                                <div className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] text-white/40">
                                    Source In/Out
                                </div>
                            </div>
                            {selectedClip ? (
                                <div className="space-y-4">
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs text-white/45">
                                            <span>入点</span>
                                            <span className="font-mono">{formatTime(selectedClip.trimStart)}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max={Math.max(selectedClip.sourceDuration - 0.1, 0.1)}
                                            step="0.1"
                                            value={selectedClip.trimStart}
                                            onChange={(event) => updateClipTrim(selectedClip.id, { trimStart: Number(event.target.value) })}
                                            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-200"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs text-white/45">
                                            <span>出点</span>
                                            <span className="font-mono">{formatTime(selectedClip.trimEnd)}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min={Math.min(selectedClip.trimStart + 0.1, selectedClip.sourceDuration)}
                                            max={selectedClip.sourceDuration}
                                            step="0.1"
                                            value={selectedClip.trimEnd}
                                            onChange={(event) => updateClipTrim(selectedClip.id, { trimEnd: Number(event.target.value) })}
                                            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-200"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                                            <div className="text-[10px] uppercase tracking-[0.24em] text-white/30">Source</div>
                                            <div className="mt-2 font-mono text-sm text-white">{formatTime(selectedClip.sourceDuration)}</div>
                                        </div>
                                        <div className="rounded-2xl border border-white/8 bg-black/20 p-3">
                                            <div className="text-[10px] uppercase tracking-[0.24em] text-white/30">Playable</div>
                                            <div className="mt-2 font-mono text-sm text-white">{formatTime(Math.max(selectedClip.trimEnd - selectedClip.trimStart, 0.1))}</div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-2xl border border-dashed border-white/10 bg-black/15 px-4 py-8 text-center text-sm text-white/35">
                                    先从上方片段列表中选择一个镜头，再进行裁切。
                                </div>
                            )}
                        </section>

                        <section className="mb-6 rounded-[28px] border border-white/8 bg-white/[0.04] p-4 shadow-[0_14px_38px_rgba(0,0,0,0.22)]">
                            <div className="mb-4 flex items-center justify-between">
                                <div>
                                    <div className="text-[10px] uppercase tracking-[0.28em] text-white/35">Audio Inspector</div>
                                    <div className="mt-1 text-sm font-semibold text-white">{selectedAudioClip ? selectedAudioClip.label : "请选择音频片段"}</div>
                                </div>
                                {selectedAudioClip ? (
                                    <div className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] ${TRACK_STYLE_MAP[selectedAudioClip.trackType].chipTone}`}>
                                        {TRACK_STYLE_MAP[selectedAudioClip.trackType].shortLabel}
                                    </div>
                                ) : null}
                            </div>
                            {selectedAudioClip ? (
                                <div className="space-y-4">
                                    <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-3">
                                        <div className="flex h-12 items-center gap-[2px]">
                                            {selectedAudioClip.waveformPeaks.map((value, index) => (
                                                <span
                                                    key={`${selectedAudioClip.id}-inspector-${index}`}
                                                    className={`w-1 rounded-full ${TRACK_STYLE_MAP[selectedAudioClip.trackType].waveformTone}`}
                                                    style={{ height: `${Math.max(18, Math.round(value * 100))}%` }}
                                                />
                                            ))}
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs text-white/45">
                                            <span>时间轴起点</span>
                                            <span className="font-mono">{formatTime(selectedAudioClip.timelineStart)}</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max={Math.max(timelineDuration + 8, selectedAudioClip.timelineStart + 8, 8)}
                                            step="0.1"
                                            value={selectedAudioClip.timelineStart}
                                            onChange={(event) => updateAudioClip(selectedAudioClip.id, { timelineStart: Number(event.target.value) })}
                                            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-xs text-white/45">
                                                <span>源入点</span>
                                                <span className="font-mono">{formatTime(selectedAudioClip.sourceStart)}</span>
                                            </div>
                                            <input
                                                type="range"
                                                min="0"
                                                max={Math.max(selectedAudioClip.sourceDuration - 0.1, 0.1)}
                                                step="0.1"
                                                value={selectedAudioClip.sourceStart}
                                                onChange={(event) => updateAudioClip(selectedAudioClip.id, { sourceStart: Number(event.target.value) })}
                                                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-xs text-white/45">
                                                <span>源出点</span>
                                                <span className="font-mono">{formatTime(selectedAudioClip.sourceEnd)}</span>
                                            </div>
                                            <input
                                                type="range"
                                                min={Math.min(selectedAudioClip.sourceStart + 0.1, selectedAudioClip.sourceDuration)}
                                                max={selectedAudioClip.sourceDuration}
                                                step="0.1"
                                                value={selectedAudioClip.sourceEnd}
                                                onChange={(event) => updateAudioClip(selectedAudioClip.id, { sourceEnd: Number(event.target.value) })}
                                                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-xs text-white/45">
                                                <span>片段音量</span>
                                                <span className="font-mono">{Math.round(selectedAudioClip.volume * 100)}%</span>
                                            </div>
                                            <input
                                                type="range"
                                                min="0"
                                                max="2"
                                                step="0.01"
                                                value={selectedAudioClip.volume}
                                                onChange={(event) => updateAudioClip(selectedAudioClip.id, { volume: Number(event.target.value) })}
                                                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-xs text-white/45">
                                                <span>淡入</span>
                                                <span className="font-mono">{formatTime(selectedAudioClip.fadeInDuration)}</span>
                                            </div>
                                            <input
                                                type="range"
                                                min="0"
                                                max={Math.max(selectedAudioClip.duration - 0.01, 0)}
                                                step="0.1"
                                                value={selectedAudioClip.fadeInDuration}
                                                onChange={(event) => updateAudioClip(selectedAudioClip.id, { fadeInDuration: Number(event.target.value) })}
                                                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <div className="flex justify-between text-xs text-white/45">
                                                <span>淡出</span>
                                                <span className="font-mono">{formatTime(selectedAudioClip.fadeOutDuration)}</span>
                                            </div>
                                            <input
                                                type="range"
                                                min="0"
                                                max={Math.max(selectedAudioClip.duration - selectedAudioClip.fadeInDuration - 0.01, 0)}
                                                step="0.1"
                                                value={selectedAudioClip.fadeOutDuration}
                                                onChange={(event) => updateAudioClip(selectedAudioClip.id, { fadeOutDuration: Number(event.target.value) })}
                                                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-2xl border border-dashed border-white/10 bg-black/15 px-4 py-8 text-center text-sm text-white/35">
                                    先在下方时间轴中选择一个音频片段，再进行精修。
                                </div>
                            )}
                        </section>

                        <section className="rounded-[28px] border border-white/8 bg-white/[0.04] p-4 shadow-[0_14px_38px_rgba(0,0,0,0.22)]">
                            <div className="mb-4 flex items-center justify-between">
                                <div>
                                    <div className="text-[10px] uppercase tracking-[0.28em] text-white/35">Mixer Matrix</div>
                                    <div className="mt-1 text-sm font-semibold text-white">轨道混音与监听</div>
                                </div>
                                <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1 text-[10px] uppercase tracking-[0.24em] text-white/40">
                                    <Sliders size={11} />
                                    Console
                                </div>
                            </div>
                            <div className="space-y-3">
                                {(Object.keys(TRACK_STYLE_MAP) as TimelineTrackType[]).map((trackType) => {
                                    const track = trackByType[trackType];
                                    if (!track) {
                                        return null;
                                    }
                                    const trackStyle = TRACK_STYLE_MAP[trackType];
                                    return (
                                        <div key={track.id} className="rounded-[22px] border border-white/8 bg-black/20 p-3.5">
                                            <div className="flex items-center justify-between gap-3">
                                                <div className="flex min-w-0 items-center gap-3">
                                                    <div className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] ${trackStyle.chipTone}`}>
                                                        {trackStyle.shortLabel}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-2 text-sm font-semibold text-white">
                                                            {trackStyle.icon}
                                                            <span className="truncate">{trackStyle.label}</span>
                                                        </div>
                                                        <div className="mt-1 text-[11px] text-white/38">
                                                            {track.enabled ? "参与导出" : "已静音"} · {track.solo ? "独奏监听" : "正常混音"}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => updateTrack(trackType, { solo: !track.solo })}
                                                        className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] ${track.solo ? "border-white/30 bg-white/15 text-white" : "border-white/10 bg-white/[0.04] text-white/45"}`}
                                                    >
                                                        Solo
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => updateTrack(trackType, { enabled: !track.enabled })}
                                                        className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-white/45 transition-colors hover:text-white"
                                                    >
                                                        {track.enabled ? <Eye size={13} /> : <EyeOff size={13} />}
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="mt-3">
                                                <div className="mb-2 flex items-center justify-between text-xs text-white/45">
                                                    <span>轨道增益</span>
                                                    <span className="font-mono">{Math.round(track.gain * 100)}%</span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="2"
                                                    step="0.01"
                                                    value={track.gain}
                                                    onChange={(event) => updateTrack(trackType, { gain: Number(event.target.value) })}
                                                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    </div>
                </aside>
            </div>

            <div className="relative h-[320px] border-t border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))]">
                <div className="flex h-12 items-center justify-between border-b border-white/8 px-5">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={togglePlayback}
                            disabled={!activeClip}
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-white transition-colors hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                        </button>
                        <div className="font-mono text-xs text-white/65">
                            {formatTime(currentTime)} / {formatTime(totalDuration)}
                        </div>
                        <div className="text-xs text-white/35">
                            {clips.length} 个视频片段 · {audioClips.length} 个音频片段
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setZoom(Math.max(0.5, zoom - 0.1))} className="rounded-full border border-white/10 px-2 py-1 text-xs text-white/55 transition-colors hover:text-white">
                            -
                        </button>
                        <span className="text-xs uppercase tracking-[0.22em] text-white/35">Zoom</span>
                        <button onClick={() => setZoom(Math.min(2, zoom + 0.1))} className="rounded-full border border-white/10 px-2 py-1 text-xs text-white/55 transition-colors hover:text-white">
                            +
                        </button>
                    </div>
                </div>

                <div
                    ref={timelineRef}
                    className="relative flex-1 select-none overflow-x-auto overflow-y-hidden custom-scrollbar"
                    onClick={(event) => {
                        if (isScrubbing || draggingAudioClipId) {
                            return;
                        }
                        seekFromClientX(event.clientX, playIntentRef.current);
                    }}
                    onPointerDown={(event) => {
                        if (draggingAudioClipId) {
                            return;
                        }
                        setIsScrubbing(true);
                        seekFromClientX(event.clientX, playIntentRef.current);
                    }}
                    onPointerMove={(event) => {
                        if (!isScrubbing || draggingAudioClipId) {
                            return;
                        }
                        seekFromClientX(event.clientX, playIntentRef.current);
                    }}
                >
                    <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-cyan-300/90 shadow-[0_0_18px_rgba(103,232,249,0.85)]" style={{ left: `${playheadLeftPx}px` }} />

                    <div className="flex min-h-full min-w-full flex-col" style={{ width: timelineWidthPercent }}>
                        <div className={`relative h-20 border-b border-white/8 bg-gradient-to-r ${TRACK_STYLE_MAP.video.railTone}`}>
                            <div className="absolute inset-y-0 left-0 z-10 flex w-[136px] items-center border-r border-white/8 bg-black/40 px-4 backdrop-blur-xl">
                                <div>
                                    <div className="text-[10px] uppercase tracking-[0.32em] text-white/35">VID</div>
                                    <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-white">
                                        <Video size={14} />
                                        视频母带
                                    </div>
                                </div>
                            </div>
                            <div className="ml-[136px] flex h-full items-center">
                                {clips.map((clip, index) => {
                                    const clipDuration = Math.max(clip.trimEnd - clip.trimStart, 0.1);
                                    const width = (clipDuration / timelineDuration) * 100;
                                    const left = (clipDurations.slice(0, index).reduce((sum, duration) => sum + duration, 0) / timelineDuration) * 100;
                                    const isActive = clip.id === activeClip?.id;

                                    return (
                                        <button
                                            key={clip.id}
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setSelectedClipId(clip.id);
                                            }}
                                            className={`absolute inset-y-2 overflow-hidden rounded-2xl border px-3 py-2 text-left transition-all ${isActive ? "border-cyan-200/45 bg-cyan-400/14 shadow-[0_18px_38px_rgba(34,211,238,0.16)]" : "border-cyan-400/20 bg-cyan-500/10"}`}
                                            style={{ left: `calc(${left}% + ${TRACK_LABEL_WIDTH}px)`, width: `max(${width}%, 84px)` }}
                                        >
                                            {clip.thumbnailUrl ? <img src={clip.thumbnailUrl} className="absolute inset-0 h-full w-full object-cover opacity-30" /> : null}
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-transparent" />
                                            <div className="relative flex h-full flex-col justify-between">
                                                <div className="text-[10px] uppercase tracking-[0.22em] text-cyan-100/55">Shot {index + 1}</div>
                                                <div>
                                                    <div className="truncate text-xs font-semibold text-white">{clip.label}</div>
                                                    <div className="mt-1 font-mono text-[10px] text-white/45">{formatTime(clipDuration)}</div>
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {renderAudioRow("dialogue")}
                        {renderAudioRow("sfx")}
                        {renderAudioRow("bgm")}
                    </div>
                </div>
            </div>
        </div>
    );
}
