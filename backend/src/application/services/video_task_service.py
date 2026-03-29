"""
视频任务应用服务。

这里负责创建持久化视频生成任务，
并把请求侧的任务准备逻辑从控制器中拆出来。
"""

import os
import shutil
import uuid

from ..tasks import TaskService
from ...common.log import get_logger
from ...repository import ProjectRepository, VideoTaskRepository
from ...schemas.models import VideoTask
from ...schemas.task_models import TaskReceipt, TaskType
from ...utils.path_safety import safe_resolve_path, validate_safe_id
from .character_service import CharacterService
from .model_provider_service import ModelProviderService


logger = get_logger(__name__)


class VideoTaskService:
    """负责视频任务创建及请求侧辅助逻辑。"""

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.video_task_repository = VideoTaskRepository()
        self.task_service = TaskService()
        self.model_provider_service = ModelProviderService()

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
        """为项目创建一个或多个持久化视频任务占位记录。"""
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
        self.model_provider_service.require_model_enabled(model, "i2v")

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

    def create_video_generation_jobs(
        self,
        *,
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
        asset_id: str | None = None,
        shot_type: str = "single",
        generation_mode: str = "i2v",
        reference_video_urls: list | None = None,
        mode: str | None = None,
        sound: str | None = None,
        cfg_scale: float | None = None,
        vidu_audio: bool | None = None,
        movement_amplitude: str | None = None,
        idempotency_key: str | None = None,
        task_type: str | None = None,
    ) -> list[TaskReceipt]:
        """创建视频任务占位记录并登记到统一任务表。

        这里仍然保留旧的 VideoTask 业务表，确保项目聚合和历史 UI 能继续读取产物列表；
        但真正的执行态已经迁移到 TaskJob，供独立 worker 接手。
        """
        if idempotency_key:
            existing_receipts: list[TaskReceipt] = []
            for index in range(batch_size):
                existing = self.task_service.get_job_by_idempotency_key(f"{idempotency_key}:{index}")
                if not existing:
                    existing_receipts = []
                    break
                existing_receipts.append(self.task_service._to_receipt(existing))
            if existing_receipts:
                logger.info(
                    "VIDEO_TASK_SERVICE: create_video_generation_jobs reuse_existing script_id=%s batch_size=%s",
                    script_id,
                    batch_size,
                )
                return existing_receipts

        tasks = self.create_tasks(
            script_id=script_id,
            image_url=image_url,
            prompt=prompt,
            batch_size=batch_size,
            duration=duration,
            seed=seed,
            resolution=resolution,
            generate_audio=generate_audio,
            audio_url=audio_url,
            prompt_extend=prompt_extend,
            negative_prompt=negative_prompt,
            model=model,
            frame_id=frame_id,
            shot_type=shot_type,
            generation_mode=generation_mode,
            reference_video_urls=reference_video_urls,
            mode=mode,
            sound=sound,
            cfg_scale=cfg_scale,
            vidu_audio=vidu_audio,
            movement_amplitude=movement_amplitude,
        )

        receipts: list[TaskReceipt] = []
        resolved_task_type = task_type or (TaskType.VIDEO_GENERATE_FRAME.value if frame_id else TaskType.VIDEO_GENERATE_ASSET.value)
        resource_type = "storyboard_frame" if frame_id else "asset"
        resource_id = frame_id or asset_id
        for index, task in enumerate(tasks):
            if asset_id:
                task.asset_id = asset_id
                self.video_task_repository.save(task)
            receipt = self.task_service.create_video_generation_job(
                video_task=task,
                task_type=resolved_task_type,
                resource_type=resource_type,
                resource_id=resource_id,
                idempotency_key=f"{idempotency_key}:{index}" if idempotency_key else None,
            )
            receipts.append(receipt)
        logger.info(
            "VIDEO_TASK_SERVICE: create_video_generation_jobs script_id=%s task_type=%s receipt_count=%s",
            script_id,
            resolved_task_type,
            len(receipts),
        )
        return receipts

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
