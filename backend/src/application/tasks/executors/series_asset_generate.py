from ....application.workflows import AssetWorkflow
from ..metrics import attach_resource_metrics
from ....schemas.task_models import TaskJob


class SeriesAssetGenerateExecutor:
    def __init__(self):
        self.asset_workflow = AssetWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        series = self.asset_workflow.execute_series_asset_generation(
            series_id=payload["series_id"],
            asset_id=payload["asset_id"],
            asset_type=payload["asset_type"],
            style_preset=payload.get("style_preset"),
            reference_image_url=payload.get("reference_image_url"),
            style_prompt=payload.get("style_prompt"),
            generation_type=payload.get("generation_type", "all"),
            prompt=payload.get("prompt"),
            apply_style=payload.get("apply_style", True),
            negative_prompt=payload.get("negative_prompt"),
            batch_size=payload.get("batch_size", 1),
            model_name=payload.get("model_name"),
        )
        result = {
            "series_id": series.id,
            "asset_id": payload["asset_id"],
            "asset_type": payload["asset_type"],
        }
        metrics = attach_resource_metrics(
            self.asset_workflow.image_provider.last_generation_metrics,
            operation="series.asset_generate",
            resource={"series_id": series.id, "asset_id": payload["asset_id"], "asset_type": payload["asset_type"]},
            artifacts={"batch_size": payload.get("batch_size", 1)},
        )
        if metrics:
            result["__metrics__"] = metrics
        return result
