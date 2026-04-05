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
import { buildCurrentMixSnapshot } from "@/lib/timelineMixState";
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
    originalAudioEnabled: boolean;
    originalAudioGain: number;
    originalAudioFadeInDuration: number;
    originalAudioFadeOutDuration: number;
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
    mode: "move" | "trimStart" | "trimEnd";
    startClientX: number;
    originTimelineStart: number;
    originSourceStart: number;
    originSourceEnd: number;
};

type VideoTrimDragState = {
    clipId: string;
    mode: "trimStart" | "trimEnd";
    startClientX: number;
    originTimelineStart: number;
    originTrimStart: number;
    originTrimEnd: number;
    sourceDuration: number;
};

type TimelineHoverInfo = {
    label: string;
    trackLabel: string;
    start: number;
    end: number;
    duration: number;
    sourceIn?: number;
    sourceOut?: number;
    gainLabel?: string;
    originalAudioLabel?: string;
    fadeLabel?: string;
    priorityLabel?: string;
};

const TRACK_LABEL_WIDTH = 136;
const DEFAULT_WAVEFORM_BARS = 28;
const TIMELINE_SNAP_THRESHOLD_SECONDS = 0.18;

const roundTimelineValue = (value: number) => Number(Math.max(0, value).toFixed(3));

const TRACK_STATUS_TONE_MAP: Record<"live" | "ducked" | "solo_cut" | "muted" | "idle", string> = {
    live: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
    ducked: "border-rose-400/30 bg-rose-400/10 text-rose-100",
    solo_cut: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-100",
    muted: "border-white/10 bg-white/[0.04] text-white/45",
    idle: "border-white/10 bg-white/[0.04] text-white/45",
};

const snapToTimelinePoint = (value: number, snapPoints: number[], thresholdSeconds = TIMELINE_SNAP_THRESHOLD_SECONDS) => {
    let nearestValue = value;
    let minDistance = thresholdSeconds;

    snapPoints.forEach((point) => {
        const distance = Math.abs(point - value);
        if (distance <= minDistance) {
            nearestValue = point;
            minDistance = distance;
        }
    });

    return nearestValue;
};

