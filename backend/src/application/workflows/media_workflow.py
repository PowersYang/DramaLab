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

from ...providers import AudioGenerator, VideoModelProvider
from ...providers.export.export_provider import ExportManager
from ...repository import ProjectRepository, VideoTaskRepository
from ...utils.path_safety import safe_resolve_path, validate_safe_id
from ...utils import get_logger
from ...utils.datetime import utc_now
from ...utils.system_check import get_ffmpeg_install_instructions, get_ffmpeg_path
from ...utils.oss_utils import OSSImageUploader, is_object_key

logger = get_logger(__name__)


class MediaWorkflow:
    """负责视频生成、音频生成与导出流程编排。"""

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.video_task_repository = VideoTaskRepository()
        self.video_provider = VideoModelProvider()
        self.audio_provider = AudioGenerator()
        self.export_manager = ExportManager()

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
        project.updated_at = utc_now()
        self.project_repository.save(project)
        logger.info("MEDIA_WORKFLOW: generate_video completed script_id=%s", script_id)
        return self._get_project(script_id)

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
        project.updated_at = utc_now()
        self.project_repository.save(project)
        logger.info("MEDIA_WORKFLOW: generate_audio completed script_id=%s", script_id)
        return self._get_project(script_id)

    def process_video_task(self, script_id: str, task_id: str):
        """执行持久化视频任务，并把结果同步回项目聚合。"""
        logger.info("MEDIA_WORKFLOW: process_video_task start script_id=%s task_id=%s", script_id, task_id)
        project = self._get_project(script_id)
        task = self.video_task_repository.get(script_id, task_id)
        if not task:
            logger.error("Task %s not found in script %s", task_id, script_id)
            return

        try:
            task.status = "processing"
            task.failed_reason = None
            self.video_task_repository.save(task)

            img_path = self._download_temp_image(task.image_url) if task.image_url else None
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
            self.video_task_repository.save(task)

        project = self._get_project(script_id)
        self._sync_asset_video_task(project, task)
        project.updated_at = utc_now()
        self.project_repository.save(project)

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
        project.updated_at = utc_now()
        self.project_repository.save(project)
        logger.info("MEDIA_WORKFLOW: generate_dialogue_line completed script_id=%s frame_id=%s", script_id, frame_id)
        return self._get_project(script_id)

    def merge_videos(self, script_id: str):
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

        video_paths = []
        for frame in project.frames:
            # 优先使用用户当前选中的视频；若没有，则退回到该帧第一个已完成任务，兼容旧项目数据。
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
        logger.info("MEDIA_WORKFLOW: merge_videos selected_video_count=%s script_id=%s", len(video_paths), script_id)

        with tempfile.TemporaryDirectory(prefix="lumenx-merge-") as temp_dir:
            list_path = os.path.join(temp_dir, f"merge_list_{script_id}.txt")
            abs_video_paths = []
            with open(list_path, "w") as file_obj:
                for index, path in enumerate(video_paths):
                    materialized_path = self._materialize_media_input(
                        path,
                        temp_dir=temp_dir,
                        filename_hint=f"merge_{index}.mp4",
                    )
                    if materialized_path and os.path.exists(materialized_path):
                        file_obj.write(f"file '{materialized_path}'\n")
                        abs_video_paths.append(materialized_path)

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
                project.merged_video_url = self._persist_output(output_path, "video/merged")
                project.updated_at = utc_now()
                self.project_repository.save(project)
                logger.info("MEDIA_WORKFLOW: merge_videos completed script_id=%s output=%s", script_id, project.merged_video_url)
                return self._get_project(script_id)
            except subprocess.TimeoutExpired:
                raise RuntimeError("FFmpeg timed out. The videos may be too large.")
            except subprocess.CalledProcessError as exc:
                stderr_msg = exc.stderr.decode() if exc.stderr else "No error output"
                raise RuntimeError(self._extract_ffmpeg_error_message(stderr_msg))

    def export_project(self, script_id: str, options: dict):
        """执行导出 provider，并持久化最终输出地址。"""
        logger.info("MEDIA_WORKFLOW: export_project script_id=%s option_keys=%s", script_id, sorted(options.keys()))
        project = self._get_project(script_id)
        # 兼容旧行为：当前导出参数仍未真正接入底层导出管线时，
        # 如果项目已有合成成片，就直接复用它，避免重复做一遍耗时渲染。
        if project.merged_video_url:
            logger.info("MEDIA_WORKFLOW: export_project reuse_merged_video script_id=%s", script_id)
            return {"url": project.merged_video_url}
        export_url = self.export_manager.render_project(project, options)
        export_local_path = safe_resolve_path("output", export_url)
        if os.path.exists(export_local_path):
            project.merged_video_url = self._persist_output(export_local_path, "export")
        else:
            project.merged_video_url = export_url
        project.updated_at = utc_now()
        self.project_repository.save(project)
        logger.info("MEDIA_WORKFLOW: export_project completed script_id=%s url=%s", script_id, project.merged_video_url)
        return {"url": project.merged_video_url}

    def _sync_asset_video_task(self, project, task):
        """把任务更新镜像回仍被 UI 使用的聚合字段。"""
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
        """尽可能把本地图片地址解析成磁盘文件路径。"""
        if not url:
            return None
        if is_object_key(url) or url.startswith("http"):
            with tempfile.NamedTemporaryFile(prefix="lumenx-input-", suffix=os.path.splitext(url)[1] or ".png", delete=False) as tmp:
                tmp_path = tmp.name
            if self._download_to_local(url, tmp_path):
                return tmp_path
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            return None

        local_path = safe_resolve_path("output", url)
        if os.path.exists(local_path):
            return local_path
        return None

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

        local_path = safe_resolve_path("output", source)
        if os.path.exists(local_path):
            return local_path
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
            return "Permission denied when accessing video files.\nPlease check that the application has read/write permissions for the output directory."
        if "disk full" in stderr_lower or "no space" in stderr_lower:
            return "Insufficient disk space to create the merged video.\nPlease free up some space and try again."
        return f"FFmpeg merge failed: {stderr.strip().splitlines()[-1]}"

    def _get_project(self, script_id: str):
        """加载项目聚合，缺失时抛出未找到错误。"""
        project = self.project_repository.get(script_id)
        if not project:
            raise ValueError("Script not found")
        return project
