from ....application.workflows import AssetWorkflow
from ....common.log import get_logger
from ..metrics import attach_resource_metrics
from ....schemas.task_models import TaskJob


logger = get_logger(__name__)


class AssetGenerateExecutor:
    def __init__(self):
        self.asset_workflow = AssetWorkflow()

    def execute(self, job: TaskJob) -> dict:
        payload = job.payload_json or {}
        project = self.asset_workflow.execute_project_asset_generation(
            script_id=payload["project_id"],
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
            "project_id": project.id,
            "asset_id": payload["asset_id"],
            "asset_type": payload["asset_type"],
            "generation_type": payload.get("generation_type", "all"),
        }
        metrics = attach_resource_metrics(
            self.asset_workflow.image_provider.last_generation_metrics,
            operation="asset.generate",
            resource={"project_id": project.id, "asset_id": payload["asset_id"], "asset_type": payload["asset_type"]},
            artifacts={"batch_size": payload.get("batch_size", 1)},
        )
        if metrics:
            result["__metrics__"] = metrics
        return result
