"""
资产应用服务。

这里处理用户对资产状态的直接编辑，例如锁定、切换候选图、上传手工替换图等。
"""

import os
import uuid
from typing import Any

from ...common.log import get_logger
from ...repository import CharacterRepository, ProjectRepository, PropRepository, SceneRepository, SeriesRepository, StoryboardFrameRepository, VideoTaskRepository
from ...schemas.models import AssetUnit, ImageAsset, ImageVariant
from ...utils.datetime import utc_now


logger = get_logger(__name__)


class AssetService:
    """负责项目资产相关变更。"""

    def __init__(self):
        self.project_repository = ProjectRepository()
        self.series_repository = SeriesRepository()
        self.character_repository = CharacterRepository()
        self.scene_repository = SceneRepository()
        self.prop_repository = PropRepository()
        self.storyboard_frame_repository = StoryboardFrameRepository()
        self.video_task_repository = VideoTaskRepository()

    def toggle_lock(self, script_id: str, asset_id: str, asset_type: str):
        """切换项目资产的锁定状态。"""
        logger.info("资产服务：切换锁定 项目ID=%s 素材ID=%s 素材类型=%s", script_id, asset_id, asset_type)
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        asset.locked = not asset.locked
        return self._persist_asset_scope(project, asset_type, asset)

    def update_image(self, script_id: str, asset_id: str, asset_type: str, image_url: str):
        """更新资产当前选中的图片地址。"""
        logger.info("资产服务：更新图片 项目ID=%s 素材ID=%s 素材类型=%s", script_id, asset_id, asset_type)
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        asset.image_url = image_url
        if asset_type == "character":
            asset.avatar_url = image_url
        return self._persist_asset_scope(project, asset_type, asset, preserve_missing_media=False)

    def update_description(self, script_id: str, asset_id: str, asset_type: str, description: str):
        """仅更新资产的描述字段。"""
        logger.info("资产服务：更新描述 项目ID=%s 素材ID=%s 素材类型=%s", script_id, asset_id, asset_type)
        return self.update_attributes(script_id, asset_id, asset_type, {"description": description})

    def update_attributes(self, script_id: str, asset_id: str, asset_type: str, attributes: dict[str, Any]):
        """按给定值增量更新资产可变属性。"""
        logger.info("资产服务：更新属性 项目ID=%s 素材ID=%s 素材类型=%s 字段=%s", script_id, asset_id, asset_type, sorted(attributes.keys()))
        project = self._get_project(script_id)
        asset = self._find_asset(project, asset_id, asset_type)
        for key, value in attributes.items():
            if hasattr(asset, key):
                setattr(asset, key, value)
        return self._persist_asset_scope(project, asset_type, asset)

    def select_variant(self, script_id: str, asset_id: str, asset_type: str, variant_id: str, generation_type: str | None = None):
        """选中一个图片候选，并同步顶层冗余图片地址。"""
        logger.info(
            "资产服务：选择候选图 项目ID=%s 素材ID=%s 素材类型=%s 候选ID=%s 生成类型=%s",
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
                variant = self._select_character_panel_variant(asset.full_body_asset, asset.full_body, variant_id)
                if variant:
                    asset.full_body_image_url = variant.url
                    asset.image_url = variant.url
            elif generation_type == "three_view":
                variant = self._select_character_panel_variant(asset.three_view_asset, asset.three_views, variant_id)
                if variant:
                    asset.three_view_image_url = variant.url
            elif generation_type == "headshot":
                variant = self._select_character_panel_variant(asset.headshot_asset, asset.head_shot, variant_id)
                if variant:
                    asset.headshot_image_url = variant.url
                    asset.avatar_url = variant.url
            else:
                for image_asset, asset_unit, setter in (
                    (asset.full_body_asset, asset.full_body, lambda v: (setattr(asset, "full_body_image_url", v.url), setattr(asset, "image_url", v.url))),
                    (asset.three_view_asset, asset.three_views, lambda v: setattr(asset, "three_view_image_url", v.url)),
                    (asset.headshot_asset, asset.head_shot, lambda v: (setattr(asset, "headshot_image_url", v.url), setattr(asset, "avatar_url", v.url))),
                ):
                    variant = self._select_character_panel_variant(image_asset, asset_unit, variant_id)
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

        return self._persist_asset_scope(project, asset_type, asset)

    def delete_variant(self, script_id: str, asset_id: str, asset_type: str, variant_id: str):
        """删除候选图，并在必要时刷新当前选中地址。"""
        logger.info("资产服务：删除候选图 项目ID=%s 素材ID=%s 素材类型=%s 候选ID=%s", script_id, asset_id, asset_type, variant_id)
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
        return self._persist_asset_scope(project, asset_type, asset)

    def toggle_variant_favorite(self, script_id: str, asset_id: str, asset_type: str, variant_id: str, is_favorited: bool, generation_type: str | None = None):
        """设置或取消候选图收藏状态。"""
        logger.info(
            "资产服务：切换候选图收藏 项目ID=%s 素材ID=%s 素材类型=%s 候选ID=%s 是否收藏=%s 生成类型=%s",
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
        return self._persist_asset_scope(project, asset_type, asset)

    def upload_variant(self, script_id: str, asset_type: str, asset_id: str, upload_type: str, image_url: str, description: str | None = None):
        """把用户上传图片作为资产的新候选图挂载进去。"""
        logger.info("资产服务：上传候选图 项目ID=%s 素材ID=%s 素材类型=%s 上传类型=%s", script_id, asset_id, asset_type, upload_type)
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

        return self._persist_asset_scope(project, asset_type, asset)

    def delete_asset_video(self, script_id: str, asset_id: str, asset_type: str, video_id: str):
        """同时从资产范围和项目范围移除一个生成视频。"""
        logger.info("资产服务：删除素材视频 项目ID=%s 素材ID=%s 素材类型=%s 视频ID=%s", script_id, asset_id, asset_type, video_id)
        project = self._get_project(script_id)
        self._find_asset(project, asset_id, asset_type)
        self.video_task_repository.delete(script_id, video_id)
        return self._get_project(script_id)

    def select_video_for_frame(self, script_id: str, frame_id: str, video_id: str):
        """把生成视频任务绑定为分镜帧当前选中结果。"""
        logger.info("资产服务：选择分镜视频 项目ID=%s 分镜ID=%s 视频ID=%s", script_id, frame_id, video_id)
        project = self._get_project(script_id)
        frame = next((frame for frame in project.frames if frame.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")
        video = next((video for video in project.video_tasks if video.id == video_id), None)
        if not video:
            raise ValueError("Video task not found")
        # 这里只更新分镜帧与已存在视频任务之间的绑定关系，避免为了一个选中态重写整项目图。
        frame.selected_video_id = video_id
        frame.video_url = video.video_url
        frame.updated_at = utc_now()
        self.storyboard_frame_repository.save(script_id, frame)
        return self._get_project(script_id)

    def upload_frame_image(self, script_id: str, frame_id: str, image_url: str):
        """登记手工上传的分镜图对象键，并把它作为候选图保存。"""
        logger.info("资产服务：上传分镜图片 项目ID=%s 分镜ID=%s 图片地址=%s", script_id, frame_id, image_url)
        project = self._get_project(script_id)
        frame = next((frame for frame in project.frames if frame.id == frame_id), None)
        if not frame:
            raise ValueError("Frame not found")
        variant = ImageVariant(
            id=str(uuid.uuid4()),
            url=image_url,
            prompt_used="用户上传图片",
            is_uploaded_source=True,
            upload_type="image",
        )
        frame.rendered_image_asset = frame.rendered_image_asset or ImageAsset()
        frame.rendered_image_asset.variants.append(variant)
        frame.rendered_image_asset.selected_id = variant.id
        frame.rendered_image_url = image_url
        frame.updated_at = utc_now()
        self.storyboard_frame_repository.save(script_id, frame)
        return self._get_project(script_id)

    def _get_project(self, script_id: str):
        """加载项目聚合，缺失时抛出统一错误。"""
        project = self.project_repository.get(script_id)
        if not project:
            logger.warning("资产服务：获取项目 未找到 项目ID=%s", script_id)
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
            logger.warning("资产服务：查找素材 未找到 素材ID=%s 素材类型=%s", asset_id, asset_type)
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found")
        return target

    def _persist_asset_scope(self, project, asset_type: str, asset, preserve_missing_media: bool = True):
        """按最小作用域持久化单个素材或分镜帧。"""
        # 保存前先把角色的 legacy/unit 素材容器补齐，避免某一侧图集丢失时被局部 upsert 放大成选中态错乱。
        self._normalize_character_assets(project)
        logger.info("资产服务：持久化素材范围 项目ID=%s 素材类型=%s 素材ID=%s", project.id, asset_type, asset.id)
        if asset_type == "storyboard_frame":
            asset.updated_at = utc_now()
            self.storyboard_frame_repository.save(project.id, asset)
            return self._get_project(project.id)
        repository = self._asset_repository(asset_type)
        owner_type, owner_id = self._resolve_asset_owner(project, asset_type, asset.id)
        if asset_type == "character":
            repository.save(owner_type, owner_id, asset, preserve_missing_media=preserve_missing_media)
        else:
            repository.save(owner_type, owner_id, asset)
        return self._get_project(project.id)

    def _asset_repository(self, asset_type: str):
        if asset_type == "character":
            return self.character_repository
        if asset_type == "scene":
            return self.scene_repository
        if asset_type == "prop":
            return self.prop_repository
        raise ValueError(f"Unsupported asset_type: {asset_type}")

    def _resolve_asset_owner(self, project, asset_type: str, asset_id: str) -> tuple[str, str]:
        """解析素材真实归属，避免系列项目误写入 project 层副本。"""
        if not project.series_id:
            return ("project", project.id)

        if asset_type == "character":
            link = next((item for item in (project.series_character_links or []) if item.character_id == asset_id), None)
            if link:
                return ("series", project.series_id)
            # 中文注释：当系列角色是通过“收件箱确认”进入主档时，当前分集可能还没有角色链接；
            # 这里回退按系列主档判断归属，确保系列角色编辑不会误写到 project owner。
            series = self.series_repository.get(project.series_id)
            if series and any(item.id == asset_id for item in (series.characters or [])):
                return ("series", project.series_id)
            return ("project", project.id)

        if asset_type in {"scene", "prop"}:
            series = self.series_repository.get(project.series_id)
            if series:
                if asset_type == "scene" and any(item.id == asset_id for item in (series.scenes or [])):
                    return ("series", project.series_id)
                if asset_type == "prop" and any(item.id == asset_id for item in (series.props or [])):
                    return ("series", project.series_id)
        return ("project", project.id)

    def _normalize_character_assets(self, project) -> None:
        """在落库前对角色图片容器做双向补齐，减少 legacy/unit 图集分叉。"""
        for character in getattr(project, "characters", []) or []:
            self._normalize_character_panel(
                character=character,
                legacy_attr="full_body_asset",
                unit_attr="full_body",
                url_attr="full_body_image_url",
                prompt_attr="full_body_prompt",
                fallback_variant_id=f"{character.id}-full-body-selected",
            )
            self._normalize_character_panel(
                character=character,
                legacy_attr="three_view_asset",
                unit_attr="three_views",
                url_attr="three_view_image_url",
                prompt_attr="three_view_prompt",
                fallback_variant_id=f"{character.id}-three-view-selected",
            )
            self._normalize_character_panel(
                character=character,
                legacy_attr="headshot_asset",
                unit_attr="head_shot",
                url_attr="headshot_image_url",
                prompt_attr="headshot_prompt",
                fallback_variant_id=f"{character.id}-headshot-selected",
            )

    def _normalize_character_panel(
        self,
        *,
        character,
        legacy_attr: str,
        unit_attr: str,
        url_attr: str,
        prompt_attr: str,
        fallback_variant_id: str,
    ) -> None:
        """确保角色某个分面至少有一份可用的 selected variant，且 legacy/unit 两套结构保持一致。"""
        legacy_asset = getattr(character, legacy_attr, None) or ImageAsset()
        unit_asset = getattr(character, unit_attr, None) or AssetUnit()
        setattr(character, legacy_attr, legacy_asset)
        setattr(character, unit_attr, unit_asset)

        if legacy_asset.variants and not unit_asset.image_variants:
            unit_asset.image_variants = [variant.model_copy(deep=True) for variant in legacy_asset.variants]
        elif unit_asset.image_variants and not legacy_asset.variants:
            legacy_asset.variants = [variant.model_copy(deep=True) for variant in unit_asset.image_variants]

        if not legacy_asset.selected_id and unit_asset.selected_image_id:
            legacy_asset.selected_id = unit_asset.selected_image_id
        if not unit_asset.selected_image_id and legacy_asset.selected_id:
            unit_asset.selected_image_id = legacy_asset.selected_id

        selected_url = getattr(character, url_attr, None)
        if not selected_url:
            selected_variant = self._find_variant_by_id_or_url(legacy_asset.variants, legacy_asset.selected_id, None)
            if not selected_variant:
                selected_variant = self._find_variant_by_id_or_url(unit_asset.image_variants, unit_asset.selected_image_id, None)
            selected_url = selected_variant.url if selected_variant else None

        if selected_url and not legacy_asset.variants and not unit_asset.image_variants:
            selected_variant_id = legacy_asset.selected_id or unit_asset.selected_image_id or fallback_variant_id
            synthesized_variant = ImageVariant(
                id=selected_variant_id,
                url=selected_url,
                prompt_used=getattr(character, prompt_attr, None),
                created_at=getattr(character, "updated_at", None) or getattr(character, "created_at", None) or utc_now(),
            )
            legacy_asset.variants = [synthesized_variant]
            unit_asset.image_variants = [synthesized_variant.model_copy(deep=True)]
            legacy_asset.selected_id = selected_variant_id
            unit_asset.selected_image_id = selected_variant_id

    def _find_variant_by_id_or_url(self, variants: list[ImageVariant] | None, variant_id: str | None, url: str | None):
        """按 ID 优先、URL 次之解析目标候选图。"""
        if not variants:
            return None
        if variant_id:
            for variant in variants:
                if variant.id == variant_id:
                    return variant
        if url:
            for variant in variants:
                if variant.url == url:
                    return variant
        return None

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

    def _select_character_panel_variant(self, image_asset: ImageAsset | None, asset_unit: AssetUnit | None, variant_id: str):
        """角色图片候选允许存在于 legacy 或 unit 任一容器中，选中时两边都尽量同步。"""
        legacy_variant = self._select_in_image_asset(image_asset, variant_id)
        unit_variant = self._select_in_asset_unit(asset_unit, variant_id)
        resolved_variant = legacy_variant or unit_variant
        if resolved_variant and image_asset and not legacy_variant:
            image_asset.selected_id = variant_id
        if resolved_variant and asset_unit and not unit_variant:
            asset_unit.selected_image_id = variant_id
        return resolved_variant

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
