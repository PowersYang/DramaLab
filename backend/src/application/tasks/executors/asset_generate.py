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
        # 中文注释：统一链路后 asset.generate 既可能处理项目素材，也可能处理系列共享素材，
        # 执行分支必须以 task_jobs 主表 scope 为真源，避免历史 payload 脏字段把任务路由到错误 owner。
        series_id = job.series_id or payload.get("series_id")
        project_id = job.project_id or payload.get("project_id")

        if series_id:
            series = self.asset_workflow.execute_series_asset_generation(
                series_id=series_id,
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
                resolved_art_direction=payload.get("resolved_art_direction"),
            )
            result = {
                "series_id": series.id,
                "project_id": project_id,
                "asset_id": payload["asset_id"],
                "asset_type": payload["asset_type"],
                "generation_type": payload.get("generation_type", "all"),
            }
            metrics_resource = {
                "series_id": series.id,
                "project_id": project_id,
                "asset_id": payload["asset_id"],
                "asset_type": payload["asset_type"],
            }
        else:
            if not project_id:
                raise ValueError("素材生成任务缺少 project_id / series_id，无法执行")
            project = self.asset_workflow.execute_project_asset_generation(
                script_id=project_id,
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
                resolved_art_direction=payload.get("resolved_art_direction"),
            )
            result = {
                "project_id": project.id,
                "asset_id": payload["asset_id"],
                "asset_type": payload["asset_type"],
                "generation_type": payload.get("generation_type", "all"),
            }
            metrics_resource = {"project_id": project.id, "asset_id": payload["asset_id"], "asset_type": payload["asset_type"]}

        metrics = attach_resource_metrics(
            self.asset_workflow.image_provider.last_generation_metrics,
            operation="asset.generate",
            resource=metrics_resource,
            artifacts={"batch_size": payload.get("batch_size", 1)},
        )
        if metrics:
            result["__metrics__"] = metrics
        return result
