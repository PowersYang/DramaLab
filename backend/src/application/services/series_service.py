"""
系列应用服务。

这里管理系列元数据、分集绑定，以及属于系列聚合的共享资产编辑。
"""

import uuid

from ...repository import ProjectRepository, SeriesRepository
from ...schemas.models import PromptConfig, Series
from ...utils.datetime import utc_now


class SeriesService:
    """负责系列级 CRUD 与关联关系更新。"""

    def __init__(self):
        self.series_repository = SeriesRepository()
        self.project_repository = ProjectRepository()

    def create_series(self, title: str, description: str = ""):
        """创建并持久化一个空的系列聚合。"""
        series = Series(
            id=str(uuid.uuid4()),
            title=title,
            description=description,
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        self.series_repository.create(series)
        return series

    def list_series(self):
        """返回所有系列记录。"""
        return self.series_repository.list()

    def get_series(self, series_id: str):
        """加载单个系列聚合。"""
        return self.series_repository.get(series_id)

    def update_series(self, series_id: str, updates: dict):
        """更新系列可变字段，同时保持标识字段不可改。"""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        for key, value in updates.items():
            if hasattr(series, key) and key not in ("id", "created_at", "episode_ids"):
                setattr(series, key, value)
        series.updated_at = utc_now()
        return self.series_repository.replace_graph(series)

    def delete_series(self, series_id: str):
        """删除系列，并解除所有已关联分集。"""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        for ep_id in list(series.episode_ids):
            project = self.project_repository.get(ep_id)
            if project:
                project.series_id = None
                project.episode_number = None
                project.updated_at = utc_now()
                self.project_repository.patch_metadata(ep_id, {"series_id": None, "episode_number": None, "updated_at": utc_now()}, expected_version=project.version)
        self.series_repository.soft_delete(series_id)

    def add_episode(self, series_id: str, script_id: str, episode_number: int | None = None):
        """把现有项目挂到系列下，必要时先从旧系列迁出。"""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        project = self.project_repository.get(script_id)
        if not project:
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
        return series

    def remove_episode(self, series_id: str, script_id: str):
        """把一个分集从系列中移除。"""
        series = self.get_series(series_id)
        if not series:
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
        return self.series_repository.replace_graph(series)

    def get_episodes(self, series_id: str):
        """列出当前挂在该系列下的项目。"""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        return [project for project in self.project_repository.list() if project.series_id == series_id]

    def update_prompt_config(self, series_id: str, config: PromptConfig):
        """整体替换系列级提示词覆写配置。"""
        return self.update_series(series_id, {"prompt_config": config})

    def update_model_settings(self, series_id: str, updates: dict):
        """增量更新系列级模型设置字段。"""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        series.model_settings = series.model_settings.model_copy(update={k: v for k, v in updates.items() if v is not None})
        series.updated_at = utc_now()
        return self.series_repository.patch_metadata(series_id, {"updated_at": utc_now(), "model_settings": series.model_settings.model_dump(mode="json")}, expected_version=series.version)

    def toggle_asset_lock(self, series_id: str, asset_id: str, asset_type: str):
        """切换系列共享资产的锁定状态。"""
        series = self.get_series(series_id)
        if not series:
            raise ValueError("Series not found")
        asset = self._find_series_asset(series, asset_id, asset_type)
        asset.locked = not asset.locked
        series.updated_at = utc_now()
        return self.series_repository.replace_graph(series)

    def update_asset_image(self, series_id: str, asset_id: str, asset_type: str, image_url: str):
        """更新系列共享资产当前选中的图片地址。"""
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
