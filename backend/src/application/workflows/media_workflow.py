"""
媒体工作流。

视频生成、对白音频、合成导出都从这里进入，
不再通过 pipeline 中转。
"""

import os
import platform
import subprocess
import tempfile
import time
from typing import Any

from ...application.services.project_timeline_service import ProjectTimelineService
from ...providers import AudioGenerator, VideoModelProvider
from ...providers.export.export_provider import ExportManager
from ...repository import ProjectRepository, StoryboardFrameRepository, VideoTaskRepository
from ...utils.path_safety import validate_safe_id
from ...utils import get_logger
from ...utils.datetime import utc_now
from ...utils.system_check import get_ffmpeg_install_instructions, get_ffmpeg_path
from ...utils.oss_utils import OSSImageUploader, is_object_key
from ...utils.temp_media import remove_temp_file

logger = get_logger(__name__)


class MediaWorkflow:
    """负责视频生成、音频生成与导出流程编排。"""

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.frame_repository = StoryboardFrameRepository()
        self.video_task_repository = VideoTaskRepository()
        self.video_provider = VideoModelProvider()
        self.audio_provider = AudioGenerator()
        self.export_manager = ExportManager()
        self.project_timeline_service = ProjectTimelineService()

    def get_available_voices(self):
        """向 API 层暴露当前可用的 TTS 音色列表。"""
        logger.info("MEDIA_WORKFLOW: get_available_voices")
        return self.audio_provider.get_available_voices()

    def generate_video(self, script_id: str):
        """为尚未产出视频的分镜帧生成视频片段。"""
        logger.info("MEDIA_WORKFLOW: generate_video script_id=%s", script_id)
        project = self._get_project(script_id)
        for frame in project.frames:
            if frame.status == "completed" and frame.video_url:
                continue
            self.video_provider.generate_clip(frame)
        for frame in project.frames:
            self.frame_repository.save(script_id, frame)
        updated_project = self._get_project(script_id)
        logger.info("MEDIA_WORKFLOW: generate_video completed script_id=%s", script_id)
        return updated_project

    def generate_audio(self, script_id: str):
        """为项目中每一帧生成对白、音效和背景音乐。"""
        logger.info("MEDIA_WORKFLOW: generate_audio script_id=%s", script_id)
        project = self._get_project(script_id)
        for frame in project.frames:
            if frame.dialogue and frame.character_ids:
                speaker = next((item for item in project.characters if item.id == frame.character_ids[0]), None)
                if speaker:
                    self.audio_provider.generate_dialogue(
                        frame,
                        speaker,
                        speed=speaker.voice_speed,
                        pitch=speaker.voice_pitch,
                        volume=speaker.voice_volume,
                    )
            if frame.action_description:
                self.audio_provider.generate_sfx(frame)
            if frame.video_url:
                self.audio_provider.generate_sfx_from_video(frame)
            self.audio_provider.generate_bgm(frame)
        for frame in project.frames:
            self.frame_repository.save(script_id, frame)
        updated_project = self._get_project(script_id)
        logger.info("MEDIA_WORKFLOW: generate_audio completed script_id=%s", script_id)
        return updated_project

    def process_video_task(self, script_id: str, task_id: str):
        """执行持久化视频任务，并把结果同步回项目聚合。"""
        logger.info("MEDIA_WORKFLOW: process_video_task start script_id=%s task_id=%s", script_id, task_id)
        project = self._get_project(script_id)
        task = self.video_task_repository.get(script_id, task_id)
        if not task:
            logger.error("Task %s not found in script %s", task_id, script_id)
            return

        img_path = None
        should_cleanup_img = False
        output_path = None
        try:
            task.status = "processing"
            task.failed_reason = None
            self.video_task_repository.save(task)

            img_path, should_cleanup_img = self._download_temp_image(task.image_url) if task.image_url else (None, False)
            output_path = self.video_provider.build_output_path(task.id)
            self.video_provider.generate_task_video(
                task,
                output_path=output_path,
                img_path=img_path,
                img_url=task.image_url,
            )
            task.video_url = self._persist_output(output_path, "video/tasks")
            task.status = "completed"
            task.completed_at = utc_now()
            logger.info("MEDIA_WORKFLOW: process_video_task completed script_id=%s task_id=%s", script_id, task_id)
        except Exception as exc:
            logger.exception("Failed to process video task")
            logger.error("Video generation failed: %s", exc)
            task.status = "failed"
            task.failed_reason = str(exc)
        finally:
            if should_cleanup_img:
                remove_temp_file(img_path)
            remove_temp_file(output_path)
            self.video_task_repository.save(task)

    def generate_dialogue_line(self, script_id: str, frame_id: str, speed: float, pitch: float, volume: int):
        """按需为单个分镜帧生成对白音频。"""
        logger.info("MEDIA_WORKFLOW: generate_dialogue_line script_id=%s frame_id=%s", script_id, frame_id)
        project = self._get_project(script_id)
        frame = next((item for item in project.frames if item.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")
        if frame.dialogue and frame.character_ids:
            speaker = next((item for item in project.characters if item.id == frame.character_ids[0]), None)
            if speaker:
                self.audio_provider.generate_dialogue(frame, speaker, speed, pitch, volume)
        self.frame_repository.save(script_id, frame)
        updated_project = self._get_project(script_id)
        logger.info("MEDIA_WORKFLOW: generate_dialogue_line completed script_id=%s frame_id=%s", script_id, frame_id)
        return updated_project

    def merge_videos(self, script_id: str, final_mix_timeline: dict | None = None):
        """使用 FFmpeg 把已选中的分镜视频合并成单个输出。"""
        logger.info("MEDIA_WORKFLOW: merge_videos script_id=%s", script_id)
        validate_safe_id(script_id, "script_id")
        project = self._get_project(script_id)
        ffmpeg_path = get_ffmpeg_path()
        if not ffmpeg_path:
            install_instructions = get_ffmpeg_install_instructions()
            raise RuntimeError(
                "FFmpeg is required for video merging but was not found.\n\n"
                f"{install_instructions}\n\n"
                "After installation, restart the application."
            )

        try:
            subprocess.run([ffmpeg_path, "-version"], capture_output=True, text=True, timeout=5)
        except Exception:
            logger.warning("Could not get FFmpeg version")

        clip_specs = self._resolve_merge_clips(project, final_mix_timeline)
        if not clip_specs:
            raise ValueError("No videos selected to merge. Please select videos for each frame first.")
        logger.info("MEDIA_WORKFLOW: merge_videos selected_clip_count=%s script_id=%s", len(clip_specs), script_id)

        with tempfile.TemporaryDirectory(prefix="dramalab-merge-") as temp_dir:
            list_path = os.path.join(temp_dir, f"merge_list_{script_id}.txt")
            abs_video_paths = []
            with open(list_path, "w") as file_obj:
                for index, clip in enumerate(clip_specs):
                    source_path = self._materialize_media_input(
                        clip["video_url"],
                        temp_dir=temp_dir,
                        filename_hint=f"merge_source_{index}.mp4",
                    )
                    if not source_path or not os.path.exists(source_path):
                        continue
                    trimmed_path = self._trim_video_clip(
                        ffmpeg_path,
                        source_path=source_path,
                        temp_dir=temp_dir,
                        index=index,
                        trim_start=float(clip["trim_start"]),
                        trim_end=float(clip["trim_end"]),
                    )
                    if trimmed_path and os.path.exists(trimmed_path):
                        file_obj.write(f"file '{trimmed_path}'\n")
                        abs_video_paths.append(trimmed_path)

            if not abs_video_paths:
                raise ValueError("No valid video files found. The video files may have been deleted or moved.")

            output_path = os.path.join(temp_dir, f"merged_{script_id}_{int(time.time())}.mp4")
            mixed_output_path = os.path.join(temp_dir, f"merged_mix_{script_id}_{int(time.time())}.mp4")

            cmd = [
                ffmpeg_path,
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                list_path,
                "-c:v",
                "libx264",
                "-crf",
                "23",
                "-preset",
                "fast",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-movflags",
                "+faststart",
                output_path,
            ]

            try:
                subprocess.run(cmd, check=True, capture_output=True, timeout=600)
                final_output_path = output_path
                audio_overlay_specs = self._resolve_timeline_audio_clips(project)
                video_audio_segments = self._resolve_video_audio_segments(project)
                if audio_overlay_specs or video_audio_segments:
                    final_output_path = self._mix_timeline_audio(
                        ffmpeg_path=ffmpeg_path,
                        merged_video_path=output_path,
                        mixed_output_path=mixed_output_path,
                        audio_overlay_specs=audio_overlay_specs,
                        video_audio_segments=video_audio_segments,
                        temp_dir=temp_dir,
                    )
                merged_video_url = self._persist_output(final_output_path, "video/merged")
                updated_project = self.project_repository.patch_metadata(
                    script_id,
                    {"merged_video_url": merged_video_url, "updated_at": utc_now()},
                    expected_version=project.version,
                )
                logger.info("MEDIA_WORKFLOW: merge_videos completed script_id=%s output=%s", script_id, merged_video_url)
                return updated_project
            except subprocess.TimeoutExpired:
                raise RuntimeError("FFmpeg timed out. The videos may be too large.")
            except subprocess.CalledProcessError as exc:
                stderr_msg = exc.stderr.decode() if exc.stderr else "No error output"
                raise RuntimeError(self._extract_ffmpeg_error_message(stderr_msg))

    def export_project(self, script_id: str, options: dict):
        """执行导出 provider，并持久化最终输出地址。"""
        logger.info("MEDIA_WORKFLOW: export_project script_id=%s option_keys=%s", script_id, sorted(options.keys()))
        project = self._get_project(script_id)
        final_mix_timeline = options.get("final_mix_timeline")
        if final_mix_timeline:
            logger.info("MEDIA_WORKFLOW: export_project use_final_mix_timeline script_id=%s", script_id)
            project = self.merge_videos(script_id, final_mix_timeline=final_mix_timeline)
            return {"url": project.merged_video_url}
        # 当前 export provider 仍是历史占位实现，会生成不可播放的 dummy 文件。
        # 这里统一回退到真实的合成成片：已有成片就直接复用，没有成片就即时执行一次 merge。
        # 这样至少保证导出的始终是可播放视频；分辨率/格式/字幕参数后续再接入真实导出管线。
        if project.merged_video_url:
            logger.info("MEDIA_WORKFLOW: export_project reuse_merged_video script_id=%s", script_id)
            return {"url": project.merged_video_url}

        logger.info("MEDIA_WORKFLOW: export_project fallback_to_merge script_id=%s", script_id)
        project = self.merge_videos(script_id)
        logger.info("MEDIA_WORKFLOW: export_project completed_via_merge script_id=%s url=%s", script_id, project.merged_video_url)
        return {"url": project.merged_video_url}

    def _resolve_merge_clips(self, project, final_mix_timeline: dict | None = None) -> list[dict]:
        """把前端 Final Mix 草稿解析成可执行的合成片段列表。"""
        if final_mix_timeline and final_mix_timeline.get("clips"):
            clips = []
            video_by_id = {task.id: task for task in project.video_tasks}
            frame_by_id = {frame.id: frame for frame in project.frames}
            for item in sorted(final_mix_timeline.get("clips", []), key=lambda clip: clip.get("clip_order", 0)):
                frame = frame_by_id.get(item.get("frame_id"))
                video = video_by_id.get(item.get("video_id"))
                if not frame or not video or not video.video_url:
                    continue
                trim_start = max(float(item.get("trim_start", 0) or 0), 0.0)
                source_duration = float(video.duration or 5)
                trim_end = float(item.get("trim_end", source_duration) or source_duration)
                trim_end = max(min(trim_end, source_duration), trim_start + 0.1)
                clips.append(
                    {
                        "frame_id": frame.id,
                        "video_id": video.id,
                        "video_url": video.video_url,
                        "trim_start": trim_start,
                        "trim_end": trim_end,
                    }
                )
            if clips:
                return clips

        if project.timeline:
            timeline_payload = self.project_timeline_service.build_final_mix_payload(project.timeline)
            if timeline_payload and timeline_payload.get("clips"):
                return self._resolve_merge_clips(project, final_mix_timeline=timeline_payload)

        clips = []
        for frame in project.frames:
            if frame.selected_video_id:
                video = next((item for item in project.video_tasks if item.id == frame.selected_video_id), None)
                if video and video.video_url:
                    clips.append(
                        {
                            "frame_id": frame.id,
                            "video_id": video.id,
                            "video_url": video.video_url,
                            "trim_start": 0.0,
                            "trim_end": float(video.duration or 5),
                        }
                    )
                continue
            default_video = next((item for item in project.video_tasks if item.frame_id == frame.id and item.status == "completed"), None)
            if default_video and default_video.video_url:
                clips.append(
                    {
                        "frame_id": frame.id,
                        "video_id": default_video.id,
                        "video_url": default_video.video_url,
                        "trim_start": 0.0,
                        "trim_end": float(default_video.duration or 5),
                    }
                )
        return clips

    def _resolve_timeline_audio_clips(self, project) -> list[dict[str, Any]]:
        """从项目时间轴提取需要参与最终混音的音频片段。"""
        timeline = project.timeline
        if not timeline:
            return []

        solo_track_types = {track.track_type for track in timeline.tracks if track.solo}
        track_by_id = {
            track.id: track
            for track in timeline.tracks
            if track.enabled and (not solo_track_types or track.track_type in solo_track_types)
        }
        asset_by_id = {asset.id: asset for asset in timeline.assets}
        audio_specs: list[dict[str, Any]] = []

        for clip in sorted(timeline.clips, key=lambda item: (item.timeline_start, item.clip_order, item.id)):
            track = track_by_id.get(clip.track_id)
            if not track or track.track_type not in {"dialogue", "sfx", "bgm"}:
                continue

            asset = asset_by_id.get(clip.asset_id)
            if not asset or not asset.source_url:
                continue

            asset_duration = max(float(asset.source_duration or 0), 0.1)
            source_start = max(float(clip.source_start or 0), 0.0)
            source_end = float(clip.source_end or asset_duration)
            source_end = max(min(source_end, asset_duration), source_start + 0.1)
            timeline_start = max(float(clip.timeline_start or 0), 0.0)
            duration = max(source_end - source_start, 0.1)
            track_gain = max(float(track.gain or 0), 0.0)
            audio_specs.append(
                {
                    "clip_id": clip.id,
                    "track_type": track.track_type,
                    "source_url": asset.source_url,
                    "timeline_start": round(timeline_start, 3),
                    "source_start": round(source_start, 3),
                    "source_end": round(source_end, 3),
                    "duration": round(duration, 3),
                    "volume": round(max(float(clip.volume or 0), 0.0) * track_gain, 3),
                    "fade_in_duration": round(max(float(clip.fade_in_duration or 0), 0.0), 3),
                    "fade_out_duration": round(max(float(clip.fade_out_duration or 0), 0.0), 3),
                }
            )

        return audio_specs

    def _get_video_track_gain(self, project) -> float:
        """读取视频主轨音量倍率；轨道禁用时直接返回 0。"""
        timeline = project.timeline
        if not timeline:
            return 1.0

        solo_track_types = {track.track_type for track in timeline.tracks if track.solo}
        for track in timeline.tracks:
            if track.track_type != "video":
                continue
            if not track.enabled:
                return 0.0
            if solo_track_types and track.track_type not in solo_track_types:
                return 0.0
            return max(float(track.gain or 0), 0.0)
        return 1.0

    def _resolve_video_audio_segments(self, project) -> list[dict[str, Any]]:
        """从视频轨时间轴提取片段级原声控制，供最终导出时重建视频原声。"""
        timeline = project.timeline
        if not timeline:
            return []

        solo_track_types = {track.track_type for track in timeline.tracks if track.solo}
        video_track = next((track for track in timeline.tracks if track.track_type == "video"), None)
        if not video_track or not video_track.enabled:
            return []
        if solo_track_types and "video" not in solo_track_types:
            return []

        video_track_gain = max(float(video_track.gain or 0), 0.0)
        if video_track_gain <= 0:
            return []

        video_track_ids = {track.id for track in timeline.tracks if track.track_type == "video"}
        segments: list[dict[str, Any]] = []

        for clip in sorted(timeline.clips, key=lambda item: (item.clip_order, item.timeline_start, item.id)):
            if clip.track_id not in video_track_ids:
                continue

            duration = max(float(clip.timeline_end or 0) - float(clip.timeline_start or 0), 0.1)
            metadata = clip.metadata or {}
            if metadata.get("original_audio_enabled", True) is False:
                continue

            clip_gain = max(float(metadata.get("original_audio_gain", 1.0) or 0), 0.0)
            effective_gain = round(video_track_gain * clip_gain, 3)
            if effective_gain <= 0:
                continue

            fade_in_duration = min(
                max(float(metadata.get("original_audio_fade_in_duration", 0.0) or 0), 0.0),
                max(duration - 0.01, 0.0),
            )
            fade_out_duration = min(
                max(float(metadata.get("original_audio_fade_out_duration", 0.0) or 0), 0.0),
                max(duration - fade_in_duration - 0.01, 0.0),
            )
            segments.append(
                {
                    "clip_id": clip.id,
                    "timeline_start": round(max(float(clip.timeline_start or 0), 0.0), 3),
                    "duration": round(duration, 3),
                    "volume": effective_gain,
                    "fade_in_duration": round(fade_in_duration, 3),
                    "fade_out_duration": round(fade_out_duration, 3),
                }
            )

        return segments

    def _trim_video_clip(self, ffmpeg_path: str, source_path: str, temp_dir: str, index: int, trim_start: float, trim_end: float) -> str:
        """把单个视频片段裁切成标准化中间文件，供后续 concat 使用。"""
        duration = max(trim_end - trim_start, 0.1)
        output_path = os.path.join(temp_dir, f"merge_clip_{index}.mp4")
        cmd = [
            ffmpeg_path,
            "-y",
            "-ss",
            f"{trim_start:.3f}",
            "-i",
            source_path,
            "-t",
            f"{duration:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            output_path,
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=600)
            return output_path
        except subprocess.CalledProcessError as exc:
            stderr_msg = exc.stderr.decode() if exc.stderr else "No error output"
            raise RuntimeError(self._extract_ffmpeg_error_message(stderr_msg))

    def _mix_timeline_audio(
        self,
        ffmpeg_path: str,
        merged_video_path: str,
        mixed_output_path: str,
        audio_overlay_specs: list[dict[str, Any]],
        video_audio_segments: list[dict[str, Any]],
        temp_dir: str,
    ) -> str:
        """把 timeline 音频片段按绝对时间位置混入最终成片。"""
        local_audio_inputs: list[str] = []
        normalized_specs: list[dict[str, Any]] = []

        for index, spec in enumerate(audio_overlay_specs):
            local_path = self._materialize_media_input(
                spec["source_url"],
                temp_dir=temp_dir,
                filename_hint=f"merge_audio_{index}.m4a",
            )
            if not local_path or not os.path.exists(local_path):
                continue
            normalized_specs.append({**spec, "local_path": local_path})
            local_audio_inputs.append(local_path)

        if not normalized_specs and not video_audio_segments:
            return merged_video_path

        filter_parts: list[str] = []
        final_mix_labels: list[str] = []
        grouped_labels: dict[str, list[str]] = {"dialogue": [], "sfx": [], "bgm": []}

        has_base_audio = self._video_has_audio_stream(ffmpeg_path, merged_video_path) and bool(video_audio_segments)
        if has_base_audio:
            video_segment_labels: list[str] = []
            for index, segment in enumerate(video_audio_segments):
                label = f"va{index}"
                timeline_start = max(float(segment["timeline_start"]), 0.0)
                duration = max(float(segment["duration"]), 0.1)
                volume = max(float(segment["volume"]), 0.0)
                fade_in_duration = min(max(float(segment.get("fade_in_duration") or 0), 0.0), max(duration - 0.01, 0.0))
                fade_out_duration = min(max(float(segment.get("fade_out_duration") or 0), 0.0), max(duration - fade_in_duration - 0.01, 0.0))
                delay_ms = max(int(round(timeline_start * 1000)), 0)
                audio_filter = (
                    f"[0:a]atrim=start={timeline_start:.3f}:duration={duration:.3f},"
                    f"asetpts=PTS-STARTPTS,volume={volume:.3f}"
                )
                if fade_in_duration > 0:
                    audio_filter += f",afade=t=in:st=0:d={fade_in_duration:.3f}"
                if fade_out_duration > 0:
                    fade_out_start = max(duration - fade_out_duration, 0.0)
                    audio_filter += f",afade=t=out:st={fade_out_start:.3f}:d={fade_out_duration:.3f}"
                filter_parts.append(f"{audio_filter},adelay={delay_ms}|{delay_ms}[{label}]")
                video_segment_labels.append(f"[{label}]")

            if video_segment_labels:
                filter_parts.append(
                    f"{''.join(video_segment_labels)}amix=inputs={len(video_segment_labels)}:normalize=0:dropout_transition=0[basea]"
                )
                final_mix_labels.append("[basea]")

        for index, spec in enumerate(normalized_specs, start=1):
            delay_ms = max(int(round(float(spec["timeline_start"]) * 1000)), 0)
            source_start = float(spec["source_start"])
            duration = max(float(spec["duration"]), 0.1)
            volume = max(float(spec["volume"]), 0.0)
            fade_in_duration = min(max(float(spec.get("fade_in_duration") or 0), 0.0), max(duration - 0.01, 0.0))
            fade_out_duration = min(max(float(spec.get("fade_out_duration") or 0), 0.0), max(duration - fade_in_duration - 0.01, 0.0))
            label = f"a{index}"
            audio_filter = (
                f"[{index}:a]atrim=start={source_start:.3f}:duration={duration:.3f},"
                f"asetpts=PTS-STARTPTS,volume={volume:.3f}"
            )
            if fade_in_duration > 0:
                audio_filter += f",afade=t=in:st=0:d={fade_in_duration:.3f}"
            if fade_out_duration > 0:
                fade_out_start = max(duration - fade_out_duration, 0.0)
                audio_filter += f",afade=t=out:st={fade_out_start:.3f}:d={fade_out_duration:.3f}"
            filter_parts.append(
                f"{audio_filter},adelay={delay_ms}|{delay_ms}[{label}]"
            )
            if spec["track_type"] in grouped_labels:
                grouped_labels[spec["track_type"]].append(f"[{label}]")

        dialogue_bus = self._build_mix_bus_filter(filter_parts, grouped_labels["dialogue"], "dialoguebus")
        sfx_bus = self._build_mix_bus_filter(filter_parts, grouped_labels["sfx"], "sfxbus")
        bgm_bus = self._build_mix_bus_filter(filter_parts, grouped_labels["bgm"], "bgmbus")

        if dialogue_bus and bgm_bus:
            filter_parts.append(
                f"{bgm_bus}{dialogue_bus}sidechaincompress="
                "threshold=0.08:ratio=10:attack=5:release=250:makeup=1[bgmduck]"
            )
            bgm_bus = "[bgmduck]"

        for bus in [dialogue_bus, sfx_bus, bgm_bus]:
            if bus:
                final_mix_labels.append(bus)

        if not final_mix_labels:
            return merged_video_path

        filter_parts.append(
            f"{''.join(final_mix_labels)}amix=inputs={len(final_mix_labels)}:normalize=0:dropout_transition=0[aout]"
        )
        cmd = [ffmpeg_path, "-y", "-i", merged_video_path]
        for local_input in local_audio_inputs:
            cmd.extend(["-i", local_input])
        cmd.extend(
            [
                "-filter_complex",
                ";".join(filter_parts),
                "-map",
                "0:v",
                "-map",
                "[aout]",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-movflags",
                "+faststart",
                "-shortest",
                mixed_output_path,
            ]
        )

        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=600)
            return mixed_output_path
        except subprocess.CalledProcessError as exc:
            stderr_msg = exc.stderr.decode() if exc.stderr else "No error output"
            raise RuntimeError(self._extract_ffmpeg_error_message(stderr_msg))

    def _build_mix_bus_filter(self, filter_parts: list[str], input_labels: list[str], bus_name: str) -> str | None:
        """把同类音轨片段汇总成一个总线 label。"""
        if not input_labels:
            return None
        if len(input_labels) == 1:
            return input_labels[0]
        filter_parts.append(
            f"{''.join(input_labels)}amix=inputs={len(input_labels)}:normalize=0:dropout_transition=0[{bus_name}]"
        )
        return f"[{bus_name}]"

    def _video_has_audio_stream(self, ffmpeg_path: str, video_path: str) -> bool:
        """判断输入视频是否包含可用音频流。"""
        try:
            result = subprocess.run(
                [ffmpeg_path, "-i", video_path],
                capture_output=True,
                text=True,
                timeout=10,
            )
        except Exception:
            return False

        inspect_output = "\n".join([result.stdout or "", result.stderr or ""]).lower()
        return "audio:" in inspect_output

    def _download_temp_image(self, url: str) -> tuple[str | None, bool]:
        """尽可能把本地图片地址解析成磁盘文件路径。"""
        if not url:
            return None, False
        if is_object_key(url) or url.startswith("http"):
            with tempfile.NamedTemporaryFile(prefix="dramalab-input-", suffix=os.path.splitext(url)[1] or ".png", delete=False) as tmp:
                tmp_path = tmp.name
            if self._download_to_local(url, tmp_path):
                return tmp_path, True
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            return None, False

        if os.path.exists(url):
            return url, False
        return None, False

    def _persist_output(self, local_path: str, sub_path: str) -> str:
        """把导出结果持久化到 OSS。

        导出地址会直接回给前端下载，当前已经不再暴露本地静态目录，
        所以这里不能回退本地相对路径，必须确保最终产物已经落到对象存储。
        """
        try:
            uploader = OSSImageUploader()
            if uploader.is_configured:
                object_key = uploader.upload_file(local_path, sub_path=sub_path)
                if object_key:
                    return object_key
        except Exception as exc:
            logger.error("Failed to upload output %s to OSS: %s", local_path, exc)
        raise RuntimeError(f"Failed to upload output {local_path} to OSS.")

    def _download_to_local(self, source: str, local_path: str) -> bool:
        uploader = OSSImageUploader()
        if is_object_key(source):
            return uploader.download_file(source, local_path)
        if source.startswith("http"):
            return uploader.download_file(source, local_path)
        return False

    def _materialize_media_input(self, source: str, temp_dir: str, filename_hint: str) -> str | None:
        """把 OSS 对象或远程地址下载成本地临时文件，供 FFmpeg 使用。"""
        if not source:
            return None

        if is_object_key(source) or source.startswith("http"):
            local_path = os.path.join(temp_dir, filename_hint)
            return local_path if self._download_to_local(source, local_path) else None

        if os.path.exists(source):
            return source
        return None

    def _extract_ffmpeg_error_message(self, stderr: str):
        """把常见 FFmpeg 错误映射成更可读的用户提示。"""
        if not stderr:
            return "FFmpeg merge failed with no error output. Please check the log files."
        stderr_lower = stderr.lower()
        if "no such file or directory" in stderr_lower:
            return "One or more video files could not be found.\nThe videos may have been deleted or moved.\nPlease try regenerating the missing videos."
        if "invalid data found" in stderr_lower or "moov atom not found" in stderr_lower:
            return "One or more video files are corrupted or incomplete.\nPlease try regenerating the affected videos."
        if "permission denied" in stderr_lower or "access is denied" in stderr_lower:
            return "Permission denied when accessing temporary video files.\nPlease check that the application has read/write permissions for the system temp directory."
        if "disk full" in stderr_lower or "no space" in stderr_lower:
            return "Insufficient disk space to create the merged video.\nPlease free up some space and try again."
        return f"FFmpeg merge failed: {stderr.strip().splitlines()[-1]}"

    def _get_project(self, script_id: str):
        """加载项目聚合，缺失时抛出未找到错误。"""
        project = self.project_repository.get(script_id)
        if not project:
            raise ValueError("Script not found")
        return project
