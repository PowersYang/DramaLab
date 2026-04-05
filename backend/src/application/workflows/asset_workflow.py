"""
素材工作流。

这一层已经不再依赖 pipeline 内存状态，而是直接从 repository 读取聚合，
并通过 provider 调用图片/视频能力。
"""

import time
import uuid
from typing import Any

from ...common.log import get_logger
from ...providers import AssetGenerator, VideoModelProvider
from ...providers.image.asset_image_provider import ASPECT_RATIO_TO_SIZE
from ...repository import CharacterRepository, ProjectRepository, PropRepository, SceneRepository, SeriesRepository, VideoTaskRepository
from ...schemas.models import AssetUnit, GenerationStatus, VideoTask, VideoVariant
from ...utils.datetime import utc_now
from ..services.model_provider_service import ModelProviderService


# 这里先保留进程内任务表，只用于过渡期的异步编排。
# 核心业务状态已经落库，后续再把任务状态也迁到专门任务表。
_ASSET_TASKS: dict[str, dict[str, Any]] = {}
_MOTION_REF_TASKS: dict[str, dict[str, Any]] = {}
logger = get_logger(__name__)


class AssetWorkflow:
    """负责串联资产生成相关的 repository 与模型 provider。"""

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.series_repository = SeriesRepository()
        self.character_repository = CharacterRepository()
        self.scene_repository = SceneRepository()
        self.prop_repository = PropRepository()
        self.video_task_repository = VideoTaskRepository()
        self.image_provider = AssetGenerator()
        self.video_provider = VideoModelProvider()
        self.model_provider_service = ModelProviderService()
        self.last_model_resolution: dict[str, str | None] | None = None

    def generate_assets(self, script_id: str):
        """为项目中的角色、场景和道具批量生成资产。"""
        logger.info("资产工作流：批量生成素材 脚本ID=%s", script_id)
        project = self._get_project(script_id)
        ordered_characters = sorted(
            project.characters,
            key=lambda item: 0 if not item.base_character_id else 1,
        )

        for character in ordered_characters:
            self._generate_project_asset(project, character.id, "character")
            project = self._get_project(script_id)
        for scene in project.scenes:
            self._generate_project_asset(project, scene.id, "scene")
            project = self._get_project(script_id)
        for prop in project.props:
            self._generate_project_asset(project, prop.id, "prop")
            project = self._get_project(script_id)

        logger.info("资产工作流：批量生成素材完成 脚本ID=%s", script_id)
        return self._get_project(script_id)

    def prepare_generate_assets(self, script_id: str):
        """批量素材生成入队前校验项目存在。"""
        return self._get_project(script_id)

    def prepare_project_asset_generation(
        self,
        script_id: str,
        asset_id: str,
        asset_type: str,
    ):
        """在任务入队前把素材状态切到 processing，便于前端立即感知。"""
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        asset.status = GenerationStatus.PROCESSING
        self._save_project_asset(script_id, asset_type, asset)
        return self._get_project(script_id)

    def execute_project_asset_generation(
        self,
        script_id: str,
        asset_id: str,
        asset_type: str,
        style_preset: str | None = None,
        reference_image_url: str | None = None,
        style_prompt: str | None = None,
        generation_type: str = "all",
        prompt: str | None = None,
        apply_style: bool = True,
        negative_prompt: str | None = None,
        batch_size: int = 1,
        model_name: str | None = None,
        resolved_art_direction: dict | None = None,
    ):
        """统一任务系统下的项目素材生成入口。"""
        project = self._get_project(script_id)
        return self._generate_project_asset(
            project,
            asset_id,
            asset_type,
            style_preset=style_preset,
            reference_image_url=reference_image_url,
            style_prompt=style_prompt,
            generation_type=generation_type,
            prompt=prompt,
            apply_style=apply_style,
            negative_prompt=negative_prompt,
            batch_size=batch_size,
            model_name=model_name,
            resolved_art_direction=resolved_art_direction,
        )

    def create_asset_generation_task(
        self,
        script_id: str,
        asset_id: str,
        asset_type: str,
        style_preset: str | None = None,
        reference_image_url: str | None = None,
        style_prompt: str | None = None,
        generation_type: str = "all",
        prompt: str | None = None,
        apply_style: bool = True,
        negative_prompt: str | None = None,
        batch_size: int = 1,
        model_name: str | None = None,
    ):
        """把项目资产生成请求登记到过渡期任务表。"""
        logger.info(
            "资产工作流：创建素材生成任务 script_id=%s asset_id=%s asset_type=%s",
            script_id,
            asset_id,
            asset_type,
        )
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        asset.status = GenerationStatus.PROCESSING
        self._save_project_asset(script_id, asset_type, asset)

        task_id = str(uuid.uuid4())
        _ASSET_TASKS[task_id] = {
            "task_id": task_id,
            "owner_kind": "project",
            "owner_id": script_id,
            "asset_id": asset_id,
            "asset_type": asset_type,
            "status": "pending",
            "progress": 0,
            "error": None,
            "created_at": utc_now(),
            "params": {
                "style_preset": style_preset,
                "reference_image_url": reference_image_url,
                "style_prompt": style_prompt,
                "generation_type": generation_type,
                "prompt": prompt,
                "apply_style": apply_style,
                "negative_prompt": negative_prompt,
                "batch_size": batch_size,
                "model_name": model_name,
            },
        }
        logger.info("资产工作流：创建素材生成任务完成 任务ID=%s", task_id)
        return self._get_project(script_id), task_id

    def create_series_asset_generation_task(
        self,
        series_id: str,
        asset_id: str,
        asset_type: str,
        style_preset: str | None = None,
        reference_image_url: str | None = None,
        style_prompt: str | None = None,
        generation_type: str = "all",
        prompt: str | None = None,
        apply_style: bool = True,
        negative_prompt: str | None = None,
        batch_size: int = 1,
        model_name: str | None = None,
    ):
        """把系列共享资产生成请求登记到过渡期任务表。"""
        logger.info(
            "资产工作流：创建系列素材生成任务 series_id=%s asset_id=%s asset_type=%s",
            series_id,
            asset_id,
            asset_type,
        )
        series = self._get_series(series_id)
        asset = self._find_asset(series, asset_id, asset_type)
        asset.status = GenerationStatus.PROCESSING
        self._save_series_asset(series_id, asset_type, asset)

        task_id = str(uuid.uuid4())
        _ASSET_TASKS[task_id] = {
            "task_id": task_id,
            "owner_kind": "series",
            "owner_id": series_id,
            "asset_id": asset_id,
            "asset_type": asset_type,
            "status": "pending",
            "progress": 0,
            "error": None,
            "created_at": utc_now(),
            "params": {
                "style_preset": style_preset,
                "reference_image_url": reference_image_url,
                "style_prompt": style_prompt,
                "generation_type": generation_type,
                "prompt": prompt,
                "apply_style": apply_style,
                "negative_prompt": negative_prompt,
                "batch_size": batch_size,
                "model_name": model_name,
            },
        }
        logger.info("资产工作流：创建系列素材生成任务完成 任务ID=%s", task_id)
        return self._get_series(series_id), task_id

    def prepare_series_asset_generation(
        self,
        series_id: str,
        asset_id: str,
        asset_type: str,
    ):
        series = self._get_series(series_id)
        asset = self._find_asset(series, asset_id, asset_type)
        asset.status = GenerationStatus.PROCESSING
        self._save_series_asset(series_id, asset_type, asset)
        return self._get_series(series_id)

    def execute_series_asset_generation(
        self,
        series_id: str,
        asset_id: str,
        asset_type: str,
        style_preset: str | None = None,
        reference_image_url: str | None = None,
        style_prompt: str | None = None,
        generation_type: str = "all",
        prompt: str | None = None,
        apply_style: bool = True,
        negative_prompt: str | None = None,
        batch_size: int = 1,
        model_name: str | None = None,
        resolved_art_direction: dict | None = None,
    ):
        series = self._get_series(series_id)
        return self._generate_series_asset(
            series,
            asset_id,
            asset_type,
            style_preset=style_preset,
            reference_image_url=reference_image_url,
            style_prompt=style_prompt,
            generation_type=generation_type,
            prompt=prompt,
            apply_style=apply_style,
            negative_prompt=negative_prompt,
            batch_size=batch_size,
            model_name=model_name,
            resolved_art_direction=resolved_art_direction,
        )

    def process_asset_generation_task(self, task_id: str):
        """执行已登记的资产生成任务。"""
        task = _ASSET_TASKS.get(task_id)
        if not task:
            logger.warning("资产工作流：处理素材生成任务 任务不存在 任务ID=%s", task_id)
            return

        logger.info(
            "资产工作流：处理素材生成任务开始 task_id=%s owner_kind=%s",
            task_id,
            task["owner_kind"],
        )
        task["status"] = "processing"
        try:
            if task["owner_kind"] == "series":
                series = self._get_series(task["owner_id"])
                self._generate_series_asset(
                    series,
                    task["asset_id"],
                    task["asset_type"],
                    **task["params"],
                )
            else:
                project = self._get_project(task["owner_id"])
                self._generate_project_asset(
                    project,
                    task["asset_id"],
                    task["asset_type"],
                    **task["params"],
                )
            task["status"] = "completed"
            task["progress"] = 100
            logger.info("资产工作流：处理素材生成任务完成 任务ID=%s", task_id)
        except Exception as exc:
            task["status"] = "failed"
            task["error"] = str(exc)
            logger.exception("资产工作流：处理素材生成任务失败 任务ID=%s", task_id)
            raise

    def get_task_status(self, task_id: str):
        """返回图片任务和动作参考任务的统一状态视图。"""
        task = _ASSET_TASKS.get(task_id) or _MOTION_REF_TASKS.get(task_id)
        if not task:
            return None
        return {
            "task_id": task_id,
            "status": task["status"],
            "progress": task.get("progress", 0),
            "error": task.get("error"),
            "asset_id": task.get("asset_id"),
            "asset_type": task.get("asset_type"),
            "script_id": task.get("owner_id"),
            "created_at": task.get("created_at"),
        }

    def generate_motion_ref_task(
        self,
        script_id: str,
        asset_id: str,
        asset_type: str,
        prompt: str | None = None,
        audio_url: str | None = None,
        duration: int = 5,
        batch_size: int = 1,
    ):
        """为资产登记一个动作参考生成任务。"""
        logger.info(
            "资产工作流：生成动作参考任务 script_id=%s asset_id=%s asset_type=%s",
            script_id,
            asset_id,
            asset_type,
        )
        project = self._get_project(script_id)
        task_id = str(uuid.uuid4())
        _MOTION_REF_TASKS[task_id] = {
            "task_id": task_id,
            "owner_id": script_id,
            "asset_id": asset_id,
            "asset_type": asset_type,
            "status": "pending",
            "progress": 0,
            "error": None,
            "created_at": utc_now(),
            "params": {
                "prompt": prompt,
                "audio_url": audio_url,
                "duration": duration,
                "batch_size": batch_size,
            },
        }
        logger.info("资产工作流：生成动作参考任务完成 任务ID=%s", task_id)
        return project, task_id

    def process_motion_ref_task(self, script_id: str, task_id: str):
        """执行动作参考生成任务。"""
        task = _MOTION_REF_TASKS.get(task_id)
        if not task:
            logger.warning("资产工作流：处理动作参考任务 任务不存在 任务ID=%s", task_id)
            return

        logger.info("资产工作流：处理动作参考任务开始 脚本ID=%s 任务ID=%s", script_id, task_id)
        task["status"] = "processing"
        try:
            project = self._get_project(script_id)
            asset = self._find_asset(project, task["asset_id"], task["asset_type"])
            params = task["params"]
            self._generate_motion_ref(
                project=project,
                asset=asset,
                asset_type=task["asset_type"],
                prompt=params["prompt"],
                audio_url=params["audio_url"],
                duration=params["duration"],
                batch_size=params["batch_size"],
            )
            task["status"] = "completed"
            task["progress"] = 100
            logger.info("资产工作流：处理动作参考任务完成 脚本ID=%s 任务ID=%s", script_id, task_id)
        except Exception as exc:
            task["status"] = "failed"
            task["error"] = str(exc)
            logger.exception("资产工作流：处理动作参考任务失败 脚本ID=%s 任务ID=%s", script_id, task_id)
            raise

    def prepare_motion_ref_generation(self, script_id: str, asset_id: str, asset_type: str):
        """入队前校验目标资产存在。"""
        project = self._get_project(script_id)
        self._find_asset(project, asset_id, asset_type)
        return project

    def prepare_series_motion_ref_generation(self, series_id: str, asset_id: str, asset_type: str):
        """入队前校验系列角色动作参考生成目标存在。"""
        series = self._get_series(series_id)
        self._find_asset(series, asset_id, asset_type)
        return series

    def execute_motion_ref_generation(
        self,
        script_id: str,
        asset_id: str,
        asset_type: str,
        prompt: str | None = None,
        audio_url: str | None = None,
        negative_prompt: str | None = None,
        duration: int = 5,
        batch_size: int = 1,
    ):
        """统一任务系统下的动作参考生成入口。"""
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        self._generate_motion_ref(
            project=project,
            asset=asset,
            asset_type=asset_type,
            prompt=prompt,
            audio_url=audio_url,
            negative_prompt=negative_prompt,
            duration=duration,
            batch_size=batch_size,
        )
        return self._get_project(script_id)

    def execute_series_motion_ref_generation(
        self,
        series_id: str,
        asset_id: str,
        asset_type: str,
        prompt: str | None = None,
        audio_url: str | None = None,
        negative_prompt: str | None = None,
        duration: int = 5,
        batch_size: int = 1,
    ):
        """统一任务系统下的系列角色动作参考生成入口。"""
        series = self._get_series(series_id)
        asset = self._find_asset(series, asset_id, asset_type)
        self._generate_series_motion_ref(
            series=series,
            asset=asset,
            asset_type=asset_type,
            prompt=prompt,
            audio_url=audio_url,
            negative_prompt=negative_prompt,
            duration=duration,
            batch_size=batch_size,
        )
        return self._get_series(series_id)

    def create_asset_video_task(
        self,
        script_id: str,
        asset_id: str,
        asset_type: str,
        prompt: str | None = None,
        duration: int = 5,
        aspect_ratio: str | None = None,
    ):
        """基于已有资产图片创建一个持久化视频任务占位记录。"""
        logger.info(
            "资产工作流：创建素材视频任务 script_id=%s asset_id=%s asset_type=%s",
            script_id,
            asset_id,
            asset_type,
        )
        _ = aspect_ratio
        project = self._get_project(script_id)
        target_asset = self._find_asset(project, asset_id, asset_type)

        if asset_type == "character":
            image_url = target_asset.full_body_image_url or target_asset.image_url
            if not prompt:
                prompt = f"A cinematic shot of {target_asset.name}, {target_asset.description}, looking around, breathing, slight movement, high quality, 4k"
        elif asset_type == "scene":
            image_url = target_asset.image_url
            if not prompt:
                prompt = f"A cinematic shot of {target_asset.name}, {target_asset.description}, ambient motion, lighting change, high quality, 4k"
        elif asset_type == "prop":
            image_url = target_asset.image_url
            if not prompt:
                prompt = f"A cinematic shot of {target_asset.name}, {target_asset.description}, rotating slowly, high quality, 4k"
        else:
            raise ValueError(f"Invalid asset_type: {asset_type}")

        if not image_url:
            raise ValueError(f"Asset {asset_id} has no image to generate video from")

        task_id = str(uuid.uuid4())
        task = VideoTask(
            id=task_id,
            project_id=script_id,
            asset_id=asset_id,
            image_url=image_url,
            prompt=prompt,
            status="pending",
            duration=duration,
            resolution="720p",
            model="wan2.6-i2v",
            created_at=utc_now(),
        )

        self.video_task_repository.save(task)
        logger.info("资产工作流：创建素材视频任务完成 脚本ID=%s 任务ID=%s", script_id, task_id)
        return self._get_project(script_id), task

    def _generate_project_asset(self, project, asset_id: str, asset_type: str, **params):
        """生成单个项目资产并持久化更新后的聚合。"""
        logger.info(
            "资产工作流：生成项目素材 project_id=%s asset_id=%s asset_type=%s",
            project.id,
            asset_id,
            asset_type,
        )
        self._generate_asset_common(project, asset_id, asset_type, **params)
        asset = self._find_asset(project, asset_id, asset_type)
        self._save_project_asset(project.id, asset_type, asset)
        return self._get_project(project.id)

    def _generate_series_asset(self, series, asset_id: str, asset_type: str, **params):
        """生成单个系列资产并持久化更新后的聚合。"""
        logger.info(
            "资产工作流：生成系列素材 series_id=%s asset_id=%s asset_type=%s",
            series.id,
            asset_id,
            asset_type,
        )
        self._generate_asset_common(series, asset_id, asset_type, **params)
        asset = self._find_asset(series, asset_id, asset_type)
        self._save_series_asset(series.id, asset_type, asset)
        return self._get_series(series.id)

    def _generate_asset_common(
        self,
        owner,
        asset_id: str,
        asset_type: str,
        style_preset: str | None = None,
        reference_image_url: str | None = None,
        style_prompt: str | None = None,
        generation_type: str = "all",
        prompt: str | None = None,
        apply_style: bool = True,
        negative_prompt: str | None = None,
        batch_size: int = 1,
        model_name: str | None = None,
        resolved_art_direction: dict | None = None,
    ):
        """结合 owner 级风格与模型配置生成单个资产。"""
        _ = reference_image_url
        asset = self._find_asset(owner, asset_id, asset_type)
        preferred_t2i_model = model_name or owner.model_settings.t2i_model
        # 中文注释：系列/项目可能保留了历史默认模型，但当前环境未必补齐了该模型的运行时配置。
        # 这里在真正调起生成前统一做一次可执行模型解析，避免任务跑到 provider 层才因 request_path 等缺失而失败。
        self.last_model_resolution = self.model_provider_service.resolve_model_execution_plan(preferred_t2i_model, "t2i")
        t2i_model = str(self.last_model_resolution.get("resolved_model") or preferred_t2i_model or "")
        i2i_model = owner.model_settings.i2i_model
        effective_size = self._get_asset_size(owner, asset_type)
        positive_prompt, effective_negative_prompt = self._build_style_prompts(
            owner,
            style_preset,
            style_prompt,
            apply_style,
            negative_prompt,
            resolved_art_direction,
        )

        asset.status = GenerationStatus.PROCESSING
        try:
            if asset_type == "character":
                self.image_provider.generate_character(
                    asset,
                    generation_type=generation_type,
                    prompt=prompt,
                    positive_prompt=positive_prompt,
                    negative_prompt=effective_negative_prompt,
                    batch_size=batch_size,
                    model_name=t2i_model,
                    i2i_model_name=i2i_model,
                    size=effective_size,
                )
            elif asset_type == "scene":
                self.image_provider.generate_scene(
                    scene=asset,
                    prompt=prompt,
                    positive_prompt=positive_prompt,
                    negative_prompt=effective_negative_prompt,
                    batch_size=batch_size,
                    model_name=t2i_model,
                    size=effective_size,
                )
            elif asset_type == "prop":
                self.image_provider.generate_prop(
                    prop=asset,
                    prompt=prompt,
                    positive_prompt=positive_prompt,
                    negative_prompt=effective_negative_prompt,
                    batch_size=batch_size,
                    model_name=t2i_model,
                    size=effective_size,
                )
            else:
                raise ValueError(f"Invalid asset_type: {asset_type}")
            asset.status = GenerationStatus.COMPLETED
        except Exception:
            asset.status = GenerationStatus.FAILED
            raise

    def _generate_motion_ref(
        self,
        project,
        asset,
        asset_type: str,
        prompt: str | None = None,
        audio_url: str | None = None,
        negative_prompt: str | None = None,
        duration: int = 5,
        batch_size: int = 1,
    ):
        """生成动作参考视频并挂到目标资产上。"""
        generated_videos = []

        if asset_type in ["full_body", "head_shot"]:
            # 角色动作参考优先复用 AssetUnit 选中的静态图；
            # 如果历史数据只有 legacy URL/selected_id，没有对应 image_variants 记录，
            # 这里要回退到 legacy 字段，否则前端明明已有主图也会被误判为“无源图”。
            source_image_url = self._resolve_character_motion_source_image(asset, asset_type)

            if not prompt:
                prompt = f"{asset_type.replace('_', ' ').title()} character reference video. {asset.description}. Looking around, breathing, slight movement, subtle gestures. Stable camera, high quality, 4k."
        else:
            source_image_url = asset.image_url
            if not prompt:
                if asset_type == "scene":
                    prompt = f"Cinematic scene video reference of {asset.name}. {asset.description}. Ambient motion, lighting changes, natural elements moving, birds, clouds. Slow pan across the scene. High quality, 4k."
                else:
                    prompt = f"Cinematic prop video reference of {asset.name}. {asset.description}. Rotating object, detailed textures visible, ambient motion, subtle movements. High quality, 4k."

        if not source_image_url:
            raise ValueError(f"No source image available for {asset_type}. Please generate a static image first.")

        for _ in range(batch_size):
            result = self.video_provider.generate_i2v(
                image_url=source_image_url,
                prompt=prompt,
                duration=duration,
                audio_url=audio_url,
                negative_prompt=negative_prompt,
            )
            if not result or not result.get("video_url"):
                continue

            if asset_type in ["full_body", "head_shot"]:
                asset_unit = getattr(asset, asset_type, None)
                if asset_unit is None:
                    raise ValueError(f"Character asset unit {asset_type} not found")
                variant = VideoVariant(
                    id=f"video_{uuid.uuid4().hex[:8]}",
                    url=result["video_url"],
                    prompt_used=prompt,
                    audio_url=audio_url,
                    source_image_id=None,
                )
                asset_unit.video_variants.append(variant)
                if not asset_unit.selected_video_id:
                    asset_unit.selected_video_id = variant.id
                asset_unit.video_prompt = prompt
                asset_unit.video_updated_at = utc_now()
                generated_videos.append(variant)
            else:
                task = VideoTask(
                    id=f"video_{uuid.uuid4().hex[:8]}",
                    project_id=project.id,
                    asset_id=asset.id,
                    image_url=source_image_url,
                    prompt=prompt,
                    status="completed",
                    video_url=result["video_url"],
                    duration=duration,
                    created_at=utc_now(),
                    generate_audio=bool(audio_url),
                    model="wan2.6-i2v",
                    generation_mode="i2v",
                )
                asset.video_assets.append(task)
                project.video_tasks.append(task)
                generated_videos.append(task)

        if batch_size > 0 and not generated_videos:
            raise RuntimeError(f"Failed to generate any motion reference videos for {asset_type}")

        self._persist_motion_ref_results(
            project_id=project.id,
            asset_id=asset.id,
            asset_type=asset_type,
            prompt=prompt,
            generated_videos=generated_videos,
        )

    def _generate_series_motion_ref(
        self,
        series,
        asset,
        asset_type: str,
        prompt: str | None = None,
        audio_url: str | None = None,
        negative_prompt: str | None = None,
        duration: int = 5,
        batch_size: int = 1,
    ):
        """为系列角色生成动作参考视频并落回系列角色资产单元。"""
        if asset_type not in ["full_body", "head_shot"]:
            raise ValueError("Series motion reference generation currently only supports character assets")

        generated_videos: list[VideoVariant] = []
        source_image_url = self._resolve_character_motion_source_image(asset, asset_type)
        if not prompt:
            prompt = f"{asset_type.replace('_', ' ').title()} character reference video. {asset.description}. Looking around, breathing, slight movement, subtle gestures. Stable camera, high quality, 4k."
        if not source_image_url:
            raise ValueError(f"No source image available for {asset_type}. Please generate a static image first.")

        for _ in range(batch_size):
            result = self.video_provider.generate_i2v(
                image_url=source_image_url,
                prompt=prompt,
                duration=duration,
                audio_url=audio_url,
                negative_prompt=negative_prompt,
            )
            if not result or not result.get("video_url"):
                continue
            asset_unit = getattr(asset, asset_type, None)
            if asset_unit is None:
                raise ValueError(f"Character asset unit {asset_type} not found")
            variant = VideoVariant(
                id=f"video_{uuid.uuid4().hex[:8]}",
                url=result["video_url"],
                prompt_used=prompt,
                audio_url=audio_url,
                source_image_id=None,
            )
            asset_unit.video_variants.append(variant)
            if not asset_unit.selected_video_id:
                asset_unit.selected_video_id = variant.id
            asset_unit.video_prompt = prompt
            asset_unit.video_updated_at = utc_now()
            generated_videos.append(variant)

        if batch_size > 0 and not generated_videos:
            raise RuntimeError(f"Failed to generate any motion reference videos for {asset_type}")

        self._persist_series_motion_ref_results(
            series_id=series.id,
            asset_id=asset.id,
            asset_type=asset_type,
            prompt=prompt,
            generated_videos=generated_videos,
        )

    def _persist_motion_ref_results(
        self,
        *,
        project_id: str,
        asset_id: str,
        asset_type: str,
        prompt: str | None,
        generated_videos: list[VideoVariant | VideoTask],
    ) -> None:
        """把动作参考结果合并回最新项目快照，避免并发任务互相覆盖状态。"""
        fresh_project = self._get_project(project_id)
        fresh_asset = self._find_asset(fresh_project, asset_id, asset_type)

        if asset_type in ["full_body", "head_shot"]:
            unit = getattr(fresh_asset, asset_type, None)
            if unit is None:
                unit = AssetUnit()
                setattr(fresh_asset, asset_type, unit)

            existing_variant_ids = {item.id for item in unit.video_variants}
            for variant in generated_videos:
                if not isinstance(variant, VideoVariant):
                    continue
                if variant.id in existing_variant_ids:
                    continue
                unit.video_variants.append(variant.model_copy(deep=True))
                existing_variant_ids.add(variant.id)
            if generated_videos and not unit.selected_video_id:
                first_variant = next((item for item in generated_videos if isinstance(item, VideoVariant)), None)
                if first_variant is not None:
                    unit.selected_video_id = first_variant.id
            unit.video_prompt = prompt
            unit.video_updated_at = utc_now()
        else:
            existing_asset_video_ids = {item.id for item in fresh_asset.video_assets}
            existing_project_video_ids = {item.id for item in fresh_project.video_tasks}
            for task in generated_videos:
                if not isinstance(task, VideoTask):
                    continue
                task_copy = task.model_copy(deep=True)
                if task_copy.id not in existing_asset_video_ids:
                    fresh_asset.video_assets.append(task_copy)
                    existing_asset_video_ids.add(task_copy.id)
                if task_copy.id not in existing_project_video_ids:
                    fresh_project.video_tasks.append(task_copy.model_copy(deep=True))
                    existing_project_video_ids.add(task_copy.id)

        if asset_type in ["full_body", "head_shot"]:
            self._save_project_asset(project_id, "character", fresh_asset)
            return

        for task in generated_videos:
            if not isinstance(task, VideoTask):
                continue
            self.video_task_repository.save(task)

    def _persist_series_motion_ref_results(
        self,
        *,
        series_id: str,
        asset_id: str,
        asset_type: str,
        prompt: str | None,
        generated_videos: list[VideoVariant],
    ) -> None:
        """把系列角色动作参考结果合并回最新系列快照，避免并发任务互相覆盖。"""
        fresh_series = self._get_series(series_id)
        fresh_asset = self._find_asset(fresh_series, asset_id, asset_type)
        unit = getattr(fresh_asset, asset_type, None)
        if unit is None:
            unit = AssetUnit()
            setattr(fresh_asset, asset_type, unit)

        existing_variant_ids = {item.id for item in unit.video_variants}
        for variant in generated_videos:
            if variant.id in existing_variant_ids:
                continue
            unit.video_variants.append(variant.model_copy(deep=True))
            existing_variant_ids.add(variant.id)
        if generated_videos and not unit.selected_video_id:
            unit.selected_video_id = generated_videos[0].id
        unit.video_prompt = prompt
        unit.video_updated_at = utc_now()
        self._save_series_asset(series_id, "character", fresh_asset)

    def _save_project_asset(self, project_id: str, asset_type: str, asset) -> None:
        project = self._get_project(project_id)
        repository = self._asset_repository(asset_type)
        owner_type, owner_id = self._resolve_asset_owner(project, asset_type, asset.id)
        repository.save(owner_type, owner_id, asset)

    def _save_series_asset(self, series_id: str, asset_type: str, asset) -> None:
        repository = self._asset_repository(asset_type)
        repository.save("series", series_id, asset)

    def _asset_repository(self, asset_type: str):
        if asset_type in ("character", "full_body", "head_shot"):
            return self.character_repository
        if asset_type == "scene":
            return self.scene_repository
        if asset_type == "prop":
            return self.prop_repository
        raise ValueError(f"Unsupported asset_type: {asset_type}")

    def _resolve_character_motion_source_image(self, asset, asset_type: str) -> str | None:
        """为角色动作参考解析最稳妥的源图地址。"""
        asset_unit = getattr(asset, asset_type, None)
        if asset_unit and asset_unit.selected_image_id and asset_unit.image_variants:
            source_image = next(
                (item for item in asset_unit.image_variants if item.id == asset_unit.selected_image_id),
                None,
            )
            if source_image and source_image.url:
                return source_image.url

        if asset_type == "full_body":
            return asset.full_body_image_url or asset.image_url
        return asset.headshot_image_url or asset.avatar_url

    def _build_style_prompts(
        self,
        owner,
        style_preset: str | None,
        style_prompt: str | None,
        apply_style: bool,
        negative_prompt: str | None,
        resolved_art_direction: dict | None = None,
    ):
        """解析生成时实际生效的正向与反向风格提示词。"""
        positive_prompt = ""
        effective_negative_prompt = negative_prompt or ""

        if not apply_style:
            return positive_prompt, effective_negative_prompt

        if resolved_art_direction and resolved_art_direction.get("style_config"):
            positive_prompt = resolved_art_direction["style_config"].get("positive_prompt", "")
            global_neg = resolved_art_direction["style_config"].get("negative_prompt", "")
            if global_neg:
                effective_negative_prompt = (
                    f"{effective_negative_prompt}, {global_neg}" if effective_negative_prompt else global_neg
                )
        elif owner.art_direction and owner.art_direction.style_config:
            positive_prompt = owner.art_direction.style_config.get("positive_prompt", "")
            global_neg = owner.art_direction.style_config.get("negative_prompt", "")
            if global_neg:
                effective_negative_prompt = (
                    f"{effective_negative_prompt}, {global_neg}" if effective_negative_prompt else global_neg
                )
        elif style_prompt:
            positive_prompt = style_prompt
        elif style_preset:
            positive_prompt = f"{style_preset} style"
        elif getattr(owner, "style_preset", None):
            positive_prompt = f"{owner.style_preset} style"
            if getattr(owner, "style_prompt", None):
                positive_prompt += f", {owner.style_prompt}"

        return positive_prompt, effective_negative_prompt

    def _get_asset_size(self, owner, asset_type: str):
        """把逻辑资产类型和 owner 配置映射为具体图片尺寸。"""
        if asset_type == "character":
            aspect_ratio = owner.model_settings.character_aspect_ratio
            default_size = "576*1024"
        elif asset_type == "scene":
            aspect_ratio = owner.model_settings.scene_aspect_ratio
            default_size = "1024*576"
        elif asset_type == "prop":
            aspect_ratio = owner.model_settings.prop_aspect_ratio
            default_size = "1024*1024"
        else:
            aspect_ratio = "9:16"
            default_size = "576*1024"
        return ASPECT_RATIO_TO_SIZE.get(aspect_ratio, default_size)

    def _find_asset(self, owner, asset_id: str, asset_type: str):
        """在项目或系列聚合内解析目标资产。"""
        if asset_type in ("character", "full_body", "head_shot"):
            target = next((item for item in owner.characters if item.id == asset_id), None)
        elif asset_type == "scene":
            target = next((item for item in owner.scenes if item.id == asset_id), None)
        elif asset_type == "prop":
            target = next((item for item in owner.props if item.id == asset_id), None)
        else:
            raise ValueError(f"Unsupported asset_type: {asset_type}")
        if not target:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")
        return target

    def _resolve_asset_owner(self, project, asset_type: str, asset_id: str) -> tuple[str, str]:
        """解析项目上下文里的素材归属，系列共享素材应写回 series owner。"""
        if not project.series_id:
            return ("project", project.id)

        if asset_type in ("character", "full_body", "head_shot"):
            link = next((item for item in (project.series_character_links or []) if item.character_id == asset_id), None)
            if link:
                return ("series", project.series_id)
            # 中文注释：系列角色采用收件箱确认后，分集未必立即带角色链接；
            # 只要角色已存在系列主档，就按系列归属执行生成与写回。
            series = self._get_series(project.series_id)
            if any(item.id == asset_id for item in (series.characters or [])):
                return ("series", project.series_id)
            return ("project", project.id)

        if asset_type in {"scene", "prop"}:
            series = self._get_series(project.series_id)
            if asset_type == "scene" and any(item.id == asset_id for item in (series.scenes or [])):
                return ("series", project.series_id)
            if asset_type == "prop" and any(item.id == asset_id for item in (series.props or [])):
                return ("series", project.series_id)
        return ("project", project.id)

    def _get_project(self, script_id: str):
        """加载项目聚合，缺失时抛出未找到错误。"""
        project = self.project_repository.get(script_id)
        if not project:
            raise ValueError("Script not found")
        return project

    def _get_series(self, series_id: str):
        """加载系列聚合，缺失时抛出未找到错误。"""
        series = self.series_repository.get(series_id)
        if not series:
            raise ValueError("Series not found")
        return series
