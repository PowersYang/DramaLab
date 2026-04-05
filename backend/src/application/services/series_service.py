"""
系列应用服务。

这里管理系列元数据、分集绑定，以及属于系列聚合的共享资产编辑。
"""

import uuid

from sqlalchemy import func

from ...common.log import get_logger
from ...db.models import ProjectRecord, SeriesRecord
from ...db.session import session_scope
from ...providers import ScriptProcessor
from ...repository import CharacterRepository, ProjectRepository, PropRepository, SceneRepository, SeriesRepository
from ...schemas.models import AssetUnit, ImageAsset, ImageVariant, PromptConfig, Series
from ...utils.datetime import utc_now
from .model_provider_service import ModelProviderService


logger = get_logger(__name__)


class SeriesService:
    """负责系列级 CRUD 与关联关系更新。"""

    def __init__(self):
        self.series_repository = SeriesRepository()
        self.project_repository = ProjectRepository()
        self.character_repository = CharacterRepository()
        self.scene_repository = SceneRepository()
        self.prop_repository = PropRepository()
        self.model_provider_service = ModelProviderService()
        self.text_provider = ScriptProcessor()

    def create_series(
        self,
        title: str,
        description: str = "",
        organization_id: str | None = None,
        workspace_id: str | None = None,
        created_by: str | None = None,
    ):
        """创建并持久化一个空的系列聚合。"""
        # 系列创建会成为多个分集的上游容器，这里记录基础元数据方便回溯来源。
        logger.info("系列服务：创建系列 标题=%s 是否有描述=%s", title, bool(description))
        series = Series(
            id=str(uuid.uuid4()),
            title=title,
            description=description,
            organization_id=organization_id,
            workspace_id=workspace_id,
            created_by=created_by,
            updated_by=created_by,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        self.series_repository.create(series)
        logger.info("系列服务：创建系列完成 系列ID=%s", series.id)
        return series

    def list_series(self, workspace_id: str | None = None):
        """返回所有系列记录。"""
        series_list = self.series_repository.list(workspace_id=workspace_id)
        logger.info("系列服务：列出系列 数量=%s", len(series_list))
        return series_list

    def list_series_briefs(self, workspace_id: str | None = None):
        """返回轻量系列摘要，给任务中心等列表页复用。"""
        series_list = self.series_repository.list_briefs(workspace_id=workspace_id)
        logger.info("系列服务：列出系列简表 数量=%s", len(series_list))
        return series_list

    def list_series_summaries(self, workspace_id: str | None = None):
        """返回项目中心系列卡片所需的轻量汇总。"""
        series_list = self.series_repository.list_summaries(workspace_id=workspace_id)
        logger.info("系列服务：列出系列汇总 数量=%s", len(series_list))
        return series_list

    def get_series(self, series_id: str):
        """加载单个系列聚合。"""
        series = self.series_repository.get(series_id)
        logger.info("系列服务：获取系列 系列ID=%s 是否存在=%s", series_id, bool(series))
        return series

    def update_series(self, series_id: str, updates: dict):
        """更新系列可变字段，同时保持标识字段不可改。"""
        logger.info("系列服务：更新系列 系列ID=%s 字段=%s", series_id, sorted(updates.keys()))
        series = self.get_series(series_id)
        if not series:
            logger.warning("系列服务：更新系列失败 目标不存在 系列ID=%s", series_id)
            raise ValueError("Series not found")
        for key, value in updates.items():
            if hasattr(series, key) and key not in ("id", "created_at", "episode_ids"):
                setattr(series, key, value)
        logger.info("系列服务：更新系列完成 系列ID=%s", series_id)
        patch = {
            "updated_at": utc_now(),
        }
        for field in ("title", "description", "art_direction", "model_settings", "prompt_config"):
            if hasattr(series, field):
                value = getattr(series, field)
                patch[field] = value.model_dump(mode="json") if hasattr(value, "model_dump") else value
        return self.series_repository.patch_metadata(series_id, patch, expected_version=series.version)

    def delete_series(self, series_id: str):
        """删除系列，并解除所有已关联分集。"""
        logger.info("系列服务：删除系列 系列ID=%s", series_id)
        series = self.get_series(series_id)
        if not series:
            logger.warning("系列服务：删除系列失败 目标不存在 系列ID=%s", series_id)
            raise ValueError("Series not found")
        for ep_id in list(series.episode_ids):
            project = self.project_repository.get(ep_id)
            if project:
                project.series_id = None
                project.episode_number = None
                project.updated_at = utc_now()
                self.project_repository.patch_metadata(
                    ep_id,
                    {
                        "series_id": None,
                        "episode_number": None,
                        "art_direction_source": "standalone",
                        "art_direction_override": None,
                        "art_direction_resolved": None,
                        "art_direction_overridden_at": None,
                        "art_direction_overridden_by": None,
                        "updated_at": utc_now(),
                    },
                    expected_version=project.version,
                )
        self.series_repository.soft_delete(series_id)
        logger.info("系列服务：删除系列完成 系列ID=%s 已解绑分集数=%s", series_id, len(series.episode_ids))

    def add_episode(self, series_id: str, script_id: str, episode_number: int | None = None):
        """把现有项目挂到系列下，必要时先从旧系列迁出。"""
        logger.info("系列服务：添加分集 系列ID=%s 项目ID=%s 分集序号=%s", series_id, script_id, episode_number)
        series = self.get_series(series_id)
        if not series:
            logger.warning("系列服务：添加分集失败 系列不存在 系列ID=%s", series_id)
            raise ValueError("Series not found")
        project = self.project_repository.get(script_id)
        if not project:
            logger.warning("系列服务：添加分集失败 项目不存在 项目ID=%s", script_id)
            raise ValueError("Script not found")
        if project.series_id and project.series_id != series_id:
            old_series = self.series_repository.get(project.series_id)
            if old_series:
                self.series_repository.patch_metadata(old_series.id, {"updated_at": utc_now()}, expected_version=old_series.version)
        project.series_id = series_id
        project.episode_number = episode_number or len(series.episode_ids or []) or 1
        project.updated_at = utc_now()
        self.project_repository.patch_metadata(
            script_id,
            {
                "series_id": series_id,
                "episode_number": project.episode_number,
                "art_direction_source": "series_default",
                "art_direction_override": None,
                "art_direction_resolved": None,
                "art_direction_overridden_at": None,
                "art_direction_overridden_by": None,
                "updated_at": utc_now(),
            },
            expected_version=project.version,
        )
        self.series_repository.patch_metadata(series.id, {"updated_at": utc_now()}, expected_version=series.version)
        logger.info(
            "系列服务：添加分集完成 系列ID=%s 项目ID=%s 已分配分集序号=%s",
            series_id,
            script_id,
            project.episode_number,
        )
        return self.series_repository.get(series_id)

    def create_episode_draft(
        self,
        series_id: str,
        title: str,
        text: str = "",
        episode_number: int | None = None,
        organization_id: str | None = None,
        workspace_id: str | None = None,
        created_by: str | None = None,
    ):
        logger.info(
            "系列服务：创建分集草稿 系列ID=%s 标题=%s 是否有正文=%s 分集序号=%s",
            series_id,
            title,
            bool(text),
            episode_number,
        )
        with session_scope() as session:
            series_record = (
                session.query(SeriesRecord)
                .filter(SeriesRecord.id == series_id, SeriesRecord.is_deleted.is_(False))
                .one_or_none()
            )
            if not series_record:
                logger.warning("系列服务：创建分集草稿失败 系列不存在 系列ID=%s", series_id)
                raise ValueError("Series not found")
            if workspace_id is not None and series_record.workspace_id != workspace_id:
                logger.warning("系列服务：创建分集草稿失败 工作区不匹配 系列ID=%s", series_id)
                raise ValueError("Series not found")

            self.series_repository.touch(series_id, expected_version=series_record.version, session=session)

            resolved_episode_number = episode_number
            if resolved_episode_number is None:
                max_episode_number = (
                    session.query(func.max(ProjectRecord.episode_number))
                    .filter(
                        ProjectRecord.is_deleted.is_(False),
                        ProjectRecord.series_id == series_id,
                        ProjectRecord.workspace_id == series_record.workspace_id,
                    )
                    .scalar()
                )
                resolved_episode_number = int(max_episode_number or 0) + 1

            project = self.text_provider.create_draft_script(title, text)
            project.series_id = series_id
            project.episode_number = resolved_episode_number
            project.art_direction_source = "series_default"
            project.art_direction_override = {}
            project.organization_id = organization_id
            project.workspace_id = series_record.workspace_id
            project.created_by = created_by
            project.updated_by = created_by
            project.updated_at = utc_now()
            self.project_repository.create(project, session=session)

        logger.info(
            "系列服务：创建分集草稿完成 系列ID=%s 项目ID=%s 分集序号=%s",
            series_id,
            project.id,
            project.episode_number,
        )
        return project

    def remove_episode(self, series_id: str, script_id: str):
        """把一个分集从系列中移除。"""
        logger.info("系列服务：移除分集 系列ID=%s 项目ID=%s", series_id, script_id)
        series = self.get_series(series_id)
        if not series:
            logger.warning("系列服务：移除分集失败 系列不存在 系列ID=%s", series_id)
            raise ValueError("Series not found")
        project = self.project_repository.get(script_id)
        if project:
            project.series_id = None
            project.episode_number = None
            project.updated_at = utc_now()
            self.project_repository.patch_metadata(
                script_id,
                {
                    "series_id": None,
                    "episode_number": None,
                    "art_direction_source": "standalone",
                    "art_direction_override": None,
                    "art_direction_resolved": None,
                    "art_direction_overridden_at": None,
                    "art_direction_overridden_by": None,
                    "updated_at": utc_now(),
                },
                expected_version=project.version,
            )
        logger.info("系列服务：移除分集完成 系列ID=%s 剩余分集数=%s", series_id, len(series.episode_ids))
        self.series_repository.patch_metadata(series.id, {"updated_at": utc_now()}, expected_version=series.version)
        return self.series_repository.get(series_id)

    def get_episodes(self, series_id: str):
        """列出当前挂在该系列下的项目。"""
        series = self.get_series(series_id)
        if not series:
            logger.warning("系列服务：获取分集列表失败 系列不存在 系列ID=%s", series_id)
            raise ValueError("Series not found")
        episodes = self.project_repository.list_by_series(series_id, workspace_id=series.workspace_id)
        logger.info("系列服务：获取分集列表 系列ID=%s 数量=%s", series_id, len(episodes))
        return episodes

    def update_prompt_config(self, series_id: str, config: PromptConfig):
        """整体替换系列级提示词覆写配置。"""
        logger.info("系列服务：更新提示词配置 系列ID=%s", series_id)
        return self.update_series(series_id, {"prompt_config": config})

    def update_model_settings(self, series_id: str, updates: dict):
        """增量更新系列级模型设置字段。"""
        logger.info(
            "系列服务：更新模型配置 系列ID=%s 字段=%s",
            series_id,
            sorted([k for k, v in updates.items() if v is not None]),
        )
        series = self.get_series(series_id)
        if not series:
            logger.warning("系列服务：更新模型配置失败 系列不存在 系列ID=%s", series_id)
            raise ValueError("Series not found")
        self.model_provider_service.ensure_model_settings_allowed({k: v for k, v in updates.items() if v is not None})
        series.model_settings = series.model_settings.model_copy(update={k: v for k, v in updates.items() if v is not None})
        series.updated_at = utc_now()
        return self.series_repository.patch_metadata(series_id, {"updated_at": utc_now(), "model_settings": series.model_settings.model_dump(mode="json")}, expected_version=series.version)

    def toggle_asset_lock(self, series_id: str, asset_id: str, asset_type: str):
        """切换系列共享资产的锁定状态。"""
        logger.info("系列服务：切换素材锁定 系列ID=%s 素材ID=%s 素材类型=%s", series_id, asset_id, asset_type)
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        asset = self._find_series_asset(series, asset_id, asset_type)
        asset.locked = not asset.locked
        self._asset_repository(asset_type).save("series", series_id, asset)
        return self.series_repository.get(series_id)

    def update_asset_image(self, series_id: str, asset_id: str, asset_type: str, image_url: str):
        """更新系列共享资产当前选中的图片地址。"""
        logger.info("系列服务：更新素材图片 系列ID=%s 素材ID=%s 素材类型=%s", series_id, asset_id, asset_type)
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        asset = self._find_series_asset(series, asset_id, asset_type)
        asset.image_url = image_url
        if asset_type == "character":
            asset.avatar_url = image_url
        self._asset_repository(asset_type).save("series", series_id, asset)
        return self.series_repository.get(series_id)

    def update_asset_attributes(self, series_id: str, asset_id: str, asset_type: str, attributes: dict):
        """增量更新系列共享资产的可变属性。"""
        logger.info(
            "系列服务：更新素材属性 系列ID=%s 素材ID=%s 素材类型=%s 字段=%s",
            series_id,
            asset_id,
            asset_type,
            sorted(attributes.keys()),
        )
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        asset = self._find_series_asset(series, asset_id, asset_type)
        for key, value in attributes.items():
            if hasattr(asset, key):
                setattr(asset, key, value)
        self._asset_repository(asset_type).save("series", series_id, asset)
        return self.series_repository.get(series_id)

    def select_variant(self, series_id: str, asset_id: str, asset_type: str, variant_id: str, generation_type: str | None = None):
        """选中系列共享资产的候选图，并同步 selected_id 与顶层图片 URL。"""
        logger.info(
            "系列服务：选择候选图 系列ID=%s 素材ID=%s 素材类型=%s 候选ID=%s 生成类型=%s",
            series_id,
            asset_id,
            asset_type,
            variant_id,
            generation_type,
        )
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        asset = self._find_series_asset(series, asset_id, asset_type)
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
                for image_asset, asset_unit, apply_variant in (
                    (asset.full_body_asset, asset.full_body, lambda selected: (setattr(asset, "full_body_image_url", selected.url), setattr(asset, "image_url", selected.url))),
                    (asset.three_view_asset, asset.three_views, lambda selected: setattr(asset, "three_view_image_url", selected.url)),
                    (asset.headshot_asset, asset.head_shot, lambda selected: (setattr(asset, "headshot_image_url", selected.url), setattr(asset, "avatar_url", selected.url))),
                ):
                    variant = self._select_character_panel_variant(image_asset, asset_unit, variant_id)
                    if variant:
                        apply_variant(variant)
                        break
        elif asset_type in {"scene", "prop"}:
            variant = self._select_in_image_asset(asset.image_asset, variant_id)
            if variant:
                asset.image_url = variant.url
        else:
            raise ValueError(f"Unsupported asset_type: {asset_type}")

        if not variant:
            raise ValueError(f"Variant {variant_id} not found")

        self._asset_repository(asset_type).save("series", series_id, asset)
        return self.series_repository.get(series_id)

    def _asset_repository(self, asset_type: str):
        if asset_type == "character":
            return self.character_repository
        if asset_type == "scene":
            return self.scene_repository
        if asset_type == "prop":
            return self.prop_repository
        raise ValueError(f"Unsupported asset_type: {asset_type}")

    def _find_series_asset(self, series, asset_id: str, asset_type: str):
        """按逻辑类型和 id 解析系列中的共享资产对象。"""
        if asset_type == "character":
            target = next((item for item in series.characters if item.id == asset_id), None)
        elif asset_type == "scene":
            target = next((item for item in series.scenes if item.id == asset_id), None)
        elif asset_type == "prop":
            target = next((item for item in series.props if item.id == asset_id), None)
        else:
            raise ValueError(f"Unsupported asset_type: {asset_type}")
        if not target:
            raise ValueError(f"Asset {asset_id} of type {asset_type} not found in series")
        return target

    def _select_in_image_asset(self, image_asset: ImageAsset | None, variant_id: str):
        """在 legacy ImageAsset 结构里更新 selected_id。"""
        if not image_asset or not image_asset.variants:
            return None
        for variant in image_asset.variants:
            if variant.id == variant_id:
                image_asset.selected_id = variant_id
                return variant
        return None

    def _select_in_asset_unit(self, asset_unit: AssetUnit | None, variant_id: str):
        """在新 AssetUnit 结构里更新 selected_image_id。"""
        if not asset_unit or not asset_unit.image_variants:
            return None
        for variant in asset_unit.image_variants:
            if variant.id == variant_id:
                asset_unit.selected_image_id = variant_id
                return variant
        return None

    def _find_variant_by_id_or_url(self, variants: list[ImageVariant] | None, variant_id: str | None, url: str | None):
        """按候选 ID 或 URL 查找变体，兼容历史数据只有 URL 没有 selected_id 的情况。"""
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

    def _select_character_panel_variant(self, image_asset: ImageAsset | None, asset_unit: AssetUnit | None, variant_id: str):
        """角色分面需要同时维护 legacy ImageAsset 与 AssetUnit 两套选中态。"""
        legacy_variant = self._select_in_image_asset(image_asset, variant_id)
        unit_variant = self._select_in_asset_unit(asset_unit, variant_id)
        variant = legacy_variant or unit_variant

        if variant and image_asset and not legacy_variant:
            image_asset.selected_id = variant_id
        if variant and asset_unit and not unit_variant:
            asset_unit.selected_image_id = variant_id

        # 中文注释：兼容历史数据只有 selected_url 或只保留其中一套结构的情况，避免前端点选后仍然回弹到最后一张。
        if not variant:
            variant = self._find_variant_by_id_or_url(image_asset.variants if image_asset else None, variant_id, None)
            if not variant:
                variant = self._find_variant_by_id_or_url(asset_unit.image_variants if asset_unit else None, variant_id, None)
            if variant and image_asset:
                image_asset.selected_id = variant_id
            if variant and asset_unit:
                asset_unit.selected_image_id = variant_id

        return variant
