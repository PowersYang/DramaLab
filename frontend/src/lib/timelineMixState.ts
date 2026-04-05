import type { TimelineTrackType } from "@/lib/api";

export type MixStateTrack = {
    trackType: TimelineTrackType;
    enabled: boolean;
    gain: number;
    solo: boolean;
};

export type MixStateAudioClip = {
    id: string;
    trackType: "dialogue" | "sfx" | "bgm";
    timelineStart: number;
    duration: number;
};

export type MixStateVideoClip = {
    id: string;
    label: string;
    originalAudioEnabled: boolean;
    originalAudioGain: number;
};

export type MixAudibleSource = {
    key: "video-original" | "dialogue" | "sfx" | "bgm";
    label: string;
    detail: string;
    tone: string;
};

export type CurrentMixSnapshot = {
    activeDialogueCount: number;
    activeSfxCount: number;
    activeBgmCount: number;
    dialogueDominant: boolean;
    videoOriginalActive: boolean;
    bgmDucked: boolean;
    hasSoloMix: boolean;
    audibleTrackTypes: TimelineTrackType[];
    excludedBySoloTrackTypes: TimelineTrackType[];
    duckedTrackTypes: TimelineTrackType[];
    priorityNotes: string[];
    audibleSources: MixAudibleSource[];
    primaryStatusLabel: string;
};

type BuildCurrentMixSnapshotInput = {
    currentTime: number;
    tracks: MixStateTrack[];
    activeVideoClip: MixStateVideoClip | null;
    audioClips: MixStateAudioClip[];
};

const ACTIVE_SOURCE_TONES: Record<MixAudibleSource["key"], string> = {
    "video-original": "border-cyan-400/30 bg-cyan-400/10 text-cyan-100",
    dialogue: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
    sfx: "border-amber-400/30 bg-amber-400/10 text-amber-100",
    bgm: "border-rose-400/30 bg-rose-400/10 text-rose-100",
};

// 统一按轨道类型取当前轨道，避免前端多处各自散落 find 逻辑。
const getTrack = (tracks: MixStateTrack[], trackType: TimelineTrackType) =>
    tracks.find((track) => track.trackType === trackType) || null;

// 独奏存在时，只有被 solo 的轨道仍然参与“当前可听”快照。
const isTrackAudible = (track: MixStateTrack | null, hasSoloMix: boolean) => {
    if (!track || !track.enabled) {
        return false;
    }
    if (!hasSoloMix) {
        return true;
    }
    return track.solo;
};

// 这里复用导出链路同样的“时间命中”语义，让预览快照尽量贴近最终导出。
const isClipActiveAtTime = (timelineStart: number, duration: number, currentTime: number) =>
    timelineStart <= currentTime && timelineStart + duration >= currentTime;

export const buildCurrentMixSnapshot = ({
    currentTime,
    tracks,
    activeVideoClip,
    audioClips,
}: BuildCurrentMixSnapshotInput): CurrentMixSnapshot => {
    // 这层快照只回答一件事：当前播放头所在时刻，哪些源会真正参与导出混音。
    const hasSoloMix = tracks.some((track) => track.enabled && track.solo);
    const videoTrack = getTrack(tracks, "video");
    const dialogueTrack = getTrack(tracks, "dialogue");
    const sfxTrack = getTrack(tracks, "sfx");
    const bgmTrack = getTrack(tracks, "bgm");
    const excludedBySoloTrackTypes = hasSoloMix
        ? tracks.filter((track) => track.enabled && !track.solo).map((track) => track.trackType)
        : [];

    const activeDialogueCount = audioClips.filter(
        (clip) =>
            clip.trackType === "dialogue" &&
            isTrackAudible(dialogueTrack, hasSoloMix) &&
            isClipActiveAtTime(clip.timelineStart, clip.duration, currentTime),
    ).length;
    const activeSfxCount = audioClips.filter(
        (clip) =>
            clip.trackType === "sfx" &&
            isTrackAudible(sfxTrack, hasSoloMix) &&
            isClipActiveAtTime(clip.timelineStart, clip.duration, currentTime),
    ).length;
    const activeBgmCount = audioClips.filter(
        (clip) =>
            clip.trackType === "bgm" &&
            isTrackAudible(bgmTrack, hasSoloMix) &&
            isClipActiveAtTime(clip.timelineStart, clip.duration, currentTime),
    ).length;

    const dialogueDominant = activeDialogueCount > 0;
    const videoOriginalActive = Boolean(
        activeVideoClip &&
            activeVideoClip.originalAudioEnabled &&
            activeVideoClip.originalAudioGain > 0 &&
            isTrackAudible(videoTrack, hasSoloMix),
    );
    const bgmDucked = dialogueDominant && activeBgmCount > 0;
    const audibleTrackTypes: TimelineTrackType[] = [];
    if (videoOriginalActive) {
        audibleTrackTypes.push("video");
    }
    if (activeDialogueCount > 0) {
        audibleTrackTypes.push("dialogue");
    }
    if (activeSfxCount > 0) {
        audibleTrackTypes.push("sfx");
    }
    if (activeBgmCount > 0) {
        audibleTrackTypes.push("bgm");
    }
    const duckedTrackTypes: TimelineTrackType[] = bgmDucked ? ["bgm"] : [];
    const priorityNotes: string[] = [];
    if (hasSoloMix) {
        priorityNotes.push("当前处于独奏监听模式，未被 solo 的轨道都会被排除。");
    }
    if (bgmDucked) {
        priorityNotes.push("对白当前抢占混音优先级，BGM 会在导出中自动 ducking。");
    }
    if (videoOriginalActive && (activeDialogueCount > 0 || activeSfxCount > 0 || activeBgmCount > 0)) {
        priorityNotes.push("视频原声与外部音轨同时参与混音。");
    }

    const audibleSources: MixAudibleSource[] = [];
    if (videoOriginalActive && activeVideoClip) {
        audibleSources.push({
            key: "video-original",
            label: "视频原声",
            detail: `${activeVideoClip.label} · ${Math.round(activeVideoClip.originalAudioGain * 100)}%`,
            tone: ACTIVE_SOURCE_TONES["video-original"],
        });
    }
    if (activeDialogueCount > 0) {
        audibleSources.push({
            key: "dialogue",
            label: "对白总线",
            detail: `${activeDialogueCount} 个片段激活`,
            tone: ACTIVE_SOURCE_TONES.dialogue,
        });
    }
    if (activeSfxCount > 0) {
        audibleSources.push({
            key: "sfx",
            label: "音效层",
            detail: `${activeSfxCount} 个片段激活`,
            tone: ACTIVE_SOURCE_TONES.sfx,
        });
    }
    if (activeBgmCount > 0) {
        audibleSources.push({
            key: "bgm",
            label: "音乐总线",
            detail: bgmDucked ? `对白抢占中，ducking 生效 · ${activeBgmCount} 个片段` : `${activeBgmCount} 个片段激活`,
            tone: ACTIVE_SOURCE_TONES.bgm,
        });
    }

    const primaryStatusLabel =
        audibleSources.length > 0
            ? hasSoloMix
                ? "当前为独奏监听混音"
                : bgmDucked
                    ? "当前为对白优先导出快照"
                    : "当前为标准导出快照"
            : "当前无激活混音源";

    return {
        activeDialogueCount,
        activeSfxCount,
        activeBgmCount,
        dialogueDominant,
        videoOriginalActive,
        bgmDucked,
        hasSoloMix,
        audibleTrackTypes,
        excludedBySoloTrackTypes,
        duckedTrackTypes,
        priorityNotes,
        audibleSources,
        primaryStatusLabel,
    };
};
