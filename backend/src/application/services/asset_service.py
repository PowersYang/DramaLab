"""Asset application service.

This service handles direct user edits to asset state such as locking,
selecting variants, and uploading manual replacements.
"""

import os
import shutil
import time
import uuid
from typing import Any

from ...repository import ProjectRepository
from ...schemas.models import AssetUnit, ImageAsset, ImageVariant
from ...utils.oss_utils import OSSImageUploader


class AssetService:
    """Application service for project asset mutations."""

    def __init__(self):
        self.project_repository = ProjectRepository()

    def toggle_lock(self, script_id: str, asset_id: str, asset_type: str):
        """Toggle lock state for a project asset."""
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        asset.locked = not asset.locked
        return self._save_project(project)

    def update_image(self, script_id: str, asset_id: str, asset_type: str, image_url: str):
        """Update the currently selected image URL for an asset."""
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        asset.image_url = image_url
        if asset_type == "character":
            asset.avatar_url = image_url
        return self._save_project(project)

    def update_description(self, script_id: str, asset_id: str, asset_type: str, description: str):
        """Update only the description field of an asset."""
        return self.update_attributes(script_id, asset_id, asset_type, {"description": description})

    def update_attributes(self, script_id: str, asset_id: str, asset_type: str, attributes: dict[str, Any]):
        """Patch mutable asset attributes with the provided values."""
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        for key, value in attributes.items():
            if hasattr(asset, key):
                setattr(asset, key, value)
        return self._save_project(project)

    def select_variant(self, script_id: str, asset_id: str, asset_type: str, variant_id: str, generation_type: str | None = None):
        """Select an image variant and sync any denormalized top-level URLs."""
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        variant = None

        if asset_type == "character":
            if generation_type == "full_body":
                variant = self._select_in_image_asset(asset.full_body_asset, variant_id)
                if variant:
                    asset.full_body_image_url = variant.url
                    asset.image_url = variant.url
            elif generation_type == "three_view":
                variant = self._select_in_image_asset(asset.three_view_asset, variant_id)
                if variant:
                    asset.three_view_image_url = variant.url
            elif generation_type == "headshot":
                variant = self._select_in_image_asset(asset.headshot_asset, variant_id)
                if variant:
                    asset.headshot_image_url = variant.url
                    asset.avatar_url = variant.url
            else:
                for image_asset, setter in (
                    (asset.full_body_asset, lambda v: (setattr(asset, "full_body_image_url", v.url), setattr(asset, "image_url", v.url))),
                    (asset.three_view_asset, lambda v: setattr(asset, "three_view_image_url", v.url)),
                    (asset.headshot_asset, lambda v: (setattr(asset, "headshot_image_url", v.url), setattr(asset, "avatar_url", v.url))),
                ):
                    variant = self._select_in_image_asset(image_asset, variant_id)
                    if variant:
                        setter(variant)
                        break
        elif asset_type in {"scene", "prop"}:
            variant = self._select_in_image_asset(asset.image_asset, variant_id)
            if variant:
                asset.image_url = variant.url
        elif asset_type == "storyboard_frame":
            variant = self._select_in_image_asset(asset.rendered_image_asset, variant_id)
            if variant:
                asset.rendered_image_url = variant.url
                asset.image_url = variant.url
            if not variant:
                self._select_in_image_asset(asset.image_asset, variant_id)
        else:
            raise ValueError(f"Unsupported asset_type: {asset_type}")

        return self._save_project(project)

    def delete_variant(self, script_id: str, asset_id: str, asset_type: str, variant_id: str):
        """Delete a variant and refresh the selected URL if it changed."""
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)

        if asset_type == "character":
            if self._delete_in_image_asset(asset.full_body_asset, variant_id):
                self._sync_selected_url(asset.full_body_asset, "full_body_image_url", asset)
                asset.image_url = asset.full_body_image_url
            elif self._delete_in_image_asset(asset.three_view_asset, variant_id):
                self._sync_selected_url(asset.three_view_asset, "three_view_image_url", asset)
            elif self._delete_in_image_asset(asset.headshot_asset, variant_id):
                self._sync_selected_url(asset.headshot_asset, "headshot_image_url", asset)
                asset.avatar_url = asset.headshot_image_url
        elif asset_type in {"scene", "prop"}:
            if self._delete_in_image_asset(asset.image_asset, variant_id):
                self._sync_selected_url(asset.image_asset, "image_url", asset)
        elif asset_type == "storyboard_frame":
            if self._delete_in_image_asset(asset.rendered_image_asset, variant_id):
                self._sync_selected_url(asset.rendered_image_asset, "rendered_image_url", asset)
                asset.image_url = asset.rendered_image_url
        return self._save_project(project)

    def toggle_variant_favorite(self, script_id: str, asset_id: str, asset_type: str, variant_id: str, is_favorited: bool, generation_type: str | None = None):
        """Mark or unmark a variant as favorited."""
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        found = False
        if asset_type == "character":
            if generation_type == "full_body":
                found = self._set_favorite(asset.full_body_asset, variant_id, is_favorited)
            elif generation_type == "three_view":
                found = self._set_favorite(asset.three_view_asset, variant_id, is_favorited)
            elif generation_type == "headshot":
                found = self._set_favorite(asset.headshot_asset, variant_id, is_favorited)
            else:
                found = self._set_favorite(asset.full_body_asset, variant_id, is_favorited) or self._set_favorite(asset.three_view_asset, variant_id, is_favorited) or self._set_favorite(asset.headshot_asset, variant_id, is_favorited)
        elif asset_type in {"scene", "prop"}:
            found = self._set_favorite(asset.image_asset, variant_id, is_favorited)
        elif asset_type == "storyboard_frame":
            found = self._set_favorite(asset.rendered_image_asset, variant_id, is_favorited) or self._set_favorite(asset.image_asset, variant_id, is_favorited)

        if not found:
            raise ValueError(f"Variant {variant_id} not found")
        return self._save_project(project)

    def upload_variant(self, script_id: str, asset_type: str, asset_id: str, upload_type: str, image_url: str, description: str | None = None):
        """Attach a user-uploaded image as a new variant for an asset."""
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        new_variant = ImageVariant(
            id=str(uuid.uuid4()),
            url=image_url,
            prompt_used=description or asset.description,
            is_uploaded_source=True,
            upload_type=upload_type,
        )
        if description:
            asset.description = description

        if asset_type == "character":
            # Character uploads must update both the new AssetUnit structure
            # and the legacy ImageAsset fields still used elsewhere.
            if upload_type == "full_body":
                target_unit = asset.full_body or AssetUnit()
                asset.full_body = target_unit
                legacy = asset.full_body_asset or ImageAsset()
                asset.full_body_asset = legacy
                asset.full_body_image_url = image_url
            elif upload_type == "head_shot":
                target_unit = asset.head_shot or AssetUnit()
                asset.head_shot = target_unit
                legacy = asset.headshot_asset or ImageAsset()
                asset.headshot_asset = legacy
                asset.headshot_image_url = image_url
            elif upload_type == "three_views":
                target_unit = asset.three_views or AssetUnit()
                asset.three_views = target_unit
                legacy = asset.three_view_asset or ImageAsset()
                asset.three_view_asset = legacy
                asset.three_view_image_url = image_url
            else:
                raise ValueError(f"Invalid upload_type for character: {upload_type}")
            target_unit.image_variants.append(new_variant)
            target_unit.selected_image_id = new_variant.id
            target_unit.image_updated_at = time.time()
            legacy.variants.append(new_variant.model_copy(deep=True))
            legacy.selected_id = new_variant.id
        elif asset_type in {"scene", "prop"}:
            legacy = asset.image_asset or ImageAsset()
            asset.image_asset = legacy
            legacy.variants.append(new_variant)
            legacy.selected_id = new_variant.id
            asset.image_url = image_url
        else:
            raise ValueError(f"Invalid asset_type: {asset_type}")

        return self._save_project(project)

    def delete_asset_video(self, script_id: str, asset_id: str, asset_type: str, video_id: str):
        """Remove a generated asset video from both asset and project scope."""
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        if hasattr(asset, "video_assets") and asset.video_assets is not None:
            asset.video_assets = [video for video in asset.video_assets if video.id != video_id]
        project.video_tasks = [task for task in project.video_tasks if task.id != video_id]
        return self._save_project(project)

    def select_video_for_frame(self, script_id: str, frame_id: str, video_id: str):
        """Bind a generated video task as the selected output for a frame."""
        project = self._get_project(script_id)
        frame = next((frame for frame in project.frames if frame.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")
        video = next((video for video in project.video_tasks if video.id == video_id), None)
        if not video:
            raise ValueError("Video task not found")
        frame.selected_video_id = video_id
        frame.video_url = video.video_url
        frame.updated_at = time.time()
        return self._save_project(project)

    def upload_frame_image(self, script_id: str, frame_id: str, image_path: str):
        """Upload a manual storyboard frame image and store it as a variant."""
        project = self._get_project(script_id)
        frame = next((frame for frame in project.frames if frame.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")

        safe_path = os.path.join("output", os.path.relpath(image_path, "output")) if os.path.isabs(image_path) else image_path
        uploader = OSSImageUploader()
        oss_url = uploader.upload_image(safe_path)
        image_url = oss_url if oss_url else os.path.relpath(safe_path, "output")
        variant = ImageVariant(
            id=str(uuid.uuid4()),
            url=image_url,
            prompt_used="User uploaded image",
            is_uploaded_source=True,
            upload_type="image",
        )
        frame.rendered_image_asset = frame.rendered_image_asset or ImageAsset()
        frame.rendered_image_asset.variants.append(variant)
        frame.rendered_image_asset.selected_id = variant.id
        frame.rendered_image_url = image_url
        frame.updated_at = time.time()
        return self._save_project(project)

    def _get_project(self, script_id: str):
        """Load a project aggregate or raise a consistent not-found error."""
        project = self.project_repository.get(script_id)
        if not project:
            raise ValueError("Script not found")
        return project

    def _find_asset(self, project, asset_id: str, asset_type: str):
        """Resolve an asset object by logical asset type inside a project."""
        if asset_type == "character":
            target = next((item for item in project.characters if item.id == asset_id), None)
        elif asset_type == "scene":
            target = next((item for item in project.scenes if item.id == asset_id), None)
        elif asset_type == "prop":
            target = next((item for item in project.props if item.id == asset_id), None)
        elif asset_type == "storyboard_frame":
            target = next((item for item in project.frames if item.id == asset_id), None)
        else:
            raise ValueError(f"Unsupported asset_type: {asset_type}")
        if not target:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")
        return target

    def _save_project(self, project):
        """Persist project aggregate changes and return a fresh read."""
        project.updated_at = time.time()
        self.project_repository.save(project)
        return self.project_repository.get(project.id)

    def _select_in_image_asset(self, image_asset: ImageAsset | None, variant_id: str):
        """Select a variant inside a legacy ImageAsset container."""
        if not image_asset or not image_asset.variants:
            return None
        for variant in image_asset.variants:
            if variant.id == variant_id:
                image_asset.selected_id = variant_id
                return variant
        return None

    def _delete_in_image_asset(self, image_asset: ImageAsset | None, variant_id: str):
        if not image_asset or not image_asset.variants:
            return False
        before = len(image_asset.variants)
        image_asset.variants = [variant for variant in image_asset.variants if variant.id != variant_id]
        if image_asset.selected_id == variant_id:
            image_asset.selected_id = image_asset.variants[0].id if image_asset.variants else None
        return len(image_asset.variants) != before

    def _set_favorite(self, image_asset: ImageAsset | None, variant_id: str, is_favorited: bool):
        if not image_asset or not image_asset.variants:
            return False
        for variant in image_asset.variants:
            if variant.id == variant_id:
                variant.is_favorited = is_favorited
                return True
        return False

    def _sync_selected_url(self, image_asset: ImageAsset | None, attr_name: str, target: Any):
        if image_asset and image_asset.selected_id:
            selected = next((variant for variant in image_asset.variants if variant.id == image_asset.selected_id), None)
            setattr(target, attr_name, selected.url if selected else None)
        else:
            setattr(target, attr_name, None)
