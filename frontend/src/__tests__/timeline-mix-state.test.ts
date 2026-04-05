import { describe, expect, it } from "vitest";

import { buildCurrentMixSnapshot } from "@/lib/timelineMixState";

describe("buildCurrentMixSnapshot", () => {
    it("在正常混音下识别对白优先、视频原声和自动 ducking", () => {
        const snapshot = buildCurrentMixSnapshot({
            currentTime: 2,
            activeVideoClip: {
                id: "video-1",
                label: "镜头 1",
                originalAudioEnabled: true,
                originalAudioGain: 0.8,
            },
            tracks: [
                { trackType: "video", enabled: true, gain: 1, solo: false },
                { trackType: "dialogue", enabled: true, gain: 1, solo: false },
                { trackType: "sfx", enabled: true, gain: 0.9, solo: false },
                { trackType: "bgm", enabled: true, gain: 0.7, solo: false },
            ],
            audioClips: [
                { id: "d-1", trackType: "dialogue", timelineStart: 1, duration: 3 },
                { id: "b-1", trackType: "bgm", timelineStart: 0, duration: 10 },
                { id: "s-1", trackType: "sfx", timelineStart: 1.5, duration: 0.6 },
            ],
        });

        expect(snapshot.dialogueDominant).toBe(true);
        expect(snapshot.videoOriginalActive).toBe(true);
        expect(snapshot.bgmDucked).toBe(true);
        expect(snapshot.hasSoloMix).toBe(false);
        expect(snapshot.audibleTrackTypes).toEqual(["video", "dialogue", "sfx", "bgm"]);
        expect(snapshot.excludedBySoloTrackTypes).toEqual([]);
        expect(snapshot.duckedTrackTypes).toEqual(["bgm"]);
        expect(snapshot.priorityNotes).toEqual([
            "对白当前抢占混音优先级，BGM 会在导出中自动 ducking。",
            "视频原声与外部音轨同时参与混音。",
        ]);
        expect(snapshot.activeDialogueCount).toBe(1);
        expect(snapshot.activeSfxCount).toBe(1);
        expect(snapshot.activeBgmCount).toBe(1);
        expect(snapshot.audibleSources.map((source) => source.key)).toEqual(["video-original", "dialogue", "sfx", "bgm"]);
        expect(snapshot.audibleSources.find((source) => source.key === "bgm")?.detail).toContain("ducking");
    });

    it("在独奏监听下只保留被 solo 的轨道来源", () => {
        const snapshot = buildCurrentMixSnapshot({
            currentTime: 4,
            activeVideoClip: {
                id: "video-2",
                label: "镜头 2",
                originalAudioEnabled: true,
                originalAudioGain: 0.6,
            },
            tracks: [
                { trackType: "video", enabled: true, gain: 1, solo: false },
                { trackType: "dialogue", enabled: true, gain: 1, solo: true },
                { trackType: "sfx", enabled: true, gain: 1, solo: false },
                { trackType: "bgm", enabled: true, gain: 1, solo: false },
            ],
            audioClips: [
                { id: "d-2", trackType: "dialogue", timelineStart: 3, duration: 4 },
                { id: "b-2", trackType: "bgm", timelineStart: 0, duration: 10 },
                { id: "s-2", trackType: "sfx", timelineStart: 3.5, duration: 1 },
            ],
        });

        expect(snapshot.hasSoloMix).toBe(true);
        expect(snapshot.audibleTrackTypes).toEqual(["dialogue"]);
        expect(snapshot.excludedBySoloTrackTypes).toEqual(["video", "sfx", "bgm"]);
        expect(snapshot.duckedTrackTypes).toEqual([]);
        expect(snapshot.priorityNotes).toEqual(["当前处于独奏监听模式，未被 solo 的轨道都会被排除。"]);
        expect(snapshot.videoOriginalActive).toBe(false);
        expect(snapshot.activeDialogueCount).toBe(1);
        expect(snapshot.activeSfxCount).toBe(0);
        expect(snapshot.activeBgmCount).toBe(0);
        expect(snapshot.audibleSources.map((source) => source.key)).toEqual(["dialogue"]);
    });

    it("在当前没有可听源时给出空快照", () => {
        const snapshot = buildCurrentMixSnapshot({
            currentTime: 8,
            activeVideoClip: {
                id: "video-3",
                label: "镜头 3",
                originalAudioEnabled: false,
                originalAudioGain: 0.5,
            },
            tracks: [
                { trackType: "video", enabled: true, gain: 1, solo: false },
                { trackType: "dialogue", enabled: true, gain: 1, solo: false },
                { trackType: "sfx", enabled: false, gain: 1, solo: false },
                { trackType: "bgm", enabled: false, gain: 1, solo: false },
            ],
            audioClips: [],
        });

        expect(snapshot.videoOriginalActive).toBe(false);
        expect(snapshot.dialogueDominant).toBe(false);
        expect(snapshot.audibleTrackTypes).toEqual([]);
        expect(snapshot.excludedBySoloTrackTypes).toEqual([]);
        expect(snapshot.duckedTrackTypes).toEqual([]);
        expect(snapshot.priorityNotes).toEqual([]);
        expect(snapshot.audibleSources).toEqual([]);
        expect(snapshot.primaryStatusLabel).toBe("当前无激活混音源");
    });
});
