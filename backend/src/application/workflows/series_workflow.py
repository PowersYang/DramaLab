"""
系列工作流。

当前主要承接系列共享素材生成与跨系列素材导入。
"""

import copy
import time
import uuid

from ...repository import SeriesRepository
from .asset_workflow import AssetWorkflow


class SeriesWorkflow:
    """负责系列共享资产生成与跨系列资产复用流程。"""

    def __init__(self):
        self.series_repository = SeriesRepository()
        self.asset_workflow = AssetWorkflow()

    def generate_series_asset(self, *args, **kwargs):
        """把系列共享资产生成转发到通用资产工作流。"""
        # 系列共享素材和项目素材共用同一套异步任务注册表，
        # 这样现有 API 的后台处理入口无需改变。
        return self.asset_workflow.create_series_asset_generation_task(*args, **kwargs)

    def import_assets_from_series(self, target_series_id: str, source_series_id: str, asset_ids: list[str]):
        """把选中的共享资产从一个系列复制到另一个系列。"""
        target = self.series_repository.get(target_series_id)
        if not target:
            raise ValueError("Target series not found")
        source = self.series_repository.get(source_series_id)
        if not source:
            raise ValueError("Source series not found")

        source_assets = {}
        for item in source.characters:
            source_assets[item.id] = ("character", item)
        for item in source.scenes:
            source_assets[item.id] = ("scene", item)
        for item in source.props:
            source_assets[item.id] = ("prop", item)

        imported_ids = []
        skipped_ids = []
        for asset_id in asset_ids:
            if asset_id not in source_assets:
                skipped_ids.append(asset_id)
                continue

            asset_type, asset = source_assets[asset_id]
            new_asset = copy.deepcopy(asset)
            new_asset.id = str(uuid.uuid4())
            if asset_type == "character":
                target.characters.append(new_asset)
            elif asset_type == "scene":
                target.scenes.append(new_asset)
            else:
                target.props.append(new_asset)
            imported_ids.append(asset_id)

        target.updated_at = time.time()
        self.series_repository.save(target)
        return target, imported_ids, skipped_ids
