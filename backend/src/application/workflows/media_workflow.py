"""
媒体工作流。

视频生成、对白音频、合成导出都从这里进入，
不再通过 pipeline 中转。
"""

import os
import platform
import subprocess
import time

from ...providers import AudioGenerator, VideoModelProvider
from ...providers.export.export_provider import ExportManager
from ...repository import ProjectRepository, VideoTaskRepository
from ...utils.path_safety import safe_resolve_path, validate_safe_id
from ...utils import get_logger
from ...utils.system_check import get_ffmpeg_install_instructions, get_ffmpeg_path

logger = get_logger(__name__)


class MediaWorkflow:
    """Coordinate video generation, audio generation, and export flows."""

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.video_task_repository = VideoTaskRepository()
        self.video_provider = VideoModelProvider()
        self.audio_provider = AudioGenerator()
        self.export_manager = ExportManager()

    def get_available_voices(self):
        """Expose available TTS voice metadata to the API layer."""
        return self.audio_provider.get_available_voices()

    def generate_video(self, script_id: str):
        """Generate clip videos for frames that do not already have outputs."""
        project = self._get_project(script_id)
        for frame in project.frames:
            if frame.status == "completed" and frame.video_url:
                continue
            self.video_provider.generate_clip(frame)
        project.updated_at = time.time()
        self.project_repository.save(project)
        return self._get_project(script_id)

    def generate_audio(self, script_id: str):
        """Generate dialogue, SFX, and BGM for each frame in the project."""
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
        project.updated_at = time.time()
        self.project_repository.save(project)
        return self._get_project(script_id)

    def process_video_task(self, script_id: str, task_id: str):
        """Execute a persisted video task and mirror results back to the project."""
        project = self._get_project(script_id)
        task = self.video_task_repository.get(script_id, task_id)
        if not task:
            logger.error("Task %s not found in script %s", task_id, script_id)
            return

        try:
            task.status = "processing"
            self.video_task_repository.save(task)

            img_path = self._download_temp_image(task.image_url) if task.image_url else None
            output_path = self.video_provider.build_output_path(task.id)
            self.video_provider.generate_task_video(
                task,
                output_path=output_path,
                img_path=img_path,
                img_url=task.image_url,
            )
            task.video_url = os.path.relpath(output_path, "output")
            task.status = "completed"
        except Exception as exc:
            logger.exception("Failed to process video task")
            logger.error("Video generation failed: %s", exc)
            task.status = "failed"
        finally:
            self.video_task_repository.save(task)

        project = self._get_project(script_id)
        self._sync_asset_video_task(project, task)
        project.updated_at = time.time()
        self.project_repository.save(project)

    def generate_dialogue_line(self, script_id: str, frame_id: str, speed: float, pitch: float, volume: int):
        """Generate dialogue audio for a single frame on demand."""
        project = self._get_project(script_id)
        frame = next((item for item in project.frames if item.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")
        if frame.dialogue and frame.character_ids:
            speaker = next((item for item in project.characters if item.id == frame.character_ids[0]), None)
            if speaker:
                self.audio_provider.generate_dialogue(frame, speaker, speed, pitch, volume)
        project.updated_at = time.time()
        self.project_repository.save(project)
        return self._get_project(script_id)

    def merge_videos(self, script_id: str):
        """Merge selected frame videos into a single output using FFmpeg."""
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

        video_paths = []
        for frame in project.frames:
            # Prefer the user-selected video. Fall back to the first completed
            # task for compatibility with older projects and partial edits.
            if frame.selected_video_id:
                video = next((item for item in project.video_tasks if item.id == frame.selected_video_id), None)
                if video and video.video_url:
                    video_paths.append(video.video_url)
                continue
            default_video = next((item for item in project.video_tasks if item.frame_id == frame.id and item.status == "completed"), None)
            if default_video and default_video.video_url:
                video_paths.append(default_video.video_url)

        if not video_paths:
            raise ValueError("No videos selected to merge. Please select videos for each frame first.")

        list_path = safe_resolve_path("output", f"merge_list_{script_id}.txt")
        abs_video_paths = []
        with open(list_path, "w") as file_obj:
            for path in video_paths:
                if path.startswith("http"):
                    continue
                abs_path = safe_resolve_path("output", path)
                if os.path.exists(abs_path):
                    file_obj.write(f"file '{abs_path}'\n")
                    abs_video_paths.append(abs_path)

        if not abs_video_paths:
            raise ValueError("No valid video files found. The video files may have been deleted or moved.")

        output_filename = f"merged_{script_id}_{int(time.time())}.mp4"
        output_path = safe_resolve_path(os.path.join("output", "video"), output_filename)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

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
            project.merged_video_url = f"videos/{output_filename}"
            project.updated_at = time.time()
            self.project_repository.save(project)
            if os.path.exists(list_path):
                os.remove(list_path)
            return self._get_project(script_id)
        except subprocess.TimeoutExpired:
            raise RuntimeError("FFmpeg timed out. The videos may be too large.")
        except subprocess.CalledProcessError as exc:
            stderr_msg = exc.stderr.decode() if exc.stderr else "No error output"
            raise RuntimeError(self._extract_ffmpeg_error_message(stderr_msg))

    def export_project(self, script_id: str, options: dict):
        """Run the export provider and persist the resulting output URL."""
        project = self._get_project(script_id)
        export_url = self.export_manager.render_project(project, options)
        project.merged_video_url = export_url
        project.updated_at = time.time()
        self.project_repository.save(project)
        return {"url": export_url}

    def _sync_asset_video_task(self, project, task):
        """Mirror task updates into aggregate fields still consumed by the UI."""
        if not task.asset_id:
            return
        target_asset = next((item for item in project.characters if item.id == task.asset_id), None)
        if not target_asset:
            target_asset = next((item for item in project.scenes if item.id == task.asset_id), None)
        if not target_asset:
            target_asset = next((item for item in project.props if item.id == task.asset_id), None)
        if not target_asset:
            return

        for index, existing_task in enumerate(target_asset.video_assets):
            if existing_task.id == task.id:
                target_asset.video_assets[index] = task
                break
        else:
            target_asset.video_assets.append(task)

        for index, existing_task in enumerate(project.video_tasks):
            if existing_task.id == task.id:
                project.video_tasks[index] = task
                break
        else:
            project.video_tasks.append(task)

    def _download_temp_image(self, url: str):
        """Resolve a local image URL into an on-disk file path when possible."""
        if not url:
            return None
        if not url.startswith("http"):
            local_path = safe_resolve_path("output", url)
        if os.path.exists(local_path):
            return local_path
        return None
        return None

    def _extract_ffmpeg_error_message(self, stderr: str):
        """Map common FFmpeg failures to more actionable user-facing messages."""
        if not stderr:
            return "FFmpeg merge failed with no error output. Please check the log files."
        stderr_lower = stderr.lower()
        if "no such file or directory" in stderr_lower:
            return "One or more video files could not be found.\nThe videos may have been deleted or moved.\nPlease try regenerating the missing videos."
        if "invalid data found" in stderr_lower or "moov atom not found" in stderr_lower:
            return "One or more video files are corrupted or incomplete.\nPlease try regenerating the affected videos."
        if "permission denied" in stderr_lower or "access is denied" in stderr_lower:
            return "Permission denied when accessing video files.\nPlease check that the application has read/write permissions for the output directory."
        if "disk full" in stderr_lower or "no space" in stderr_lower:
            return "Insufficient disk space to create the merged video.\nPlease free up some space and try again."
        return f"FFmpeg merge failed: {stderr.strip().splitlines()[-1]}"

    def _get_project(self, script_id: str):
        """Load a project aggregate or raise a not-found error."""
        project = self.project_repository.get(script_id)
        if not project:
            raise ValueError("Script not found")
        return project
