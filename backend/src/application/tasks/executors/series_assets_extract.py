from ....application.services import SeriesAssetExtractService
from ..metrics import attach_resource_metrics
from ....schemas.task_models import TaskJob


class SeriesAssetsExtractExecutor:
    """执行系列资产识别预览任务。"""

    def __init__(self):
        self.series_asset_extract_service = SeriesAssetExtractService()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        result = self.series_asset_extract_service.extract_assets_preview(
            payload["series_id"],
            payload["text"],
        )
        characters = result.get("characters", [])
        scenes = result.get("scenes", [])
        props = result.get("props", [])
        metrics = attach_resource_metrics(
            self.series_asset_extract_service.text_provider.get_last_metrics(),
            operation="series.assets.extract",
            resource={"series_id": payload["series_id"]},
            artifacts={
                "character_count": len(characters),
                "scene_count": len(scenes),
                "prop_count": len(props),
            },
        )
        response = {
            **result,
            "text_length": len(payload.get("text", "")),
            "character_count": len(characters),
            "scene_count": len(scenes),
            "prop_count": len(props),
        }
        if metrics:
            response["__metrics__"] = metrics
        return response
