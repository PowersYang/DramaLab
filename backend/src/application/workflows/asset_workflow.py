"""
素材工作流。

这一层已经不再依赖 pipeline 内存状态，而是直接从 repository 读取聚合，
并通过 provider 调用图片/视频能力。
"""

import time
import uuid
from typing import Any

from ...providers import AssetGenerator, VideoModelProvider
from ...providers.image.asset_image_provider import ASPECT_RATIO_TO_SIZE
from ...repository import ProjectRepository, SeriesRepository
from ...schemas.models import GenerationStatus, VideoTask, VideoVariant


# 这里先保留进程内任务表，只用于过渡期的异步编排。
# 核心业务状态已经落库，后续再把任务状态也迁到专门任务表。
_ASSET_TASKS: dict[str, dict[str, Any]] = {}
_MOTION_REF_TASKS: dict[str, dict[str, Any]] = {}


class AssetWorkflow:
    """Coordinate asset generation across repositories and model providers."""

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.series_repository = SeriesRepository()
        self.image_provider = AssetGenerator()
        self.video_provider = VideoModelProvider()

    def generate_assets(self, script_id: str):
        """Generate assets for all pending characters, scenes, and props."""
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

        return self._get_project(script_id)

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
        """Register a project asset generation request in the transitional task map."""
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        asset.status = GenerationStatus.PROCESSING
        project.updated_at = time.time()
        self.project_repository.save(project)

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
            "created_at": time.time(),
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
        """Register a shared series asset generation request."""
        series = self._get_series(series_id)
        asset = self._find_asset(series, asset_id, asset_type)
        asset.status = GenerationStatus.PROCESSING
        series.updated_at = time.time()
        self.series_repository.save(series)

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
            "created_at": time.time(),
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
        return self._get_series(series_id), task_id

    def process_asset_generation_task(self, task_id: str):
        """Execute a previously registered asset generation task."""
        task = _ASSET_TASKS.get(task_id)
        if not task:
            return

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
        except Exception as exc:
            task["status"] = "failed"
            task["error"] = str(exc)
            raise

    def get_task_status(self, task_id: str):
        """Return normalized status for image and motion-reference tasks."""
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
        """Register a motion-reference generation task for an asset."""
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
            "created_at": time.time(),
            "params": {
                "prompt": prompt,
                "audio_url": audio_url,
                "duration": duration,
                "batch_size": batch_size,
            },
        }
        return project, task_id

    def process_motion_ref_task(self, script_id: str, task_id: str):
        """Execute a motion-reference generation task."""
        task = _MOTION_REF_TASKS.get(task_id)
        if not task:
            return

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
        except Exception as exc:
            task["status"] = "failed"
            task["error"] = str(exc)
            raise

    def create_asset_video_task(
        self,
        script_id: str,
        asset_id: str,
        asset_type: str,
        prompt: str | None = None,
        duration: int = 5,
        aspect_ratio: str | None = None,
    ):
        """Create a persisted video task from an existing asset image."""
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
            created_at=time.time(),
        )

        project.video_tasks.append(task)
        target_asset.video_assets.append(task)
        project.updated_at = time.time()
        self.project_repository.save(project)
        return self._get_project(script_id), task_id

    def _generate_project_asset(self, project, asset_id: str, asset_type: str, **params):
        """Generate a single project asset and persist the updated aggregate."""
        self._generate_asset_common(project, asset_id, asset_type, **params)
        project.updated_at = time.time()
        self.project_repository.save(project)
        return project

    def _generate_series_asset(self, series, asset_id: str, asset_type: str, **params):
        """Generate a single series asset and persist the updated aggregate."""
        self._generate_asset_common(series, asset_id, asset_type, **params)
        series.updated_at = time.time()
        self.series_repository.save(series)
        return series

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
    ):
        """Generate one asset using owner-level style and model settings."""
        _ = reference_image_url
        asset = self._find_asset(owner, asset_id, asset_type)
        t2i_model = model_name or owner.model_settings.t2i_model
        i2i_model = owner.model_settings.i2i_model
        effective_size = self._get_asset_size(owner, asset_type)
        positive_prompt, effective_negative_prompt = self._build_style_prompts(
            owner,
            style_preset,
            style_prompt,
            apply_style,
            negative_prompt,
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
                    asset,
                    positive_prompt,
                    effective_negative_prompt,
                    batch_size=batch_size,
                    model_name=t2i_model,
                    size=effective_size,
                )
            elif asset_type == "prop":
                self.image_provider.generate_prop(
                    asset,
                    positive_prompt,
                    effective_negative_prompt,
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
        duration: int = 5,
        batch_size: int = 1,
    ):
        """Generate motion-reference videos and attach them to the target asset."""
        generated_videos = []

        if asset_type in ["full_body", "head_shot"]:
            # Character motion refs attach to AssetUnit variants so they can
            # be selected independently from normal asset videos.
            asset_unit = getattr(asset, asset_type, None)
            if asset_unit and asset_unit.selected_image_id:
                source_image = next(
                    (item for item in asset_unit.image_variants if item.id == asset_unit.selected_image_id),
                    None,
                )
                source_image_url = source_image.url if source_image else None
            else:
                source_image_url = asset.full_body_image_url if asset_type == "full_body" else asset.headshot_image_url

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
                asset_unit.video_updated_at = time.time()
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
                    created_at=time.time(),
                    generate_audio=bool(audio_url),
                    model="wan2.6-i2v",
                    generation_mode="i2v",
                )
                asset.video_assets.append(task)
                project.video_tasks.append(task)
                generated_videos.append(task)

        if batch_size > 0 and not generated_videos:
            raise RuntimeError(f"Failed to generate any motion reference videos for {asset_type}")

        project.updated_at = time.time()
        self.project_repository.save(project)

    def _build_style_prompts(
        self,
        owner,
        style_preset: str | None,
        style_prompt: str | None,
        apply_style: bool,
        negative_prompt: str | None,
    ):
        """Resolve effective positive and negative style prompts for generation."""
        positive_prompt = ""
        effective_negative_prompt = negative_prompt or ""

        if not apply_style:
            return positive_prompt, effective_negative_prompt

        if owner.art_direction and owner.art_direction.style_config:
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
        """Map logical asset type and owner settings to a concrete image size."""
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
        """Resolve an asset inside either a project or series aggregate."""
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

    def _get_project(self, script_id: str):
        project = self.project_repository.get(script_id)
        if not project:
            raise ValueError("Script not found")
        return project

    def _get_series(self, series_id: str):
        series = self.series_repository.get(series_id)
        if not series:
            raise ValueError("Series not found")
        return series
