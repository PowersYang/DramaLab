"""Concrete image generation implementation for storyboard rendering."""

import os
import time
import uuid
from typing import Any, Dict, List

from backend.src.schemas.models import Character, GenerationStatus, ImageAsset, ImageVariant, Scene, StoryboardFrame

from ...models.image import WanxImageModel
from ...utils import get_logger
from ...utils.oss_utils import OSSImageUploader, is_object_key

logger = get_logger(__name__)


class StoryboardGenerator:
    """
    分镜图片生成 provider。

    这里承接原 `src/service/storyboard.py` 的实现。
    """

    def __init__(self, config: Dict[str, Any] = None):
        self.config = config or {}
        self.model = WanxImageModel(self.config.get("model", {}))
        self.output_dir = self.config.get("output_dir", "output/storyboard")

    def generate_storyboard(self, script: Any) -> Any:
        """Generate images for all incomplete frames in a script."""
        logger.info("Generating storyboard for script: %s", script.title)
        total_frames = len(script.frames)
        for index, frame in enumerate(script.frames):
            logger.info("Generating frame %s/%s: %s", index + 1, total_frames, frame.id)
            if frame.status == GenerationStatus.COMPLETED and frame.image_url:
                continue
            scene = next((item for item in script.scenes if item.id == frame.scene_id), None)
            self.generate_frame(frame, script.characters, scene)
        return script

    def generate_frame(
        self,
        frame: StoryboardFrame,
        characters: List[Character],
        scene: Scene,
        ref_image_path: str = None,
        ref_image_paths: List[str] = None,
        prompt: str = None,
        batch_size: int = 1,
        size: str = None,
        model_name: str = None,
    ) -> StoryboardFrame:
        """Generate one or more image variants for a single storyboard frame."""
        frame.status = GenerationStatus.PROCESSING
        effective_size = size or "1024*576"
        char_descriptions = []
        asset_ref_paths = []
        use_frontend_refs = (ref_image_paths and len(ref_image_paths) > 0) or ref_image_path

        if use_frontend_refs:
            # Prefer explicit frontend composition references when present.
            if ref_image_paths:
                asset_ref_paths.extend(ref_image_paths)
            if ref_image_path:
                asset_ref_paths.append(ref_image_path)
            logger.info("[Storyboard] Using %s frontend-provided reference images", len(asset_ref_paths))
        else:
            # Fall back to selected character and scene assets from the project.
            for char_id in frame.character_ids:
                char = next((item for item in characters if item.id == char_id), None)
                if not char:
                    continue
                target_url = None
                if char.three_view_asset and char.three_view_asset.selected_id:
                    selected_variant = next((variant for variant in char.three_view_asset.variants if variant.id == char.three_view_asset.selected_id), None)
                    if selected_variant:
                        target_url = selected_variant.url
                if not target_url and char.full_body_asset and char.full_body_asset.selected_id:
                    selected_variant = next((variant for variant in char.full_body_asset.variants if variant.id == char.full_body_asset.selected_id), None)
                    if selected_variant:
                        target_url = selected_variant.url
                if not target_url and char.headshot_asset and char.headshot_asset.selected_id:
                    selected_variant = next((variant for variant in char.headshot_asset.variants if variant.id == char.headshot_asset.selected_id), None)
                    if selected_variant:
                        target_url = selected_variant.url
                if not target_url:
                    target_url = char.three_view_image_url or char.full_body_image_url or char.headshot_image_url or char.avatar_url or char.image_url
                if target_url:
                    if is_object_key(target_url):
                        asset_ref_paths.append(target_url)
                    else:
                        potential_path = os.path.join("output", target_url)
                        if os.path.exists(potential_path):
                            asset_ref_paths.append(os.path.abspath(potential_path))
                        elif os.path.exists(target_url):
                            asset_ref_paths.append(os.path.abspath(target_url))

            scene_url = None
            if scene:
                if scene.image_asset and scene.image_asset.selected_id:
                    selected_variant = next((variant for variant in scene.image_asset.variants if variant.id == scene.image_asset.selected_id), None)
                    if selected_variant:
                        scene_url = selected_variant.url
                if not scene_url:
                    scene_url = scene.image_url
                if scene_url:
                    if is_object_key(scene_url):
                        asset_ref_paths.append(scene_url)
                    else:
                        potential_path = os.path.join("output", scene_url)
                        if os.path.exists(potential_path):
                            asset_ref_paths.append(os.path.abspath(potential_path))
                        elif os.path.exists(scene_url):
                            asset_ref_paths.append(os.path.abspath(scene_url))

        for char_id in frame.character_ids:
            char = next((item for item in characters if item.id == char_id), None)
            if char:
                char_descriptions.append(f"{char.name} ({char.description})")

        char_text = ", ".join(char_descriptions)
        asset_ref_paths = list(set(asset_ref_paths))

        if not prompt:
            prompt = f"Storyboard Frame: {frame.action_description}. "
            if char_text:
                prompt += f"Characters: {char_text}. "
            if scene:
                prompt += f"Location: {scene.name}, {scene.description}. "
            prompt += f"Camera: {frame.camera_angle}"
            if frame.camera_movement:
                prompt += f", {frame.camera_movement}"
            prompt += "."
        elif char_text and char_text not in prompt:
            prompt = f"{prompt} Characters: {char_text}."

        frame.image_prompt = prompt
        if not frame.rendered_image_asset:
            frame.rendered_image_asset = ImageAsset(asset_id=frame.id, asset_type="storyboard_frame")

        try:
            for _ in range(batch_size):
                variant_id = str(uuid.uuid4())
                output_filename = f"{frame.id}_{variant_id}.png"
                output_path = os.path.join(self.output_dir, output_filename)
                os.makedirs(os.path.dirname(output_path), exist_ok=True)
                logger.info("[Storyboard] Calling model.generate with %s reference images using model %s", len(asset_ref_paths), model_name or "default")
                self.model.generate(prompt, output_path, ref_image_paths=asset_ref_paths, size=effective_size, model_name=model_name)
                rel_path = os.path.relpath(output_path, "output")
                variant = ImageVariant(id=variant_id, url=rel_path, prompt=prompt, created_at=time.time())
                frame.rendered_image_asset.variants.append(variant)
                frame.rendered_image_asset.selected_id = variant_id

            selected_variant = next((variant for variant in frame.rendered_image_asset.variants if variant.id == frame.rendered_image_asset.selected_id), None)
            if selected_variant:
                frame.rendered_image_url = selected_variant.url
                frame.image_url = selected_variant.url

            frame.updated_at = time.time()
            frame.status = GenerationStatus.COMPLETED

            try:
                uploader = OSSImageUploader()
                if uploader.is_configured and selected_variant:
                    # Upload only the selected variant so external references
                    # stay aligned with the image currently shown in the UI.
                    local_path = os.path.join("output", selected_variant.url)
                    if os.path.exists(local_path):
                        object_key = uploader.upload_file(local_path, sub_path="storyboard")
                        if object_key:
                            logger.info("Uploaded frame %s to OSS: %s", frame.id, object_key)
                            selected_variant.url = object_key
                            frame.rendered_image_url = object_key
                            frame.image_url = object_key
            except Exception as exc:
                logger.error("Failed to upload frame %s to OSS: %s", frame.id, exc)
        except Exception as exc:
            logger.error("Failed to generate frame %s: %s", frame.id, exc)
            frame.status = GenerationStatus.FAILED

        return frame
