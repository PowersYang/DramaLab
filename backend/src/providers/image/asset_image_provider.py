"""角色、场景、道具资产的具体图片生成实现。"""

import os
import time
import uuid
from typing import Any, Dict

from ...schemas.models import (
    AssetUnit,
    Character,
    GenerationStatus,
    ImageAsset,
    ImageVariant,
    MAX_VARIANTS_PER_ASSET,
    Prop,
    Scene,
)

from ...models.image import WanxImageModel
from ...utils import get_logger
from ...utils.datetime import utc_now
from ...utils.oss_utils import OSSImageUploader, is_object_key
from ...utils.reference_inputs import resolve_reference_image_input
from ...utils.temp_media import create_temp_file_path, remove_temp_file

logger = get_logger(__name__)


def cleanup_old_variants(image_asset: ImageAsset) -> None:
    """
    控制素材历史图数量。

    最多保留 `MAX_VARIANTS_PER_ASSET` 张未收藏图片；
    已收藏的图片始终保留；
    超出上限时，优先删除最早生成的未收藏图片。
    """
    if not image_asset or not image_asset.variants:
        return

    favorited = [variant for variant in image_asset.variants if variant.is_favorited]
    non_favorited = [variant for variant in image_asset.variants if not variant.is_favorited]
    non_favorited.sort(key=lambda variant: variant.created_at)

    if len(non_favorited) > MAX_VARIANTS_PER_ASSET:
        to_remove = len(non_favorited) - MAX_VARIANTS_PER_ASSET
        removed = non_favorited[:to_remove]
        non_favorited = non_favorited[to_remove:]
        for variant in removed:
            logger.info("Auto-removed old variant: %s (created_at: %s)", variant.id, variant.created_at)

    non_favorited.reverse()
    image_asset.variants = favorited + non_favorited


ASPECT_RATIO_TO_SIZE = {
    "9:16": "576*1024",
    "16:9": "1024*576",
    "1:1": "1024*1024",
}


