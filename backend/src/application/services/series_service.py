"""
系列应用服务。

这里管理系列元数据、分集绑定，以及属于系列聚合的共享资产编辑。
"""

import uuid

from ...common.log import get_logger
from ...repository import ProjectRepository, SeriesRepository
from ...schemas.models import PromptConfig, Series
from ...utils.datetime import utc_now


logger = get_logger(__name__)


class SeriesService:
    """负责系列级 CRUD 与关联关系更新。"""

    def __init__(self):
        self.series_repository = SeriesRepository()
        self.project_repository = ProjectRepository()

    def create_series(self, title: str, description: str = ""):
        """创建并持久化一个空的系列聚合。"""
        # 系列创建会成为多个分集的上游容器，这里记录基础元数据方便回溯来源。
        logger.info("SERIES_SERVICE: create_series title=%s has_description=%s", title, bool(description))
        series = Series(
            id=str(uuid.uuid4()),
            title=title,
            description=description,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        self.series_repository.create(series)
        logger.info("SERIES_SERVICE: create_series completed series_id=%s", series.id)
        return series

    def list_series(self):
        """返回所有系列记录。"""
        series_list = self.series_repository.list()
        logger.info("SERIES_SERVICE: list_series count=%s", len(series_list))
        return series_list

    def get_series(self, series_id: str):
        """加载单个系列聚合。"""
        series = self.series_repository.get(series_id)
        logger.info("SERIES_SERVICE: get_series series_id=%s found=%s", series_id, bool(series))
        return series

    def update_series(self, series_id: str, updates: dict):
        """更新系列可变字段，同时保持标识字段不可改。"""
        logger.info("SERIES_SERVICE: update_series series_id=%s fields=%s", series_id, sorted(updates.keys()))
        series = self.get_series(series_id)
        if not series:
            logger.warning("SERIES_SERVICE: update_series target_missing series_id=%s", series_id)
            raise ValueError("Series not found")
        for key, value in updates.items():
            if hasattr(series, key) and key not in ("id", "created_at", "episode_ids"):
                setattr(series, key, value)
        series.updated_at = utc_now()
        logger.info("SERIES_SERVICE: update_series completed series_id=%s", series_id)
        return self.series_repository.replace_graph(series)

    def delete_series(self, series_id: str):
        """删除系列，并解除所有已关联分集。"""
        logger.info("SERIES_SERVICE: delete_series series_id=%s", series_id)
        series = self.get_series(series_id)
        if not series:
            logger.warning("SERIES_SERVICE: delete_series target_missing series_id=%s", series_id)
            raise ValueError("Series not found")
        for ep_id in list(series.episode_ids):
            project = self.project_repository.get(ep_id)
            if project:
                project.series_id = None
                project.episode_number = None
                project.updated_at = utc_now()
                self.project_repository.patch_metadata(ep_id, {"series_id": None, "episode_number": None, "updated_at": utc_now()}, expected_version=project.version)
        self.series_repository.soft_delete(series_id)
        logger.info("SERIES_SERVICE: delete_series completed series_id=%s detached_episodes=%s", series_id, len(series.episode_ids))

    def add_episode(self, series_id: str, script_id: str, episode_number: int | None = None):
        """把现有项目挂到系列下，必要时先从旧系列迁出。"""
        logger.info("SERIES_SERVICE: add_episode series_id=%s script_id=%s episode_number=%s", series_id, script_id, episode_number)
        series = self.get_series(series_id)
        if not series:
            logger.warning("SERIES_SERVICE: add_episode series_missing series_id=%s", series_id)
            raise ValueError("Series not found")
        project = self.project_repository.get(script_id)
        if not project:
            logger.warning("SERIES_SERVICE: add_episode project_missing script_id=%s", script_id)
            raise ValueError("Script not found")
        if project.series_id and project.series_id != series_id:
            old_series = self.series_repository.get(project.series_id)
            if old_series and script_id in old_series.episode_ids:
                old_series.episode_ids.remove(script_id)
                old_series.updated_at = utc_now()
                self.series_repository.replace_graph(old_series)
        if script_id not in series.episode_ids:
            series.episode_ids.append(script_id)
        project.series_id = series_id
        project.episode_number = episode_number or len(series.episode_ids)
        project.updated_at = utc_now()
        series.updated_at = utc_now()
        self.project_repository.patch_metadata(script_id, {"series_id": series_id, "episode_number": project.episode_number, "updated_at": utc_now()}, expected_version=project.version)
        self.series_repository.replace_graph(series)
        logger.info("SERIES_SERVICE: add_episode completed series_id=%s script_id=%s assigned_episode_number=%s", series_id, script_id, project.episode_number)
        return series

    def remove_episode(self, series_id: str, script_id: str):
        """把一个分集从系列中移除。"""
        logger.info("SERIES_SERVICE: remove_episode series_id=%s script_id=%s", series_id, script_id)
        series = self.get_series(series_id)
        if not series:
            logger.warning("SERIES_SERVICE: remove_episode series_missing series_id=%s", series_id)
            raise ValueError("Series not found")
        if script_id in series.episode_ids:
            series.episode_ids.remove(script_id)
        project = self.project_repository.get(script_id)
        if project:
            project.series_id = None
            project.episode_number = None
            project.updated_at = utc_now()
            self.project_repository.patch_metadata(script_id, {"series_id": None, "episode_number": None, "updated_at": utc_now()}, expected_version=project.version)
        series.updated_at = utc_now()
        logger.info("SERIES_SERVICE: remove_episode completed series_id=%s remaining_episodes=%s", series_id, len(series.episode_ids))
        return self.series_repository.replace_graph(series)

    def get_episodes(self, series_id: str):
        """列出当前挂在该系列下的项目。"""
        series = self.get_series(series_id)
        if not series:
            logger.warning("SERIES_SERVICE: get_episodes series_missing series_id=%s", series_id)
            raise ValueError("Series not found")
        episodes = [project for project in self.project_repository.list() if project.series_id == series_id]
        logger.info("SERIES_SERVICE: get_episodes series_id=%s count=%s", series_id, len(episodes))
        return episodes

    def update_prompt_config(self, series_id: str, config: PromptConfig):
        """整体替换系列级提示词覆写配置。"""
        logger.info("SERIES_SERVICE: update_prompt_config series_id=%s", series_id)
        return self.update_series(series_id, {"prompt_config": config})

    def update_model_settings(self, series_id: str, updates: dict):
        """增量更新系列级模型设置字段。"""
        logger.info("SERIES_SERVICE: update_model_settings series_id=%s fields=%s", series_id, sorted([k for k, v in updates.items() if v is not None]))
        series = self.get_series(series_id)
        if not series:
            logger.warning("SERIES_SERVICE: update_model_settings series_missing series_id=%s", series_id)
            raise ValueError("Series not found")
        series.model_settings = series.model_settings.model_copy(update={k: v for k, v in updates.items() if v is not None})
        series.updated_at = utc_now()
        return self.series_repository.patch_metadata(series_id, {"updated_at": utc_now(), "model_settings": series.model_settings.model_dump(mode="json")}, expected_version=series.version)

    def toggle_asset_lock(self, series_id: str, asset_id: str, asset_type: str):
        """切换系列共享资产的锁定状态。"""
        logger.info("SERIES_SERVICE: toggle_asset_lock series_id=%s asset_id=%s asset_type=%s", series_id, asset_id, asset_type)
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        asset = self._find_series_asset(series, asset_id, asset_type)
        asset.locked = not asset.locked
        series.updated_at = utc_now()
        return self.series_repository.replace_graph(series)

    def update_asset_image(self, series_id: str, asset_id: str, asset_type: str, image_url: str):
        """更新系列共享资产当前选中的图片地址。"""
        logger.info("SERIES_SERVICE: update_asset_image series_id=%s asset_id=%s asset_type=%s", series_id, asset_id, asset_type)
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        asset = self._find_series_asset(series, asset_id, asset_type)
        asset.image_url = image_url
        if asset_type == "character":
            asset.avatar_url = image_url
        series.updated_at = utc_now()
        return self.series_repository.replace_graph(series)

    def update_asset_attributes(self, series_id: str, asset_id: str, asset_type: str, attributes: dict):
        """增量更新系列共享资产的可变属性。"""
        logger.info("SERIES_SERVICE: update_asset_attributes series_id=%s asset_id=%s asset_type=%s fields=%s", series_id, asset_id, asset_type, sorted(attributes.keys()))
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        asset = self._find_series_asset(series, asset_id, asset_type)
        for key, value in attributes.items():
            if hasattr(asset, key):
                setattr(asset, key, value)
        series.updated_at = utc_now()
        return self.series_repository.replace_graph(series)

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
