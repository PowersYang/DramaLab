"""
视频任务应用服务。

这里负责创建持久化视频生成任务，
并把请求侧的任务准备逻辑从控制器中拆出来。
"""

import os
import shutil
import uuid

from ...common.log import get_logger
from ...repository import ProjectRepository, VideoTaskRepository
from ...schemas.models import VideoTask
from ...utils.path_safety import safe_resolve_path, validate_safe_id
from .character_service import CharacterService


logger = get_logger(__name__)


class VideoTaskService:
    """负责视频任务创建及请求侧辅助逻辑。"""

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.video_task_repository = VideoTaskRepository()

    def create_tasks(
        self,
        script_id: str,
        image_url: str,
        prompt: str,
        batch_size: int = 1,
        duration: int = 5,
        seed: int | None = None,
        resolution: str = "720p",
        generate_audio: bool = False,
        audio_url: str | None = None,
        prompt_extend: bool = True,
        negative_prompt: str | None = None,
        model: str = "wan2.6-i2v",
        frame_id: str | None = None,
        shot_type: str = "single",
        generation_mode: str = "i2v",
        reference_video_urls: list | None = None,
        mode: str | None = None,
        sound: str | None = None,
        cfg_scale: float | None = None,
        vidu_audio: bool | None = None,
        movement_amplitude: str | None = None,
    ) -> list[VideoTask]:
        """为项目创建一个或多个持久化视频任务。"""
        logger.info(
            "VIDEO_TASK_SERVICE: create_tasks script_id=%s batch_size=%s model=%s generation_mode=%s frame_id=%s",
            script_id,
            batch_size,
            model,
            generation_mode,
            frame_id,
        )
        project = self.project_repository.get(script_id)
        if not project:
            logger.warning("VIDEO_TASK_SERVICE: create_tasks project_missing script_id=%s", script_id)
            raise ValueError("Script not found")

        tasks = []
        for _ in range(batch_size):
            task_id = str(uuid.uuid4())
            final_model = "wan2.6-r2v" if generation_mode == "r2v" else model
            snapshot_url = self._snapshot_input_image(task_id, image_url)
            task = VideoTask(
                id=task_id,
                project_id=script_id,
                frame_id=frame_id,
                image_url=snapshot_url,
                prompt=prompt,
                status="pending",
                duration=duration,
                seed=seed,
                resolution=resolution,
                generate_audio=generate_audio,
                audio_url=audio_url,
                prompt_extend=prompt_extend,
                negative_prompt=negative_prompt,
                model=final_model,
                shot_type=shot_type,
                generation_mode=generation_mode,
                reference_video_urls=reference_video_urls or [],
                mode=mode,
                sound=sound,
                cfg_scale=cfg_scale,
                vidu_audio=vidu_audio,
                movement_amplitude=movement_amplitude,
            )
            self.video_task_repository.save(task)
            tasks.append(task)

        logger.info("VIDEO_TASK_SERVICE: create_tasks completed script_id=%s task_count=%s", script_id, len(tasks))
        return tasks

    def bind_voice(self, script_id: str, char_id: str, voice_id: str, voice_name: str):
        """把语音绑定请求转交给角色服务。"""
        logger.info("VIDEO_TASK_SERVICE: bind_voice script_id=%s char_id=%s voice_id=%s", script_id, char_id, voice_id)
        return CharacterService().bind_voice(script_id, char_id, voice_id, voice_name)

    def update_voice_params(self, script_id: str, char_id: str, speed: float, pitch: float, volume: int):
        """把语音参数更新请求转交给角色服务。"""
        logger.info("VIDEO_TASK_SERVICE: update_voice_params script_id=%s char_id=%s", script_id, char_id)
        return CharacterService().update_voice_params(script_id, char_id, speed, pitch, volume)

    def _snapshot_input_image(self, task_id: str, image_url: str) -> str:
        """复制本地输入图片，避免后续编辑影响已创建任务。"""
        snapshot_url = image_url
        try:
            if image_url and not image_url.startswith("http"):
                src_path = safe_resolve_path("output", image_url)
                if os.path.exists(src_path) and os.path.isfile(src_path):
                    snapshot_dir = os.path.join("output", "video_inputs")
                    os.makedirs(snapshot_dir, exist_ok=True)
                    ext = os.path.splitext(os.path.basename(image_url))[1] or ".png"
                    validate_safe_id(task_id, "task_id")
                    snapshot_filename = f"{task_id}{ext}"
                    snapshot_path = safe_resolve_path(snapshot_dir, snapshot_filename)
                    shutil.copy2(src_path, snapshot_path)
                    snapshot_url = f"video_inputs/{snapshot_filename}"
                    logger.info("VIDEO_TASK_SERVICE: snapshot_input_image task_id=%s snapshot_url=%s", task_id, snapshot_url)
        except Exception:
            logger.exception("VIDEO_TASK_SERVICE: snapshot_input_image failed task_id=%s", task_id)
            snapshot_url = image_url
        return snapshot_url