class AssetGenerator:
    """
    图片素材生成 provider。

    这里承接原 `src/service/assets.py` 的实现。
    """

    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.model = WanxImageModel(self.config.get("model", {}))
        self.last_generation_metrics = None

    def _remember_model_metrics(self, *, resource: Dict[str, Any], artifacts: Dict[str, Any] | None = None) -> None:
        """把底层模型最近一次生成 metrics 抬升到 provider 层，供任务执行器读取。"""
        if not self.model.last_generation_metrics:
            return
        self.last_generation_metrics = {
            **self.model.last_generation_metrics,
            "resource": resource,
            "artifacts": {
                **(self.model.last_generation_metrics.get("artifacts") or {}),
                **(artifacts or {}),
            },
        }

    def _raise_generation_failure(self, stage_label: str, last_error: Exception | None) -> None:
        """保留最后一次真实异常，避免任务表只落笼统失败文案。"""
        if last_error is not None:
            raise RuntimeError(f"{stage_label}生成失败：{last_error}") from last_error
        raise RuntimeError(f"{stage_label}生成失败，请检查模型配置或修改描述内容后重试。")

    def generate_character(self, character: Character, generation_type: str = "all", prompt: str = "", positive_prompt: str = None, negative_prompt: str = "", batch_size: int = 1, model_name: str = None, i2i_model_name: str = None, size: str = None) -> Character:
        """为角色的一个或多个资产槽位生成图片候选。"""
        character.status = GenerationStatus.PROCESSING
        style_suffix = positive_prompt if positive_prompt is not None else "cinematic lighting, movie still, 8k, highly detailed, realistic"
        effective_size = size or "576*1024"

        try:
            if generation_type in ["all", "full_body"]:
                if not prompt:
                    base_prompt = f"Full body character design of {character.name}, concept art. {character.description}. Standing pose, neutral expression, no emotion, looking at viewer. Clean white background, isolated, no other objects, no scenery, simple background, high quality, masterpiece."
                else:
                    base_prompt = prompt
                character.full_body_prompt = base_prompt
                generation_prompt = f"{base_prompt}, {style_suffix}" if style_suffix and style_suffix not in base_prompt else base_prompt

                ref_image_path = None
                if character.three_view_asset:
                    uploaded_variant = next((variant for variant in character.three_view_asset.variants if getattr(variant, "is_uploaded_source", False)), None)
                    if uploaded_variant:
                        ref_url = uploaded_variant.url
                        if is_object_key(ref_url) or ref_url.startswith("http"):
                            ref_image_path = ref_url
                        elif os.path.exists(ref_url):
                            ref_image_path = ref_url

                if not ref_image_path and character.headshot_asset:
                    uploaded_variant = next((variant for variant in character.headshot_asset.variants if getattr(variant, "is_uploaded_source", False)), None)
                    if uploaded_variant:
                        ref_url = uploaded_variant.url
                        if is_object_key(ref_url) or ref_url.startswith("http"):
                            ref_image_path = ref_url
                        elif os.path.exists(ref_url):
                            ref_image_path = ref_url

                successful_generations = 0
                last_generation_error: Exception | None = None
                for index in range(batch_size):
                    try:
                        variant_id = str(uuid.uuid4())
                        fullbody_path = create_temp_file_path(prefix=f"dramalab-character-fullbody-{character.id}-{variant_id}-", suffix=".png")

                        effective_model_name = model_name
                        effective_generation_prompt = generation_prompt
                        if ref_image_path:
                            # 一旦存在参考图，就切到图生图模型，尽量保持生成外观一致。
                            effective_model_name = i2i_model_name or "wan2.6-image"
                            reverse_enhancement = "STRICTLY MAINTAIN the SAME character appearance, face, hairstyle, skin tone, and clothing as the reference image. "
                            if reverse_enhancement.strip() not in effective_generation_prompt:
                                effective_generation_prompt = f"{reverse_enhancement}{generation_prompt}"

                        try:
                            self.model.generate(
                                effective_generation_prompt,
                                fullbody_path,
                                ref_image_path=ref_image_path,
                                negative_prompt=negative_prompt,
                                model_name=effective_model_name,
                                size=effective_size,
                            )
                            self._remember_model_metrics(
                                resource={"asset_type": "character", "asset_id": character.id, "generation_type": "full_body"},
                                artifacts={"variant_kind": "full_body"},
                            )

                            if not character.full_body_asset:
                                character.full_body_asset = ImageAsset()
                            uploader = OSSImageUploader()
                            object_key = uploader.upload_file(fullbody_path, sub_path="assets/characters") if uploader.is_configured else None
                            if not object_key:
                                raise RuntimeError("Failed to upload full body variant to OSS.")
                            variant = ImageVariant(
                                id=variant_id,
                                url=object_key,
                                created_at=utc_now(),
                                prompt_used=generation_prompt,
                            )
                            if not character.full_body:
                                character.full_body = AssetUnit()
                            character.full_body_asset.variants.insert(0, variant)
                            character.full_body.image_variants.insert(0, variant.model_copy(deep=True))
                            character.full_body.image_prompt = base_prompt
                            character.full_body.image_updated_at = utc_now()
                            cleanup_old_variants(character.full_body_asset)
                            character.full_body.image_variants = [item.model_copy(deep=True) for item in character.full_body_asset.variants]

                            if not character.full_body_asset.selected_id or batch_size == 1:
                                character.full_body_asset.selected_id = variant_id
                                character.full_body_image_url = object_key
                                character.full_body.selected_image_id = variant_id
                        finally:
                            remove_temp_file(fullbody_path)

                        successful_generations += 1
                        if index < batch_size - 1:
                            time.sleep(1)
                    except Exception as exc:
                        last_generation_error = exc
                        logger.error("Failed to generate full body variant %s/%s: %s", index + 1, batch_size, exc)
                        continue

                character.full_body_updated_at = utc_now()
                if successful_generations == 0:
                    self._raise_generation_failure("全身图", last_generation_error)
                if generation_type == "full_body":
                    character.is_consistent = False

            current_full_body_url = character.full_body_image_url
            if character.full_body_asset and character.full_body_asset.selected_id:
                selected_variant = next((variant for variant in character.full_body_asset.variants if variant.id == character.full_body_asset.selected_id), None)
                if selected_variant:
                    current_full_body_url = selected_variant.url

            uploaded_reference_url = None
            if not current_full_body_url:
                if generation_type == "three_view" and character.headshot_asset:
                    uploaded_variant = next((variant for variant in character.headshot_asset.variants if getattr(variant, "is_uploaded_source", False)), None)
                    if uploaded_variant:
                        uploaded_reference_url = uploaded_variant.url
                elif generation_type == "headshot" and character.three_view_asset:
                    uploaded_variant = next((variant for variant in character.three_view_asset.variants if getattr(variant, "is_uploaded_source", False)), None)
                    if uploaded_variant:
                        uploaded_reference_url = uploaded_variant.url
                if not uploaded_reference_url:
                    own_asset = character.three_view_asset if generation_type == "three_view" else character.headshot_asset
                    if own_asset:
                        uploaded_variant = next((variant for variant in own_asset.variants if getattr(variant, "is_uploaded_source", False)), None)
                        if uploaded_variant:
                            uploaded_reference_url = uploaded_variant.url

            if generation_type in ["three_view", "headshot"] and not current_full_body_url and not uploaded_reference_url:
                raise ValueError("Full body image is required to generate derived assets. Upload an image or generate a full body first.")

            reference_url = current_full_body_url or uploaded_reference_url
            fullbody_path = resolve_reference_image_input(reference_url)
            if generation_type in ["three_view", "headshot"] and not fullbody_path:
                raise ValueError("Reference image is unavailable. Please use an OSS-hosted image or regenerate the source image first.")

            if generation_type in ["all", "three_view"]:
                if not prompt or generation_type == "all":
                    base_prompt = f"Character Reference Sheet for {character.name}. {character.description}. Three-view character design: Front view, Side view, and Back view. STRICTLY MAINTAIN the SAME character appearance, face, hairstyle, and clothing as the reference image. Full body, standing pose, neutral expression. Consistent clothing and details across all views. Simple white background, clean lines, studio lighting, high quality."
                else:
                    base_prompt = prompt
                character.three_view_prompt = base_prompt
                generation_prompt = f"{base_prompt}, {style_suffix}" if style_suffix and style_suffix not in base_prompt else base_prompt
                sheet_negative = negative_prompt + ", background, scenery, landscape, shadows, complex background, text, watermark, messy, distorted, extra limbs"

                successful_generations = 0
                last_generation_error: Exception | None = None
                for index in range(batch_size):
                    try:
                        variant_id = str(uuid.uuid4())
                        sheet_path = create_temp_file_path(prefix=f"dramalab-character-sheet-{character.id}-{variant_id}-", suffix=".png")
                        try:
                            self.model.generate(generation_prompt, sheet_path, ref_image_path=fullbody_path, negative_prompt=sheet_negative, ref_strength=0.8, model_name=i2i_model_name)
                            self._remember_model_metrics(
                                resource={"asset_type": "character", "asset_id": character.id, "generation_type": "three_view"},
                                artifacts={"variant_kind": "three_view"},
                            )
                            if not character.three_view_asset:
                                character.three_view_asset = ImageAsset()
                            if not character.three_views:
                                character.three_views = AssetUnit()
                            uploader = OSSImageUploader()
                            object_key = uploader.upload_file(sheet_path, sub_path="assets/characters") if uploader.is_configured else None
                            if not object_key:
                                raise RuntimeError("Failed to upload three view variant to OSS.")
                            variant = ImageVariant(id=variant_id, url=object_key, created_at=utc_now(), prompt_used=generation_prompt)
                            character.three_view_asset.variants.insert(0, variant)
                            character.three_views.image_variants.insert(0, variant.model_copy(deep=True))
                            character.three_views.image_prompt = base_prompt
                            character.three_views.image_updated_at = utc_now()
                            cleanup_old_variants(character.three_view_asset)
                            character.three_views.image_variants = [item.model_copy(deep=True) for item in character.three_view_asset.variants]
                            if not character.three_view_asset.selected_id or batch_size == 1:
                                character.three_view_asset.selected_id = variant_id
                                character.three_view_image_url = object_key
                                character.image_url = object_key
                                character.three_views.selected_image_id = variant_id
                        finally:
                            remove_temp_file(sheet_path)
                        successful_generations += 1
                        if index < batch_size - 1:
                            time.sleep(1)
                    except Exception as exc:
                        last_generation_error = exc
                        logger.error("Failed to generate three view variant %s/%s: %s", index + 1, batch_size, exc)
                        continue

                character.three_view_updated_at = utc_now()
                if successful_generations == 0:
                    self._raise_generation_failure("三视图", last_generation_error)

            if generation_type in ["all", "headshot"]:
                if not prompt or generation_type == "all":
                    base_prompt = f"Close-up portrait of the SAME character {character.name}. {character.description}. STRICTLY MAINTAIN the SAME face, hairstyle, skin tone, and facial features as the reference image. Zoom in on face and shoulders, detailed facial features, neutral expression, looking at viewer, high quality, masterpiece."
                else:
                    base_prompt = prompt
                character.headshot_prompt = base_prompt
                generation_prompt = f"{base_prompt}, {style_suffix}" if style_suffix and style_suffix not in base_prompt else base_prompt

                successful_generations = 0
                last_generation_error: Exception | None = None
                for index in range(batch_size):
                    try:
                        variant_id = str(uuid.uuid4())
                        avatar_path = create_temp_file_path(prefix=f"dramalab-character-headshot-{character.id}-{variant_id}-", suffix=".png")
                        try:
                            self.model.generate(generation_prompt, avatar_path, ref_image_path=fullbody_path, negative_prompt=negative_prompt, ref_strength=0.8, model_name=i2i_model_name)
                            self._remember_model_metrics(
                                resource={"asset_type": "character", "asset_id": character.id, "generation_type": "headshot"},
                                artifacts={"variant_kind": "headshot"},
                            )
                            if not character.headshot_asset:
                                character.headshot_asset = ImageAsset()
                            if not character.head_shot:
                                character.head_shot = AssetUnit()
                            uploader = OSSImageUploader()
                            object_key = uploader.upload_file(avatar_path, sub_path="assets/characters") if uploader.is_configured else None
                            if not object_key:
                                raise RuntimeError("Failed to upload headshot variant to OSS.")
                            variant = ImageVariant(id=variant_id, url=object_key, created_at=utc_now(), prompt_used=generation_prompt)
                            character.headshot_asset.variants.insert(0, variant)
                            character.head_shot.image_variants.insert(0, variant.model_copy(deep=True))
                            character.head_shot.image_prompt = base_prompt
                            character.head_shot.image_updated_at = utc_now()
                            cleanup_old_variants(character.headshot_asset)
                            character.head_shot.image_variants = [item.model_copy(deep=True) for item in character.headshot_asset.variants]
                            if not character.headshot_asset.selected_id or batch_size == 1:
                                character.headshot_asset.selected_id = variant_id
                                character.headshot_image_url = object_key
                                character.avatar_url = object_key
                                character.head_shot.selected_image_id = variant_id
                        finally:
                            remove_temp_file(avatar_path)
                        successful_generations += 1
                        if index < batch_size - 1:
                            time.sleep(1)
                    except Exception as exc:
                        last_generation_error = exc
                        logger.error("Failed to generate headshot variant %s/%s: %s", index + 1, batch_size, exc)
                        continue

                character.headshot_updated_at = utc_now()
                if successful_generations == 0:
                    self._raise_generation_failure("头像", last_generation_error)

            if generation_type == "all":
                character.is_consistent = True
            elif character.three_view_updated_at >= character.full_body_updated_at and character.headshot_updated_at >= character.full_body_updated_at:
                character.is_consistent = True

            character.status = GenerationStatus.COMPLETED
        except Exception as exc:
            logger.error("Failed to generate character %s: %s", character.name, exc)
            character.status = GenerationStatus.FAILED
            raise

        return character

    def generate_scene(self, scene: Scene, positive_prompt: str = None, negative_prompt: str = "", batch_size: int = 1, model_name: str = None, size: str = None) -> Scene:
        """为场景资产生成图片候选。"""
        scene.status = GenerationStatus.PROCESSING
        if positive_prompt is None:
            positive_prompt = "cinematic lighting, movie still, 8k, highly detailed, realistic"
        effective_size = size or "1024*576"
        prompt = f"Scene Concept Art: {scene.name}. {scene.description}. High quality, detailed. {positive_prompt}"

        try:
            for _ in range(batch_size):
                variant_id = str(uuid.uuid4())
                output_path = create_temp_file_path(prefix=f"dramalab-scene-{scene.id}-{variant_id}-", suffix=".png")
                try:
                    self.model.generate(prompt, output_path, negative_prompt=negative_prompt, model_name=model_name, size=effective_size)
                    self._remember_model_metrics(
                        resource={"asset_type": "scene", "asset_id": scene.id, "generation_type": "scene"},
                        artifacts={"variant_kind": "scene"},
                    )
                    if not scene.image_asset:
                        scene.image_asset = ImageAsset()
                    uploader = OSSImageUploader()
                    object_key = uploader.upload_file(output_path, sub_path="assets/scenes") if uploader.is_configured else None
                    if not object_key:
                        raise RuntimeError("Failed to upload scene variant to OSS.")
                    variant = ImageVariant(id=variant_id, url=object_key, created_at=utc_now(), prompt_used=prompt)
                    scene.image_asset.variants.insert(0, variant)
                    if not scene.image_asset.selected_id or batch_size == 1:
                        scene.image_asset.selected_id = variant_id
                        scene.image_url = object_key
                finally:
                    remove_temp_file(output_path)
            scene.status = GenerationStatus.COMPLETED
        except Exception as exc:
            logger.error("Failed to generate scene %s: %s", scene.name, exc)
            scene.status = GenerationStatus.FAILED
            raise
        return scene

    def generate_prop(self, prop: Prop, positive_prompt: str = None, negative_prompt: str = "", batch_size: int = 1, model_name: str = None, size: str = None) -> Prop:
        """为道具资产生成图片候选。"""
        prop.status = GenerationStatus.PROCESSING
        if positive_prompt is None:
            positive_prompt = "cinematic lighting, movie still, 8k, highly detailed, realistic"
        effective_size = size or "1024*1024"
        prompt = f"Prop Design: {prop.name}. {prop.description}. Isolated on white background, high quality, detailed. {positive_prompt}"

        try:
            for _ in range(batch_size):
                variant_id = str(uuid.uuid4())
                output_path = create_temp_file_path(prefix=f"dramalab-prop-{prop.id}-{variant_id}-", suffix=".png")
                try:
                    self.model.generate(prompt, output_path, negative_prompt=negative_prompt, model_name=model_name, size=effective_size)
                    self._remember_model_metrics(
                        resource={"asset_type": "prop", "asset_id": prop.id, "generation_type": "prop"},
                        artifacts={"variant_kind": "prop"},
                    )
                    if not prop.image_asset:
                        prop.image_asset = ImageAsset()
                    uploader = OSSImageUploader()
                    object_key = uploader.upload_file(output_path, sub_path="assets/props") if uploader.is_configured else None
                    if not object_key:
                        raise RuntimeError("Failed to upload prop variant to OSS.")
                    variant = ImageVariant(id=variant_id, url=object_key, created_at=utc_now(), prompt_used=prompt)
                    prop.image_asset.variants.insert(0, variant)
                    if not prop.image_asset.selected_id or batch_size == 1:
                        prop.image_asset.selected_id = variant_id
                        prop.image_url = object_key
                finally:
                    remove_temp_file(output_path)
            prop.status = GenerationStatus.COMPLETED
        except Exception as exc:
            logger.error("Failed to generate prop %s: %s", prop.name, exc)
            prop.status = GenerationStatus.FAILED
            raise
        return prop
