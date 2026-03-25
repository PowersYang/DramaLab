"""Concrete image generation implementation for characters, scenes, and props."""

import os
import time
import uuid
from typing import Any, Dict

from backend.src.schemas.models import Character, GenerationStatus, ImageAsset, ImageVariant, MAX_VARIANTS_PER_ASSET, Prop, Scene

from ...models.image import WanxImageModel
from ...utils import get_logger
from ...utils.oss_utils import OSSImageUploader, is_object_key

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
        self.output_dir = self.config.get("output_dir", "output/assets")

    def generate_character(self, character: Character, generation_type: str = "all", prompt: str = "", positive_prompt: str = None, negative_prompt: str = "", batch_size: int = 1, model_name: str = None, i2i_model_name: str = None, size: str = None) -> Character:
        """Generate character asset variants for one or more asset slots."""
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
                if character.base_character_id:
                    base_fullbody_path = os.path.join(self.output_dir, "characters", f"{character.base_character_id}_fullbody.png")
                    if os.path.exists(base_fullbody_path):
                        ref_image_path = base_fullbody_path

                if not ref_image_path and character.three_view_asset:
                    uploaded_variant = next((variant for variant in character.three_view_asset.variants if getattr(variant, "is_uploaded_source", False)), None)
                    if uploaded_variant:
                        ref_url = uploaded_variant.url
                        if is_object_key(ref_url):
                            ref_image_path = ref_url
                        else:
                            local_path = os.path.join("output", ref_url)
                            if os.path.exists(local_path):
                                ref_image_path = local_path

                if not ref_image_path and character.headshot_asset:
                    uploaded_variant = next((variant for variant in character.headshot_asset.variants if getattr(variant, "is_uploaded_source", False)), None)
                    if uploaded_variant:
                        ref_url = uploaded_variant.url
                        if is_object_key(ref_url):
                            ref_image_path = ref_url
                        else:
                            local_path = os.path.join("output", ref_url)
                            if os.path.exists(local_path):
                                ref_image_path = local_path

                successful_generations = 0
                for index in range(batch_size):
                    try:
                        variant_id = str(uuid.uuid4())
                        fullbody_path = os.path.join(self.output_dir, "characters", f"{character.id}_fullbody_{variant_id}.png")
                        os.makedirs(os.path.dirname(fullbody_path), exist_ok=True)

                        effective_model_name = model_name
                        effective_generation_prompt = generation_prompt
                        if ref_image_path:
                            # When a reference exists, switch to the image-to-image
                            # model so the generated appearance stays consistent.
                            effective_model_name = i2i_model_name or "wan2.6-image"
                            reverse_enhancement = "STRICTLY MAINTAIN the SAME character appearance, face, hairstyle, skin tone, and clothing as the reference image. "
                            if reverse_enhancement.strip() not in effective_generation_prompt:
                                effective_generation_prompt = f"{reverse_enhancement}{generation_prompt}"

                        self.model.generate(
                            effective_generation_prompt,
                            fullbody_path,
                            ref_image_path=ref_image_path,
                            negative_prompt=negative_prompt,
                            model_name=effective_model_name,
                            size=effective_size,
                        )

                        rel_fullbody_path = os.path.relpath(fullbody_path, "output")
                        if not character.full_body_asset:
                            character.full_body_asset = ImageAsset()

                        variant = ImageVariant(
                            id=variant_id,
                            url=rel_fullbody_path,
                            created_at=time.time(),
                            prompt_used=generation_prompt,
                        )
                        character.full_body_asset.variants.insert(0, variant)
                        cleanup_old_variants(character.full_body_asset)

                        if not character.full_body_asset.selected_id or batch_size == 1:
                            character.full_body_asset.selected_id = variant_id
                            character.full_body_image_url = rel_fullbody_path

                        successful_generations += 1
                        if index < batch_size - 1:
                            time.sleep(1)
                    except Exception as exc:
                        logger.error("Failed to generate full body variant %s/%s: %s", index + 1, batch_size, exc)
                        continue

                    try:
                        uploader = OSSImageUploader()
                        if uploader.is_configured:
                            object_key = uploader.upload_file(fullbody_path, sub_path="assets/characters")
                            if object_key:
                                variant.url = object_key
                                if character.full_body_asset.selected_id == variant.id:
                                    character.full_body_image_url = object_key
                    except Exception as exc:
                        logger.error("Failed to upload full body variant %s/%s to OSS: %s", index + 1, batch_size, exc)

                character.full_body_updated_at = time.time()
                if successful_generations == 0:
                    raise RuntimeError("生成失败，请检查 API 配置或修改描述内容后重试。")
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
            if reference_url:
                if is_object_key(reference_url):
                    fullbody_path = reference_url
                else:
                    fullbody_path = os.path.join("output", reference_url)
            else:
                fullbody_path = None

            if generation_type in ["all", "three_view"]:
                if not prompt or generation_type == "all":
                    base_prompt = f"Character Reference Sheet for {character.name}. {character.description}. Three-view character design: Front view, Side view, and Back view. STRICTLY MAINTAIN the SAME character appearance, face, hairstyle, and clothing as the reference image. Full body, standing pose, neutral expression. Consistent clothing and details across all views. Simple white background, clean lines, studio lighting, high quality."
                else:
                    base_prompt = prompt
                character.three_view_prompt = base_prompt
                generation_prompt = f"{base_prompt}, {style_suffix}" if style_suffix and style_suffix not in base_prompt else base_prompt
                sheet_negative = negative_prompt + ", background, scenery, landscape, shadows, complex background, text, watermark, messy, distorted, extra limbs"

                successful_generations = 0
                for index in range(batch_size):
                    try:
                        variant_id = str(uuid.uuid4())
                        sheet_path = os.path.join(self.output_dir, "characters", f"{character.id}_sheet_{variant_id}.png")
                        self.model.generate(generation_prompt, sheet_path, ref_image_path=fullbody_path, negative_prompt=sheet_negative, ref_strength=0.8, model_name=i2i_model_name)
                        rel_sheet_path = os.path.relpath(sheet_path, "output")
                        if not character.three_view_asset:
                            character.three_view_asset = ImageAsset()
                        variant = ImageVariant(id=variant_id, url=rel_sheet_path, created_at=time.time(), prompt_used=generation_prompt)
                        character.three_view_asset.variants.insert(0, variant)
                        cleanup_old_variants(character.three_view_asset)
                        if not character.three_view_asset.selected_id or batch_size == 1:
                            character.three_view_asset.selected_id = variant_id
                            character.three_view_image_url = rel_sheet_path
                            character.image_url = rel_sheet_path
                        successful_generations += 1
                        if index < batch_size - 1:
                            time.sleep(1)
                    except Exception as exc:
                        logger.error("Failed to generate three view variant %s/%s: %s", index + 1, batch_size, exc)
                        continue

                    try:
                        uploader = OSSImageUploader()
                        if uploader.is_configured:
                            object_key = uploader.upload_file(sheet_path, sub_path="assets/characters")
                            if object_key:
                                variant.url = object_key
                                if character.three_view_asset.selected_id == variant.id:
                                    character.three_view_image_url = object_key
                                    character.image_url = object_key
                    except Exception as exc:
                        logger.error("Failed to upload three view variant %s/%s to OSS: %s", index + 1, batch_size, exc)

                character.three_view_updated_at = time.time()
                if successful_generations == 0:
                    raise RuntimeError("生成失败，请检查 API 配置或修改描述内容后重试。")

            if generation_type in ["all", "headshot"]:
                if not prompt or generation_type == "all":
                    base_prompt = f"Close-up portrait of the SAME character {character.name}. {character.description}. STRICTLY MAINTAIN the SAME face, hairstyle, skin tone, and facial features as the reference image. Zoom in on face and shoulders, detailed facial features, neutral expression, looking at viewer, high quality, masterpiece."
                else:
                    base_prompt = prompt
                character.headshot_prompt = base_prompt
                generation_prompt = f"{base_prompt}, {style_suffix}" if style_suffix and style_suffix not in base_prompt else base_prompt

                successful_generations = 0
                for index in range(batch_size):
                    try:
                        variant_id = str(uuid.uuid4())
                        avatar_path = os.path.join(self.output_dir, "characters", f"{character.id}_avatar_{variant_id}.png")
                        self.model.generate(generation_prompt, avatar_path, ref_image_path=fullbody_path, negative_prompt=negative_prompt, ref_strength=0.8, model_name=i2i_model_name)
                        rel_avatar_path = os.path.relpath(avatar_path, "output")
                        if not character.headshot_asset:
                            character.headshot_asset = ImageAsset()
                        variant = ImageVariant(id=variant_id, url=rel_avatar_path, created_at=time.time(), prompt_used=generation_prompt)
                        character.headshot_asset.variants.insert(0, variant)
                        cleanup_old_variants(character.headshot_asset)
                        if not character.headshot_asset.selected_id or batch_size == 1:
                            character.headshot_asset.selected_id = variant_id
                            character.headshot_image_url = rel_avatar_path
                            character.avatar_url = rel_avatar_path
                        successful_generations += 1
                        if index < batch_size - 1:
                            time.sleep(1)
                    except Exception as exc:
                        logger.error("Failed to generate headshot variant %s/%s: %s", index + 1, batch_size, exc)
                        continue

                    try:
                        uploader = OSSImageUploader()
                        if uploader.is_configured:
                            object_key = uploader.upload_file(avatar_path, sub_path="assets/characters")
                            if object_key:
                                variant.url = object_key
                                if character.headshot_asset.selected_id == variant.id:
                                    character.headshot_image_url = object_key
                                    character.avatar_url = object_key
                    except Exception as exc:
                        logger.error("Failed to upload headshot variant %s/%s to OSS: %s", index + 1, batch_size, exc)

                character.headshot_updated_at = time.time()
                if successful_generations == 0:
                    raise RuntimeError("生成失败，请检查 API 配置或修改描述内容后重试。")

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
        """Generate image variants for a scene asset."""
        scene.status = GenerationStatus.PROCESSING
        if positive_prompt is None:
            positive_prompt = "cinematic lighting, movie still, 8k, highly detailed, realistic"
        effective_size = size or "1024*576"
        prompt = f"Scene Concept Art: {scene.name}. {scene.description}. High quality, detailed. {positive_prompt}"

        try:
            for _ in range(batch_size):
                variant_id = str(uuid.uuid4())
                output_path = os.path.join(self.output_dir, "scenes", f"{scene.id}_{variant_id}.png")
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                self.model.generate(prompt, output_path, negative_prompt=negative_prompt, model_name=model_name, size=effective_size)
                rel_path = os.path.relpath(output_path, "output")
                if not scene.image_asset:
                    scene.image_asset = ImageAsset()
                variant = ImageVariant(id=variant_id, url=rel_path, created_at=time.time(), prompt_used=prompt)
                scene.image_asset.variants.insert(0, variant)
                if not scene.image_asset.selected_id or batch_size == 1:
                    scene.image_asset.selected_id = variant_id
                    scene.image_url = rel_path
                try:
                    uploader = OSSImageUploader()
                    if uploader.is_configured:
                        object_key = uploader.upload_file(output_path, sub_path="assets/scenes")
                        if object_key:
                            variant.url = object_key
                            if scene.image_asset.selected_id == variant.id:
                                scene.image_url = object_key
                except Exception as exc:
                    logger.error("Failed to upload scene variant to OSS: %s", exc)
            scene.status = GenerationStatus.COMPLETED
        except Exception as exc:
            logger.error("Failed to generate scene %s: %s", scene.name, exc)
            scene.status = GenerationStatus.FAILED
            raise
        return scene

    def generate_prop(self, prop: Prop, positive_prompt: str = None, negative_prompt: str = "", batch_size: int = 1, model_name: str = None, size: str = None) -> Prop:
        """Generate image variants for a prop asset."""
        prop.status = GenerationStatus.PROCESSING
        if positive_prompt is None:
            positive_prompt = "cinematic lighting, movie still, 8k, highly detailed, realistic"
        effective_size = size or "1024*1024"
        prompt = f"Prop Design: {prop.name}. {prop.description}. Isolated on white background, high quality, detailed. {positive_prompt}"

        try:
            for _ in range(batch_size):
                variant_id = str(uuid.uuid4())
                output_path = os.path.join(self.output_dir, "props", f"{prop.id}_{variant_id}.png")
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                self.model.generate(prompt, output_path, negative_prompt=negative_prompt, model_name=model_name, size=effective_size)
                rel_path = os.path.relpath(output_path, "output")
                if not prop.image_asset:
                    prop.image_asset = ImageAsset()
                variant = ImageVariant(id=variant_id, url=rel_path, created_at=time.time(), prompt_used=prompt)
                prop.image_asset.variants.insert(0, variant)
                if not prop.image_asset.selected_id or batch_size == 1:
                    prop.image_asset.selected_id = variant_id
                    prop.image_url = rel_path
                try:
                    uploader = OSSImageUploader()
                    if uploader.is_configured:
                        object_key = uploader.upload_file(output_path, sub_path="assets/props")
                        if object_key:
                            variant.url = object_key
                            if prop.image_asset.selected_id == variant.id:
                                prop.image_url = object_key
                except Exception as exc:
                    logger.error("Failed to upload prop variant to OSS: %s", exc)
            prop.status = GenerationStatus.COMPLETED
        except Exception as exc:
            logger.error("Failed to generate prop %s: %s", prop.name, exc)
            prop.status = GenerationStatus.FAILED
            raise
        return prop