const resolveSnapIndicator = (value: number, snapPoints: number[], thresholdSeconds = TIMELINE_SNAP_THRESHOLD_SECONDS) => {
    let nearestValue: number | null = null;
    let minDistance = thresholdSeconds;

    snapPoints.forEach((point) => {
        const distance = Math.abs(point - value);
        if (distance <= minDistance) {
            nearestValue = point;
            minDistance = distance;
        }
    });

    return nearestValue;
};

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
                originalAudioEnabled: clip.metadata?.original_audio_enabled !== false,
                originalAudioGain: Number(clip.metadata?.original_audio_gain ?? 1),
                originalAudioFadeInDuration: Number(clip.metadata?.original_audio_fade_in_duration || 0),
                originalAudioFadeOutDuration: Number(clip.metadata?.original_audio_fade_out_duration || 0),
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
        const safeOriginalAudioGain = Math.max(0, Math.min(editableClip.originalAudioGain, 2));
        const safeOriginalAudioFadeIn = Math.max(0, Math.min(editableClip.originalAudioFadeInDuration, Math.max(clipDuration - 0.01, 0)));
        const safeOriginalAudioFadeOut = Math.max(
            0,
            Math.min(editableClip.originalAudioFadeOutDuration, Math.max(clipDuration - safeOriginalAudioFadeIn - 0.01, 0)),
        );

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
                original_audio_enabled: editableClip.originalAudioEnabled,
                original_audio_gain: Number(safeOriginalAudioGain.toFixed(3)),
                original_audio_fade_in_duration: Number(safeOriginalAudioFadeIn.toFixed(3)),
                original_audio_fade_out_duration: Number(safeOriginalAudioFadeOut.toFixed(3)),
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
    const videoTrimDragStateRef = useRef<VideoTrimDragState | null>(null);

    const [timelineState, setTimelineState] = useState<ProjectTimeline | null>(null);
    const [clips, setClips] = useState<EditableVideoClip[]>([]);
    const [audioClips, setAudioClips] = useState<AudioLaneClip[]>([]);
    const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
    const [selectedAudioClipId, setSelectedAudioClipId] = useState<string | null>(null);
    const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
    const [draggingAudioClipId, setDraggingAudioClipId] = useState<string | null>(null);
    const [draggingVideoTrimClipId, setDraggingVideoTrimClipId] = useState<string | null>(null);
    const [activeSnapPoint, setActiveSnapPoint] = useState<number | null>(null);
    const [editorHud, setEditorHud] = useState<string>("待命");
    const [hoverInfo, setHoverInfo] = useState<TimelineHoverInfo | null>(null);
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
    const timelineSnapPoints = useMemo(() => {
        const points = new Set<number>([0, roundTimelineValue(currentTime), roundTimelineValue(totalDuration), roundTimelineValue(maxAudioEnd)]);
        let videoCursor = 0;
        clipDurations.forEach((duration) => {
            points.add(roundTimelineValue(videoCursor));
            videoCursor += duration;
            points.add(roundTimelineValue(videoCursor));
        });
        audioClips.forEach((clip) => {
            points.add(roundTimelineValue(clip.timelineStart));
            points.add(roundTimelineValue(clip.timelineStart + clip.duration));
        });
        return Array.from(points).sort((a, b) => a - b);
    }, [audioClips, clipDurations, currentTime, maxAudioEnd, totalDuration]);
    const timeRulerMarks = useMemo(() => {
        const safeDuration = Math.max(timelineDuration, 1);
        const coarseStep = safeDuration <= 20 ? 1 : safeDuration <= 60 ? 2 : safeDuration <= 180 ? 5 : 10;
        const marks = [];
        for (let value = 0; value <= safeDuration + 0.001; value += coarseStep) {
            marks.push(roundTimelineValue(value));
        }
        if (marks[marks.length - 1] !== roundTimelineValue(safeDuration)) {
            marks.push(roundTimelineValue(safeDuration));
        }
        return marks;
    }, [timelineDuration]);

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
    // 统一收口“当前时间点的真实混音快照”，让预览区、侧栏和时间轴共享同一套导出语义。
    const currentMixSnapshot = useMemo(
        () =>
            buildCurrentMixSnapshot({
                currentTime,
                activeVideoClip: activeClip
                    ? {
                        id: activeClip.id,
                        label: activeClip.label,
                        originalAudioEnabled: activeClip.originalAudioEnabled,
                        originalAudioGain: activeClip.originalAudioGain,
                    }
                    : null,
                tracks: [
                    { trackType: "video", enabled: Boolean(trackByType.video?.enabled), gain: trackByType.video?.gain || 0, solo: Boolean(trackByType.video?.solo) },
                    { trackType: "dialogue", enabled: Boolean(trackByType.dialogue?.enabled), gain: trackByType.dialogue?.gain || 0, solo: Boolean(trackByType.dialogue?.solo) },
                    { trackType: "sfx", enabled: Boolean(trackByType.sfx?.enabled), gain: trackByType.sfx?.gain || 0, solo: Boolean(trackByType.sfx?.solo) },
                    { trackType: "bgm", enabled: Boolean(trackByType.bgm?.enabled), gain: trackByType.bgm?.gain || 0, solo: Boolean(trackByType.bgm?.solo) },
                ],
                audioClips: audioClips.map((clip) => ({
                    id: clip.id,
                    trackType: clip.trackType,
                    timelineStart: clip.timelineStart,
                    duration: clip.duration,
                })),
            }),
        [activeClip, audioClips, currentTime, trackByType],
    );
    const mixPrioritySignals = useMemo(() => {
        const videoTrack = trackByType.video;
        const sfxTrack = trackByType.sfx;
        const bgmTrack = trackByType.bgm;
        return [
            {
                id: "dialogue",
                label: "对白优先",
                detail: currentMixSnapshot.dialogueDominant ? "当前对白激活，BGM 将被自动压低" : "当前无对白抢占",
                tone: currentMixSnapshot.dialogueDominant ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/[0.04] text-white/45",
            },
            {
                id: "video-original",
                label: "视频原声",
                detail:
                    activeClip && videoTrack?.enabled
                        ? activeClip.originalAudioEnabled
                            ? `当前镜头原声 ${Math.round(activeClip.originalAudioGain * 100)}%`
                            : "当前镜头原声已静音"
                        : "视频轨未参与混音",
                tone:
                    currentMixSnapshot.videoOriginalActive
                        ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                        : "border-white/10 bg-white/[0.04] text-white/45",
            },
            {
                id: "bgm",
                label: "音乐总线",
                detail: bgmTrack?.enabled
                    ? bgmTrack.solo
                        ? "当前独奏监听"
                        : currentMixSnapshot.bgmDucked
                            ? "对白抢占中，导出链路 ducking 生效"
                            : `轨道增益 ${Math.round((bgmTrack.gain || 0) * 100)}%`
                    : "未参与导出",
                tone: bgmTrack?.enabled ? "border-rose-400/30 bg-rose-400/10 text-rose-100" : "border-white/10 bg-white/[0.04] text-white/45",
            },
            {
                id: "sfx",
                label: "音效设计",
                detail: sfxTrack?.enabled ? `轨道增益 ${Math.round((sfxTrack.gain || 0) * 100)}%` : "未参与导出",
                tone: sfxTrack?.enabled ? "border-amber-400/30 bg-amber-400/10 text-amber-100" : "border-white/10 bg-white/[0.04] text-white/45",
            },
        ];
    }, [activeClip, currentMixSnapshot, trackByType]);
    const trackMonitorState = useMemo(() => {
        const describeTrack = (trackType: TimelineTrackType) => {
            const track = trackByType[trackType];
            if (!track || !track.enabled) {
                return { label: "Muted", tone: TRACK_STATUS_TONE_MAP.muted, detail: "未参与导出" };
            }
            if (currentMixSnapshot.excludedBySoloTrackTypes.includes(trackType)) {
                return { label: "Solo Cut", tone: TRACK_STATUS_TONE_MAP.solo_cut, detail: "被独奏监听排除" };
            }
            if (currentMixSnapshot.duckedTrackTypes.includes(trackType)) {
                return { label: "Ducked", tone: TRACK_STATUS_TONE_MAP.ducked, detail: "对白优先压低中" };
            }
            if (currentMixSnapshot.audibleTrackTypes.includes(trackType)) {
                return { label: "Live", tone: TRACK_STATUS_TONE_MAP.live, detail: "当前参与导出混音" };
            }
            return { label: "Idle", tone: TRACK_STATUS_TONE_MAP.idle, detail: "当前时间点无激活片段" };
        };

        return {
            video: describeTrack("video"),
            dialogue: describeTrack("dialogue"),
            sfx: describeTrack("sfx"),
            bgm: describeTrack("bgm"),
        };
    }, [currentMixSnapshot, trackByType]);
    const timelineDiagnostics = timelineState?.diagnostics;
    const exportReadinessTone =
        timelineDiagnostics?.export_readiness === "mix_ready"
            ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
            : timelineDiagnostics?.export_readiness === "base_ready"
                ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                : "border-rose-400/30 bg-rose-400/10 text-rose-100";
    const exportReadinessLabel =
        timelineDiagnostics?.export_readiness === "mix_ready"
            ? "Mix Ready"
            : timelineDiagnostics?.export_readiness === "base_ready"
                ? "Base Ready"
                : "Missing Video";
    const diagnosticsFlags = [
        {
            key: "multitrack_audio",
            label: "Multitrack",
            active: Boolean(timelineDiagnostics?.flags?.multitrack_audio),
        },
        {
            key: "ducking_ready",
            label: "Ducking",
            active: Boolean(timelineDiagnostics?.flags?.ducking_ready),
        },
        {
            key: "video_original_audio",
            label: "Video Original",
            active: Boolean(timelineDiagnostics?.flags?.video_original_audio),
        },
        {
            key: "monitoring_overrides",
            label: "Solo Override",
            active: Boolean(timelineDiagnostics?.flags?.monitoring_overrides),
        },
    ];
    const playheadStatusTone = currentMixSnapshot.hasSoloMix
        ? TRACK_STATUS_TONE_MAP.solo_cut
        : currentMixSnapshot.bgmDucked
            ? TRACK_STATUS_TONE_MAP.ducked
            : currentMixSnapshot.audibleSources.length > 0
                ? TRACK_STATUS_TONE_MAP.live
                : TRACK_STATUS_TONE_MAP.idle;

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
            setAudioClips((previous) =>
                previous.map((clip) => {
                    if (clip.id !== dragState.clipId) {
                        return clip;
                    }

                    // 音频块支持移动与左右裁切，确保时间轴位置、源入点和持续时长始终保持同源更新。
                    if (dragState.mode === "move") {
                        const rawTimelineStart = Math.max(0, dragState.originTimelineStart + deltaSeconds);
                        const snapPoint = resolveSnapIndicator(rawTimelineStart, timelineSnapPoints);
                        const nextTimelineStart = snapToTimelinePoint(rawTimelineStart, timelineSnapPoints);
                        setActiveSnapPoint(snapPoint);
                        setEditorHud(`移动音频 · ${formatTime(nextTimelineStart)}`);
                        return {
                            ...clip,
                            timelineStart: roundTimelineValue(nextTimelineStart),
                        };
                    }

                    if (dragState.mode === "trimStart") {
                        const nextSourceStart = Math.max(0, Math.min(dragState.originSourceStart + deltaSeconds, dragState.originSourceEnd - 0.1));
                        const sourceDelta = nextSourceStart - dragState.originSourceStart;
                        const rawTimelineStart = Math.max(0, dragState.originTimelineStart + sourceDelta);
                        const snapPoint = resolveSnapIndicator(rawTimelineStart, timelineSnapPoints);
                        const nextTimelineStart = snapToTimelinePoint(rawTimelineStart, timelineSnapPoints);
                        const snappedSourceStart = dragState.originSourceStart + (nextTimelineStart - dragState.originTimelineStart);
                        const safeSourceStart = Math.max(0, Math.min(snappedSourceStart, dragState.originSourceEnd - 0.1));
                        const nextDuration = Math.max(dragState.originSourceEnd - safeSourceStart, 0.1);
                        const safeFadeIn = Math.max(0, Math.min(clip.fadeInDuration, Math.max(nextDuration - 0.01, 0)));
                        const safeFadeOut = Math.max(0, Math.min(clip.fadeOutDuration, Math.max(nextDuration - safeFadeIn - 0.01, 0)));
                        setActiveSnapPoint(snapPoint);
                        setEditorHud(`裁切音频头部 · ${formatTime(nextTimelineStart)} / 时长 ${formatTime(nextDuration)}`);
                        return {
                            ...clip,
                            timelineStart: roundTimelineValue(nextTimelineStart),
                            sourceStart: roundTimelineValue(safeSourceStart),
                            duration: roundTimelineValue(nextDuration),
                            fadeInDuration: roundTimelineValue(safeFadeIn),
                            fadeOutDuration: roundTimelineValue(safeFadeOut),
                        };
                    }

                    const rawTimelineEnd = dragState.originTimelineStart + Math.max(dragState.originSourceStart + 0.1, Math.min(dragState.originSourceEnd + deltaSeconds, clip.sourceDuration)) - dragState.originSourceStart;
                    const snapPoint = resolveSnapIndicator(rawTimelineEnd, timelineSnapPoints);
                    const snappedTimelineEnd = snapToTimelinePoint(rawTimelineEnd, timelineSnapPoints);
                    const nextSourceEnd = Math.max(dragState.originSourceStart + 0.1, Math.min(dragState.originSourceStart + (snappedTimelineEnd - dragState.originTimelineStart), clip.sourceDuration));
                    const nextDuration = Math.max(nextSourceEnd - dragState.originSourceStart, 0.1);
                    const safeFadeIn = Math.max(0, Math.min(clip.fadeInDuration, Math.max(nextDuration - 0.01, 0)));
                    const safeFadeOut = Math.max(0, Math.min(clip.fadeOutDuration, Math.max(nextDuration - safeFadeIn - 0.01, 0)));
                    setActiveSnapPoint(snapPoint);
                    setEditorHud(`裁切音频尾部 · ${formatTime(snappedTimelineEnd)} / 时长 ${formatTime(nextDuration)}`);
                    return {
                        ...clip,
                        sourceEnd: roundTimelineValue(nextSourceEnd),
                        duration: roundTimelineValue(nextDuration),
                        fadeInDuration: roundTimelineValue(safeFadeIn),
                        fadeOutDuration: roundTimelineValue(safeFadeOut),
                    };
                })
            );
        };

        const handlePointerUp = () => {
            audioDragStateRef.current = null;
            setDraggingAudioClipId(null);
            setActiveSnapPoint(null);
            setEditorHud("待命");
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
        };
    }, [timelineDuration, timelineSnapPoints]);

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            const dragState = videoTrimDragStateRef.current;
            const timeline = timelineRef.current;
            if (!dragState || !timeline || timelineDuration <= 0) {
                return;
            }

            const playableWidth = Math.max(timeline.scrollWidth - TRACK_LABEL_WIDTH, 1);
            const deltaX = event.clientX - dragState.startClientX;
            const deltaSeconds = (deltaX / playableWidth) * timelineDuration;

            setClips((previous) =>
                previous.map((clip) => {
                    if (clip.id !== dragState.clipId) {
                        return clip;
                    }

                    // 视频块边缘裁切与右侧 Trim Panel 共享同一套源入/出点语义，避免两套状态分叉。
                    if (dragState.mode === "trimStart") {
                        const rawTrimStart = Math.max(0, Math.min(dragState.originTrimStart + deltaSeconds, dragState.originTrimEnd - 0.1));
                        const rawTimelineStart = dragState.originTimelineStart + rawTrimStart - dragState.originTrimStart;
                        const snapPoint = resolveSnapIndicator(rawTimelineStart, timelineSnapPoints);
                        const snappedTimelineStart = snapToTimelinePoint(rawTimelineStart, timelineSnapPoints);
                        const nextTrimStart = Math.max(0, Math.min(dragState.originTrimStart + (snappedTimelineStart - dragState.originTimelineStart), dragState.originTrimEnd - 0.1));
                        setActiveSnapPoint(snapPoint);
                        setEditorHud(`裁切视频头部 · ${formatTime(snappedTimelineStart)} / 入点 ${formatTime(nextTrimStart)}`);
                        return {
                            ...clip,
                            trimStart: roundTimelineValue(nextTrimStart),
                        };
                    }

                    const rawTrimEnd = Math.max(dragState.originTrimStart + 0.1, Math.min(dragState.originTrimEnd + deltaSeconds, dragState.sourceDuration));
                    const rawTimelineEnd = dragState.originTimelineStart + rawTrimEnd - dragState.originTrimStart;
                    const snapPoint = resolveSnapIndicator(rawTimelineEnd, timelineSnapPoints);
                    const snappedTimelineEnd = snapToTimelinePoint(rawTimelineEnd, timelineSnapPoints);
                    const nextTrimEnd = Math.max(dragState.originTrimStart + 0.1, Math.min(dragState.originTrimStart + (snappedTimelineEnd - dragState.originTimelineStart), dragState.sourceDuration));
                    setActiveSnapPoint(snapPoint);
                    setEditorHud(`裁切视频尾部 · ${formatTime(snappedTimelineEnd)} / 出点 ${formatTime(nextTrimEnd)}`);
                    return {
                        ...clip,
                        trimEnd: roundTimelineValue(nextTrimEnd),
                    };
                })
            );
        };

        const handlePointerUp = () => {
            videoTrimDragStateRef.current = null;
            setDraggingVideoTrimClipId(null);
            setActiveSnapPoint(null);
            setEditorHud("待命");
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerUp);
        };
    }, [timelineDuration, timelineSnapPoints]);

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

    const updateVideoClipAudio = (
        clipId: string,
        patch: Partial<Pick<EditableVideoClip, "originalAudioEnabled" | "originalAudioGain" | "originalAudioFadeInDuration" | "originalAudioFadeOutDuration">>,
    ) => {
        setClips((previous) =>
            previous.map((clip) => {
                if (clip.id !== clipId) {
                    return clip;
                }
                const duration = Math.max(clip.trimEnd - clip.trimStart, 0.1);
                const nextGain = patch.originalAudioGain ?? clip.originalAudioGain;
                const nextFadeIn = patch.originalAudioFadeInDuration ?? clip.originalAudioFadeInDuration;
                const safeFadeIn = Math.max(0, Math.min(nextFadeIn, Math.max(duration - 0.01, 0)));
                const nextFadeOut = patch.originalAudioFadeOutDuration ?? clip.originalAudioFadeOutDuration;
                const safeFadeOut = Math.max(0, Math.min(nextFadeOut, Math.max(duration - safeFadeIn - 0.01, 0)));
                return {
                    ...clip,
                    originalAudioEnabled: patch.originalAudioEnabled ?? clip.originalAudioEnabled,
                    originalAudioGain: Number(Math.max(0, Math.min(nextGain, 2)).toFixed(3)),
                    originalAudioFadeInDuration: Number(safeFadeIn.toFixed(3)),
                    originalAudioFadeOutDuration: Number(safeFadeOut.toFixed(3)),
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
            mode: "move",
            startClientX: clientX,
            originTimelineStart: clip.timelineStart,
            originSourceStart: clip.sourceStart,
            originSourceEnd: clip.sourceEnd,
        };
        setSelectedAudioClipId(clip.id);
        setDraggingAudioClipId(clip.id);
    };

    const startTrimmingAudioClip = (clip: AudioLaneClip, mode: "trimStart" | "trimEnd", clientX: number) => {
        audioDragStateRef.current = {
            clipId: clip.id,
            mode,
            startClientX: clientX,
            originTimelineStart: clip.timelineStart,
            originSourceStart: clip.sourceStart,
            originSourceEnd: clip.sourceEnd,
        };
        setSelectedAudioClipId(clip.id);
        setDraggingAudioClipId(clip.id);
    };

    const startTrimmingVideoClip = (clip: EditableVideoClip, mode: "trimStart" | "trimEnd", clientX: number) => {
        const clipIndex = clips.findIndex((item) => item.id === clip.id);
        const clipTimelineStart = clipDurations.slice(0, Math.max(clipIndex, 0)).reduce((sum, duration) => sum + duration, 0);
        videoTrimDragStateRef.current = {
            clipId: clip.id,
            mode,
            startClientX: clientX,
            originTimelineStart: clipTimelineStart,
            originTrimStart: clip.trimStart,
            originTrimEnd: clip.trimEnd,
            sourceDuration: clip.sourceDuration,
        };
        setSelectedClipId(clip.id);
        setDraggingVideoTrimClipId(clip.id);
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
    const snapGuideLeftPx = useMemo(() => {
        if (activeSnapPoint == null) {
            return null;
        }
        const timelineWidth = timelineRef.current?.scrollWidth || 0;
        const playableWidth = Math.max(timelineWidth - TRACK_LABEL_WIDTH, 0);
        return TRACK_LABEL_WIDTH + (timelineDuration > 0 ? (activeSnapPoint / timelineDuration) * playableWidth : 0);
    }, [activeSnapPoint, timelineDuration]);

    const renderAudioRow = (trackType: AudioLaneClip["trackType"]) => {
        const track = trackByType[trackType];
        if (!track) {
            return null;
        }
        const trackStyle = TRACK_STYLE_MAP[trackType];
        const monitor = trackMonitorState[trackType];
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
                            <div className="mt-1 flex items-center gap-2">
                                <span className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] ${monitor.tone}`}>
                                    {monitor.label}
                                </span>
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
                        const isActiveNow = clip.timelineStart <= currentTime && clip.timelineStart + clip.duration >= currentTime;

                        return (
                            <div
                                key={clip.id}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedAudioClipId(clip.id);
                                }}
                                onMouseEnter={() =>
                                    setHoverInfo({
                                        label: clip.label,
                                        trackLabel: trackStyle.label,
                                        start: clip.timelineStart,
                                        end: clip.timelineStart + clip.duration,
                                        duration: clip.duration,
                                        sourceIn: clip.sourceStart,
                                        sourceOut: clip.sourceEnd,
                                        gainLabel: `${Math.round(clip.volume * 100)}%`,
                                        priorityLabel:
                                            currentMixSnapshot.excludedBySoloTrackTypes.includes(trackType)
                                                ? "Solo Cut"
                                                : currentMixSnapshot.duckedTrackTypes.includes(trackType)
                                                    ? "Ducked"
                                                    : isActiveNow
                                                        ? "Live"
                                                        : "Idle",
                                    })
                                }
                                onMouseLeave={() => setHoverInfo((previous) => (previous?.label === clip.label ? null : previous))}
                                onPointerDown={(event) => {
                                    if (!track.enabled) {
                                        return;
                                    }
                                    event.stopPropagation();
                                    startDraggingAudioClip(clip, event.clientX);
                                }}
                                className={`absolute top-2 h-12 rounded-2xl border px-3 py-2 ${trackStyle.blockTone} ${track.enabled ? "" : "opacity-45"} ${
                                    selectedAudioClipId === clip.id ? "ring-1 ring-white/45" : ""
                                } ${draggingAudioClipId === clip.id ? "cursor-grabbing" : "cursor-grab"} ${
                                    currentMixSnapshot.excludedBySoloTrackTypes.includes(trackType) ? "opacity-30" : ""
                                } ${
                                    currentMixSnapshot.duckedTrackTypes.includes(trackType) ? "shadow-[inset_0_0_0_1px_rgba(251,113,133,0.35)]" : ""
                                }`}
                                style={{ left: `calc(${left}% + ${TRACK_LABEL_WIDTH}px)`, width: `max(${width}%, 72px)` }}
                            >
                                <button
                                    type="button"
                                    aria-label={`裁切 ${clip.label} 开始`}
                                    onPointerDown={(event) => {
                                        if (!track.enabled) {
                                            return;
                                        }
                                        event.stopPropagation();
                                        startTrimmingAudioClip(clip, "trimStart", event.clientX);
                                    }}
                                    className="absolute inset-y-0 left-0 z-10 w-3 cursor-ew-resize rounded-l-2xl bg-white/8 transition-colors hover:bg-white/16"
                                />
                                <button
                                    type="button"
                                    aria-label={`裁切 ${clip.label} 结束`}
                                    onPointerDown={(event) => {
                                        if (!track.enabled) {
                                            return;
                                        }
                                        event.stopPropagation();
                                        startTrimmingAudioClip(clip, "trimEnd", event.clientX);
                                    }}
                                    className="absolute inset-y-0 right-0 z-10 w-3 cursor-ew-resize rounded-r-2xl bg-white/8 transition-colors hover:bg-white/16"
                                />
                                <div className="absolute inset-0 overflow-hidden rounded-2xl">
                                    {isActiveNow ? <div className="absolute inset-0 bg-white/6" /> : null}
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
                                    <div className="flex items-center gap-1.5">
                                        {isActiveNow ? <span className="h-1.5 w-1.5 rounded-full bg-white/80" /> : null}
                                        {isActiveNow && currentMixSnapshot.duckedTrackTypes.includes(trackType) ? <span className="rounded-full border border-rose-400/25 bg-rose-400/12 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.16em] text-rose-100">DUCK</span> : null}
                                        {isActiveNow && currentMixSnapshot.excludedBySoloTrackTypes.includes(trackType) ? <span className="rounded-full border border-fuchsia-400/25 bg-fuchsia-400/12 px-1.5 py-0.5 text-[8px] uppercase tracking-[0.16em] text-fuchsia-100">CUT</span> : null}
                                        <span className="font-mono text-white/55">{Math.round(clip.volume * 100)}%</span>
                                    </div>
                                </div>
                                <div className="relative mt-1 flex items-center justify-between gap-2 font-mono text-[9px] text-white/45">
                                    <span>T {formatTime(clip.timelineStart)}</span>
                                    <span>S {formatTime(clip.sourceStart)}-{formatTime(clip.sourceEnd)}</span>
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
        <div className="final-mix-shell relative flex h-full flex-col overflow-hidden">
            <div className="relative flex min-h-0 flex-1 border-b border-white/8">
                <section className="flex min-h-0 flex-1 flex-col px-6 pb-5 pt-5">
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h2 className="truncate font-display text-lg font-semibold tracking-[-0.04em] text-white">最终混剪</h2>
                                <span className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${exportReadinessTone}`}>
                                    {exportReadinessLabel}
                                </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-white/45">
                                <span>{timelineDiagnostics?.video_clip_count ?? clips.length} 段视频</span>
                                <span className="text-white/25">·</span>
                                <span>{timelineDiagnostics?.audio_clip_count ?? audioClips.length} 段音频</span>
                                <span className="text-white/25">·</span>
                                <span className="font-mono">{formatTime(timelineDuration)}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <div
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.24em] ${
                                    timelineStatus === "saved"
                                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                                        : timelineStatus === "saving"
                                            ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                                            : timelineStatus === "error"
                                                ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
                                                : "border-white/10 bg-white/[0.05] text-white/55"
                                }`}
                            >
                                {timelineStatus === "saved" ? (
                                    <CheckCircle2 size={12} />
                                ) : timelineStatus === "saving" ? (
                                    <Loader2 size={12} className="animate-spin" />
                                ) : (
                                    <Scissors size={12} />
                                )}
                                {timelineStatus === "saved"
                                    ? "Synced"
                                    : timelineStatus === "saving"
                                        ? "Saving"
                                        : timelineStatus === "error"
                                            ? "Issue"
                                            : "Standby"}
                            </div>
                            <div className="hidden items-center gap-1.5 lg:flex">
                                {diagnosticsFlags.slice(0, 3).map((flag) => (
                                    <span
                                        key={flag.key}
                                        className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
                                            flag.active
                                                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                                                : "border-white/10 bg-white/[0.04] text-white/45"
                                        }`}
                                    >
                                        {flag.label}
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="final-mix-preview relative flex flex-1 items-center justify-center overflow-hidden rounded-[26px] border border-white/10 bg-black/40 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
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
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between px-4 pb-4">
                                    <div className="rounded-full border border-white/10 bg-black/40 px-3 py-2 text-white/80 backdrop-blur-md">
                                        <span className="text-[10px] uppercase tracking-[0.22em] text-white/45">Active</span>
                                        <span className="ml-2 text-xs font-semibold text-white">{activeClip?.label || "未选中片段"}</span>
                                    </div>
                                    <div className="rounded-full border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs text-white/80 backdrop-blur-md">
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

                <aside className="final-mix-sidebar flex w-[400px] flex-col border-l border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] backdrop-blur-2xl">
                    <div className="border-b border-white/8 px-5 pb-4 pt-4">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-[10px] uppercase tracking-[0.3em] text-white/35">Console</div>
                                <h3 className="mt-2 truncate font-display text-lg font-semibold tracking-[-0.04em] text-white">控制台</h3>
                            </div>
                            <div
                                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.24em] ${
                                    timelineStatus === "saved"
                                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                                        : timelineStatus === "saving"
                                            ? "border-amber-400/30 bg-amber-400/10 text-amber-100"
                                            : timelineStatus === "error"
                                                ? "border-rose-400/30 bg-rose-400/10 text-rose-100"
                                                : "border-white/10 bg-white/[0.05] text-white/55"
                                }`}
                            >
                                {timelineStatus === "saved" ? (
                                    <CheckCircle2 size={12} />
                                ) : timelineStatus === "saving" ? (
                                    <Loader2 size={12} className="animate-spin" />
                                ) : (
                                    <Scissors size={12} />
                                )}
                                {timelineStatus === "saved"
                                    ? "Synced"
                                    : timelineStatus === "saving"
                                        ? "Saving"
                                        : timelineStatus === "error"
                                            ? "Issue"
                                            : "Standby"}
                            </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span
                                className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
                                    clips.length > 0
                                        ? "border-white/10 bg-white/[0.04] text-white/55"
                                        : "border-amber-400/25 bg-amber-400/10 text-amber-100"
                                }`}
                            >
                                {clips.length > 0 ? "Picture Lock" : "No Cuts"}
                            </span>
                            <span
                                className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
                                    timelineDiagnostics?.has_ducking_path
                                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                                        : "border-white/10 bg-white/[0.04] text-white/45"
                                }`}
                            >
                                {timelineDiagnostics?.has_ducking_path ? "Ducking On" : "Ducking Off"}
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-white/55">
                                {currentMixSnapshot.primaryStatusLabel}
                            </span>
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] text-white/45">
                                {formatTime(currentTime)}
                            </span>
                            {mixPrioritySignals.slice(0, 2).map((signal) => (
                                <span
                                    key={signal.id}
                                    title={signal.detail}
                                    className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${signal.tone}`}
                                >
                                    {signal.label}
                                </span>
                            ))}
                        </div>

                        {timelineError ? (
                            <div className="mt-3 rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-xs leading-relaxed text-rose-100">
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
                                    <div className="rounded-2xl border border-white/8 bg-black/20 p-3.5">
                                        <div className="mb-3 flex items-center justify-between">
                                            <div>
                                                <div className="text-[10px] uppercase tracking-[0.24em] text-white/30">Original Audio</div>
                                                <div className="mt-1 text-xs text-white/45">片段级控制视频原声是否参与最终混音。</div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => updateVideoClipAudio(selectedClip.id, { originalAudioEnabled: !selectedClip.originalAudioEnabled })}
                                                className={`rounded-full border px-3 py-1 text-[10px] uppercase tracking-[0.22em] ${selectedClip.originalAudioEnabled ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100" : "border-white/10 bg-white/[0.04] text-white/45"}`}
                                            >
                                                {selectedClip.originalAudioEnabled ? "原声开启" : "原声静音"}
                                            </button>
                                        </div>
                                        <div className="space-y-3">
                                            <div className="space-y-2">
                                                <div className="flex justify-between text-xs text-white/45">
                                                    <span>原声音量</span>
                                                    <span className="font-mono">{Math.round(selectedClip.originalAudioGain * 100)}%</span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="2"
                                                    step="0.01"
                                                    value={selectedClip.originalAudioGain}
                                                    onChange={(event) => updateVideoClipAudio(selectedClip.id, { originalAudioGain: Number(event.target.value) })}
                                                    disabled={!selectedClip.originalAudioEnabled}
                                                    className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-200"
                                                />
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                <div className="space-y-2">
                                                    <div className="flex justify-between text-xs text-white/45">
                                                        <span>原声淡入</span>
                                                        <span className="font-mono">{formatTime(selectedClip.originalAudioFadeInDuration)}</span>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        min="0"
                                                        max={Math.max(Math.max(selectedClip.trimEnd - selectedClip.trimStart, 0.1) - 0.01, 0)}
                                                        step="0.1"
                                                        value={selectedClip.originalAudioFadeInDuration}
                                                        onChange={(event) => updateVideoClipAudio(selectedClip.id, { originalAudioFadeInDuration: Number(event.target.value) })}
                                                        disabled={!selectedClip.originalAudioEnabled}
                                                        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-200"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <div className="flex justify-between text-xs text-white/45">
                                                        <span>原声淡出</span>
                                                        <span className="font-mono">{formatTime(selectedClip.originalAudioFadeOutDuration)}</span>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        min="0"
                                                        max={Math.max(Math.max(selectedClip.trimEnd - selectedClip.trimStart, 0.1) - selectedClip.originalAudioFadeInDuration - 0.01, 0)}
                                                        step="0.1"
                                                        value={selectedClip.originalAudioFadeOutDuration}
                                                        onChange={(event) => updateVideoClipAudio(selectedClip.id, { originalAudioFadeOutDuration: Number(event.target.value) })}
                                                        disabled={!selectedClip.originalAudioEnabled}
                                                        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-200"
                                                    />
                                                </div>
                                            </div>
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
                                    const monitor = trackMonitorState[trackType];
                                    const activeClipCount =
                                        trackType === "video"
                                            ? activeClip
                                                ? 1
                                                : 0
                                            : audioClips.filter(
                                                  (clip) =>
                                                      clip.trackType === trackType &&
                                                      clip.timelineStart <= currentTime &&
                                                      clip.timelineStart + clip.duration >= currentTime,
                                              ).length;
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
                                                            {track.enabled ? "参与导出" : "已静音"} · {track.solo ? "独奏监听" : "正常混音"} · {monitor.detail}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {activeClipCount > 0 || monitor.label !== "Idle" ? (
                                                        <div className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] ${monitor.tone}`}>
                                                            {monitor.label}
                                                        </div>
                                                    ) : null}
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

            <div className="final-mix-timeline relative h-[320px] border-t border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))]">
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
                        <div className="hidden items-center gap-2 xl:flex">
                            {(["video", "dialogue", "sfx", "bgm"] as TimelineTrackType[]).map((trackType) => {
                                const track = trackByType[trackType];
                                if (!track) {
                                    return null;
                                }
                                const monitor = trackMonitorState[trackType];
                                return (
                                    <span key={trackType} className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${monitor.tone}`}>
                                        {TRACK_STYLE_MAP[trackType].shortLabel} {monitor.label}
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="max-w-[280px] truncate rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-100">
                            {editorHud}
                        </div>
                        <div className="hidden max-w-[360px] items-center gap-2 overflow-hidden lg:flex">
                            {currentMixSnapshot.audibleSources.length > 0 ? (
                                currentMixSnapshot.audibleSources.map((source) => (
                                    <span key={source.key} className={`truncate rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${source.tone}`}>
                                        {source.label}
                                    </span>
                                ))
                            ) : (
                                <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-white/45">
                                    Idle Mix
                                </span>
                            )}
                        </div>
                        <div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.22em] text-emerald-100">
                            Snap On
                        </div>
                        <button onClick={() => setZoom(Math.max(0.5, zoom - 0.1))} className="rounded-full border border-white/10 px-2 py-1 text-xs text-white/55 transition-colors hover:text-white">
                            -
                        </button>
                        <span className="text-xs uppercase tracking-[0.22em] text-white/35">Zoom</span>
                        <button onClick={() => setZoom(Math.min(2, zoom + 0.1))} className="rounded-full border border-white/10 px-2 py-1 text-xs text-white/55 transition-colors hover:text-white">
                            +
                        </button>
                    </div>
                </div>
                {currentMixSnapshot.priorityNotes.length > 0 ? (
                    <div className="flex items-center gap-2 border-b border-white/8 px-5 py-2 text-[11px] text-white/62">
                        <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-amber-100">
                            Current Priority
                        </span>
                        <div className="flex flex-wrap gap-2">
                            {currentMixSnapshot.priorityNotes.map((note) => (
                                <span key={note} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">
                                    {note}
                                </span>
                            ))}
                        </div>
                    </div>
                ) : null}

                <div
                    ref={timelineRef}
                    className="relative flex-1 select-none overflow-x-auto overflow-y-hidden custom-scrollbar"
                    onClick={(event) => {
                        if (isScrubbing || draggingAudioClipId || draggingVideoTrimClipId) {
                            return;
                        }
                        seekFromClientX(event.clientX, playIntentRef.current);
                    }}
                    onPointerDown={(event) => {
                        if (draggingAudioClipId || draggingVideoTrimClipId) {
                            return;
                        }
                        setIsScrubbing(true);
                        seekFromClientX(event.clientX, playIntentRef.current);
                    }}
                    onPointerMove={(event) => {
                        if (!isScrubbing || draggingAudioClipId || draggingVideoTrimClipId) {
                            return;
                        }
                        seekFromClientX(event.clientX, playIntentRef.current);
                    }}
                >
                    <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-cyan-300/90 shadow-[0_0_18px_rgba(103,232,249,0.85)]" style={{ left: `${playheadLeftPx}px` }} />
                    <div className="pointer-events-none absolute left-0 top-3 z-30" style={{ transform: `translateX(${Math.max(playheadLeftPx - 56, TRACK_LABEL_WIDTH)}px)` }}>
                        <div className={`rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] shadow-[0_10px_28px_rgba(0,0,0,0.28)] ${playheadStatusTone}`}>
                            {currentMixSnapshot.primaryStatusLabel}
                        </div>
                    </div>
                    {snapGuideLeftPx != null ? (
                        <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-emerald-300/90 shadow-[0_0_16px_rgba(110,231,183,0.9)]" style={{ left: `${snapGuideLeftPx}px` }} />
                    ) : null}
                    {hoverInfo ? (
                        <div className="pointer-events-none absolute right-5 top-4 z-30 w-[260px] rounded-2xl border border-white/10 bg-black/70 px-4 py-3 shadow-[0_18px_45px_rgba(0,0,0,0.38)] backdrop-blur-xl">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-[10px] uppercase tracking-[0.24em] text-white/35">{hoverInfo.trackLabel}</div>
                                    <div className="mt-1 text-sm font-semibold text-white">{hoverInfo.label}</div>
                                </div>
                                <div className="font-mono text-[10px] text-white/55">{formatTime(hoverInfo.duration)}</div>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px] text-white/55">
                                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2">T In {formatTime(hoverInfo.start)}</div>
                                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2">T Out {formatTime(hoverInfo.end)}</div>
                                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2">S In {formatTime(hoverInfo.sourceIn ?? 0)}</div>
                                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2">S Out {formatTime(hoverInfo.sourceOut ?? hoverInfo.duration)}</div>
                            </div>
                            {hoverInfo.gainLabel ? (
                                <div className="mt-2 text-[10px] uppercase tracking-[0.22em] text-white/40">Gain {hoverInfo.gainLabel}</div>
                            ) : null}
                            {hoverInfo.priorityLabel ? (
                                <div className="mt-2 text-[10px] uppercase tracking-[0.22em] text-white/40">State {hoverInfo.priorityLabel}</div>
                            ) : null}
                            {hoverInfo.originalAudioLabel ? (
                                <div className="mt-2 flex items-center gap-2">
                                    <div className="text-[10px] uppercase tracking-[0.22em] text-white/40">{hoverInfo.originalAudioLabel}</div>
                                    {hoverInfo.fadeLabel ? (
                                        <div className="font-mono text-[10px] text-white/45">Fade {hoverInfo.fadeLabel}</div>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    <div className="flex min-h-full min-w-full flex-col" style={{ width: timelineWidthPercent }}>
                        <div className="relative h-10 border-b border-white/8 bg-black/30">
                            <div className="absolute inset-y-0 left-0 z-10 flex w-[136px] items-center border-r border-white/8 bg-black/45 px-4 backdrop-blur-xl">
                                <div>
                                    <div className="text-[10px] uppercase tracking-[0.32em] text-white/35">RUL</div>
                                    <div className="mt-1 text-xs font-semibold text-white/75">时间标尺</div>
                                </div>
                            </div>
                            <div className="relative ml-[136px] h-full">
                                {timeRulerMarks.map((mark, index) => {
                                    const left = timelineDuration > 0 ? (mark / timelineDuration) * 100 : 0;
                                    return (
                                        <div key={`${mark}-${index}`} className="absolute inset-y-0" style={{ left: `${left}%` }}>
                                            <div className="h-full w-px bg-white/10" />
                                            <div className="absolute left-2 top-1.5 font-mono text-[10px] text-white/35">{formatTime(mark)}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                        <div className={`relative h-20 border-b border-white/8 bg-gradient-to-r ${TRACK_STYLE_MAP.video.railTone}`}>
                            <div className="absolute inset-y-0 left-0 z-10 flex w-[136px] items-center border-r border-white/8 bg-black/40 px-4 backdrop-blur-xl">
                                <div>
                                    <div className="text-[10px] uppercase tracking-[0.32em] text-white/35">VID</div>
                                    <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-white">
                                        <Video size={14} />
                                        视频母带
                                    </div>
                                    <div className="mt-1">
                                        <span className={`rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.18em] ${trackMonitorState.video.tone}`}>
                                            {trackMonitorState.video.label}
                                        </span>
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
                                            onMouseEnter={() =>
                                                setHoverInfo({
                                                    label: clip.label,
                                                    trackLabel: TRACK_STYLE_MAP.video.label,
                                                    start: clipDurations.slice(0, index).reduce((sum, duration) => sum + duration, 0),
                                                    end: clipDurations.slice(0, index).reduce((sum, duration) => sum + duration, 0) + clipDuration,
                                                    duration: clipDuration,
                                                    sourceIn: clip.trimStart,
                                                    sourceOut: clip.trimEnd,
                                                    originalAudioLabel: clip.originalAudioEnabled ? `VO ${Math.round(clip.originalAudioGain * 100)}%` : "VO MUTED",
                                                    fadeLabel: clip.originalAudioEnabled
                                                        ? `${formatTime(clip.originalAudioFadeInDuration)} / ${formatTime(clip.originalAudioFadeOutDuration)}`
                                                        : undefined,
                                                    priorityLabel: trackMonitorState.video.label,
                                                })
                                            }
                                            onMouseLeave={() => setHoverInfo((previous) => (previous?.label === clip.label ? null : previous))}
                                            className={`absolute inset-y-2 overflow-hidden rounded-2xl border px-3 py-2 text-left transition-all ${isActive ? "border-cyan-200/45 bg-cyan-400/14 shadow-[0_18px_38px_rgba(34,211,238,0.16)]" : "border-cyan-400/20 bg-cyan-500/10"} ${draggingVideoTrimClipId === clip.id ? "cursor-ew-resize" : ""} ${clip.originalAudioEnabled ? "" : "opacity-85"}`}
                                            style={{ left: `calc(${left}% + ${TRACK_LABEL_WIDTH}px)`, width: `max(${width}%, 84px)` }}
                                        >
                                            <span
                                                onPointerDown={(event) => {
                                                    event.stopPropagation();
                                                    startTrimmingVideoClip(clip, "trimStart", event.clientX);
                                                }}
                                                className="absolute inset-y-0 left-0 z-10 w-3 cursor-ew-resize rounded-l-2xl bg-black/20 transition-colors hover:bg-cyan-100/18"
                                            />
                                            <span
                                                onPointerDown={(event) => {
                                                    event.stopPropagation();
                                                    startTrimmingVideoClip(clip, "trimEnd", event.clientX);
                                                }}
                                                className="absolute inset-y-0 right-0 z-10 w-3 cursor-ew-resize rounded-r-2xl bg-black/20 transition-colors hover:bg-cyan-100/18"
                                            />
                                            {clip.thumbnailUrl ? <img src={clip.thumbnailUrl} className="absolute inset-0 h-full w-full object-cover opacity-30" /> : null}
                                            <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/15 to-transparent" />
                                            {!clip.originalAudioEnabled ? (
                                                <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.06)_0px,rgba(255,255,255,0.06)_6px,transparent_6px,transparent_12px)]" />
                                            ) : null}
                                            <div className="relative flex h-full flex-col justify-between">
                                                <div className="text-[10px] uppercase tracking-[0.22em] text-cyan-100/55">Shot {index + 1}</div>
                                                <div>
                                                    <div className="truncate text-xs font-semibold text-white">{clip.label}</div>
                                                    <div className="mt-1 font-mono text-[10px] text-white/45">{formatTime(clipDuration)}</div>
                                                    <div className="mt-1 font-mono text-[9px] text-white/40">
                                                        In {formatTime(clip.trimStart)} · Out {formatTime(clip.trimEnd)}
                                                    </div>
                                                    <div className="mt-1 flex items-center gap-1.5">
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                updateVideoClipAudio(clip.id, { originalAudioEnabled: !clip.originalAudioEnabled });
                                                            }}
                                                            className={`rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em] transition-colors ${
                                                                clip.originalAudioEnabled
                                                                    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/18"
                                                                    : "border-white/10 bg-white/[0.04] text-white/45 hover:bg-white/[0.08]"
                                                            }`}
                                                            title={clip.originalAudioEnabled ? "点击静音当前片段原声" : "点击启用当前片段原声"}
                                                        >
                                                            {clip.originalAudioEnabled ? `VO ${Math.round(clip.originalAudioGain * 100)}%` : "VO MUTED"}
                                                        </button>
                                                    </div>
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
