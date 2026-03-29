"""
资产应用服务。

这里处理用户对资产状态的直接编辑，例如锁定、切换候选图、上传手工替换图等。
"""

import os
import uuid
from typing import Any

from ...common.log import get_logger
from ...repository import ProjectRepository, StoryboardFrameRepository
from ...schemas.models import AssetUnit, ImageAsset, ImageVariant
from ...utils.datetime import utc_now


logger = get_logger(__name__)


class AssetService:
    """负责项目资产相关变更。"""

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.storyboard_frame_repository = StoryboardFrameRepository()

    def toggle_lock(self, script_id: str, asset_id: str, asset_type: str):
        """切换项目资产的锁定状态。"""
        logger.info("ASSET_SERVICE: toggle_lock script_id=%s asset_id=%s asset_type=%s", script_id, asset_id, asset_type)
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        asset.locked = not asset.locked
        return self._save_project(project)

    def update_image(self, script_id: str, asset_id: str, asset_type: str, image_url: str):
        """更新资产当前选中的图片地址。"""
        logger.info("ASSET_SERVICE: update_image script_id=%s asset_id=%s asset_type=%s", script_id, asset_id, asset_type)
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        asset.image_url = image_url
        if asset_type == "character":
            asset.avatar_url = image_url
        return self._save_project(project)

    def update_description(self, script_id: str, asset_id: str, asset_type: str, description: str):
        """仅更新资产的描述字段。"""
        logger.info("ASSET_SERVICE: update_description script_id=%s asset_id=%s asset_type=%s", script_id, asset_id, asset_type)
        return self.update_attributes(script_id, asset_id, asset_type, {"description": description})

    def update_attributes(self, script_id: str, asset_id: str, asset_type: str, attributes: dict[str, Any]):
        """按给定值增量更新资产可变属性。"""
        logger.info("ASSET_SERVICE: update_attributes script_id=%s asset_id=%s asset_type=%s fields=%s", script_id, asset_id, asset_type, sorted(attributes.keys()))
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        for key, value in attributes.items():
            if hasattr(asset, key):
                setattr(asset, key, value)
        return self._save_project(project)

    def select_variant(self, script_id: str, asset_id: str, asset_type: str, variant_id: str, generation_type: str | None = None):
        """选中一个图片候选，并同步顶层冗余图片地址。"""
        logger.info(
            "ASSET_SERVICE: select_variant script_id=%s asset_id=%s asset_type=%s variant_id=%s generation_type=%s",
            script_id,
            asset_id,
            asset_type,
            variant_id,
            generation_type,
        )
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        variant = None

        if asset_type == "character":
            if generation_type == "full_body":
                variant = self._select_in_image_asset(asset.full_body_asset, variant_id)
                if variant:
                    self._select_in_asset_unit(asset.full_body, variant_id)
                    asset.full_body_image_url = variant.url
                    asset.image_url = variant.url
            elif generation_type == "three_view":
                variant = self._select_in_image_asset(asset.three_view_asset, variant_id)
                if variant:
                    self._select_in_asset_unit(asset.three_views, variant_id)
                    asset.three_view_image_url = variant.url
            elif generation_type == "headshot":
                variant = self._select_in_image_asset(asset.headshot_asset, variant_id)
                if variant:
                    self._select_in_asset_unit(asset.head_shot, variant_id)
                    asset.headshot_image_url = variant.url
                    asset.avatar_url = variant.url
            else:
                for image_asset, asset_unit, setter in (
                    (asset.full_body_asset, asset.full_body, lambda v: (setattr(asset, "full_body_image_url", v.url), setattr(asset, "image_url", v.url))),
                    (asset.three_view_asset, asset.three_views, lambda v: setattr(asset, "three_view_image_url", v.url)),
                    (asset.headshot_asset, asset.head_shot, lambda v: (setattr(asset, "headshot_image_url", v.url), setattr(asset, "avatar_url", v.url))),
                ):
                    variant = self._select_in_image_asset(image_asset, variant_id)
                    if variant:
                        self._select_in_asset_unit(asset_unit, variant_id)
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
        """删除候选图，并在必要时刷新当前选中地址。"""
        logger.info("ASSET_SERVICE: delete_variant script_id=%s asset_id=%s asset_type=%s variant_id=%s", script_id, asset_id, asset_type, variant_id)
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)

        if asset_type == "character":
            if self._delete_in_image_asset(asset.full_body_asset, variant_id):
                self._delete_in_asset_unit(asset.full_body, variant_id)
                self._sync_selected_url(asset.full_body_asset, "full_body_image_url", asset)
                asset.image_url = asset.full_body_image_url
            elif self._delete_in_image_asset(asset.three_view_asset, variant_id):
                self._delete_in_asset_unit(asset.three_views, variant_id)
                self._sync_selected_url(asset.three_view_asset, "three_view_image_url", asset)
            elif self._delete_in_image_asset(asset.headshot_asset, variant_id):
                self._delete_in_asset_unit(asset.head_shot, variant_id)
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
        """设置或取消候选图收藏状态。"""
        logger.info(
            "ASSET_SERVICE: toggle_variant_favorite script_id=%s asset_id=%s asset_type=%s variant_id=%s is_favorited=%s generation_type=%s",
            script_id,
            asset_id,
            asset_type,
            variant_id,
            is_favorited,
            generation_type,
        )
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        found = False
        if asset_type == "character":
            if generation_type == "full_body":
                found = self._set_favorite(asset.full_body_asset, variant_id, is_favorited)
                found = self._set_favorite_asset_unit(asset.full_body, variant_id, is_favorited) or found
            elif generation_type == "three_view":
                found = self._set_favorite(asset.three_view_asset, variant_id, is_favorited)
                found = self._set_favorite_asset_unit(asset.three_views, variant_id, is_favorited) or found
            elif generation_type == "headshot":
                found = self._set_favorite(asset.headshot_asset, variant_id, is_favorited)
                found = self._set_favorite_asset_unit(asset.head_shot, variant_id, is_favorited) or found
            else:
                found = self._set_favorite(asset.full_body_asset, variant_id, is_favorited) or self._set_favorite(asset.three_view_asset, variant_id, is_favorited) or self._set_favorite(asset.headshot_asset, variant_id, is_favorited)
                found = self._set_favorite_asset_unit(asset.full_body, variant_id, is_favorited) or self._set_favorite_asset_unit(asset.three_views, variant_id, is_favorited) or self._set_favorite_asset_unit(asset.head_shot, variant_id, is_favorited) or found
        elif asset_type in {"scene", "prop"}:
            found = self._set_favorite(asset.image_asset, variant_id, is_favorited)
        elif asset_type == "storyboard_frame":
            found = self._set_favorite(asset.rendered_image_asset, variant_id, is_favorited) or self._set_favorite(asset.image_asset, variant_id, is_favorited)

        if not found:
            raise ValueError(f"Variant {variant_id} not found")
        return self._save_project(project)

    def upload_variant(self, script_id: str, asset_type: str, asset_id: str, upload_type: str, image_url: str, description: str | None = None):
        """把用户上传图片作为资产的新候选图挂载进去。"""
        logger.info("ASSET_SERVICE: upload_variant script_id=%s asset_id=%s asset_type=%s upload_type=%s", script_id, asset_id, asset_type, upload_type)
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
            # 角色上传要同时维护新的 AssetUnit 结构和仍被其它代码使用的旧 ImageAsset 字段。
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
            target_unit.image_updated_at = utc_now()
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
        """同时从资产范围和项目范围移除一个生成视频。"""
        logger.info("ASSET_SERVICE: delete_asset_video script_id=%s asset_id=%s asset_type=%s video_id=%s", script_id, asset_id, asset_type, video_id)
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        if hasattr(asset, "video_assets") and asset.video_assets is not None:
            asset.video_assets = [video for video in asset.video_assets if video.id != video_id]
        project.video_tasks = [task for task in project.video_tasks if task.id != video_id]
        return self._save_project(project)

    def select_video_for_frame(self, script_id: str, frame_id: str, video_id: str):
        """把生成视频任务绑定为分镜帧当前选中结果。"""
        logger.info("ASSET_SERVICE: select_video_for_frame script_id=%s frame_id=%s video_id=%s", script_id, frame_id, video_id)
        project = self._get_project(script_id)
        frame = next((frame for frame in project.frames if frame.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")
        video = next((video for video in project.video_tasks if video.id == video_id), None)
        if not video:
            raise ValueError("Video task not found")
        # 这里只更新分镜帧与已存在视频任务之间的绑定关系，避免为了一个选中态重写整项目图。
        self.storyboard_frame_repository.patch(
            script_id,
            frame_id,
            {
                "selected_video_id": video_id,
                "video_url": video.video_url,
                "updated_at": utc_now(),
            },
        )
        return self.project_repository.get(script_id)

    def upload_frame_image(self, script_id: str, frame_id: str, image_path: str):
        """上传手工分镜图，并把它作为候选图保存。"""
        logger.info("ASSET_SERVICE: upload_frame_image script_id=%s frame_id=%s image_path=%s", script_id, frame_id, image_path)
        project = self._get_project(script_id)
        frame = next((frame for frame in project.frames if frame.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")

        safe_path = os.path.join("output", os.path.relpath(image_path, "output")) if os.path.isabs(image_path) else image_path
        uploader = OSSImageUploader()
        oss_url = uploader.upload_image(safe_path)
        if not oss_url:
            # 分镜上传结果会直接回给前端；既然静态目录不再对外暴露，这里不能再回退本地相对路径。
            raise RuntimeError("OSS upload failed for frame image.")
        image_url = oss_url
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
        frame.updated_at = utc_now()
        return self._save_project(project)

    def _get_project(self, script_id: str):
        """加载项目聚合，缺失时抛出统一错误。"""
        project = self.project_repository.get(script_id)
        if not project:
            logger.warning("ASSET_SERVICE: _get_project target_missing script_id=%s", script_id)
            raise ValueError("Script not found")
        return project

    def _find_asset(self, project, asset_id: str, asset_type: str):
        """在项目内按逻辑资产类型解析目标对象。"""
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
            logger.warning("ASSET_SERVICE: _find_asset target_missing asset_id=%s asset_type=%s", asset_id, asset_type)
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")
        return target

    def _save_project(self, project):
        """持久化项目聚合变更，并返回最新读取结果。"""
        # 聚合更新统一走这里落库，便于后续把保存耗时或版本冲突监控集中到同一出口。
        logger.info("ASSET_SERVICE: _save_project project_id=%s", project.id)
        project.updated_at = utc_now()
        self.project_repository.save(project)
        return self.project_repository.get(project.id)

    def _select_in_image_asset(self, image_asset: ImageAsset | None, variant_id: str):
        """在旧版 ImageAsset 容器中选中一个候选图。"""
        if not image_asset or not image_asset.variants:
            return None
        for variant in image_asset.variants:
            if variant.id == variant_id:
                image_asset.selected_id = variant_id
                return variant
        return None

    def _select_in_asset_unit(self, asset_unit: AssetUnit | None, variant_id: str):
        """在新版 AssetUnit 容器中同步当前选中候选图。"""
        if not asset_unit or not asset_unit.image_variants:
            return None
        for variant in asset_unit.image_variants:
            if variant.id == variant_id:
                asset_unit.selected_image_id = variant_id
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

    def _delete_in_asset_unit(self, asset_unit: AssetUnit | None, variant_id: str):
        if not asset_unit or not asset_unit.image_variants:
            return False
        before = len(asset_unit.image_variants)
        asset_unit.image_variants = [variant for variant in asset_unit.image_variants if variant.id != variant_id]
        if asset_unit.selected_image_id == variant_id:
            asset_unit.selected_image_id = asset_unit.image_variants[0].id if asset_unit.image_variants else None
        return len(asset_unit.image_variants) != before

    def _set_favorite(self, image_asset: ImageAsset | None, variant_id: str, is_favorited: bool):
        if not image_asset or not image_asset.variants:
            return False
        for variant in image_asset.variants:
            if variant.id == variant_id:
                variant.is_favorited = is_favorited
                return True
        return False

    def _set_favorite_asset_unit(self, asset_unit: AssetUnit | None, variant_id: str, is_favorited: bool):
        if not asset_unit or not asset_unit.image_variants:
            return False
        for variant in asset_unit.image_variants:
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
