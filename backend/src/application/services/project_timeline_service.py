from __future__ import annotations

import os
import tempfile

from .project_service import ProjectService
from ...repository import ProjectRepository
from ...schemas.models import ProjectTimeline, TimelineAsset, TimelineClip, TimelineTrack
from ...utils.audio_waveform import AudioWaveformAnalyzer
from ...utils.datetime import utc_now
from ...utils.oss_utils import OSSImageUploader, is_object_key
from ...utils.system_check import get_ffmpeg_path
from ...utils.temp_media import remove_temp_file


class ProjectTimelineService:
    """项目时间轴工程服务。

    Phase 1 先把时间轴工程稳定成项目级 JSON 真源：
    - 前端通过独立 API 读写
    - 合成导出可以从这里回放
    - 后续再把高频读写热点拆到独立时间轴子表
    """

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.project_service = ProjectService()
        self.waveform_analyzer = AudioWaveformAnalyzer()
        self.oss_uploader = OSSImageUploader()

    def get_timeline(self, project_id: str) -> ProjectTimeline:
        """读取项目时间轴；若项目还没有保存过，则即时根据当前素材生成默认时间轴。"""
        project = self.project_service.get_project(project_id)
        if not project:
            raise ValueError("Project not found")
        if project.timeline:
            normalized = self._normalize_timeline(project.timeline, bump_version=False)
            if normalized.model_dump(mode="json") != project.timeline.model_dump(mode="json"):
                self.project_repository.cache_timeline_snapshot(project_id, normalized.model_dump(mode="json"))
            return normalized
        return self._build_default_timeline(project)

    def save_timeline(self, project_id: str, timeline: ProjectTimeline) -> ProjectTimeline:
        """保存项目时间轴，并返回规范化后的最新版本。"""
        project = self.project_service.get_project(project_id)
        if not project:
            raise ValueError("Project not found")

        normalized = self._normalize_timeline(timeline.model_copy(update={"project_id": project_id}), bump_version=True)
        updated_project = self.project_repository.save_timeline(
            project_id,
            normalized.model_dump(mode="json"),
        )
        if not updated_project.timeline:
            raise ValueError("Project timeline was not persisted correctly")
        return updated_project.timeline

    def build_final_mix_payload(self, timeline: ProjectTimeline | None) -> dict | None:
        """把工程时间轴降级为现有 media.merge 可消费的片段草稿。"""
        if not timeline:
            return None

        video_track_ids = {track.id for track in timeline.tracks if track.track_type == "video"}
        asset_map = {asset.id: asset for asset in timeline.assets}
        clips = []
        for clip in sorted(timeline.clips, key=lambda item: (item.timeline_start, item.clip_order, item.id)):
            if clip.track_id not in video_track_ids:
                continue
            asset = asset_map.get(clip.asset_id)
            if not asset:
                continue
            frame_id = asset.frame_id or clip.metadata.get("frame_id")
            video_task_id = asset.video_task_id or clip.metadata.get("video_task_id")
            if not frame_id or not video_task_id:
                continue
            clips.append(
                {
                    "frame_id": frame_id,
                    "video_id": video_task_id,
                    "clip_order": clip.clip_order,
                    "trim_start": float(clip.source_start),
                    "trim_end": float(clip.source_end),
                }
            )
        return {"clips": clips}

    def _normalize_timeline(self, timeline: ProjectTimeline, bump_version: bool) -> ProjectTimeline:
        """统一修正轨道顺序、片段时长边界和时间轴版本。"""
        tracks = sorted(timeline.tracks, key=lambda item: (item.order, item.id))
        assets = self._hydrate_asset_waveforms(list(timeline.assets))
        asset_map = {asset.id: asset for asset in assets}
        track_order_map = {track.id: track.order for track in tracks}

        clips: list[TimelineClip] = []
        ordered_source_clips = sorted(
            timeline.clips,
            key=lambda item: (
                track_order_map.get(item.track_id, 0),
                item.timeline_start,
                item.lane_index,
                item.clip_order,
                item.id,
            ),
        )
        clip_order_by_track: dict[str, int] = {}
        for clip in ordered_source_clips:
            asset = asset_map.get(clip.asset_id)
            if not asset:
                continue
            asset_duration = max(float(asset.source_duration or 0), 0.1)
            safe_source_start = max(float(clip.source_start or 0), 0.0)
            safe_source_end = float(clip.source_end or asset_duration)
            safe_source_end = max(min(safe_source_end, asset_duration), safe_source_start + 0.1)
            clip_duration = max(safe_source_end - safe_source_start, 0.1)
            safe_fade_in = min(max(float(clip.fade_in_duration or 0), 0.0), max(clip_duration - 0.01, 0.0))
            safe_fade_out = min(max(float(clip.fade_out_duration or 0), 0.0), max(clip_duration - safe_fade_in - 0.01, 0.0))
            requested_timeline_start = max(float(clip.timeline_start or 0), 0.0)
            # 时间轴结束时间始终跟随裁切后的真实可播放时长，避免出现“时长和源媒体不一致”的脏数据。
            safe_timeline_end = round(requested_timeline_start + clip_duration, 3)
            clip_order = clip_order_by_track.get(clip.track_id, 0)
            clip_order_by_track[clip.track_id] = clip_order + 1
            clips.append(
                clip.model_copy(
                    update={
                        "clip_order": clip_order,
                        "timeline_start": round(requested_timeline_start, 3),
                        "timeline_end": safe_timeline_end,
                        "source_start": round(safe_source_start, 3),
                        "source_end": round(safe_source_end, 3),
                        "volume": max(float(clip.volume or 0), 0.0),
                        "fade_in_duration": round(safe_fade_in, 3),
                        "fade_out_duration": round(safe_fade_out, 3),
                    }
                )
            )

        return timeline.model_copy(
            update={
                "tracks": [
                    track.model_copy(
                        update={
                            "gain": round(max(float(track.gain or 0), 0.0), 3),
                            "solo": bool(track.solo),
                        }
                    )
                    for track in tracks
                ],
                "assets": assets,
                "clips": clips,
                "version": max(int(timeline.version or 0), 0) + (1 if bump_version else 0),
                "updated_at": utc_now() if bump_version else timeline.updated_at,
            }
        )

    def _build_default_timeline(self, project) -> ProjectTimeline:
        """根据当前已选素材构建一份可直接编辑的默认时间轴。"""
        tracks = [
            TimelineTrack(id="track_video_main", track_type="video", label="视频", order=0, gain=1.0, solo=False),
            TimelineTrack(id="track_dialogue_main", track_type="dialogue", label="对白", order=1, gain=1.0, solo=False),
            TimelineTrack(id="track_sfx_main", track_type="sfx", label="音效", order=2, gain=0.8, solo=False),
            TimelineTrack(id="track_bgm_main", track_type="bgm", label="背景音乐", order=3, gain=0.5, solo=False),
        ]
        assets: list[TimelineAsset] = []
        clips: list[TimelineClip] = []
        asset_ids: set[str] = set()
        timeline_cursor = 0.0
        video_by_id = {task.id: task for task in project.video_tasks or []}

        for frame in sorted(project.frames or [], key=lambda item: (item.frame_order, item.id)):
            selected_video = video_by_id.get(frame.selected_video_id) if frame.selected_video_id else None
            if not selected_video or not selected_video.video_url:
                continue

            video_duration = max(float(selected_video.duration or 5), 0.1)
            video_asset_id = f"asset_video_{frame.id}_{selected_video.id}"
            if video_asset_id not in asset_ids:
                asset_ids.add(video_asset_id)
                assets.append(
                    TimelineAsset(
                        id=video_asset_id,
                        kind="video",
                        source_url=selected_video.video_url,
                        label=f"镜头 {frame.frame_order + 1 if isinstance(frame.frame_order, int) else frame.id}",
                        source_duration=video_duration,
                        frame_id=frame.id,
                        video_task_id=selected_video.id,
                        role="main",
                    )
                )

            video_clip_id = f"clip_video_{frame.id}_{selected_video.id}"
            clips.append(
                TimelineClip(
                    id=video_clip_id,
                    asset_id=video_asset_id,
                    track_id="track_video_main",
                    clip_order=len(clips),
                    timeline_start=timeline_cursor,
                    timeline_end=timeline_cursor + video_duration,
                    source_start=0,
                    source_end=video_duration,
                    metadata={"frame_id": frame.id, "video_task_id": selected_video.id},
                )
            )

            if frame.audio_url:
                dialogue_asset_id = f"asset_dialogue_{frame.id}"
                if dialogue_asset_id not in asset_ids:
                    asset_ids.add(dialogue_asset_id)
                    assets.append(
                        TimelineAsset(
                            id=dialogue_asset_id,
                            kind="audio",
                            source_url=frame.audio_url,
                            label=f"对白 {frame.frame_order + 1 if isinstance(frame.frame_order, int) else frame.id}",
                            source_duration=video_duration,
                            frame_id=frame.id,
                            role="dialogue",
                        )
                    )
                clips.append(
                    TimelineClip(
                        id=f"clip_dialogue_{frame.id}",
                        asset_id=dialogue_asset_id,
                        track_id="track_dialogue_main",
                        clip_order=len(clips),
                        timeline_start=timeline_cursor,
                        timeline_end=timeline_cursor + video_duration,
                        source_start=0,
                        source_end=video_duration,
                        linked_clip_id=video_clip_id,
                        metadata={"frame_id": frame.id},
                    )
                )

            if frame.sfx_url:
                sfx_asset_id = f"asset_sfx_{frame.id}"
                if sfx_asset_id not in asset_ids:
                    asset_ids.add(sfx_asset_id)
                    assets.append(
                        TimelineAsset(
                            id=sfx_asset_id,
                            kind="audio",
                            source_url=frame.sfx_url,
                            label=f"音效 {frame.frame_order + 1 if isinstance(frame.frame_order, int) else frame.id}",
                            source_duration=video_duration,
                            frame_id=frame.id,
                            role="sfx",
                        )
                    )
                clips.append(
                    TimelineClip(
                        id=f"clip_sfx_{frame.id}",
                        asset_id=sfx_asset_id,
                        track_id="track_sfx_main",
                        clip_order=len(clips),
                        timeline_start=timeline_cursor,
                        timeline_end=timeline_cursor + video_duration,
                        source_start=0,
                        source_end=video_duration,
                        linked_clip_id=video_clip_id,
                        metadata={"frame_id": frame.id},
                    )
                )

            if frame.bgm_url:
                bgm_asset_id = f"asset_bgm_{frame.id}"
                if bgm_asset_id not in asset_ids:
                    asset_ids.add(bgm_asset_id)
                    assets.append(
                        TimelineAsset(
                            id=bgm_asset_id,
                            kind="audio",
                            source_url=frame.bgm_url,
                            label="背景音乐",
                            source_duration=video_duration,
                            frame_id=frame.id,
                            role="bgm",
                        )
                    )
                clips.append(
                    TimelineClip(
                        id=f"clip_bgm_{frame.id}",
                        asset_id=bgm_asset_id,
                        track_id="track_bgm_main",
                        clip_order=len(clips),
                        timeline_start=timeline_cursor,
                        timeline_end=timeline_cursor + video_duration,
                        source_start=0,
                        source_end=video_duration,
                        linked_clip_id=video_clip_id,
                        metadata={"frame_id": frame.id},
                    )
                )

            timeline_cursor += video_duration

        return self._normalize_timeline(
            ProjectTimeline(
                project_id=project.id,
                version=0,
                tracks=tracks,
                assets=assets,
                clips=clips,
            )
            ,
            bump_version=True,
        )

    def _hydrate_asset_waveforms(self, assets: list[TimelineAsset]) -> list[TimelineAsset]:
        """为音频资产补齐 waveform peaks，失败时保持静默降级。"""
        ffmpeg_path = get_ffmpeg_path()
        if not ffmpeg_path:
            return assets

        hydrated_assets: list[TimelineAsset] = []
        for asset in assets:
            if asset.kind != "audio":
                hydrated_assets.append(asset)
                continue

            metadata = dict(asset.metadata or {})
            existing_peaks = metadata.get("waveform_peaks")
            if isinstance(existing_peaks, list) and existing_peaks:
                hydrated_assets.append(asset)
                continue

            peaks = self._build_asset_waveform_peaks(ffmpeg_path, asset.source_url)
            if not peaks:
                hydrated_assets.append(asset)
                continue

            metadata["waveform_peaks"] = peaks
            metadata["waveform_bucket_count"] = len(peaks)
            hydrated_assets.append(asset.model_copy(update={"metadata": metadata}))

        return hydrated_assets

    def _build_asset_waveform_peaks(self, ffmpeg_path: str, source_url: str) -> list[float] | None:
        """把音频资产物化到本地后生成 peaks。"""
        if not source_url:
            return None

        local_path = None
        should_cleanup = False
        try:
            if is_object_key(source_url) or source_url.startswith("http"):
                with tempfile.NamedTemporaryFile(
                    prefix="dramalab-waveform-",
                    suffix=os.path.splitext(source_url)[1] or ".m4a",
                    delete=False,
                ) as temp_file:
                    local_path = temp_file.name
                should_cleanup = True
                if not self.oss_uploader.download_file(source_url, local_path):
                    return None
            elif os.path.exists(source_url):
                local_path = source_url

            if not local_path or not os.path.exists(local_path):
                return None
            return self.waveform_analyzer.build_peaks(ffmpeg_path, local_path)
        except Exception:
            return None
        finally:
            if should_cleanup:
                remove_temp_file(local_path)
